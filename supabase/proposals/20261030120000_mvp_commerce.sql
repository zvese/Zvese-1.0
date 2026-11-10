-- PROPOSAL ONLY. Not part of automatic migration discovery. Requires separate review.
-- Depends on approved Stages 00, 01, 02. No seed rates, no live payments, no historical row updates.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
set local idle_in_transaction_session_timeout='30s';

create table public.shipping_rates (
 id uuid primary key default gen_random_uuid(), label text not null check(length(label) between 1 and 100),
 method text not null check(method in ('standard','express')),
 country text not null check(country ~ '^[A-Z]{2}$'), region text not null default '', city text not null default '',
 currency text not null check(currency in ('USD','ZWG')), amount_minor bigint not null check(amount_minor between 0 and 999999999999),
 active boolean not null default false,
 unique(method,country,region,city,currency)
);
create table public.order_commerce (
 order_id uuid primary key references public.orders(id) on delete restrict,
 rate_id uuid not null references public.shipping_rates(id) on delete restrict,
 shipping_minor bigint not null check(shipping_minor between 0 and 999999999999),
 total_minor bigint not null check(total_minor between 1 and 999999999999),
 currency text not null check(currency in ('USD','ZWG')), mode text not null default 'sandbox' check(mode='sandbox'),
 payment_status text not null default 'unpaid' check(payment_status in ('unpaid','initiating','pending','paid','failed','cancelled','refunded')),
 fulfillment_status text not null default 'unfulfilled' check(fulfillment_status in ('unfulfilled','sourcing','dispatched','delivered')),
 tracking_reference text check(length(tracking_reference) between 1 and 200),
 cancel_requested boolean not null default false, refund_requested boolean not null default false,
 updated_at timestamptz not null default now()
);
create table public.payment_attempts (
 id uuid primary key default gen_random_uuid(), order_id uuid not null unique references public.order_commerce(order_id),
 provider text not null default 'pesepay' check(provider='pesepay'), mode text not null default 'sandbox' check(mode='sandbox'),
 amount_minor bigint not null check(amount_minor between 1 and 999999999999), currency text not null check(currency in ('USD','ZWG')),
 provider_reference text unique check(length(provider_reference) between 1 and 160), redirect_url text,
 status text not null default 'initiating' check(status in ('initiating','pending','paid','failed','cancelled','refunded')),
 checked_after timestamptz not null default '-infinity', created_at timestamptz not null default now()
);
create table public.commerce_events (
 id bigint generated always as identity primary key, order_id uuid not null references public.orders(id),
 event_type text not null, actor_id uuid, created_at timestamptz not null default now(),
 detail text not null check(length(detail)<=250)
);
alter table public.shipping_rates enable row level security;
alter table public.order_commerce enable row level security;
alter table public.payment_attempts enable row level security;
alter table public.commerce_events enable row level security;
revoke all on public.shipping_rates,public.order_commerce,public.payment_attempts,public.commerce_events from public,anon,authenticated,service_role;
revoke all on sequence public.commerce_events_id_seq from public,anon,authenticated,service_role;
grant select on public.shipping_rates to anon,authenticated;
grant select on public.order_commerce to authenticated;
grant select on public.payment_attempts to service_role;
create policy "Active shipping quotes" on public.shipping_rates for select to anon,authenticated using(active);
create policy "Buyer and admin commerce" on public.order_commerce for select to authenticated using(
 exists(select 1 from public.orders o where o.id=order_id and o.buyer_user_id=auth.uid()) or private.is_order_super_admin()
);

create function public.create_checkout_order(p_listing_id uuid,p_expected_revision integer,p_checkout_id uuid,p_delivery jsonb,p_rate_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare oid uuid; o public.orders; r public.shipping_rates; c public.order_commerce;
begin
 -- Calls the reviewed order function: auth, canonical price, publication, revision, locks and idempotency.
 oid:=public.create_buyer_order(p_listing_id,p_expected_revision,p_checkout_id,p_delivery);
 select * into strict o from public.orders where id=oid for update;
 select * into c from public.order_commerce where order_id=oid;
 if found then
   if c.rate_id is distinct from p_rate_id then raise exception 'Checkout delivery changed' using errcode='22023'; end if;
   return oid;
 end if;
 select * into r from public.shipping_rates where id=p_rate_id and active for share;
 if not found or r.currency<>o.currency or r.country<>o.country or r.method<>o.delivery_method
 or (r.region<>'' and lower(r.region)<>lower(btrim(o.region))) or (r.city<>'' and lower(r.city)<>lower(btrim(o.city))) then
   raise exception 'Delivery service unavailable' using errcode='22023';
 end if;
 insert into public.order_commerce(order_id,rate_id,shipping_minor,total_minor,currency)
 values(oid,r.id,r.amount_minor,o.subtotal+r.amount_minor,o.currency);
 return oid;
end; $$;

create function public.reserve_order_payment(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.orders; c public.order_commerce; a public.payment_attempts;
begin
 select * into o from public.orders where id=p_order_id and buyer_user_id=auth.uid() for update;
 if not found then raise exception 'Order unavailable' using errcode='42501'; end if;
 select * into strict c from public.order_commerce where order_id=o.id for update;
 select * into a from public.payment_attempts where order_id=o.id;
 if found then return jsonb_build_object('claimed',false,'id',a.id,'redirect_url',a.redirect_url,'status',a.status); end if;
 if c.cancel_requested or c.refund_requested or c.payment_status<>'unpaid' or c.mode<>'sandbox' then raise exception 'Payment unavailable'; end if;
 if (select count(*) from public.order_items where order_id=o.id)<>1 or exists(
   select 1 from public.order_items i where i.order_id=o.id and not private.listing_is_orderable(i.listing_id)
 ) then raise exception 'Listing no longer orderable'; end if;
 insert into public.payment_attempts(order_id,amount_minor,currency) values(o.id,c.total_minor,c.currency) returning * into a;
 update public.order_commerce set payment_status='initiating',updated_at=now() where order_id=o.id;
 return jsonb_build_object('claimed',true,'id',a.id,'amount_minor',a.amount_minor,'currency',a.currency);
end; $$;

create function public.bind_payment_reference(p_attempt_id uuid,p_reference text,p_redirect text)
returns void language plpgsql security definer set search_path='' as $$
declare a public.payment_attempts;
begin
 if p_reference is null or p_reference !~ '^[A-Za-z0-9_-]{1,160}$' or p_redirect is null or length(p_redirect)>2048 then raise exception 'Invalid payment reference'; end if;
 select * into strict a from public.payment_attempts where id=p_attempt_id for update;
 if a.provider_reference is not null then
   if a.provider_reference<>p_reference or a.redirect_url<>p_redirect then raise exception 'Payment binding conflict'; end if;
   return;
 end if;
 update public.payment_attempts set provider_reference=p_reference,redirect_url=p_redirect,status='pending' where id=a.id;
 update public.order_commerce set payment_status='pending',updated_at=now() where order_id=a.order_id;
 insert into public.commerce_events(order_id,event_type,detail) values(a.order_id,'payment_bound','sandbox');
end; $$;

create function public.claim_payment_check(p_attempt_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 update public.payment_attempts set checked_after=now()+interval '20 seconds'
 where id=p_attempt_id and provider_reference is not null and checked_after<=now();
 return found;
end; $$;

-- Only server-side authenticated provider reconciliation may call this function.
-- Row lock + monotonic transitions make duplicate callbacks harmless. No browser execution grant.
create function public.apply_verified_payment(p_attempt_id uuid,p_reference text,p_amount bigint,p_currency text,p_status text)
returns void language plpgsql security definer set search_path='' as $$
declare a public.payment_attempts; v_status text;
begin
 if p_status is null or p_status not in ('pending','paid','failed','cancelled','refunded') then raise exception 'Invalid payment state'; end if;
 select * into strict a from public.payment_attempts where id=p_attempt_id for update;
 if a.provider_reference is null or p_reference is distinct from a.provider_reference or p_amount is distinct from a.amount_minor
 or p_currency is distinct from a.currency or a.mode<>'sandbox' then raise exception 'Payment reconciliation mismatch'; end if;
 v_status:=p_status;
 if a.status='refunded' or (a.status='paid' and p_status<>'refunded') or
    (a.status in ('failed','cancelled') and p_status not in ('paid','refunded')) then v_status:=a.status; end if;
 if v_status=a.status then return; end if;
 update public.payment_attempts set status=v_status where id=a.id;
 update public.order_commerce set payment_status=v_status,updated_at=now() where order_id=a.order_id;
 insert into public.commerce_events(order_id,event_type,detail) values(a.order_id,'payment_verified',v_status||':sandbox');
end; $$;

create function public.request_order_resolution(p_order_id uuid,p_kind text) returns void
language plpgsql security definer set search_path='' as $$
declare c public.order_commerce;
begin
 if not exists(select 1 from public.orders where id=p_order_id and buyer_user_id=auth.uid()) then raise exception 'Order unavailable' using errcode='42501'; end if;
 select * into strict c from public.order_commerce where order_id=p_order_id for update;
 if p_kind='cancel' and c.fulfillment_status in ('unfulfilled','sourcing') then
   update public.order_commerce set cancel_requested=true,updated_at=now() where order_id=p_order_id;
 elsif p_kind='refund' and c.payment_status='paid' then
   update public.order_commerce set refund_requested=true,updated_at=now() where order_id=p_order_id;
 else raise exception 'Request unavailable'; end if;
 insert into public.commerce_events(order_id,event_type,actor_id,detail) values(p_order_id,'buyer_request',auth.uid(),p_kind);
end; $$;

create function public.advance_order_fulfillment(p_order_id uuid,p_expected text,p_next text,p_tracking text) returns void
language plpgsql security definer set search_path='' as $$
declare c public.order_commerce;
begin
 if not private.is_order_super_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
 select * into strict c from public.order_commerce where order_id=p_order_id for update;
 if c.payment_status<>'paid' or c.cancel_requested or c.refund_requested or c.fulfillment_status is distinct from p_expected then raise exception 'Order not eligible for fulfillment'; end if;
 if not ((p_expected='unfulfilled' and p_next='sourcing') or (p_expected='sourcing' and p_next='dispatched') or (p_expected='dispatched' and p_next='delivered')) or p_next is null then raise exception 'Invalid fulfillment transition'; end if;
 if p_next='dispatched' and (p_tracking is null or length(btrim(p_tracking)) not between 1 and 200) then raise exception 'Dispatch reference required'; end if;
 update public.order_commerce set fulfillment_status=p_next,
 tracking_reference=case when p_next='dispatched' then btrim(p_tracking) else tracking_reference end,updated_at=now() where order_id=p_order_id;
 insert into public.commerce_events(order_id,event_type,actor_id,detail) values(p_order_id,'fulfillment',auth.uid(),p_next||':sandbox');
end; $$;

create function public.get_sale_commerce(p_order_id uuid) returns setof public.order_commerce
language sql stable security definer set search_path='' as $$
 select c.* from public.order_commerce c where c.order_id=p_order_id and exists(
   select 1 from public.order_items i join public.seller_profiles s on s.id=i.seller_profile_id
   where i.order_id=c.order_id and s.user_id=auth.uid() and s.status='active'
 ) and (select count(*) from public.order_items i where i.order_id=c.order_id)=1;
$$;

-- Explicit ownership and exhaustive function ACLs; no inherited PUBLIC EXECUTE defaults.
alter function public.create_checkout_order(uuid,integer,uuid,jsonb,uuid) owner to postgres;
alter function public.reserve_order_payment(uuid) owner to postgres;
alter function public.bind_payment_reference(uuid,text,text) owner to postgres;
alter function public.claim_payment_check(uuid) owner to postgres;
alter function public.apply_verified_payment(uuid,text,bigint,text,text) owner to postgres;
alter function public.request_order_resolution(uuid,text) owner to postgres;
alter function public.advance_order_fulfillment(uuid,text,text,text) owner to postgres;
alter function public.get_sale_commerce(uuid) owner to postgres;
revoke all on function public.create_checkout_order(uuid,integer,uuid,jsonb,uuid),public.reserve_order_payment(uuid),public.bind_payment_reference(uuid,text,text),public.claim_payment_check(uuid),public.apply_verified_payment(uuid,text,bigint,text,text),public.request_order_resolution(uuid,text),public.advance_order_fulfillment(uuid,text,text,text),public.get_sale_commerce(uuid) from public,anon,authenticated,service_role;
grant execute on function public.create_checkout_order(uuid,integer,uuid,jsonb,uuid),public.reserve_order_payment(uuid),public.request_order_resolution(uuid,text),public.advance_order_fulfillment(uuid,text,text,text),public.get_sale_commerce(uuid) to authenticated;
grant execute on function public.bind_payment_reference(uuid,text,text),public.claim_payment_check(uuid),public.apply_verified_payment(uuid,text,bigint,text,text) to service_role;
commit;
