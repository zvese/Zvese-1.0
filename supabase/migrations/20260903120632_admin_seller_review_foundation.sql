-- ============================================================
-- Zvese 1.0 - Admin seller review foundation
-- Migration: 20260903120632_admin_seller_review_foundation.sql
--
-- Adds the minimum authorization, review, and immutable decision
-- foundation for human seller reviewers and future policy automation.
-- No administrator is bootstrapped by this migration.
-- ============================================================


create schema if not exists private;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;


create table public.admin_memberships (
  user_id uuid primary key
    references auth.users(id)
    on delete cascade,

  role text not null
    constraint admin_memberships_role_check
    check (role in ('seller_reviewer', 'super_admin')),

  is_active boolean not null default true,

  created_at timestamptz not null default now(),

  updated_at timestamptz not null default now()
);


create trigger admin_memberships_set_updated_at
before update on public.admin_memberships
for each row
execute function public.set_updated_at();


alter table public.seller_profiles
  drop constraint seller_profiles_status_check,
  add constraint seller_profiles_status_check
  check (
    status in (
      'pending',
      'active',
      'suspended',
      'closed',
      'rejected'
    )
  );


create table public.seller_application_reviews (
  id uuid primary key default gen_random_uuid(),

  seller_profile_id uuid not null
    references public.seller_profiles(id)
    on delete restrict,

  review_type text not null
    constraint seller_application_reviews_review_type_check
    check (review_type in ('deterministic', 'ai', 'manual')),

  status text not null default 'queued'
    constraint seller_application_reviews_status_check
    check (status in ('queued', 'running', 'completed', 'failed', 'superseded')),

  risk_score numeric
    constraint seller_application_reviews_risk_score_check
    check (risk_score is null or risk_score between 0 and 1),

  confidence numeric
    constraint seller_application_reviews_confidence_check
    check (confidence is null or confidence between 0 and 1),

  recommendation text
    constraint seller_application_reviews_recommendation_check
    check (
      recommendation is null
      or recommendation in ('approve', 'hold', 'reject', 'no_action')
    ),

  signals jsonb not null default '[]'::jsonb
    constraint seller_application_reviews_signals_check
    check (jsonb_typeof(signals) = 'array'),

  evidence_refs jsonb not null default '[]'::jsonb
    constraint seller_application_reviews_evidence_refs_check
    check (jsonb_typeof(evidence_refs) = 'array'),

  subject_snapshot jsonb
    constraint seller_application_reviews_subject_snapshot_check
    check (
      subject_snapshot is null
      or jsonb_typeof(subject_snapshot) = 'object'
    ),

  rationale text
    constraint seller_application_reviews_rationale_check
    check (rationale is null or char_length(rationale) <= 4000),

  provider text,

  model text,

  model_version text,

  policy_version text not null
    constraint seller_application_reviews_policy_version_check
    check (char_length(trim(policy_version)) between 1 and 100),

  created_by uuid
    references auth.users(id)
    on delete set null,

  created_at timestamptz not null default now(),

  started_at timestamptz,

  completed_at timestamptz,

  constraint seller_application_reviews_timestamps_check
  check (
    (started_at is null or started_at >= created_at)
    and (
      completed_at is null
      or completed_at >= coalesce(started_at, created_at)
    )
  )
);


create table public.seller_application_decisions (
  id uuid primary key default gen_random_uuid(),

  seller_profile_id uuid not null
    references public.seller_profiles(id)
    on delete restrict,

  review_id uuid
    references public.seller_application_reviews(id)
    on delete restrict,

  decision text not null
    constraint seller_application_decisions_decision_check
    check (decision in ('approve', 'reject', 'hold', 'reopen')),

  from_status text not null
    constraint seller_application_decisions_from_status_check
    check (from_status in ('pending', 'active', 'suspended', 'closed', 'rejected')),

  to_status text not null
    constraint seller_application_decisions_to_status_check
    check (to_status in ('pending', 'active', 'suspended', 'closed', 'rejected')),

  decided_by uuid not null
    references auth.users(id)
    on delete restrict,

  public_reason text
    constraint seller_application_decisions_public_reason_check
    check (public_reason is null or char_length(trim(public_reason)) between 1 and 2000),

  internal_reason text
    constraint seller_application_decisions_internal_reason_check
    check (internal_reason is null or char_length(trim(internal_reason)) between 1 and 2000),

  policy_version text not null
    constraint seller_application_decisions_policy_version_check
    check (char_length(trim(policy_version)) between 1 and 100),

  supersedes_decision_id uuid
    references public.seller_application_decisions(id)
    on delete restrict,

  created_at timestamptz not null default now(),

  constraint seller_application_decisions_transition_check
  check (
    (decision = 'approve' and from_status = 'pending' and to_status = 'active')
    or (decision = 'reject' and from_status = 'pending' and to_status = 'rejected')
    or (decision = 'hold' and from_status = 'pending' and to_status = 'pending')
    or (decision = 'reopen' and from_status = 'rejected' and to_status = 'pending')
  ),

  constraint seller_application_decisions_reason_required_check
  check (
    decision = 'approve'
    or (
      coalesce(
        nullif(trim(public_reason), ''),
        nullif(trim(internal_reason), '')
      ) is not null
    )
  )
);


comment on table public.seller_application_reviews is
  'Advisory deterministic, AI, or manual seller assessments; not authoritative status changes.';

comment on column public.seller_application_reviews.rationale is
  'Concise decision rationale only. Hidden model reasoning or chain-of-thought must not be stored.';

comment on table public.seller_application_decisions is
  'Immutable audit records for authorized seller application state transitions.';


create index seller_profiles_status_idx
  on public.seller_profiles(status);

create index seller_application_reviews_seller_created_idx
  on public.seller_application_reviews(seller_profile_id, created_at desc);

create index seller_application_reviews_status_created_idx
  on public.seller_application_reviews(status, created_at);

create index seller_application_decisions_seller_created_idx
  on public.seller_application_decisions(seller_profile_id, created_at desc);


alter table public.admin_memberships enable row level security;
alter table public.seller_application_reviews enable row level security;
alter table public.seller_application_decisions enable row level security;


revoke all on table public.admin_memberships
from public, anon, authenticated;

revoke all on table public.seller_application_reviews
from public, anon, authenticated;

revoke all on table public.seller_application_decisions
from public, anon, authenticated;

grant select on table public.admin_memberships to authenticated;
grant select on table public.seller_application_reviews to authenticated;
grant select on table public.seller_application_decisions to authenticated;


create policy "Users can view their own admin membership"
on public.admin_memberships
for select
to authenticated
using ((select auth.uid()) = user_id);


create or replace function private.is_active_seller_reviewer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_memberships am
    where am.user_id = (select auth.uid())
      and am.is_active = true
      and am.role in ('seller_reviewer', 'super_admin')
  );
$$;


revoke execute on function private.is_active_seller_reviewer()
from public, anon, authenticated;

grant execute on function private.is_active_seller_reviewer()
to authenticated;


create policy "Seller reviewers can view seller profiles"
on public.seller_profiles
for select
to authenticated
using ((select private.is_active_seller_reviewer()));


create policy "Seller reviewers can view application reviews"
on public.seller_application_reviews
for select
to authenticated
using ((select private.is_active_seller_reviewer()));


create policy "Seller reviewers can view application decisions"
on public.seller_application_decisions
for select
to authenticated
using ((select private.is_active_seller_reviewer()));


create or replace function private.prevent_seller_application_decision_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception
    'Seller application decisions are append-only';
end;
$$;


revoke execute
on function private.prevent_seller_application_decision_mutation()
from public, anon, authenticated;


create trigger seller_application_decisions_append_only
before update or delete on public.seller_application_decisions
for each row
execute function private.prevent_seller_application_decision_mutation();


create or replace function private.decide_seller_application(
  p_seller_profile_id uuid,
  p_decision text,
  p_review_id uuid default null,
  p_public_reason text default null,
  p_internal_reason text default null,
  p_policy_version text default 'seller-review-v1'
)
returns table (
  seller_profile_id uuid,
  seller_status text,
  decision_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reviewer_id uuid := (select auth.uid());
  v_seller_user_id uuid;
  v_from_status text;
  v_to_status text;
  v_decision_id uuid;
  v_supersedes_decision_id uuid;
begin
  if v_reviewer_id is null then
    raise exception 'Authentication required'
      using errcode = '28000';
  end if;

  if not (select private.is_active_seller_reviewer()) then
    raise exception 'Seller reviewer authorization required'
      using errcode = '42501';
  end if;

  if p_decision is null
     or p_decision not in ('approve', 'reject', 'hold', 'reopen')
  then
    raise exception 'Invalid seller application decision'
      using errcode = '22023';
  end if;

  if p_policy_version is null
     or char_length(trim(p_policy_version)) not between 1 and 100
  then
    raise exception 'A valid policy version is required'
      using errcode = '22023';
  end if;

  if p_public_reason is not null
     and char_length(trim(p_public_reason)) not between 1 and 2000
  then
    raise exception 'Public reason must be between 1 and 2000 characters'
      using errcode = '22023';
  end if;

  if p_internal_reason is not null
     and char_length(trim(p_internal_reason)) not between 1 and 2000
  then
    raise exception 'Internal reason must be between 1 and 2000 characters'
      using errcode = '22023';
  end if;

  if p_decision = 'reject'
     and nullif(trim(p_public_reason), '') is null
  then
    raise exception 'A public reason is required to reject an application'
      using errcode = '22023';
  end if;

  if p_decision in ('hold', 'reopen')
     and coalesce(
       nullif(trim(p_public_reason), ''),
       nullif(trim(p_internal_reason), '')
     ) is null
  then
    raise exception 'A reason is required for this decision'
      using errcode = '22023';
  end if;

  select sp.user_id, sp.status
  into v_seller_user_id, v_from_status
  from public.seller_profiles sp
  where sp.id = p_seller_profile_id
  for update;

  if not found then
    raise exception 'Seller profile not found'
      using errcode = 'P0002';
  end if;

  if v_seller_user_id = v_reviewer_id then
    raise exception 'Administrators cannot review their own seller application'
      using errcode = '42501';
  end if;

  if p_decision in ('approve', 'reject', 'hold')
     and v_from_status <> 'pending'
  then
    raise exception 'Only pending seller applications can receive this decision'
      using errcode = 'P0001';
  end if;

  if p_decision = 'reopen'
     and v_from_status <> 'rejected'
  then
    raise exception 'Only rejected seller applications can be reopened'
      using errcode = 'P0001';
  end if;

  if p_review_id is not null
     and not exists (
       select 1
       from public.seller_application_reviews sar
       where sar.id = p_review_id
         and sar.seller_profile_id = p_seller_profile_id
         and sar.status = 'completed'
     )
  then
    raise exception 'Review does not belong to this seller application or is incomplete'
      using errcode = '23503';
  end if;

  v_to_status := case p_decision
    when 'approve' then 'active'
    when 'reject' then 'rejected'
    when 'hold' then 'pending'
    when 'reopen' then 'pending'
  end;

  select sad.id
  into v_supersedes_decision_id
  from public.seller_application_decisions sad
  where sad.seller_profile_id = p_seller_profile_id
  order by sad.created_at desc, sad.id desc
  limit 1;

  insert into public.seller_application_decisions (
    seller_profile_id,
    review_id,
    decision,
    from_status,
    to_status,
    decided_by,
    public_reason,
    internal_reason,
    policy_version,
    supersedes_decision_id
  )
  values (
    p_seller_profile_id,
    p_review_id,
    p_decision,
    v_from_status,
    v_to_status,
    v_reviewer_id,
    nullif(trim(p_public_reason), ''),
    nullif(trim(p_internal_reason), ''),
    trim(p_policy_version),
    v_supersedes_decision_id
  )
  returning id into v_decision_id;

  update public.seller_profiles
  set status = v_to_status
  where id = p_seller_profile_id;

  return query
  select p_seller_profile_id, v_to_status, v_decision_id;
end;
$$;


revoke execute
on function private.decide_seller_application(uuid, text, uuid, text, text, text)
from public, anon, authenticated;

grant execute
on function private.decide_seller_application(uuid, text, uuid, text, text, text)
to authenticated;


create or replace function public.decide_seller_application(
  p_seller_profile_id uuid,
  p_decision text,
  p_review_id uuid default null,
  p_public_reason text default null,
  p_internal_reason text default null,
  p_policy_version text default 'seller-review-v1'
)
returns table (
  seller_profile_id uuid,
  seller_status text,
  decision_id uuid
)
language sql
security invoker
set search_path = ''
as $$
  select *
  from private.decide_seller_application(
    p_seller_profile_id,
    p_decision,
    p_review_id,
    p_public_reason,
    p_internal_reason,
    p_policy_version
  );
$$;


revoke execute
on function public.decide_seller_application(uuid, text, uuid, text, text, text)
from public, anon, authenticated;

grant execute
on function public.decide_seller_application(uuid, text, uuid, text, text, text)
to authenticated;


create or replace function private.get_my_latest_seller_application_decision()
returns table (
  decision text,
  seller_status text,
  public_reason text,
  policy_version text,
  decided_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    sad.decision,
    sad.to_status,
    sad.public_reason,
    sad.policy_version,
    sad.created_at
  from public.seller_application_decisions sad
  join public.seller_profiles sp
    on sp.id = sad.seller_profile_id
  where sp.user_id = (select auth.uid())
  order by sad.created_at desc, sad.id desc
  limit 1;
$$;


revoke execute
on function private.get_my_latest_seller_application_decision()
from public, anon, authenticated;

grant execute
on function private.get_my_latest_seller_application_decision()
to authenticated;


create or replace function public.get_my_latest_seller_application_decision()
returns table (
  decision text,
  seller_status text,
  public_reason text,
  policy_version text,
  decided_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from private.get_my_latest_seller_application_decision();
$$;


revoke execute
on function public.get_my_latest_seller_application_decision()
from public, anon, authenticated;

grant execute
on function public.get_my_latest_seller_application_decision()
to authenticated;
