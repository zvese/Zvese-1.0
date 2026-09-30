-- Run only on disposable LOCAL Supabase with the orders migration installed.
-- All fixture users, listings, reviews, orders and test triggers are rolled back.
begin;
create function pg_temp.ok(value boolean,message text) returns void language plpgsql as $$
begin if value is not true then raise exception 'FAIL: %',message; end if; raise notice 'PASS: %',message; end; $$;
create function pg_temp.fails(statement text,expected text,message text) returns void language plpgsql as $$
begin
 begin execute statement;
 exception when others then
   if sqlstate=expected then raise notice 'PASS: %',message; return; end if;
   raise exception 'FAIL: % (expected %, got %: %)',message,expected,sqlstate,sqlerrm;
 end;
 raise exception 'FAIL: % (expected failure %)',message,expected;
end; $$;

insert into auth.users(id,aud,role,email,created_at,updated_at)
select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','order-fixture-'||n||'@example.invalid',now(),now()
from generate_series(1101,1106) n;
insert into public.seller_profiles(id,user_id,store_name,store_slug,status) values
 ('10000000-0000-4000-8000-000000001101','00000000-0000-4000-8000-000000001101','Order Seller A','order.fixture.a','active'),
 ('10000000-0000-4000-8000-000000001102','00000000-0000-4000-8000-000000001102','Order Seller B','order.fixture.b','active');
insert into public.admin_memberships(user_id,role,is_active) values
 ('00000000-0000-4000-8000-000000001105','super_admin',true),
 ('00000000-0000-4000-8000-000000001106','seller_reviewer',true);

create function pg_temp.listing(seller uuid,title text,decision text,availability text) returns uuid language plpgsql as $$
declare v_id uuid; r record;
begin
 perform set_config('request.jwt.claim.sub',seller::text,true);
 v_id:=public.save_source_listing(title,'A canonical product for disposable order tests',1250,'other','Local fixture source');
 if decision='draft' then return v_id; end if;
 perform public.submit_source_listing(v_id);
 if decision='pending_review' then return v_id; end if;
 select * into r from public.get_product_review_input(v_id,1);
 perform public.record_product_review(v_id,1,gen_random_uuid(),decision,availability,r.snapshot_hash,r.files_fingerprint,
 jsonb_build_object('kind','manual','controller','local-order-test','source',jsonb_build_object('reference','evidence://local/order-test','observed_at',now(),'availability',availability),
 'policy',jsonb_build_object('version','order-test-v1','result',decision)));
 return v_id;
end; $$;
select set_config('test.available',pg_temp.listing('00000000-0000-4000-8000-000000001101','Canonical A','approved','available')::text,true);
select set_config('test.other',pg_temp.listing('00000000-0000-4000-8000-000000001102','Canonical B','approved','available')::text,true);
select set_config('test.checking',pg_temp.listing('00000000-0000-4000-8000-000000001101','Checking fixture','approved','checking')::text,true);
select set_config('test.unavailable',pg_temp.listing('00000000-0000-4000-8000-000000001101','Unavailable fixture','approved','unavailable')::text,true);
select set_config('test.draft',pg_temp.listing('00000000-0000-4000-8000-000000001101','Draft fixture','draft','checking')::text,true);
select set_config('test.pending',pg_temp.listing('00000000-0000-4000-8000-000000001101','Pending fixture','pending_review','checking')::text,true);
select set_config('test.rejected',pg_temp.listing('00000000-0000-4000-8000-000000001101','Rejected fixture','rejected','unavailable')::text,true);
select set_config('test.delivery','{"recipient_name":"Test Recipient","phone":"+2630000000","address_line1":"1 Test Road","address_line2":"","city":"Harare","region":"Harare","postal_code":"","country":"ZW","delivery_method":"standard"}',true);
create function pg_temp.buy(listing uuid,checkout uuid default gen_random_uuid()) returns uuid language sql as $$
 select public.create_buyer_order(listing,1,checkout,current_setting('test.delivery')::jsonb);
$$;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
select pg_temp.fails($q$select pg_temp.buy(current_setting('test.available')::uuid)$q$,'42501','anonymous cannot order');
select pg_temp.fails('select * from public.orders','42501','anonymous cannot read orders');
select pg_temp.fails('select * from public.order_items','42501','anonymous cannot read items');
select pg_temp.fails('select * from public.get_my_sales()','42501','anonymous cannot read sales');
set local role authenticated;
select pg_temp.fails($q$select pg_temp.buy(current_setting('test.available')::uuid)$q$,'42501','missing JWT subject cannot order');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001103',true);
select pg_temp.fails('insert into public.orders default values','42501','buyer cannot insert orders directly');
select pg_temp.fails('insert into public.order_items default values','42501','buyer cannot insert items directly');
select pg_temp.fails('update public.orders set status=''pending''','42501','buyer cannot update orders');
select pg_temp.fails($q$select pg_temp.buy(current_setting('test.draft')::uuid)$q$,'55000','draft product blocks order');
select pg_temp.fails($q$select pg_temp.buy(current_setting('test.pending')::uuid)$q$,'55000','unpublished product blocks order');
select pg_temp.fails($q$select pg_temp.buy(current_setting('test.rejected')::uuid)$q$,'55000','rejected product blocks order');
select pg_temp.fails($q$select pg_temp.buy(current_setting('test.checking')::uuid)$q$,'55000','checking availability blocks order');
select pg_temp.fails($q$select pg_temp.buy(current_setting('test.unavailable')::uuid)$q$,'55000','unavailable blocks order');
select pg_temp.fails($q$select pg_temp.buy('ffffffff-ffff-4fff-8fff-ffffffffffff')$q$,'55000','missing product blocks order');
select pg_temp.fails($q$select public.create_buyer_order(current_setting('test.available')::uuid,2,gen_random_uuid(),current_setting('test.delivery')::jsonb)$q$,'55000','stale checkout revision blocked');
select pg_temp.fails($q$select public.create_buyer_order(current_setting('test.available')::uuid,1,gen_random_uuid(),current_setting('test.delivery')::jsonb||'{"unit_price":1}')$q$,'22023','forged price is rejected');
select pg_temp.fails($q$select public.create_buyer_order(current_setting('test.available')::uuid,1,gen_random_uuid(),current_setting('test.delivery')::jsonb||'{"seller_profile_id":"10000000-0000-4000-8000-000000001102"}')$q$,'22023','forged seller is rejected');
select pg_temp.fails($q$select public.create_buyer_order(current_setting('test.available')::uuid,1,gen_random_uuid(),current_setting('test.delivery')::jsonb||'{"delivery_method":"teleport"}')$q$,'23514','invalid delivery rolls back');
select pg_temp.ok(not exists(select 1 from public.orders),'failed checkouts left no buyer orders');

reset role;
update public.seller_profiles set status='suspended' where id='10000000-0000-4000-8000-000000001101';
set local role authenticated;
select pg_temp.fails($q$select pg_temp.buy(current_setting('test.available')::uuid)$q$,'55000','inactive seller blocks order');
reset role;
update public.seller_profiles set status='active' where id='10000000-0000-4000-8000-000000001101';
update public.products set status='draft' where id=(select product_id from public.listings where id=current_setting('test.available')::uuid);
set local role authenticated;
select pg_temp.fails($q$select pg_temp.buy(current_setting('test.available')::uuid)$q$,'55000','inactive canonical product blocks order');
reset role;
update public.products set status='active' where id=(select product_id from public.listings where id=current_setting('test.available')::uuid);

-- Force a failure AFTER the order header insert to prove transaction rollback.
create function pg_temp.fail_item() returns trigger language plpgsql as $$ begin raise exception 'Synthetic item failure' using errcode='P0001'; end; $$;
create trigger test_order_item_failure before insert on public.order_items for each row execute function pg_temp.fail_item();
set local role authenticated;
select pg_temp.fails($q$select pg_temp.buy(current_setting('test.available')::uuid)$q$,'P0001','item failure rolls back whole transaction');
select pg_temp.ok(not exists(select 1 from public.orders),'no orphan header after item failure');
select pg_temp.ok(not exists(select 1 from public.order_items),'no orphan item after failure');
reset role;
drop trigger test_order_item_failure on public.order_items;
set local role authenticated;
select set_config('test.checkout',gen_random_uuid()::text,true);
select set_config('test.order_a',pg_temp.buy(current_setting('test.available')::uuid,current_setting('test.checkout')::uuid)::text,true);
select pg_temp.ok(current_setting('test.order_a')::uuid=pg_temp.buy(current_setting('test.available')::uuid,current_setting('test.checkout')::uuid),'available listing succeeds and duplicate checkout returns same order');
select pg_temp.ok((select count(*)=1 from public.orders),'retry creates no duplicate order');
select pg_temp.fails($q$select pg_temp.buy(current_setting('test.other')::uuid,current_setting('test.checkout')::uuid)$q$,'22023','checkout key cannot be reused for different listing');
select pg_temp.ok((select subtotal=1250 and currency='USD' and status='pending' from public.orders where id=current_setting('test.order_a')::uuid),'server subtotal currency and pending status canonical');
select pg_temp.ok((select product_name='Canonical A' and seller_name='Order Seller A' and seller_profile_id='10000000-0000-4000-8000-000000001101'
 and unit_price=1250 and currency='USD' and quantity=1 and line_total=1250 and submission_revision=1
 and product_id=(select product_id from public.listings where id=current_setting('test.available')::uuid)
 from public.order_items where order_id=current_setting('test.order_a')::uuid),'item snapshots canonical product seller price currency revision and totals');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001104',true);
select pg_temp.ok(not exists(select 1 from public.orders where id=current_setting('test.order_a')::uuid),'other buyer cannot read order');
select pg_temp.ok(not exists(select 1 from public.order_items where order_id=current_setting('test.order_a')::uuid),'other buyer cannot read items');
select set_config('test.order_b',pg_temp.buy(current_setting('test.other')::uuid)::text,true);
select pg_temp.ok((select count(*)=1 from public.orders),'buyer reads only own order');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001101',true);
select pg_temp.ok((select count(*)=1 from public.order_items),'seller reads only own items');
select pg_temp.ok(not exists(select 1 from public.orders),'seller has no full order header access');
select pg_temp.ok((select count(*)=1 and bool_and(product_name='Canonical A' and recipient_name='Test Recipient') from public.get_my_sales()),'seller sees own sale and necessary delivery data');
select pg_temp.ok(not exists(select 1 from public.get_my_sales() where order_id=current_setting('test.order_b')::uuid),'seller cannot see another seller sale');
select pg_temp.fails('update public.order_items set quantity=2','42501','seller cannot modify orders');
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.seller_profiles set status='suspended' where id='10000000-0000-4000-8000-000000001101';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001101',true);
select pg_temp.ok(not exists(select 1 from public.get_my_sales()),'suspended seller loses sales access');
select pg_temp.ok(not exists(select 1 from public.order_items),'suspended seller loses item access');
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.seller_profiles set status='active' where id='10000000-0000-4000-8000-000000001101';

-- Future multiple-seller order: each seller must still see only their line and no subtotal/buyer ID.
insert into public.order_items(order_id,product_id,listing_id,seller_profile_id,submission_revision,product_name,seller_name,unit_price,currency,quantity,line_total)
select current_setting('test.order_a')::uuid,product_id,listing_id,seller_profile_id,submission_revision,product_name,seller_name,unit_price,currency,quantity,line_total
from public.order_items where order_id=current_setting('test.order_b')::uuid;
update public.orders set subtotal=2500 where id=current_setting('test.order_a')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001101',true);
select pg_temp.ok((select count(*)=1 from public.order_items where order_id=current_setting('test.order_a')::uuid),'seller cannot see other line of shared order');
select pg_temp.ok((select count(*)=1 and bool_and(line_total=1250) from public.get_my_sales() where order_id=current_setting('test.order_a')::uuid),'shared order sales projection exposes only seller amount');
select pg_temp.ok((select bool_and(not(to_jsonb(s) ? 'buyer_user_id') and not(to_jsonb(s) ? 'subtotal')) from public.get_my_sales() s),'sales projection omits buyer identity and full subtotal');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001105',true);
select pg_temp.ok((select count(*)=2 from public.orders where id in (current_setting('test.order_a')::uuid,current_setting('test.order_b')::uuid)),'active super admin sees all fixture orders');
select pg_temp.ok((select count(*)=3 from public.order_items where order_id in (current_setting('test.order_a')::uuid,current_setting('test.order_b')::uuid)),'active super admin sees all fixture items');
reset role;
update public.admin_memberships set is_active=false where user_id='00000000-0000-4000-8000-000000001105';
set local role authenticated;
select pg_temp.ok(not exists(select 1 from public.orders),'inactive super admin denied');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001106',true);
select pg_temp.ok(not exists(select 1 from public.orders),'seller-review-only admin denied');
reset role;
update public.products set title='Changed later' where id=(select product_id from public.listings where id=current_setting('test.available')::uuid);
select pg_temp.ok((select product_name='Canonical A' and unit_price=1250 from public.order_items where listing_id=current_setting('test.available')::uuid),'purchase snapshot survives later product edits');
select pg_temp.ok(not has_table_privilege('authenticated','public.orders','INSERT') and not has_table_privilege('authenticated','public.order_items','INSERT'),'no privileged browser writes');
select pg_temp.ok(not has_function_privilege('anon','public.create_buyer_order(uuid,integer,uuid,jsonb)','execute'),'anonymous RPC execute revoked');
rollback;
