-- Disposable LOCAL Supabase only. No migrations or persistent fixtures here.
-- Application moderator authorization is tested in tests/product-review.test.mjs.
-- This suite checks the existing privileged RPC and actual public RLS/predicates.
begin;
create function pg_temp.ok(value boolean,message text) returns void language plpgsql as $$
begin if value is not true then raise exception 'Assertion failed: %',message; end if; end; $$;
create function pg_temp.fails(statement text,expected text) returns void language plpgsql as $$
begin
 begin execute statement;
 exception when others then
 if sqlstate=expected then return; end if;
 raise exception 'Expected SQLSTATE %, got %: %',expected,sqlstate,sqlerrm;
 end;
 raise exception 'Expected failure %: %',expected,statement;
end; $$;
select set_config('request.jwt.claim.sub','',true);
insert into auth.users(id,aud,role,email,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000000901','authenticated','authenticated','moderation-seller@example.invalid',now(),now());
insert into public.seller_profiles(id,user_id,store_name,store_slug,status) values
 ('10000000-0000-4000-8000-000000000901','00000000-0000-4000-8000-000000000901','Moderation fixture','moderation.fixture','active');
select pg_temp.ok(not has_function_privilege('authenticated','public.record_product_review(uuid,integer,uuid,text,text,text,text,jsonb)','execute'),'browser roles cannot directly review');
select pg_temp.ok(not has_function_privilege('anon','public.record_product_review(uuid,integer,uuid,text,text,text,text,jsonb)','execute'),'anonymous review denied');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000901',true);
select set_config('test.approve',public.save_source_listing('Attachment free approved','Description for a local publishing fixture',1200,'other','MVP source reference')::text,true);
select public.submit_source_listing(current_setting('test.approve')::uuid);
select public.begin_listing_revision(current_setting('test.approve')::uuid);
select public.save_source_listing('Revised submitted title','Description for the immutable revised fixture',1250,'other','MVP source reference',current_setting('test.approve')::uuid);
select pg_temp.ok(public.submit_source_listing(current_setting('test.approve')::uuid)=2,'new submission advances revision');
select set_config('test.reject',public.save_source_listing('Attachment free rejected','Description for a rejected publishing fixture',1200,'other','MVP source reference')::text,true);
select public.submit_source_listing(current_setting('test.reject')::uuid);
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.ok(not exists(select 1 from public.listings where id=current_setting('test.approve')::uuid),'pending revision is not public');
reset role;
create function pg_temp.decide(listing uuid,revision integer,decision text,job uuid) returns void language plpgsql as $$
declare r record; begin
 select * into r from public.get_product_review_input(listing,revision);
 perform public.record_product_review(listing,revision,job,decision,'checking',r.snapshot_hash,r.files_fingerprint,
 jsonb_build_object('kind','manual','controller','super_admin:local-test-only',
 'moderator_user_id','00000000-0000-4000-8000-000000000902','review_note','Synthetic local review; availability unconfirmed',
 'source',jsonb_build_object('reference','evidence://manual-product-review/local-test/'||job,'observed_at',now(),'availability','checking'),
 'policy',jsonb_build_object('version','manual-product-review-v1','result',decision)));
end; $$;
set local role service_role;
select pg_temp.fails($q$select pg_temp.decide(current_setting('test.approve')::uuid,1,'approved','40000000-0000-4000-8000-000000000901')$q$,'40001');
select pg_temp.decide(current_setting('test.approve')::uuid,2,'approved','40000000-0000-4000-8000-000000000901');
select pg_temp.fails($q$select pg_temp.decide(current_setting('test.approve')::uuid,2,'approved','40000000-0000-4000-8000-000000000901')$q$,'23505');
select pg_temp.fails($q$select pg_temp.decide(current_setting('test.approve')::uuid,2,'rejected','40000000-0000-4000-8000-000000000903')$q$,'23505');
select pg_temp.decide(current_setting('test.reject')::uuid,1,'rejected','40000000-0000-4000-8000-000000000902');
select pg_temp.ok((select count(*)=1 from public.product_review_events where listing_id=current_setting('test.approve')::uuid),'one immutable decision for approved revision');
select pg_temp.ok((select provenance->>'moderator_user_id'='00000000-0000-4000-8000-000000000902' from public.product_review_events where listing_id=current_setting('test.approve')::uuid),'moderator identity persisted in private evidence');
set local role anon;
select pg_temp.ok(private.listing_is_public(current_setting('test.approve')::uuid),'attachment-free approved revision is publicly eligible');
select pg_temp.ok(exists(select 1 from public.listings l join public.products p on p.id=l.product_id join public.seller_profiles s on s.id=l.seller_id
 where l.id=current_setting('test.approve')::uuid and l.status='active' and l.review_state in ('approved','legacy_unreviewed')
 and p.status='active' and s.status='active' and p.title='Revised submitted title'),'anonymous marketplace query sees approved canonical product');
select pg_temp.ok(not private.listing_is_public(current_setting('test.reject')::uuid),'rejected listing fails public predicate');
select pg_temp.ok(not exists(select 1 from public.listings where id=current_setting('test.reject')::uuid),'rejected listing is not anonymously readable');
reset role;
update public.seller_profiles set status='suspended' where id='10000000-0000-4000-8000-000000000901';
set local role anon;
select pg_temp.ok(not private.listing_is_public(current_setting('test.approve')::uuid),'suspended seller loses public eligibility');
select pg_temp.ok(not exists(select 1 from public.listings where id=current_setting('test.approve')::uuid),'suspended listing hidden by RLS');
reset role;
rollback;
