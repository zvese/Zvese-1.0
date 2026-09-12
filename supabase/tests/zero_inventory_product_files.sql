-- DISPOSABLE LOCAL database only; requires migrations. Never run against live.
-- psql -v ON_ERROR_STOP=1 -f supabase/tests/zero_inventory_product_files.sql
-- Storage rows below are fixtures, NOT a substitute for HTTP/byte validation tests.
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
-- All identities and evidence in this suite are synthetic, rolled-back fixtures.
insert into auth.users(id,aud,role,email,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000000801','authenticated','authenticated','product-a@example.invalid',now(),now()),
 ('00000000-0000-4000-8000-000000000802','authenticated','authenticated','product-b@example.invalid',now(),now()),
 ('00000000-0000-4000-8000-000000000803','authenticated','authenticated','product-pending@example.invalid',now(),now());
insert into public.seller_profiles(id,user_id,store_name,store_slug,status) values
 ('10000000-0000-4000-8000-000000000801','00000000-0000-4000-8000-000000000801','Product A','product.a','active'),
 ('10000000-0000-4000-8000-000000000802','00000000-0000-4000-8000-000000000802','Product B','product.b','active'),
 ('10000000-0000-4000-8000-000000000803','00000000-0000-4000-8000-000000000803','Product Pending','product.pending','pending');
-- Represents a pre-migration active row (backfill state), with old stock values.
insert into public.products(id,created_by,title,slug,description,status) values
 ('20000000-0000-4000-8000-000000000801','00000000-0000-4000-8000-000000000801','Legacy fixture','legacy-fixture','Legacy product fixture description','active');
insert into public.listings(id,product_id,seller_id,price_minor,status,inventory_quantity,inventory_mode,review_state) values
 ('30000000-0000-4000-8000-000000000801','20000000-0000-4000-8000-000000000801','10000000-0000-4000-8000-000000000801',100,'active',999,'stock','legacy_unreviewed');
select pg_temp.ok(not exists(select 1 from storage.buckets where id like 'product-%' and public),'all buckets private');
select pg_temp.ok(not has_function_privilege('authenticated','public.record_product_review(uuid,integer,uuid,text,text,text,text,jsonb)','execute'),'seller review RPC denied');
select pg_temp.ok(not has_function_privilege('anon','public.record_product_review(uuid,integer,uuid,text,text,text,text,jsonb)','execute'),'anon review RPC denied');
select pg_temp.ok(not has_function_privilege('authenticated','public.record_product_file_validation(uuid,text,uuid,text,text,text,text,text,text)','execute'),'seller validation RPC denied');
select pg_temp.ok(not has_function_privilege('anon','public.get_validated_file_delivery(uuid)','execute'),'anon vault descriptor denied');
select pg_temp.ok(not has_function_privilege('authenticated','public.create_product_listing(text,text,bigint,bigint,text,text,uuid)','execute'),'legacy publishing RPC denied');
select pg_temp.ok(not has_table_privilege('service_role','public.listings','UPDATE'),'worker must use guarded RPC');
select pg_temp.ok(not has_column_privilege('authenticated','public.product_files','object_path','SELECT'),'no persistent path disclosure');
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.ok(exists(select 1 from public.listings where id='30000000-0000-4000-8000-000000000801' and review_state='legacy_unreviewed' and availability_state='checking'),'legacy visible without false verification');
select pg_temp.fails($q$insert into storage.objects(bucket_id,name) values('product-images','arbitrary.png')$q$,'42501');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000801',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000801',true);
select set_config('test.listing',public.save_source_listing('Partner product','A detailed product description',1200,'supplier','Fixture supplier')::text,true);
select pg_temp.ok((select current_revision=0 and review_state='draft' and availability_state='checking' and inventory_quantity=0 from public.listings where id=current_setting('test.listing')::uuid),'new listings start draft/checking with no stock');
select pg_temp.fails($q$update public.listings set review_state='approved',availability_state='available',status='active',inventory_quantity=999 where id=current_setting('test.listing')::uuid$q$,'42501');
select pg_temp.fails($q$select public.record_product_review(current_setting('test.listing')::uuid,1,gen_random_uuid(),'approved','available','x','x','{}')$q$,'42501');
select pg_temp.fails($q$select public.record_product_file_validation(gen_random_uuid(),'v',gen_random_uuid(),'passed',repeat('a',64),'seller','evidence://fake')$q$,'42501');
select pg_temp.fails($q$update public.product_files set content_validation_state='passed'$q$,'42501');
-- Both MIME and extension, visibility and all size boundaries enforced by RPC.
do $$ declare n text; begin
 foreach n in array array['run.exe','run.js','run.html','run.svg','run.sh','run.cmd'] loop
 perform pg_temp.fails(format('select public.reserve_product_file(%L,%L,%L,%L,100)',current_setting('test.listing'),'public',n,'image/png'),'22023'); end loop;
end $$;
select pg_temp.fails($q$select public.reserve_product_file(current_setting('test.listing')::uuid,'public','photo.png','image/jpeg',100)$q$,'22023');
select pg_temp.fails($q$select public.reserve_product_file(current_setting('test.listing')::uuid,'public','../photo.png','image/png',100)$q$,'22023');
select pg_temp.fails($q$select public.reserve_product_file(current_setting('test.listing')::uuid,'public','photo.png','image/png',10485761)$q$,'22023');
select pg_temp.fails($q$select public.reserve_product_file(current_setting('test.listing')::uuid,'public','clip.mp4','video/mp4',104857601)$q$,'22023');
select pg_temp.fails($q$select public.reserve_product_file(current_setting('test.listing')::uuid,'private','source.pdf','application/pdf',26214401)$q$,'22023');
select pg_temp.fails($q$select public.reserve_product_file(current_setting('test.listing')::uuid,'public','source.txt','text/plain',100)$q$,'22023');
select set_config('test.public_file',id::text,true),set_config('test.public_path',object_path,true)
 from public.reserve_product_file(current_setting('test.listing')::uuid,'public','photo.png','image/png',100);
select set_config('test.private_file',id::text,true),set_config('test.private_path',object_path,true)
 from public.reserve_product_file(current_setting('test.listing')::uuid,'private','source.pdf','application/pdf',100);
select set_config('test.text_file',id::text,true)
 from public.reserve_product_file(current_setting('test.listing')::uuid,'private','source.txt','text/plain',38);
select pg_temp.fails($q$select public.finish_product_file(current_setting('test.public_file')::uuid)$q$,'22023');
select pg_temp.fails($q$select public.submit_source_listing(current_setting('test.listing')::uuid)$q$,'55000');
-- Active second seller cannot manage another seller or select private metadata.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000802',true);
select pg_temp.ok(not exists(select id from public.product_files where id=current_setting('test.private_file')::uuid),'cross-seller private metadata denied');
select pg_temp.fails($q$select public.remove_product_file(current_setting('test.public_file')::uuid)$q$,'42501');
select pg_temp.fails($q$select public.finish_product_file(current_setting('test.public_file')::uuid)$q$,'42501');
select pg_temp.fails($q$select public.begin_listing_revision(current_setting('test.listing')::uuid)$q$,'42501');
select pg_temp.fails($q$insert into storage.objects(bucket_id,name) values('product-images',current_setting('test.public_path'))$q$,'42501');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000803',true);
select pg_temp.fails($q$select public.save_source_listing('Pending seller','A detailed description',100,'supplier','Fixture supplier')$q$,'42501');
-- Simulate late Storage persistence after seller suspension. Finalization fails.
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.seller_profiles set status='suspended' where id='10000000-0000-4000-8000-000000000801';
insert into storage.objects(bucket_id,name,version,metadata)
 select bucket_id,object_path,'staging-v1',jsonb_build_object('size',size_bytes,'mimetype',mime_type) from public.product_files where listing_id=current_setting('test.listing')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000801',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000801',true);
select pg_temp.fails($q$select public.finish_product_file(current_setting('test.public_file')::uuid)$q$,'42501');
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.seller_profiles set status='active' where id='10000000-0000-4000-8000-000000000801';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000801',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000801',true);
-- No raw staging reads, signing or overwrite, even for uploader.
select pg_temp.ok(not exists(select 1 from storage.objects where bucket_id='product-images'),'staging reads denied');
select public.finish_product_file(current_setting('test.public_file')::uuid);
select public.finish_product_file(current_setting('test.private_file')::uuid);
select public.finish_product_file(current_setting('test.text_file')::uuid);
select pg_temp.fails($q$select public.finish_product_file(current_setting('test.public_file')::uuid)$q$,'55000');
select pg_temp.ok(public.submit_source_listing(current_setting('test.listing')::uuid)=1,'submission revision 1');
select pg_temp.fails($q$select public.remove_product_file(current_setting('test.public_file')::uuid)$q$,'55000');
select pg_temp.fails($q$select public.reserve_product_file(current_setting('test.listing')::uuid,'public','late.png','image/png',100)$q$,'55000');
select pg_temp.fails($q$select public.save_source_listing('Silent edit','A changed description',100,'supplier','Changed source',current_setting('test.listing')::uuid)$q$,'55000');
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('test.hash1',(select snapshot_hash from public.listing_submissions where listing_id=current_setting('test.listing')::uuid and revision=1),true);
-- Trusted review helper: reads canonical worker input and calls the same public RPC.
create function pg_temp.review(revision integer,job uuid,hash_override text default null,files_override text default null) returns void language plpgsql as $$
declare x record; begin
 select * into x from public.get_product_review_input(current_setting('test.listing')::uuid,revision);
 perform public.record_product_review(current_setting('test.listing')::uuid,revision,job,'approved','available',coalesce(hash_override,x.snapshot_hash,current_setting('test.hash1')),coalesce(files_override,x.files_fingerprint,repeat('a',64)),
 jsonb_build_object('kind','manual','controller','local-test-only','source',jsonb_build_object('reference','evidence://local-test/source','availability','available','observed_at',now()),'policy',jsonb_build_object('version','test-v1','result','approved')));
end; $$;
set local role service_role;
select pg_temp.fails($q$select pg_temp.review(1,'40000000-0000-4000-8000-000000000801')$q$,'55000');
-- Byte validation is represented only by trusted fixtures; no model is called.
reset role;
insert into storage.objects(bucket_id,name,version,metadata)
 select 'product-validated-files','validated/'||id||'/'||repeat('a',64)||'.'||substring(object_path from '\.([^.]+)$'),'vault-v1',jsonb_build_object('size',size_bytes,'mimetype',mime_type)
 from public.product_files where listing_id=current_setting('test.listing')::uuid;
-- Deliberately inconsistent paths still have real fixture rows with matching
-- version/MIME/size, so rejection must enforce identity/hash/extension binding.
insert into storage.objects(bucket_id,name,version,metadata) values
 ('product-validated-files','validated/00000000-0000-4000-8000-000000000899/'||repeat('a',64)||'.png','vault-v1','{"size":100,"mimetype":"image/png"}'),
 ('product-validated-files','validated/'||current_setting('test.public_file')||'/'||repeat('a',64)||'.svg','vault-v1','{"size":100,"mimetype":"image/png"}'),
 ('product-validated-files','validated/'||current_setting('test.public_file')||'/'||repeat('a',64)||'.jpg','vault-v1','{"size":100,"mimetype":"image/png"}');
select set_config('test.vault_path','validated/'||current_setting('test.public_file')||'/'||repeat('a',64)||'.png',true);
create function pg_temp.validate_file(hash text,path text,version text default 'vault-v1') returns void language plpgsql as $$
begin
 perform public.record_product_file_validation(current_setting('test.public_file')::uuid,'staging-v1',
 '40000000-0000-4000-8000-000000000850','passed',hash,'test-fixture-only','evidence://local-test/validation',path,version);
end; $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000801',true);
select pg_temp.fails($q$select pg_temp.validate_file(repeat('a',64),current_setting('test.vault_path'))$q$,'42501');
set local role service_role;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.fails($q$select pg_temp.validate_file(repeat('a',63),current_setting('test.vault_path'))$q$,'22023');
select pg_temp.fails($q$select pg_temp.validate_file(repeat('a',65),current_setting('test.vault_path'))$q$,'22023');
select pg_temp.fails($q$select pg_temp.validate_file(repeat('g',64),current_setting('test.vault_path'))$q$,'22023');
select pg_temp.fails($q$select pg_temp.validate_file(repeat('A',64),current_setting('test.vault_path'))$q$,'22023');
select pg_temp.fails($q$select pg_temp.validate_file(null,current_setting('test.vault_path'))$q$,'22023');
select pg_temp.fails($q$select pg_temp.validate_file(repeat('b',64),current_setting('test.vault_path'))$q$,'22023');
select pg_temp.fails($q$select pg_temp.validate_file(repeat('a',64),'validated/00000000-0000-4000-8000-000000000899/'||repeat('a',64)||'.png')$q$,'22023');
select pg_temp.fails($q$select pg_temp.validate_file(repeat('a',64),'validated/'||current_setting('test.public_file')||'/'||repeat('a',64)||'.svg')$q$,'22023');
select pg_temp.fails($q$select pg_temp.validate_file(repeat('a',64),'validated/'||current_setting('test.public_file')||'/'||repeat('a',64)||'.jpg')$q$,'22023');
select pg_temp.fails($q$select pg_temp.validate_file(repeat('a',64),current_setting('test.vault_path'),'wrong-version')$q$,'22023');
reset role;
update storage.objects set metadata='{"size":100,"mimetype":"text/plain"}' where bucket_id='product-validated-files' and name=current_setting('test.vault_path');
set local role service_role;
select pg_temp.fails($q$select pg_temp.validate_file(repeat('a',64),current_setting('test.vault_path'))$q$,'22023');
reset role;
update storage.objects set metadata='{"size":101,"mimetype":"image/png"}' where bucket_id='product-validated-files' and name=current_setting('test.vault_path');
set local role service_role;
select pg_temp.fails($q$select pg_temp.validate_file(repeat('a',64),current_setting('test.vault_path'))$q$,'22023');
reset role;
update storage.objects set metadata='{"size":100,"mimetype":"image/png"}' where bucket_id='product-validated-files' and name=current_setting('test.vault_path');
set local role service_role;
select public.record_product_file_validation(f.id,f.storage_version,gen_random_uuid(),'passed',repeat('a',64),'test-fixture-only','evidence://local-test/validation',o.name,o.version)
 from public.product_files f join storage.objects o on o.bucket_id='product-validated-files' and o.name='validated/'||f.id||'/'||repeat('a',64)||'.'||substring(f.object_path from '\.([^.]+)$') where f.listing_id=current_setting('test.listing')::uuid;
select pg_temp.ok((select count(*)=3 from public.product_file_validations v join public.product_files f on f.id=v.file_id where f.listing_id=current_setting('test.listing')::uuid and v.state='passed'),'64-character SHA paths validate, including 38-byte TXT');
select pg_temp.fails($q$select pg_temp.validate_file(repeat('a',64),current_setting('test.vault_path'))$q$,'23505');
select pg_temp.fails($q$select pg_temp.review(1,'40000000-0000-4000-8000-000000000801',repeat('b',64),null)$q$,'40001');
select pg_temp.fails($q$select pg_temp.review(1,'40000000-0000-4000-8000-000000000801',null,repeat('b',64))$q$,'40001');
select pg_temp.review(1,'40000000-0000-4000-8000-000000000801');
select pg_temp.fails($q$select pg_temp.review(1,'40000000-0000-4000-8000-000000000801')$q$,'23505');
select pg_temp.fails($q$select pg_temp.review(1,'40000000-0000-4000-8000-000000000899')$q$,'23505');
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.ok(exists(select 1 from public.listings where id=current_setting('test.listing')::uuid),'approved listing visible');
select pg_temp.ok(exists(select id from public.product_files where id=current_setting('test.public_file')::uuid),'current public media metadata visible');
select pg_temp.ok(not exists(select id from public.product_files where id=current_setting('test.private_file')::uuid),'private file metadata denied');
select pg_temp.ok((select count(*)=1 from public.get_listing_public_files(current_setting('test.listing')::uuid)),'only current public file enumerated');
select pg_temp.ok(not exists(select 1 from storage.objects where bucket_id='product-validated-files'),'vault cannot be directly read or signed');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000801',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000801',true);
select pg_temp.fails($q$select public.reserve_product_file(current_setting('test.listing')::uuid,'public','after-review.png','image/png',100)$q$,'55000');
select pg_temp.fails($q$update public.product_files set visibility='public' where id=current_setting('test.private_file')::uuid$q$,'42501');
select pg_temp.fails($q$delete from public.product_files where id=current_setting('test.public_file')::uuid$q$,'42501');
select public.begin_listing_revision(current_setting('test.listing')::uuid);
select public.save_source_listing('Revised title','A revised product description',1400,'supplier','Revised supplier',current_setting('test.listing')::uuid);
-- Detachment changes only the working set, never the old reviewed file/snapshot.
select public.remove_product_file(current_setting('test.public_file')::uuid);
select pg_temp.ok(public.submit_source_listing(current_setting('test.listing')::uuid)=2,'edit and resubmit advances revision');
set local role service_role;
select pg_temp.fails($q$select pg_temp.review(1,'40000000-0000-4000-8000-000000000802')$q$,'40001');
select pg_temp.fails($q$select pg_temp.review(2,'40000000-0000-4000-8000-000000000801')$q$,'23505');
select pg_temp.ok((select snapshot_hash=current_setting('test.hash1') from public.listing_submissions where listing_id=current_setting('test.listing')::uuid and revision=1),'old snapshot unchanged');
select pg_temp.ok((select count(*)=3 from public.submission_files where listing_id=current_setting('test.listing')::uuid and revision=1),'old file set preserved');
select pg_temp.review(2,'40000000-0000-4000-8000-000000000802');
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.ok(not exists(select id from public.product_files where id=current_setting('test.public_file')::uuid),'detached historical public media not buyer-readable');
reset role;
select pg_temp.fails($q$update public.listing_submissions set snapshot='{}' where listing_id=current_setting('test.listing')::uuid$q$,'55000');
select pg_temp.fails($q$delete from public.product_file_validations where file_id=current_setting('test.private_file')::uuid$q$,'55000');
-- Cancellation, expiry, maximum count and reconciliation on a separate draft.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000801',true);
select set_config('test.draft',public.save_source_listing('Upload lifecycle','A detailed product description',100,'supplier','Fixture supplier')::text,true);
select set_config('test.cancel',id::text,true) from public.reserve_product_file(current_setting('test.draft')::uuid,'public','cancel.png','image/png',100);
select public.remove_product_file(current_setting('test.cancel')::uuid);
select pg_temp.fails($q$select public.finish_product_file(current_setting('test.cancel')::uuid)$q$,'55000');
select set_config('test.expired',id::text,true) from public.reserve_product_file(current_setting('test.draft')::uuid,'public','expired.png','image/png',100);
reset role;
-- Simulate expiry while this transaction was running/waiting on locks.
-- now() is still earlier than expiry; the wall-clock check must reject it.
update public.product_files set expires_at=clock_timestamp()-interval '1 microsecond' where id=current_setting('test.expired')::uuid;
select pg_temp.ok((select expires_at>now() and expires_at<clock_timestamp() from public.product_files where id=current_setting('test.expired')::uuid),'expiry occurred after transaction start');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000801',true);
select pg_temp.fails($q$select public.finish_product_file(current_setting('test.expired')::uuid)$q$,'55000');
select public.remove_product_file(current_setting('test.expired')::uuid);
do $$ begin for i in 1..12 loop perform public.reserve_product_file(current_setting('test.draft')::uuid,'public','count.png','image/png',100); end loop; end $$;
select pg_temp.fails($q$select public.reserve_product_file(current_setting('test.draft')::uuid,'public','excess.png','image/png',100)$q$,'22023');
select public.withdraw_source_listing(current_setting('test.draft')::uuid);
select pg_temp.fails($q$select public.submit_source_listing(current_setting('test.draft')::uuid)$q$,'42501');
set local role service_role;
select public.reconcile_product_files();
select pg_temp.ok(exists(select 1 from public.product_cleanup_queue),'cleanup candidates queued without deleting evidence');
select pg_temp.ok(exists(select 1 from public.product_file_validations where file_id=current_setting('test.public_file')::uuid),'review evidence retained');
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.seller_profiles set status='rejected' where id='10000000-0000-4000-8000-000000000801';
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.ok(not exists(select 1 from public.listings where id=current_setting('test.listing')::uuid),'rejected seller hidden');
select pg_temp.ok(not exists(select id from public.product_files where id=current_setting('test.private_file')::uuid),'rejected seller private files hidden');
reset role;
rollback;
