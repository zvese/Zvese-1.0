-- Security and transaction regression suite for
-- 20260904101720_seller_decision_notifications.sql.
-- Run only against a disposable/local Supabase database after all migrations.
-- All fixtures and forced-failure triggers are rolled back.

begin;

create function pg_temp.assert_true(condition boolean, message text)
returns void
language plpgsql
as $$
begin
  if condition is not true then
    raise exception 'Assertion failed: %', message;
  end if;
end;
$$;

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('00000000-0000-4000-8000-000000000201', 'authenticated', 'authenticated', 'notification-reviewer@example.invalid', now(), now()),
  ('00000000-0000-4000-8000-000000000202', 'authenticated', 'authenticated', 'notification-approve@example.invalid', now(), now()),
  ('00000000-0000-4000-8000-000000000203', 'authenticated', 'authenticated', 'notification-hold@example.invalid', now(), now()),
  ('00000000-0000-4000-8000-000000000204', 'authenticated', 'authenticated', 'notification-reject@example.invalid', now(), now()),
  ('00000000-0000-4000-8000-000000000205', 'authenticated', 'authenticated', 'notification-rollback@example.invalid', now(), now()),
  ('00000000-0000-4000-8000-000000000206', 'authenticated', 'authenticated', 'outbox-rollback@example.invalid', now(), now()),
  ('00000000-0000-4000-8000-000000000207', 'authenticated', 'authenticated', 'notification-other@example.invalid', now(), now());

insert into public.admin_memberships (user_id, role, is_active)
values ('00000000-0000-4000-8000-000000000201', 'seller_reviewer', true);

insert into public.seller_profiles (
  id,
  user_id,
  store_name,
  store_slug,
  default_currency,
  status
)
values
  ('10000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000202', 'Notification Approval Target', 'notification.approval', 'USD', 'pending'),
  ('10000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000203', 'Notification Hold Target', 'notification.hold', 'USD', 'pending'),
  ('10000000-0000-4000-8000-000000000204', '00000000-0000-4000-8000-000000000204', 'Notification Rejection Target', 'notification.rejection', 'USD', 'pending'),
  ('10000000-0000-4000-8000-000000000205', '00000000-0000-4000-8000-000000000205', 'Notification Rollback Target', 'notification.rollback', 'USD', 'pending'),
  ('10000000-0000-4000-8000-000000000206', '00000000-0000-4000-8000-000000000206', 'Outbox Rollback Target', 'outbox.rollback', 'USD', 'pending');

select pg_temp.assert_true(
  has_table_privilege('authenticated', 'public.notifications', 'select')
  and not has_table_privilege('authenticated', 'public.notifications', 'insert')
  and not has_table_privilege('authenticated', 'public.notifications', 'update')
  and not has_table_privilege('authenticated', 'public.notifications', 'delete'),
  'authenticated users must only receive direct SELECT on notifications'
);

select pg_temp.assert_true(
  not has_table_privilege('authenticated', 'public.notification_email_outbox', 'select')
  and not has_table_privilege('authenticated', 'public.notification_email_outbox', 'insert')
  and not has_table_privilege('authenticated', 'public.notification_email_outbox', 'update')
  and not has_table_privilege('authenticated', 'public.notification_email_outbox', 'delete')
  and not has_table_privilege('anon', 'public.notifications', 'select')
  and not has_table_privilege('anon', 'public.notification_email_outbox', 'select'),
  'clients must have no outbox access and anon must have no notification access'
);

select pg_temp.assert_true(
  not has_function_privilege('anon', 'public.mark_notification_read(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.claim_seller_decision_email(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.mark_seller_decision_email_sent(uuid,uuid,text)', 'execute')
  and not has_function_privilege('anon', 'public.mark_seller_decision_email_failed(uuid,uuid,text)', 'execute')
  and not has_function_privilege('anon', 'public.get_seller_decision_email_retry_state(uuid)', 'execute'),
  'anon must not execute notification or outbox RPCs'
);

select pg_temp.assert_true(
  has_function_privilege(
    'authenticated',
    'public.decide_seller_application(uuid,text,uuid,text,text,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'private.decide_seller_application(uuid,text,uuid,text,text,text)',
    'execute'
  ),
  'authenticated callers must use only the public decision wrapper'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000201', true);

select *
from public.decide_seller_application(
  '10000000-0000-4000-8000-000000000202',
  'approve',
  null,
  null,
  'INTERNAL-APPROVE-SECRET',
  'seller-review-v1'
);

select *
from public.decide_seller_application(
  '10000000-0000-4000-8000-000000000203',
  'hold',
  null,
  'Additional creator identity information is required.',
  'INTERNAL-HOLD-SECRET',
  'seller-review-v1'
);

select *
from public.decide_seller_application(
  '10000000-0000-4000-8000-000000000204',
  'reject',
  null,
  'The application did not meet the current seller identity policy.',
  'INTERNAL-REJECT-SECRET',
  'seller-review-v1'
);

reset role;

select pg_temp.assert_true(
  (select status = 'active'
   from public.seller_profiles
   where id = '10000000-0000-4000-8000-000000000202'),
  'approve must activate the seller'
);

select pg_temp.assert_true(
  (select status = 'pending'
   from public.seller_profiles
   where id = '10000000-0000-4000-8000-000000000203'),
  'hold must keep the seller pending'
);

select pg_temp.assert_true(
  (select status = 'rejected'
   from public.seller_profiles
   where id = '10000000-0000-4000-8000-000000000204'),
  'reject must reject the seller'
);

select pg_temp.assert_true(
  (select count(*) = 3 from public.seller_application_decisions
   where seller_profile_id in (
     '10000000-0000-4000-8000-000000000202',
     '10000000-0000-4000-8000-000000000203',
     '10000000-0000-4000-8000-000000000204'
   ))
  and
  (select count(*) = 3 from public.notifications
   where related_seller_profile_id in (
     '10000000-0000-4000-8000-000000000202',
     '10000000-0000-4000-8000-000000000203',
     '10000000-0000-4000-8000-000000000204'
   ))
  and
  (select count(*) = 3 from public.notification_email_outbox
   where user_id in (
     '00000000-0000-4000-8000-000000000202',
     '00000000-0000-4000-8000-000000000203',
     '00000000-0000-4000-8000-000000000204'
   )),
  'each decision must create exactly one notification and one outbox row'
);

select pg_temp.assert_true(
  (select body like '%Additional creator identity information is required.%'
   from public.notifications
   where user_id = '00000000-0000-4000-8000-000000000203')
  and
  (select body like '%The application did not meet the current seller identity policy.%'
   from public.notifications
   where user_id = '00000000-0000-4000-8000-000000000204'),
  'public hold and rejection reasons must reach creator notifications'
);

select pg_temp.assert_true(
  not exists (
    select 1
    from public.notifications n
    where n.related_seller_profile_id in (
      '10000000-0000-4000-8000-000000000202',
      '10000000-0000-4000-8000-000000000203',
      '10000000-0000-4000-8000-000000000204'
    )
      and (
        n.body like '%INTERNAL-%'
        or n.title like '%INTERNAL-%'
        or n.metadata::text like '%INTERNAL-%'
      )
  )
  and not exists (
    select 1
    from public.notification_email_outbox neo
    where neo.user_id in (
      '00000000-0000-4000-8000-000000000202',
      '00000000-0000-4000-8000-000000000203',
      '00000000-0000-4000-8000-000000000204'
    )
      and (neo.subject like '%INTERNAL-%' or neo.body like '%INTERNAL-%')
  ),
  'internal reasons must never enter notifications or email content'
);

-- A user can read only their own notification and cannot forge one.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000202', true);

select pg_temp.assert_true(
  (select count(*) = 1 from public.notifications),
  'a creator must only see their own notification'
);

do $$
begin
  insert into public.notifications (user_id, type, title, body)
  values (
    '00000000-0000-4000-8000-000000000202',
    'seller_application_approved',
    'Forged',
    'This insert must fail.'
  );

  raise exception 'Expected notification insert to fail';
exception
  when insufficient_privilege then null;
  when raise_exception then
    if sqlerrm = 'Expected notification insert to fail' then
      raise;
    end if;
end;
$$;

do $$
begin
  perform count(*) from public.notification_email_outbox;
  raise exception 'Expected outbox read to fail';
exception
  when insufficient_privilege then null;
  when raise_exception then
    if sqlerrm = 'Expected outbox read to fail' then
      raise;
    end if;
end;
$$;

do $$
begin
  perform *
  from public.claim_seller_decision_email(
    '30000000-0000-4000-8000-000000000202'
  );
  raise exception 'Expected ordinary-user email claim to fail';
exception
  when insufficient_privilege then null;
  when raise_exception then
    if sqlerrm = 'Expected ordinary-user email claim to fail' then
      raise;
    end if;
end;
$$;

do $$
begin
  perform public.mark_seller_decision_email_sent(
    '30000000-0000-4000-8000-000000000202',
    '40000000-0000-4000-8000-000000000202',
    null
  );
  raise exception 'Expected ordinary-user sent completion to fail';
exception
  when insufficient_privilege then null;
  when raise_exception then
    if sqlerrm = 'Expected ordinary-user sent completion to fail' then
      raise;
    end if;
end;
$$;

do $$
begin
  perform public.mark_seller_decision_email_failed(
    '30000000-0000-4000-8000-000000000202',
    '40000000-0000-4000-8000-000000000202',
    'This must be rejected before outbox access.'
  );
  raise exception 'Expected ordinary-user failed completion to fail';
exception
  when insufficient_privilege then null;
  when raise_exception then
    if sqlerrm = 'Expected ordinary-user failed completion to fail' then
      raise;
    end if;
end;
$$;

do $$
begin
  perform *
  from public.get_seller_decision_email_retry_state(
    '10000000-0000-4000-8000-000000000202'
  );
  raise exception 'Expected ordinary-user retry-state access to fail';
exception
  when insufficient_privilege then null;
  when raise_exception then
    if sqlerrm = 'Expected ordinary-user retry-state access to fail' then
      raise;
    end if;
end;
$$;

select *
from public.mark_notification_read(
  (select id from public.notifications limit 1)
);

do $$
begin
  perform *
  from public.mark_notification_read(
    (select id
     from public.notifications
     where user_id = '00000000-0000-4000-8000-000000000203')
  );

  raise exception 'Expected cross-user mark-read to fail';
exception
  when no_data_found then null;
end;
$$;

reset role;

select pg_temp.assert_true(
  (select read_at is not null
   from public.notifications
   where user_id = '00000000-0000-4000-8000-000000000202')
  and
  (select read_at is null
   from public.notifications
   where user_id = '00000000-0000-4000-8000-000000000203'),
  'mark-read must update only the caller notification'
);

-- Claiming is exact-decision scoped, increments attempts, and excludes a
-- concurrent/second claim while the first claim is active.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000201', true);

do $$
declare
  v_outbox_id uuid;
  v_claim_token uuid;
  v_second_claim_count integer;
begin
  select claimed.outbox_id, claimed.email_claim_token
  into v_outbox_id, v_claim_token
  from public.claim_seller_decision_email(
    (select sad.id
     from public.seller_application_decisions sad
     where sad.seller_profile_id = '10000000-0000-4000-8000-000000000202')
  ) claimed;

  select count(*)
  into v_second_claim_count
  from public.claim_seller_decision_email(
    (select sad.id
     from public.seller_application_decisions sad
     where sad.seller_profile_id = '10000000-0000-4000-8000-000000000202')
  );

  perform pg_temp.assert_true(
    v_outbox_id is not null
    and v_claim_token is not null
    and v_second_claim_count = 0,
    'an active email claim must prevent a duplicate claim'
  );

  perform public.mark_seller_decision_email_failed(
    v_outbox_id,
    v_claim_token,
    'Simulated provider failure.'
  );
end;
$$;

reset role;

select pg_temp.assert_true(
  (select status = 'failed'
     and attempts = 1
     and last_error = 'Simulated provider failure.'
     and next_attempt_at > now()
   from public.notification_email_outbox
   where user_id = '00000000-0000-4000-8000-000000000202')
  and
  (select status = 'active'
   from public.seller_profiles
   where id = '10000000-0000-4000-8000-000000000202')
  and
  (select count(*) = 1
   from public.seller_application_decisions
   where seller_profile_id = '10000000-0000-4000-8000-000000000202'),
  'post-commit provider failure must remain retryable without rolling back the decision'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000201', true);

do $$
declare
  v_outbox_id uuid;
  v_claim_token uuid;
  v_decision_id uuid;
begin
  select sad.id
  into v_decision_id
  from public.seller_application_decisions sad
  where sad.seller_profile_id = '10000000-0000-4000-8000-000000000202';

  select claimed.outbox_id, claimed.email_claim_token
  into v_outbox_id, v_claim_token
  from public.claim_seller_decision_email(v_decision_id) claimed;

  perform public.mark_seller_decision_email_sent(
    v_outbox_id,
    v_claim_token,
    'provider-test-message-id'
  );

  perform pg_temp.assert_true(
    (select count(*) = 0
     from public.claim_seller_decision_email(v_decision_id))
    and not (
      select retry_state.can_retry
      from public.get_seller_decision_email_retry_state(
        '10000000-0000-4000-8000-000000000202'
      ) retry_state
    ),
    'a sent email must not be claimed or offered for retry'
  );
end;
$$;

reset role;

select pg_temp.assert_true(
  (select count(*) = 3 from public.seller_application_decisions
   where seller_profile_id in (
     '10000000-0000-4000-8000-000000000202',
     '10000000-0000-4000-8000-000000000203',
     '10000000-0000-4000-8000-000000000204'
   ))
  and
  (select count(*) = 3 from public.notifications
   where related_seller_profile_id in (
     '10000000-0000-4000-8000-000000000202',
     '10000000-0000-4000-8000-000000000203',
     '10000000-0000-4000-8000-000000000204'
   ))
  and
  (select count(*) = 3 from public.notification_email_outbox
   where user_id in (
     '00000000-0000-4000-8000-000000000202',
     '00000000-0000-4000-8000-000000000203',
     '00000000-0000-4000-8000-000000000204'
   )),
  'email retry must not create another decision, notification, or outbox row'
);

select pg_temp.assert_true(
  (select status = 'sent'
     and attempts = 2
     and sent_at is not null
   from public.notification_email_outbox
   where user_id = '00000000-0000-4000-8000-000000000202'),
  'a failed event must be retryable and a sent event terminal'
);

-- Force notification insertion to fail after decision insert/status update.
create function pg_temp.reject_notification_insert()
returns trigger
language plpgsql
as $$
begin
  if new.user_id = '00000000-0000-4000-8000-000000000205' then
    raise exception 'Forced notification insert failure';
  end if;
  return new;
end;
$$;

create trigger test_reject_notification_insert
before insert on public.notifications
for each row
execute function pg_temp.reject_notification_insert();

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000201', true);

do $$
begin
  perform *
  from public.decide_seller_application(
    '10000000-0000-4000-8000-000000000205',
    'approve'
  );
  raise exception 'Expected forced notification failure';
exception
  when raise_exception then
    if sqlerrm = 'Expected forced notification failure' then
      raise;
    end if;
end;
$$;

reset role;
drop trigger test_reject_notification_insert on public.notifications;

select pg_temp.assert_true(
  (select status = 'pending'
   from public.seller_profiles
   where id = '10000000-0000-4000-8000-000000000205')
  and not exists (
    select 1 from public.seller_application_decisions
    where seller_profile_id = '10000000-0000-4000-8000-000000000205'
  )
  and not exists (
    select 1 from public.notifications
    where user_id = '00000000-0000-4000-8000-000000000205'
  ),
  'notification failure must roll back decision and seller status'
);

-- Force outbox insertion to fail after the notification insert.
create function pg_temp.reject_outbox_insert()
returns trigger
language plpgsql
as $$
begin
  if new.user_id = '00000000-0000-4000-8000-000000000206' then
    raise exception 'Forced outbox insert failure';
  end if;
  return new;
end;
$$;

create trigger test_reject_outbox_insert
before insert on public.notification_email_outbox
for each row
execute function pg_temp.reject_outbox_insert();

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000201', true);

do $$
begin
  perform *
  from public.decide_seller_application(
    '10000000-0000-4000-8000-000000000206',
    'approve'
  );
  raise exception 'Expected forced outbox failure';
exception
  when raise_exception then
    if sqlerrm = 'Expected forced outbox failure' then
      raise;
    end if;
end;
$$;

reset role;
drop trigger test_reject_outbox_insert on public.notification_email_outbox;

select pg_temp.assert_true(
  (select status = 'pending'
   from public.seller_profiles
   where id = '10000000-0000-4000-8000-000000000206')
  and not exists (
    select 1 from public.seller_application_decisions
    where seller_profile_id = '10000000-0000-4000-8000-000000000206'
  )
  and not exists (
    select 1 from public.notifications
    where user_id = '00000000-0000-4000-8000-000000000206'
  )
  and not exists (
    select 1 from public.notification_email_outbox
    where user_id = '00000000-0000-4000-8000-000000000206'
  ),
  'outbox failure must roll back notification, decision, and seller status'
);

-- This suite uses only reserved example.invalid accounts and fixed isolated
-- UUIDs. It never selects or mutates real seller handles, including the live
-- Tashinga Test or Alpha Test Store records.

rollback;
