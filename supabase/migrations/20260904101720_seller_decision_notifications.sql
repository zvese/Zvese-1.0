-- ============================================================
-- ZVESE 1.0 - SELLER DECISION NOTIFICATIONS AND EMAIL OUTBOX
-- ============================================================
-- Adds creator-safe in-app notifications and a transactional email outbox.
-- Email delivery remains an application-server concern after this transaction.


create table public.notifications (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null
    references auth.users(id)
    on delete cascade,

  type text not null
    constraint notifications_type_check
    check (
      type in (
        'seller_application_approved',
        'seller_application_held',
        'seller_application_rejected',
        'seller_application_reopened'
      )
    ),

  title text not null
    constraint notifications_title_check
    check (char_length(trim(title)) between 1 and 200),

  body text not null
    constraint notifications_body_check
    check (char_length(trim(body)) between 1 and 10000),

  related_seller_profile_id uuid
    references public.seller_profiles(id)
    on delete restrict,

  related_decision_id uuid unique
    references public.seller_application_decisions(id)
    on delete restrict,

  metadata jsonb not null default '{}'::jsonb
    constraint notifications_metadata_object_check
    check (jsonb_typeof(metadata) = 'object'),

  read_at timestamptz,

  created_at timestamptz not null default now()
);


create table public.notification_email_outbox (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null
    references auth.users(id)
    on delete restrict,

  recipient_email text not null
    constraint notification_email_outbox_recipient_check
    check (
      recipient_email = trim(recipient_email)
      and char_length(recipient_email) between 3 and 320
      and strpos(recipient_email, '@') > 1
    ),

  notification_id uuid not null unique
    references public.notifications(id)
    on delete restrict,

  decision_id uuid not null unique
    references public.seller_application_decisions(id)
    on delete restrict,

  template_type text not null
    constraint notification_email_outbox_template_type_check
    check (template_type in ('approve', 'hold', 'reject', 'reopen')),

  subject text not null
    constraint notification_email_outbox_subject_check
    check (char_length(trim(subject)) between 1 and 300),

  body text not null
    constraint notification_email_outbox_body_check
    check (char_length(trim(body)) between 1 and 10000),

  status text not null default 'queued'
    constraint notification_email_outbox_status_check
    check (status in ('queued', 'sending', 'sent', 'failed')),

  attempts integer not null default 0
    constraint notification_email_outbox_attempts_check
    check (attempts >= 0),

  last_error text
    constraint notification_email_outbox_last_error_check
    check (
      last_error is null
      or char_length(trim(last_error)) between 1 and 1000
    ),

  provider_message_id text,
  claim_token uuid,

  claimed_by uuid
    references auth.users(id)
    on delete restrict,

  claimed_at timestamptz,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint notification_email_outbox_claim_state_check
  check (
    (
      status = 'sending'
      and claim_token is not null
      and claimed_by is not null
      and claimed_at is not null
    )
    or (
      status <> 'sending'
      and claim_token is null
      and claimed_by is null
      and claimed_at is null
    )
  ),

  constraint notification_email_outbox_sent_state_check
  check (
    (status = 'sent' and sent_at is not null)
    or (status <> 'sent' and sent_at is null)
  )
);


comment on table public.notifications is
  'Creator-safe Zvese in-app notifications. Internal moderation notes must never be stored here.';

comment on table public.notification_email_outbox is
  'Private transactional email outbox. Claimed and completed only through authorized RPCs.';


create index notifications_user_created_idx
  on public.notifications(user_id, created_at desc);

create index notifications_user_unread_idx
  on public.notifications(user_id, created_at desc)
  where read_at is null;

create index notification_email_outbox_delivery_idx
  on public.notification_email_outbox(status, next_attempt_at, created_at);


alter table public.notifications enable row level security;
alter table public.notification_email_outbox enable row level security;


revoke all on table public.notifications
from public, anon, authenticated;

revoke all on table public.notification_email_outbox
from public, anon, authenticated;

grant select on table public.notifications to authenticated;


create policy "Users can view their own notifications"
on public.notifications
for select
to authenticated
using ((select auth.uid()) = user_id);


create or replace function public.mark_notification_read(
  p_notification_id uuid
)
returns table (
  notification_id uuid,
  notification_read_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'Authentication required'
      using errcode = '28000';
  end if;

  return query
  update public.notifications n
  set read_at = coalesce(n.read_at, now())
  where n.id = p_notification_id
    and n.user_id = v_user_id
  returning n.id, n.read_at;

  if not found then
    raise exception 'Notification not found'
      using errcode = 'P0002';
  end if;
end;
$$;


revoke execute on function public.mark_notification_read(uuid)
from public, anon, authenticated;

grant execute on function public.mark_notification_read(uuid)
to authenticated;


create or replace function public.claim_seller_decision_email(
  p_decision_id uuid
)
returns table (
  outbox_id uuid,
  email_claim_token uuid,
  recipient_email text,
  email_subject text,
  email_body text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reviewer_id uuid := (select auth.uid());
  v_claim_token uuid := gen_random_uuid();
begin
  if v_reviewer_id is null then
    raise exception 'Authentication required'
      using errcode = '28000';
  end if;

  if not (select private.is_active_seller_reviewer()) then
    raise exception 'Seller reviewer authorization required'
      using errcode = '42501';
  end if;

  return query
  with candidate as (
    select neo.id
    from public.notification_email_outbox neo
    join public.seller_application_decisions sad
      on sad.id = neo.decision_id
    join public.seller_profiles sp
      on sp.id = sad.seller_profile_id
    where neo.decision_id = p_decision_id
      and sp.user_id <> v_reviewer_id
      and (
        neo.status in ('queued', 'failed')
        or (
          neo.status = 'sending'
          and neo.claimed_at <= now() - interval '15 minutes'
        )
      )
    for update of neo skip locked
    limit 1
  ),
  claimed as (
    update public.notification_email_outbox neo
    set
      status = 'sending',
      attempts = neo.attempts + 1,
      last_error = null,
      claim_token = v_claim_token,
      claimed_by = v_reviewer_id,
      claimed_at = now(),
      last_attempt_at = now(),
      updated_at = now()
    from candidate c
    where neo.id = c.id
    returning
      neo.id,
      neo.claim_token,
      neo.recipient_email,
      neo.subject,
      neo.body
  )
  select
    claimed.id,
    claimed.claim_token,
    claimed.recipient_email,
    claimed.subject,
    claimed.body
  from claimed;
end;
$$;


revoke execute on function public.claim_seller_decision_email(uuid)
from public, anon, authenticated;

grant execute on function public.claim_seller_decision_email(uuid)
to authenticated;


create or replace function public.mark_seller_decision_email_sent(
  p_outbox_id uuid,
  p_claim_token uuid,
  p_provider_message_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reviewer_id uuid := (select auth.uid());
begin
  if v_reviewer_id is null then
    raise exception 'Authentication required'
      using errcode = '28000';
  end if;

  if not (select private.is_active_seller_reviewer()) then
    raise exception 'Seller reviewer authorization required'
      using errcode = '42501';
  end if;

  update public.notification_email_outbox neo
  set
    status = 'sent',
    provider_message_id = nullif(trim(p_provider_message_id), ''),
    last_error = null,
    sent_at = now(),
    claim_token = null,
    claimed_by = null,
    claimed_at = null,
    updated_at = now()
  where neo.id = p_outbox_id
    and neo.status = 'sending'
    and neo.claim_token = p_claim_token
    and neo.claimed_by = v_reviewer_id;

  if not found then
    raise exception 'Claimed email event not found'
      using errcode = 'P0002';
  end if;

  return true;
end;
$$;


revoke execute
on function public.mark_seller_decision_email_sent(uuid, uuid, text)
from public, anon, authenticated;

grant execute
on function public.mark_seller_decision_email_sent(uuid, uuid, text)
to authenticated;


create or replace function public.mark_seller_decision_email_failed(
  p_outbox_id uuid,
  p_claim_token uuid,
  p_last_error text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reviewer_id uuid := (select auth.uid());
  v_safe_error text := left(nullif(trim(p_last_error), ''), 1000);
begin
  if v_reviewer_id is null then
    raise exception 'Authentication required'
      using errcode = '28000';
  end if;

  if not (select private.is_active_seller_reviewer()) then
    raise exception 'Seller reviewer authorization required'
      using errcode = '42501';
  end if;

  if v_safe_error is null then
    raise exception 'A safe delivery error is required'
      using errcode = '22023';
  end if;

  update public.notification_email_outbox neo
  set
    status = 'failed',
    last_error = v_safe_error,
    next_attempt_at = now() + interval '15 minutes',
    claim_token = null,
    claimed_by = null,
    claimed_at = null,
    updated_at = now()
  where neo.id = p_outbox_id
    and neo.status = 'sending'
    and neo.claim_token = p_claim_token
    and neo.claimed_by = v_reviewer_id;

  if not found then
    raise exception 'Claimed email event not found'
      using errcode = 'P0002';
  end if;

  return true;
end;
$$;


revoke execute
on function public.mark_seller_decision_email_failed(uuid, uuid, text)
from public, anon, authenticated;

grant execute
on function public.mark_seller_decision_email_failed(uuid, uuid, text)
to authenticated;


create or replace function public.get_seller_decision_email_retry_state(
  p_seller_profile_id uuid
)
returns table (
  decision_id uuid,
  can_retry boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_reviewer_id uuid := (select auth.uid());
begin
  if v_reviewer_id is null then
    raise exception 'Authentication required'
      using errcode = '28000';
  end if;

  if not (select private.is_active_seller_reviewer()) then
    raise exception 'Seller reviewer authorization required'
      using errcode = '42501';
  end if;

  return query
  select
    sad.id,
    coalesce(neo.status = 'failed', false)
  from public.seller_application_decisions sad
  join public.seller_profiles sp
    on sp.id = sad.seller_profile_id
  left join public.notification_email_outbox neo
    on neo.decision_id = sad.id
  where sad.seller_profile_id = p_seller_profile_id
    and sp.user_id <> v_reviewer_id
  order by sad.created_at desc, sad.id desc
  limit 1;
end;
$$;


revoke execute
on function public.get_seller_decision_email_retry_state(uuid)
from public, anon, authenticated;

grant execute
on function public.get_seller_decision_email_retry_state(uuid)
to authenticated;


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
  v_store_name text;
  v_recipient_email text;
  v_from_status text;
  v_to_status text;
  v_decision_id uuid;
  v_notification_id uuid;
  v_supersedes_decision_id uuid;
  v_notification_type text;
  v_notification_title text;
  v_notification_body text;
  v_email_subject text;
  v_email_body text;
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

  if p_decision in ('reject', 'hold')
     and nullif(trim(p_public_reason), '') is null
  then
    raise exception 'A public reason is required for this decision'
      using errcode = '22023';
  end if;

  if p_decision = 'reopen'
     and coalesce(
       nullif(trim(p_public_reason), ''),
       nullif(trim(p_internal_reason), '')
     ) is null
  then
    raise exception 'A reason is required for this decision'
      using errcode = '22023';
  end if;

  select sp.user_id, sp.status, sp.store_name
  into v_seller_user_id, v_from_status, v_store_name
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

  select au.email
  into v_recipient_email
  from auth.users au
  where au.id = v_seller_user_id;

  if nullif(trim(v_recipient_email), '') is null then
    raise exception 'Seller account has no deliverable email address'
      using errcode = '23502';
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

  v_notification_type := case p_decision
    when 'approve' then 'seller_application_approved'
    when 'hold' then 'seller_application_held'
    when 'reject' then 'seller_application_rejected'
    when 'reopen' then 'seller_application_reopened'
  end;

  v_notification_title := case p_decision
    when 'approve' then 'Seller Application Approved'
    when 'hold' then 'Seller Application Held for Review'
    when 'reject' then 'Seller Application Not Approved'
    when 'reopen' then 'Seller Application Reopened'
  end;

  v_notification_body := case p_decision
    when 'approve' then
      'Your Zvese seller application for ' || v_store_name ||
      ' has been approved. Your seller account is now active.'
    when 'hold' then
      'Your Zvese seller application for ' || v_store_name ||
      ' requires further review. Reason: ' || trim(p_public_reason)
    when 'reject' then
      'Your Zvese seller application for ' || v_store_name ||
      ' was not approved. Reason: ' || trim(p_public_reason)
    when 'reopen' then
      'Your Zvese seller application for ' || v_store_name ||
      ' has been reopened and is under review.' ||
      case
        when nullif(trim(p_public_reason), '') is not null
          then ' Reason: ' || trim(p_public_reason)
        else ''
      end
  end;

  v_email_subject := case p_decision
    when 'approve' then 'Your Zvese seller application has been approved'
    when 'hold' then 'Your Zvese seller application is under further review'
    when 'reject' then 'Update on your Zvese seller application'
    when 'reopen' then 'Your Zvese seller application has been reopened'
  end;

  v_email_body := v_notification_body ||
    E'\n\nSign in to your Zvese account to view your current seller status.';

  insert into public.notifications (
    user_id,
    type,
    title,
    body,
    related_seller_profile_id,
    related_decision_id,
    metadata
  )
  values (
    v_seller_user_id,
    v_notification_type,
    v_notification_title,
    v_notification_body,
    p_seller_profile_id,
    v_decision_id,
    jsonb_build_object(
      'decision', p_decision,
      'seller_status', v_to_status,
      'store_name', v_store_name
    )
  )
  returning id into v_notification_id;

  insert into public.notification_email_outbox (
    user_id,
    recipient_email,
    notification_id,
    decision_id,
    template_type,
    subject,
    body
  )
  values (
    v_seller_user_id,
    trim(v_recipient_email),
    v_notification_id,
    v_decision_id,
    p_decision,
    v_email_subject,
    v_email_body
  );

  return query
  select p_seller_profile_id, v_to_status, v_decision_id;
end;
$$;


revoke execute
on function private.decide_seller_application(uuid, text, uuid, text, text, text)
from public, anon, authenticated;


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
security definer
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
