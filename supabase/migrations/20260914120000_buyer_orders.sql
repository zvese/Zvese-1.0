-- Unpaid, one-item checkout. Amounts use the marketplace's integer minor units.
create table public.orders (
 id uuid primary key default gen_random_uuid(),
 buyer_user_id uuid not null references public.profiles(id) on delete restrict,
 checkout_id uuid not null,
 request_fingerprint text not null,
 status text not null default 'pending' check(status='pending'),
 currency text not null check(currency ~ '^[A-Z]{3}$'),
 subtotal bigint not null check(subtotal between 0 and 9007199254740991),
 delivery_method text not null check(delivery_method in ('standard','express')),
 recipient_name text not null check(char_length(btrim(recipient_name)) between 1 and 120),
 phone text not null check(char_length(btrim(phone)) between 3 and 40),
 address_line1 text not null check(char_length(btrim(address_line1)) between 1 and 200),
 address_line2 text check(char_length(address_line2)<=200),
 city text not null check(char_length(btrim(city)) between 1 and 100),
 region text not null check(char_length(btrim(region)) between 1 and 100),
 postal_code text check(char_length(postal_code)<=30),
 country text not null check(country ~ '^[A-Z]{2}$'),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(buyer_user_id,checkout_id)
);
create table public.order_items (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.orders(id) on delete restrict,
 product_id uuid not null references public.products(id) on delete restrict,
 listing_id uuid not null references public.listings(id) on delete restrict,
 seller_profile_id uuid not null references public.seller_profiles(id) on delete restrict,
 submission_revision integer not null check(submission_revision>0),
 product_name text not null,
 seller_name text not null,
 unit_price bigint not null check(unit_price between 0 and 9007199254740991),
 currency text not null check(currency ~ '^[A-Z]{3}$'),
 quantity integer not null check(quantity between 1 and 1000),
 line_total bigint not null check(line_total between 0 and 9007199254740991 and line_total=unit_price*quantity),
 created_at timestamptz not null default now(),
 unique(order_id,listing_id)
);
create index orders_buyer_created_idx on public.orders(buyer_user_id,created_at desc);
create index order_items_seller_created_idx on public.order_items(seller_profile_id,created_at desc);
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
revoke all on public.orders,public.order_items from public,anon,authenticated,service_role;
grant select on public.orders,public.order_items to authenticated;

create function private.is_order_super_admin() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.admin_memberships where user_id=auth.uid() and is_active and role='super_admin');
$$;
revoke all on function private.is_order_super_admin() from public,anon,authenticated,service_role;
grant execute on function private.is_order_super_admin() to authenticated;
create policy "Buyer or super admin reads orders" on public.orders for select to authenticated
 using(buyer_user_id=(select auth.uid()) or private.is_order_super_admin());
create policy "Participants read order items" on public.order_items for select to authenticated using(
 private.is_order_super_admin()
 or exists(select 1 from public.orders o where o.id=order_id and o.buyer_user_id=(select auth.uid()))
 or exists(select 1 from public.seller_profiles s where s.id=seller_profile_id and s.user_id=(select auth.uid()) and s.status='active')
);

-- Reuse public eligibility without giving legacy compatibility listings a purchase bypass.
create function private.listing_is_orderable(p_listing_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.listings l
 join public.listing_submissions s on s.listing_id=l.id and s.revision=l.current_revision
 join public.product_review_events e on e.listing_id=l.id and e.revision=l.current_revision
 where l.id=p_listing_id and private.listing_is_public(l.id)
 and l.review_state='approved' and l.availability_mode='source_managed' and l.availability_state='available'
 and e.decision='approved' and e.snapshot_hash=s.snapshot_hash
 and e.files_fingerprint=private.submission_files_fingerprint(l.id,l.current_revision));
$$;
revoke all on function private.listing_is_orderable(uuid) from public,anon,authenticated,service_role;

create function public.get_checkout_listing(p_listing_id uuid)
returns table(listing_id uuid,product_name text,seller_name text,unit_price bigint,currency text,revision integer)
language sql stable security definer set search_path='' as $$
 select l.id,p.title,s.store_name,l.price_minor,l.currency,l.current_revision
 from public.listings l join public.products p on p.id=l.product_id join public.seller_profiles s on s.id=l.seller_id
 where auth.uid() is not null and l.id=p_listing_id and private.listing_is_orderable(l.id);
$$;
revoke all on function public.get_checkout_listing(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_checkout_listing(uuid) to authenticated;

create function public.create_buyer_order(p_listing_id uuid,p_expected_revision integer,p_checkout_id uuid,p_delivery jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_buyer uuid:=auth.uid(); l public.listings; p public.products; s public.seller_profiles;
 v_order uuid; v_fingerprint text; v_existing public.orders;
begin
 if v_buyer is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_checkout_id is null or p_listing_id is null or p_expected_revision is null then raise exception 'Invalid checkout' using errcode='22023'; end if;
 if p_delivery is null or jsonb_typeof(p_delivery)<>'object' or octet_length(p_delivery::text)>8000
 or exists(select 1 from jsonb_object_keys(p_delivery) k where k not in ('delivery_method','recipient_name','phone','address_line1','address_line2','city','region','postal_code','country'))
 or exists(select 1 from jsonb_each(p_delivery) kv where jsonb_typeof(kv.value) not in ('string','null'))
 then raise exception 'Invalid delivery details' using errcode='22023'; end if;
 v_fingerprint:=encode(extensions.digest(jsonb_build_object('listing',p_listing_id,'revision',p_expected_revision,'delivery',p_delivery)::text,'sha256'),'hex');
 -- Serialize retries of one checkout, including across separate HTTP requests.
 perform pg_advisory_xact_lock(hashtextextended(v_buyer::text||p_checkout_id::text,0));
 select * into v_existing from public.orders where buyer_user_id=v_buyer and checkout_id=p_checkout_id;
 if found then
   if v_existing.request_fingerprint<>v_fingerprint then raise exception 'Checkout already used with different details' using errcode='22023'; end if;
   return v_existing.id;
 end if;
 -- Lock in the same listing-then-seller order as product review/revision operations.
 select * into l from public.listings where id=p_listing_id for update;
 if not found then raise exception 'Listing unavailable for purchase' using errcode='55000'; end if;
 select * into s from public.seller_profiles where id=l.seller_id for share;
 select * into p from public.products where id=l.product_id for share;
 if l.current_revision<>p_expected_revision or p.status<>'active' or s.status<>'active'
 or not private.listing_is_orderable(l.id) then raise exception 'Listing unavailable for purchase' using errcode='55000'; end if;
 insert into public.orders(buyer_user_id,checkout_id,request_fingerprint,currency,subtotal,delivery_method,recipient_name,phone,address_line1,address_line2,city,region,postal_code,country)
 values(v_buyer,p_checkout_id,v_fingerprint,l.currency,l.price_minor,p_delivery->>'delivery_method',
 btrim(p_delivery->>'recipient_name'),btrim(p_delivery->>'phone'),btrim(p_delivery->>'address_line1'),nullif(btrim(p_delivery->>'address_line2'),''),
 btrim(p_delivery->>'city'),btrim(p_delivery->>'region'),nullif(btrim(p_delivery->>'postal_code'),''),upper(btrim(p_delivery->>'country')))
 returning id into v_order;
 insert into public.order_items(order_id,product_id,listing_id,seller_profile_id,submission_revision,product_name,seller_name,unit_price,currency,quantity,line_total)
 values(v_order,p.id,l.id,s.id,l.current_revision,p.title,s.store_name,l.price_minor,l.currency,1,l.price_minor*1);
 return v_order;
end; $$;
revoke all on function public.create_buyer_order(uuid,integer,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.create_buyer_order(uuid,integer,uuid,jsonb) to authenticated;

-- Sellers do not receive orders-table SELECT access. This projection intentionally
-- omits buyer identity, checkout keys, order subtotal and other sellers' items.
create function public.get_my_sales(p_offset integer default 0)
returns table(order_id uuid,product_name text,seller_name text,quantity integer,line_total bigint,currency text,
 delivery_method text,status text,recipient_name text,phone text,address_line1 text,address_line2 text,
 city text,region text,postal_code text,country text,created_at timestamptz)
language sql stable security definer set search_path='' as $$
 select o.id,i.product_name,i.seller_name,i.quantity,i.line_total,i.currency,o.delivery_method,o.status,
 o.recipient_name,o.phone,o.address_line1,o.address_line2,o.city,o.region,o.postal_code,o.country,o.created_at
 from public.order_items i join public.orders o on o.id=i.order_id
 join public.seller_profiles s on s.id=i.seller_profile_id
 where s.user_id=auth.uid() and s.status='active'
 order by o.created_at desc,i.id limit 50 offset greatest(0,least(coalesce(p_offset,0),100000));
$$;
revoke all on function public.get_my_sales(integer) from public,anon,authenticated,service_role;
grant execute on function public.get_my_sales(integer) to authenticated;

comment on table public.orders is 'Unpaid pending orders. No payment, delivery fee, stock reservation or fulfillment execution. Retained snapshots; deletion requires a future explicit retention policy.';
comment on function public.create_buyer_order(uuid,integer,uuid,jsonb) is 'One canonical item, quantity one. Idempotent per buyer/checkout UUID. Browser supplied prices, sellers and totals are never accepted.';
