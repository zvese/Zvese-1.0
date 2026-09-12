-- Security regression suite for 20260903120632_admin_seller_review_foundation.sql
-- Run only against a disposable/local Supabase database after all migrations.
-- The transaction always rolls back its isolated fixtures and test triggers.

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
  ('00000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'ordinary-1@example.invalid', now(), now()),
  ('00000000-0000-4000-8000-000000000102', 'authenticated', 'authenticated', 'reviewer-1@example.invalid', now(), now()),
  ('00000000-0000-4000-8000-000000000103', 'authenticated', 'authenticated', 'inactive-reviewer@example.invalid', now(), now()),
  ('00000000-0000-4000-8000-000000000104', 'authenticated', 'authenticated', 'ordinary-2@example.invalid', now(), now()),
  ('00000000-0000-4000-8000-000000000105', 'authenticated', 'authenticated', 'ordinary-3@example.invalid', now(), now()),
  ('00000000-0000-4000-8000-000000000106', 'authenticated', 'authenticated', 'ordinary-4@example.invalid', now(), now()),
  ('00000000-0000-4000-8000-000000000107', 'authenticated', 'authenticated', 'ordinary-5@example.invalid', now(), now());

insert into public.admin_memberships (user_id, role, is_active)
values
  ('00000000-0000-4000-8000-000000000102', 'seller_reviewer', true),
  ('00000000-0000-4000-8000-000000000103', 'seller_reviewer', false);

insert into public.seller_profiles (
  id,
  user_id,
  store_name,
  store_slug,
  default_currency,
  status
)
values
  ('10000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000101', 'Ordinary Seller', 'ordinary.seller', 'USD', 'pending'),
  ('10000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000102', 'Reviewer Store', 'reviewer.store', 'USD', 'pending'),
  ('10000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-000000000104', 'Approval Target', 'approval.target', 'USD', 'pending'),
  ('10000000-0000-4000-8000-000000000105', '00000000-0000-4000-8000-000000000105', 'Rejection Target', 'rejection.target', 'USD', 'pending'),
  ('10000000-0000-4000-8000-000000000106', '00000000-0000-4000-8000-000000000106', 'Rollback Target', 'rollback.target', 'USD', 'pending'),
  ('10000000-0000-4000-8000-000000000107', '00000000-0000-4000-8000-000000000107', 'Hold Target', 'hold.target', 'USD', 'pending');

insert into public.seller_application_reviews (
  id,
  seller_profile_id,
  review_type,
  status,
  recommendation,
  policy_version,
  completed_at
)
values (
  '20000000-0000-4000-8000-000000000105',
  '10000000-0000-4000-8000-000000000105',
  'deterministic',
  'completed',
  'hold',
  'seller-review-v1',
  now()
);

-- PUBLIC/anon cannot execute the privileged decision RPC.
select pg_temp.assert_true(
  not has_function_privilege(
    'anon',
    'public.decide_seller_application(uuid,text,uuid,text,text,text)',
    'execute'
  ),
  'anon must not be able to execute seller decisions'
);

select pg_temp.assert_true(
  has_function_privilege(
    'authenticated',
    'public.decide_seller_application(uuid,text,uuid,text,text,text)',
    'execute'
  ),
  'authenticated must be able to reach the self-authorizing RPC'
);

select pg_temp.assert_true(
  not exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) acl
    where n.nspname = 'public'
      and p.proname = 'decide_seller_application'
      and pg_catalog.pg_get_function_identity_arguments(p.oid) =
        'p_seller_profile_id uuid, p_decision text, p_review_id uuid, p_public_reason text, p_internal_reason text, p_policy_version text'
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC must not have EXECUTE on seller decisions'
);

select pg_temp.assert_true(
  not has_table_privilege('authenticated', 'public.admin_memberships', 'insert')
  and not has_table_privilege('authenticated', 'public.admin_memberships', 'update')
  and not has_table_privilege('authenticated', 'public.admin_memberships', 'delete')
  and not has_table_privilege('authenticated', 'public.seller_application_decisions', 'insert')
  and not has_table_privilege('authenticated', 'public.seller_application_decisions', 'update')
  and not has_table_privilege('authenticated', 'public.seller_application_decisions', 'delete'),
  'authenticated must have no direct admin or decision mutations'
);

select pg_temp.assert_true(
  not has_table_privilege('anon', 'public.admin_memberships', 'select')
  and not has_table_privilege('anon', 'public.seller_application_reviews', 'select')
  and not has_table_privilege('anon', 'public.seller_application_decisions', 'select'),
  'anon must have no admin, review, or decision read access'
);

-- An ordinary authenticated user cannot direct-update protected seller status.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000101', true);

select pg_temp.assert_true(
  not exists (
    select 1
    from public.seller_profiles
    where id = '10000000-0000-4000-8000-000000000104'
  ),
  'ordinary users must not read another pending application'
);

do $$
begin
  update public.seller_profiles
  set status = 'active'
  where id = '10000000-0000-4000-8000-000000000101';

  raise exception 'Expected direct seller status update to fail';
exception
  when insufficient_privilege then null;
  when raise_exception then
    if sqlerrm = 'Expected direct seller status update to fail' then
      raise;
    end if;
end;
$$;

-- An ordinary authenticated user cannot approve or reject another seller.
do $$
begin
  perform *
  from public.decide_seller_application(
    '10000000-0000-4000-8000-000000000101',
    'approve'
  );

  raise exception 'Expected ordinary-user self-approval to fail';
exception
  when insufficient_privilege then null;
end;
$$;

do $$
begin
  perform *
  from public.decide_seller_application(
    '10000000-0000-4000-8000-000000000104',
    'approve'
  );

  raise exception 'Expected ordinary-user approval to fail';
exception
  when insufficient_privilege then null;
end;
$$;

do $$
begin
  perform *
  from public.decide_seller_application(
    '10000000-0000-4000-8000-000000000105',
    'reject',
    null,
    'Test rejection reason'
  );

  raise exception 'Expected ordinary-user rejection to fail';
exception
  when insufficient_privilege then null;
end;
$$;

-- A pending seller cannot use listing creation before approval.
do $$
begin
  perform *
  from public.create_product_listing(
    'Pending seller product',
    'This listing must not be created for a pending seller.',
    100,
    1,
    'on_demand',
    null,
    null
  );

  raise exception 'Expected pending-seller listing creation to fail';
exception
  when raise_exception then
    if sqlerrm = 'Expected pending-seller listing creation to fail' then
      raise;
    end if;
end;
$$;

reset role;

-- An inactive reviewer cannot decide applications.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000103', true);

do $$
begin
  perform *
  from public.decide_seller_application(
    '10000000-0000-4000-8000-000000000104',
    'approve'
  );

  raise exception 'Expected inactive-reviewer approval to fail';
exception
  when insufficient_privilege then null;
end;
$$;

reset role;

-- An active reviewer still cannot review their own seller profile.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000102', true);

do $$
begin
  perform *
  from public.decide_seller_application(
    '10000000-0000-4000-8000-000000000102',
    'approve'
  );

  raise exception 'Expected self-review to fail';
exception
  when insufficient_privilege then null;
end;
$$;

select pg_temp.assert_true(
  exists (
    select 1
    from public.seller_profiles
    where id = '10000000-0000-4000-8000-000000000104'
  ),
  'active reviewers must be able to read another pending application'
);

-- A supplied review must be completed and belong to the same seller.
do $$
begin
  perform *
  from public.decide_seller_application(
    '10000000-0000-4000-8000-000000000104',
    'approve',
    '20000000-0000-4000-8000-000000000105'
  );

  raise exception 'Expected mismatched review reference to fail';
exception
  when foreign_key_violation then null;
end;
$$;

-- An active reviewer can approve and reject other pending sellers.
select *
from public.decide_seller_application(
  '10000000-0000-4000-8000-000000000104',
  'approve',
  null,
  null,
  'Approved by security regression test',
  'seller-review-v1'
);

select pg_temp.assert_true(
  (select status = 'active'
   from public.seller_profiles
   where id = '10000000-0000-4000-8000-000000000104'),
  'approval must transition pending to active'
);

select pg_temp.assert_true(
  (select count(*) = 1
   from public.seller_application_decisions
   where seller_profile_id = '10000000-0000-4000-8000-000000000104'
     and decision = 'approve'
     and from_status = 'pending'
     and to_status = 'active'),
  'approval must append one matching decision record'
);

select *
from public.decide_seller_application(
  '10000000-0000-4000-8000-000000000105',
  'reject',
  '20000000-0000-4000-8000-000000000105',
  'Application did not meet the current seller identity policy.',
  null,
  'seller-review-v1'
);

select pg_temp.assert_true(
  (select status = 'rejected'
   from public.seller_profiles
   where id = '10000000-0000-4000-8000-000000000105'),
  'rejection must transition pending to rejected'
);

select pg_temp.assert_true(
  (select count(*) = 1
   from public.seller_application_decisions
   where seller_profile_id = '10000000-0000-4000-8000-000000000105'
     and decision = 'reject'
     and from_status = 'pending'
     and to_status = 'rejected'),
  'rejection must append one matching decision record'
);

select *
from public.decide_seller_application(
  '10000000-0000-4000-8000-000000000107',
  'hold',
  null,
  null,
  'Additional identity evidence is required.',
  'seller-review-v1'
);

select pg_temp.assert_true(
  (select status = 'pending'
   from public.seller_profiles
   where id = '10000000-0000-4000-8000-000000000107'),
  'hold must leave a pending seller pending'
);

select pg_temp.assert_true(
  (select count(*) = 1
   from public.seller_application_decisions
   where seller_profile_id = '10000000-0000-4000-8000-000000000107'
     and decision = 'hold'
     and from_status = 'pending'
     and to_status = 'pending'),
  'hold must append a pending-to-pending decision record'
);

reset role;

-- Even the table owner cannot mutate an existing append-only decision record.
do $$
begin
  update public.seller_application_decisions
  set public_reason = 'Mutation must fail'
  where seller_profile_id = '10000000-0000-4000-8000-000000000105';

  raise exception 'Expected append-only decision update to fail';
exception
  when raise_exception then
    if sqlerrm = 'Expected append-only decision update to fail' then
      raise;
    end if;
end;
$$;

-- Force the status update to fail after the decision insert. The statement must
-- roll back the preceding audit insert as part of the same atomic function call.
create function pg_temp.reject_test_seller_status_update()
returns trigger
language plpgsql
as $$
begin
  if old.id = '10000000-0000-4000-8000-000000000106' then
    raise exception 'Forced seller status update failure';
  end if;
  return new;
end;
$$;

create trigger test_reject_seller_status_update
before update on public.seller_profiles
for each row
execute function pg_temp.reject_test_seller_status_update();

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000102', true);

do $$
begin
  perform *
  from public.decide_seller_application(
    '10000000-0000-4000-8000-000000000106',
    'approve'
  );

  raise exception 'Expected forced seller update failure';
exception
  when raise_exception then
    if sqlerrm = 'Expected forced seller update failure' then
      raise;
    end if;
end;
$$;

select pg_temp.assert_true(
  (select status = 'pending'
   from public.seller_profiles
   where id = '10000000-0000-4000-8000-000000000106'),
  'failed status update must leave the seller pending'
);

select pg_temp.assert_true(
  not exists (
    select 1
    from public.seller_application_decisions
    where seller_profile_id = '10000000-0000-4000-8000-000000000106'
  ),
  'failed status update must roll back the decision insert'
);

reset role;
drop trigger test_reject_seller_status_update on public.seller_profiles;

-- Force the decision insert to fail. No seller status update may survive.
create function pg_temp.reject_test_decision_insert()
returns trigger
language plpgsql
as $$
begin
  if new.seller_profile_id = '10000000-0000-4000-8000-000000000106' then
    raise exception 'Forced decision insert failure';
  end if;
  return new;
end;
$$;

create trigger test_reject_decision_insert
before insert on public.seller_application_decisions
for each row
execute function pg_temp.reject_test_decision_insert();

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000102', true);

do $$
begin
  perform *
  from public.decide_seller_application(
    '10000000-0000-4000-8000-000000000106',
    'approve'
  );

  raise exception 'Expected forced decision insert failure';
exception
  when raise_exception then
    if sqlerrm = 'Expected forced decision insert failure' then
      raise;
    end if;
end;
$$;

select pg_temp.assert_true(
  (select status = 'pending'
   from public.seller_profiles
   where id = '10000000-0000-4000-8000-000000000106'),
  'failed decision insert must leave the seller pending'
);

reset role;
drop trigger test_reject_decision_insert on public.seller_application_decisions;

rollback;
