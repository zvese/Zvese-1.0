import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parseDelivery, canBuy, orderPage, money } from "../src/lib/orders/checkout.ts";

function form(extra = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ recipient_name: " Test Buyer ", phone: "+263000000", address_line1: "1 Test Road", city: "Harare", region: "Harare", country: "zw", delivery_method: "standard", ...extra })) data.set(key, value);
  return data;
}
test("checkout forwards only normalized delivery fields, never privileged browser values", () => {
  const delivery = parseDelivery(form({ unit_price: "1", currency: "XXX", seller_profile_id: "forged", subtotal: "0", quantity: "100", buyer_user_id: "other", status: "paid" }));
  assert.equal(delivery.country, "ZW"); assert.equal(delivery.recipient_name, "Test Buyer");
  assert.deepEqual(Object.keys(delivery).sort(), ["recipient_name", "phone", "address_line1", "address_line2", "city", "region", "postal_code", "country", "delivery_method"].sort());
});
test("checkout rejects invalid delivery and missing required fields", () => {
  for (const input of [{ city: " " }, { phone: "1" }, { recipient_name: "x".repeat(121) }, { country: "123" }, { delivery_method: "free" }]) assert.throws(() => parseDelivery(form(input)));
  assert.equal(parseDelivery(form({ delivery_method: "express" })).delivery_method, "express");
});
test("only approved available listings offer Buy now, including the checking T-shirt gate", () => {
  assert.equal(canBuy("available", "approved"), true);
  for (const [availability, review] of [["checking", "approved"], ["unavailable", "approved"], ["available", "draft"], ["available", "legacy_unreviewed"], ["available", "rejected"]]) assert.equal(canBuy(availability, review), false);
});
test("money uses existing minor units and paging is bounded", () => {
  assert.match(money(1250, "USD"), /12\.50/);
  for (const input of ["-1", "1.5", "NaN", "2001"]) assert.equal(orderPage(input), 1);
  assert.equal(orderPage("2"), 2);
});
test("order action uses authenticated session and canonical RPC with encrypted server context", () => {
  const action = readFileSync(new URL("../src/app/checkout/[id]/actions.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("../src/app/checkout/[id]/page.tsx", import.meta.url), "utf8");
  assert.match(action, /requireBuyer\(\)/); assert.match(action, /user\.id !== context\.buyerId/);
  assert.match(action, /rpc\("create_buyer_order"/); assert.match(page, /randomUUID\(\)/); assert.match(page, /"use server"/);
  assert.doesNotMatch(action, /service.role|ProductSystemClient|\.insert\(|\.update\(/i);
});
test("SQL preserves public and exact review/file gates, locks, canonical snapshot and limited seller access", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20260914120000_buyer_orders.sql", import.meta.url), "utf8");
  assert.match(sql, /private\.listing_is_public\(l.id\)/);
  assert.match(sql, /e\.files_fingerprint=private\.submission_files_fingerprint/);
  assert.match(sql, /l\.availability_state='available'/);
  assert.match(sql, /pg_advisory_xact_lock/); assert.match(sql, /for update/); assert.match(sql, /for share/);
  assert.match(sql, /l\.price_minor,l\.currency,1,l\.price_minor\*1/);
  assert.match(sql, /buyer_user_id=\(select auth.uid\(\)\)/);
  assert.match(sql, /s\.user_id=auth.uid\(\) and s.status='active'/);
  assert.doesNotMatch(sql, /grant (?:all|insert|update|delete).*to (?:anon|authenticated)/i);
});
