-- LOCAL ONLY. Run as postgres AFTER the trigger patch. Never run against production.
-- Uses one existing open sourcing candidate and active super_admin; all test writes roll back.
-- This script does NOT apply migrations or replace any database functions.
begin;

create temporary table media_transition_test_context on commit drop as
select c.id as candidate_id, a.user_id as admin_id,
  gen_random_uuid() as approve_id, gen_random_uuid() as reject_id, gen_random_uuid() as evidence_id
from public.sourcing_candidates c cross join public.admin_memberships a
where c.status in ('needs_review','held') and a.role='super_admin' and a.is_active=true
limit 1;

do $$ begin
  if not exists(select 1 from media_transition_test_context) then
    raise exception 'Test requires one open sourcing candidate and active super_admin';
  end if;
end $$;

insert into public.sourcing_media_candidates(id,candidate_id,media_type,source_url,provenance_type,
  rights_status,match_status,match_confidence,quality_score,selected_role,width,height)
select media_id,c.candidate_id,'image','https://supplier.example/test/'||media_id::text,
  'supplier_catalog','claimed_authorized','matched',0.900,0.900,'none',1600,1600
from media_transition_test_context c
cross join lateral unnest(array[c.approve_id,c.reject_id,c.evidence_id]) as ids(media_id);

-- Privileges, including column grants: direct browser/service updates must remain impossible.
do $$ declare r text; begin
  foreach r in array array['anon','authenticated','service_role'] loop
    if has_any_column_privilege(r,'public.sourcing_media_candidates','UPDATE')
      or has_table_privilege(r,'public.sourcing_media_candidates','DELETE')
      or has_table_privilege(r,'public.sourcing_media_candidates','TRUNCATE')
      or has_column_privilege(r,'public.sourcing_media_candidates','review_status','INSERT')
      or has_column_privilege(r,'public.sourcing_media_candidates','source_url_identity','INSERT')
      or has_any_column_privilege(r,'public.sourcing_media_review_events','INSERT')
      or has_any_column_privilege(r,'public.sourcing_media_review_events','UPDATE')
      or has_table_privilege(r,'public.sourcing_media_review_events','DELETE')
      or has_table_privilege(r,'public.sourcing_media_review_events','TRUNCATE') then
      raise exception 'Unexpected direct media/evidence privileges for %',r;
    end if;
    if has_function_privilege(r,'public.record_sourcing_media_decision(uuid,uuid,text,text)','EXECUTE')
      is distinct from (r='service_role') then
      raise exception 'Unexpected media RPC permission for %',r;
    end if;
  end loop;
end $$;

grant select on media_transition_test_context to service_role;
set local role service_role;
select public.record_sourcing_media_decision(approve_id,admin_id,'approve','Local regression approval evidence.')
from media_transition_test_context;
select public.record_sourcing_media_decision(reject_id,admin_id,'reject','Local regression rejection evidence.')
from media_transition_test_context;
reset role;

do $$
declare ctx record; original public.sourcing_media_candidates; field record; replacement jsonb;
begin
  select * into strict ctx from media_transition_test_context;
  if not exists(select 1 from public.sourcing_media_candidates where id=ctx.approve_id and review_status='approved')
    or not exists(select 1 from public.sourcing_media_candidates where id=ctx.reject_id and review_status='rejected') then
    raise exception 'Controlled pending approval/rejection failed';
  end if;
  if (select count(*) from public.sourcing_media_review_events e
    where e.media_id in (ctx.approve_id,ctx.reject_id)
      and e.snapshot_hash=encode(extensions.digest(convert_to(e.reviewed_snapshot::text,'UTF8'),'sha256'),'hex'))<>2 then
    raise exception 'Missing atomic review events or snapshot hashes';
  end if;

  select * into strict original from public.sourcing_media_candidates where id=ctx.evidence_id;
  -- Test every real column, including source_url and selected_role, without depending on a fixed list.
  for field in select key,value from jsonb_each(to_jsonb(original))
    where key not in ('review_status','source_url_identity') loop
    replacement:=case
      when field.key in ('id','candidate_id') then to_jsonb(gen_random_uuid())
      when field.key='created_at' then to_jsonb(original.created_at+interval '1 second')
      when jsonb_typeof(field.value)='boolean' then to_jsonb(not (field.value::text)::boolean)
      when jsonb_typeof(field.value)='number' then to_jsonb((field.value::text)::numeric+1)
      when jsonb_typeof(field.value)='array' then field.value||'"tampered"'::jsonb
      else to_jsonb(coalesce(field.value#>>'{}','')||'-tampered') end;
    begin
      execute format('update public.sourcing_media_candidates set review_status=''approved'', %1$I=(jsonb_populate_record(null::public.sourcing_media_candidates,$1)).%1$I where id=$2',field.key)
        using jsonb_build_object(field.key,replacement),ctx.evidence_id;
      raise exception 'Evidence mutation was accepted for %',field.key;
    exception when sqlstate '55000' then
      if sqlerrm<>'Sourcing media may only be decided through the controlled review operation' then raise; end if;
    end;
  end loop;

  begin
    update public.sourcing_media_candidates set source_url_identity='https://attacker.example/' where id=ctx.evidence_id;
    raise exception 'Generated identity was directly writable';
  exception when sqlstate '428C9' then null;
  end;
  begin
    update public.sourcing_media_candidates set review_status='rejected' where id=ctx.approve_id;
    raise exception 'Final media decision could be changed';
  exception when sqlstate '55000' then null;
  end;
  begin
    update public.sourcing_media_review_events set note='Tampered review evidence.' where media_id=ctx.approve_id;
    raise exception 'Review event update was accepted';
  exception when sqlstate '55000' then null;
  end;
  begin
    delete from public.sourcing_media_review_events where media_id=ctx.reject_id;
    raise exception 'Review event deletion was accepted';
  exception when sqlstate '55000' then null;
  end;
end $$;

rollback;
