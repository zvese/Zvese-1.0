-- Executed ONLY by scripts/test-commerce-local.mjs in the pinned development container.
-- The proposal, fixtures, assertions and schema changes all roll back together.
create function pg_temp.assert_true(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Assertion failed: %',label; end if; end; $$;
create function pg_temp.denied(statement text, label text) returns void language plpgsql as $$
begin
 begin execute statement;
 exception when others then return;
 end;
 raise exception 'Unexpectedly permitted: %',label;
end; $$;
create temp table commerce_test_ids(key text primary key,id uuid not null default gen_random_uuid());
insert into commerce_test_ids(key) values('buyer'),('other'),('admin'),('order'),('rate'),('attempt');
grant select on commerce_test_ids to authenticated,service_role;
insert into auth.users(id,email) select id,'commerce-test-'||id||'@example.invalid' from commerce_test_ids where key in ('buyer','other','admin');
insert into public.profiles(id) select id from commerce_test_ids where key in ('buyer','other','admin') on conflict(id) do nothing;
insert into public.admin_memberships(user_id,role,is_active) select id,'super_admin',true from commerce_test_ids where key='admin';
insert into public.orders(id,buyer_user_id,checkout_id,request_fingerprint,currency,subtotal,delivery_method,recipient_name,phone,address_line1,city,region,country)
values((select id from commerce_test_ids where key='order'),(select id from commerce_test_ids where key='buyer'),gen_random_uuid(),'local-fixture','USD',1000,'standard','Test Buyer','000000000','Fixture only','Harare','Harare','ZW');
insert into public.shipping_rates(id,label,method,country,region,city,currency,amount_minor,active)
values((select id from commerce_test_ids where key='rate'),'Fixture only','standard','ZW','Harare','Harare','USD',250,true);
insert into public.order_commerce(order_id,rate_id,shipping_minor,total_minor,currency)
values((select id from commerce_test_ids where key='order'),(select id from commerce_test_ids where key='rate'),250,1250,'USD');

set local role authenticated;
select set_config('request.jwt.claim.sub',(select id::text from commerce_test_ids where key='other'),true) is not null as session_set;
select pg_temp.assert_true((select count(*)=0 from public.order_commerce),'other buyer RLS');
select pg_temp.denied('select public.reserve_order_payment('''||(select id from commerce_test_ids where key='order')||''')','other buyer cannot pay');
select pg_temp.denied('select public.request_order_resolution('''||(select id from commerce_test_ids where key='order')||''',''cancel'')','other buyer cannot cancel');
select pg_temp.denied('select public.advance_order_fulfillment('''||(select id from commerce_test_ids where key='order')||''',''unfulfilled'',''sourcing'',null)','nonadmin fulfillment');
select set_config('request.jwt.claim.sub',(select id::text from commerce_test_ids where key='buyer'),true) is not null as session_set;
select pg_temp.assert_true((select count(*)=1 from public.order_commerce),'buyer reads own commerce');
select pg_temp.denied('update public.order_commerce set payment_status=''paid''','buyer cannot mark paid');
select pg_temp.denied('select * from public.payment_attempts','buyer cannot read provider references');
select pg_temp.denied('select public.apply_verified_payment(gen_random_uuid(),''forged'',1250,''USD'',''paid'')','buyer cannot forge verified payment');
select pg_temp.denied('select public.reserve_order_payment('''||(select id from commerce_test_ids where key='order')||''')','empty order cannot initiate payment');
select pg_temp.assert_true((select count(*)=0 from public.get_sale_commerce((select id from commerce_test_ids where key='order'))),'non-seller has no sale access');

reset role;
-- A trusted reservation fixture allows exercising provider reconciliation in isolation.
insert into public.payment_attempts(id,order_id,amount_minor,currency)
values((select id from commerce_test_ids where key='attempt'),(select id from commerce_test_ids where key='order'),1250,'USD');
select pg_temp.denied('insert into public.payment_attempts(order_id,amount_minor,currency) values('''||(select id from commerce_test_ids where key='order')||''',1250,''USD'')','one attempt per order');
set local role service_role;
select public.bind_payment_reference((select id from commerce_test_ids where key='attempt'),'fixture-reference','https://test.sandbox.pesepay.com/fixture');
select pg_temp.denied('select public.bind_payment_reference('''||(select id from commerce_test_ids where key='attempt')||''',''replacement'',''https://test.sandbox.pesepay.com/fixture'')','immutable provider reference');
select pg_temp.denied('select public.apply_verified_payment('''||(select id from commerce_test_ids where key='attempt')||''',''fixture-reference'',1,''USD'',''paid'')','amount mismatch');
select pg_temp.denied('select public.apply_verified_payment('''||(select id from commerce_test_ids where key='attempt')||''',''fixture-reference'',1250,''ZWG'',''paid'')','currency mismatch');
select pg_temp.denied('select public.apply_verified_payment('''||(select id from commerce_test_ids where key='attempt')||''',''wrong-order'',1250,''USD'',''paid'')','reference mismatch');
select pg_temp.assert_true(public.claim_payment_check((select id from commerce_test_ids where key='attempt')),'first reconciliation claimed');
select pg_temp.assert_true(not public.claim_payment_check((select id from commerce_test_ids where key='attempt')),'duplicate reconciliation throttled');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select id::text from commerce_test_ids where key='admin'),true) is not null as session_set;
select pg_temp.denied('select public.advance_order_fulfillment('''||(select id from commerce_test_ids where key='order')||''',''unfulfilled'',''sourcing'',null)','unpaid order cannot be fulfilled');
reset role;
set local role service_role;
select public.apply_verified_payment((select id from commerce_test_ids where key='attempt'),'fixture-reference',1250,'USD','paid');
select public.apply_verified_payment((select id from commerce_test_ids where key='attempt'),'fixture-reference',1250,'USD','paid');
select public.apply_verified_payment((select id from commerce_test_ids where key='attempt'),'fixture-reference',1250,'USD','pending');
reset role;
select pg_temp.assert_true((select payment_status='paid' from public.order_commerce),'duplicate and delayed webhook protection');
select pg_temp.assert_true((select count(*)=1 from public.commerce_events where event_type='payment_verified'),'duplicate event not recorded twice');
set local role authenticated;
select public.advance_order_fulfillment((select id from commerce_test_ids where key='order'),'unfulfilled','sourcing',null);
select pg_temp.denied('select public.advance_order_fulfillment('''||(select id from commerce_test_ids where key='order')||''',''sourcing'',''delivered'',null)','cannot skip dispatch');
select pg_temp.denied('select public.advance_order_fulfillment('''||(select id from commerce_test_ids where key='order')||''',''sourcing'',''dispatched'',null)','tracking required');
select public.advance_order_fulfillment((select id from commerce_test_ids where key='order'),'sourcing','dispatched','TEST-ONLY-TRACKING');
select set_config('request.jwt.claim.sub',(select id::text from commerce_test_ids where key='buyer'),true) is not null as session_set;
select public.request_order_resolution((select id from commerce_test_ids where key='order'),'refund');
select set_config('request.jwt.claim.sub',(select id::text from commerce_test_ids where key='admin'),true) is not null as session_set;
select pg_temp.denied('select public.advance_order_fulfillment('''||(select id from commerce_test_ids where key='order')||''',''dispatched'',''delivered'',null)','open refund blocks fulfillment');
reset role;
set local role service_role;
select public.apply_verified_payment((select id from commerce_test_ids where key='attempt'),'fixture-reference',1250,'USD','refunded');
select public.apply_verified_payment((select id from commerce_test_ids where key='attempt'),'fixture-reference',1250,'USD','paid');
reset role;
select pg_temp.assert_true((select payment_status='refunded' from public.order_commerce),'refund cannot revert to paid');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.apply_verified_payment(uuid,text,bigint,text,text)','EXECUTE'),'payment mutation is service-only');
select 'LOCAL_COMMERCE_ASSERTIONS_PASS' as result;
