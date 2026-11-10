-- LOCAL ONLY. Review and run manually against the already-applied local database.
-- Replaces only the media transition guard. Does not alter data, grants, or RPCs.
begin;

create or replace function private.enforce_sourcing_media_decision_transition()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='DELETE' then
    raise exception 'Sourcing media evidence is immutable' using errcode='55000';
  end if;
  if old.review_status='pending' and new.review_status in ('approved','rejected')
    -- Stored generated values are recomputed after BEFORE triggers; compare their source instead.
    and (to_jsonb(new) - ARRAY['review_status','source_url_identity'])
      is not distinct from (to_jsonb(old) - ARRAY['review_status','source_url_identity']) then
    return new;
  end if;
  raise exception 'Sourcing media may only be decided through the controlled review operation' using errcode='55000';
end; $$;

commit;

-- Verify the installed guard, attached trigger, and generated expression.
select pg_catalog.pg_get_functiondef('private.enforce_sourcing_media_decision_transition()'::regprocedure);
select tgname, pg_catalog.pg_get_triggerdef(oid)
from pg_catalog.pg_trigger
where tgrelid='public.sourcing_media_candidates'::regclass and not tgisinternal;
select column_name, is_generated, generation_expression
from information_schema.columns
where table_schema='public' and table_name='sourcing_media_candidates'
  and column_name='source_url_identity';

-- Expected: all mutation flags false; RPC execution true only for service_role.
select role_name,
  has_any_column_privilege(role_name,'public.sourcing_media_candidates','UPDATE') as any_media_update,
  has_table_privilege(role_name,'public.sourcing_media_candidates','DELETE') as media_delete,
  has_table_privilege(role_name,'public.sourcing_media_candidates','TRUNCATE') as media_truncate,
  has_column_privilege(role_name,'public.sourcing_media_candidates','review_status','INSERT') as insert_decision,
  has_column_privilege(role_name,'public.sourcing_media_candidates','source_url_identity','INSERT') as insert_generated_identity,
  has_function_privilege(role_name,'public.record_sourcing_media_decision(uuid,uuid,text,text)','EXECUTE') as decision_rpc
from (values ('anon'),('authenticated'),('service_role')) roles(role_name);

-- Expected: no direct mutation of media review evidence by any of these roles.
select role_name,
  has_any_column_privilege(role_name,'public.sourcing_media_review_events','INSERT') as event_insert,
  has_any_column_privilege(role_name,'public.sourcing_media_review_events','UPDATE') as event_update,
  has_table_privilege(role_name,'public.sourcing_media_review_events','DELETE') as event_delete,
  has_table_privilege(role_name,'public.sourcing_media_review_events','TRUNCATE') as event_truncate
from (values ('anon'),('authenticated'),('service_role')) roles(role_name);

-- Read-only integrity check: expect zero rows following successful RPC decisions.
select m.id, m.review_status
from public.sourcing_media_candidates m
left join public.sourcing_media_review_events e on e.media_id=m.id
where m.review_status in ('approved','rejected')
  and (e.id is null or e.to_status<>m.review_status
    or e.snapshot_hash<>encode(extensions.digest(convert_to(e.reviewed_snapshot::text,'UTF8'),'sha256'),'hex'));
