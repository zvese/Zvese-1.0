import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shippingQuote, nextPaymentState, canFulfill } from "../src/lib/orders/commerce.ts";
import { encryptPayload, decryptPayload, authenticCallback, decimalMinor, reconcilePesepay, pesepaySandbox, safePaymentRedirect } from "../src/lib/payments/pesepay.ts";

const key = "0123456789abcdef0123456789abcdef"; // Test fixture, not a merchant credential.
const rate = { id: "test", label: "Test standard", method: "standard", country: "ZW", region: "Harare", city: "Harare", currency: "USD", amount_minor: 250 };
const destination = { country: "zw", region: " Harare ", city: "HARARE" };
const expected = { reference: "test-reference", amountMinor: 1250, currency: "USD" };
const transaction = (extra = {}) => ({ referenceNumber: "test-reference", amountDetails: { amount: 12.5, currencyCode: "USD" }, transactionStatus: "SUCCESS", ...extra });

test("standard and express quote exact configured amounts and service areas", () => {
  assert.deepEqual(shippingQuote(rate, destination, 1000, "USD"), { subtotal: 1000, shipping: 250, total: 1250, currency: "USD" });
  assert.equal(shippingQuote({ ...rate, method: "express", amount_minor: 500 }, destination, 1000, "USD").total, 1500);
  for (const change of [{ country: "ZA" }, { region: "Bulawayo" }, { city: "Elsewhere" }]) assert.throws(() => shippingQuote(rate, { ...destination, ...change }, 1000, "USD"));
  assert.throws(() => shippingQuote(rate, destination, 1000, "ZWG"));
  for (const value of [-1, 1.5, Infinity, Number.MAX_SAFE_INTEGER]) assert.throws(() => shippingQuote(rate, destination, value, "USD"));
  assert.throws(() => shippingQuote({ ...rate, amount_minor: -1 }, destination, 1000, "USD"));
});

test("payment crypto roundtrip, invalid envelope and callback authentication", () => {
  assert.deepEqual(decryptPayload(encryptPayload(transaction(), key), key), transaction());
  assert.throws(() => encryptPayload({}, "bad"));
  assert.throws(() => decryptPayload("!invalid!", key));
  assert.throws(() => decryptPayload(encryptPayload([], key), key));
  assert.equal(authenticCallback("fixture-key", "fixture-key"), true);
  for (const actual of [null, "", "forged", "fixture-keY"]) assert.equal(authenticCallback(actual, "fixture-key"), false);
  assert.equal(authenticCallback("", ""), false);
});

test("verification reconciles reference, principal amount and currency exactly", () => {
  assert.equal(reconcilePesepay(transaction(), expected), "paid");
  assert.throws(() => reconcilePesepay(transaction({ referenceNumber: "other-order" }), expected));
  assert.throws(() => reconcilePesepay(transaction({ amountDetails: { amount: 0.01, currencyCode: "USD" } }), expected));
  assert.throws(() => reconcilePesepay(transaction({ amountDetails: { amount: 12.5, currencyCode: "ZWG" } }), expected));
  assert.throws(() => reconcilePesepay(transaction({ transactionStatus: "UNKNOWN" }), expected));
  for (const [status, result] of [["FAILED", "failed"], ["CANCELLED", "cancelled"], ["REVERSED", "refunded"], ["PARTIALLY_PAID", "pending"], ["PROCESSING", "pending"]]) assert.equal(reconcilePesepay(transaction({ transactionStatus: status }), expected), result);
  assert.equal(decimalMinor("12.50"), 1250);
  for (const value of ["12.501", "-1", "1e4", null, Infinity, "not money"]) assert.throws(() => decimalMinor(value));
});

test("duplicate and out-of-order events cannot regress paid/refunded states", () => {
  assert.equal(nextPaymentState("paid", "paid"), "paid");
  for (const status of ["pending", "failed", "cancelled"]) assert.equal(nextPaymentState("paid", status), "paid");
  assert.equal(nextPaymentState("failed", "paid"), "paid");
  assert.equal(nextPaymentState("paid", "refunded"), "refunded");
  assert.equal(nextPaymentState("refunded", "paid"), "refunded");
});

test("fulfillment requires verified payment, sequence and no unresolved buyer request", () => {
  for (const status of ["unpaid", "initiating", "pending", "failed", "cancelled", "refunded"]) assert.equal(canFulfill(status, "unfulfilled", "sourcing", false), false);
  assert.equal(canFulfill("paid", "unfulfilled", "sourcing", false), true);
  assert.equal(canFulfill("paid", "sourcing", "dispatched", false), true);
  assert.equal(canFulfill("paid", "dispatched", "delivered", false), true);
  assert.equal(canFulfill("paid", "unfulfilled", "delivered", false), false);
  assert.equal(canFulfill("paid", "unfulfilled", "sourcing", true), false);
});

test("sandbox adapter uses encrypted requests, fixed URLs and no automatic retries", async () => {
  let calls = 0;
  const transport = async (url, options) => {
    calls++;
    assert.match(url, /^https:\/\/api\.test\.sandbox\.pesepay\.com\/payments-engine\/v1\/payments\//);
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.authorization, "test-integration");
    if (options.method === "POST") {
      const plain = decryptPayload(JSON.parse(options.body).payload, key);
      assert.deepEqual(plain.amountDetails, { amount: 12.5, currencyCode: "USD" });
      assert.equal(plain.merchantReference, "attempt-1");
      return Response.json({ payload: encryptPayload({ referenceNumber: expected.reference, redirectUrl: "https://test.sandbox.pesepay.com/checkout/test", pollUrl: "http://127.0.0.1/evil" }, key) });
    }
    assert.match(url, /referenceNumber=test-reference$/);
    return Response.json({ payload: encryptPayload(transaction(), key) });
  };
  const provider = pesepaySandbox({ integrationKey: "test-integration", encryptionKey: key }, transport);
  assert.equal((await provider.initiate({ attemptId: "attempt-1", amountMinor: 1250, currency: "USD", returnUrl: "https://example.test/order", resultUrl: "https://example.test/result" })).reference, expected.reference);
  assert.equal(await provider.check(expected), "paid");
  assert.equal(calls, 2);
  let failedCalls = 0;
  const failing = pesepaySandbox({ integrationKey: "test", encryptionKey: key }, async () => { failedCalls++; throw new Error("network interrupted"); });
  await assert.rejects(() => failing.initiate({ attemptId: "attempt-2", amountMinor: 1250, currency: "USD", returnUrl: "https://example.test/order", resultUrl: "https://example.test/result" }));
  assert.equal(failedCalls, 1);
});

test("redirects reject SSRF/open redirect targets and credentials", () => {
  for (const url of ["javascript:alert(1)", "http://pesepay.com", "https://pesepay.com.evil.test", "https://127.0.0.1/", "https://user:secret@pesepay.com", "https://pesepay.com:444/"]) assert.throws(() => safePaymentRedirect(url));
});

test("commerce proposal has explicit ACL, RLS and locked idempotent payment boundaries", () => {
  const sql = readFileSync(new URL("../supabase/proposals/20261030120000_mvp_commerce.sql", import.meta.url), "utf8");
  assert.match(sql, /order_id uuid not null unique/);
  assert.match(sql, /provider_reference text unique/);
  assert.match(sql, /mode='sandbox'/);
  assert.match(sql, /p_amount is distinct from a.amount_minor/);
  assert.match(sql, /for update/g);
  assert.match(sql, /private.is_order_super_admin\(\)/);
  assert.match(sql, /s.user_id=auth.uid\(\) and s.status='active'/);
  assert.match(sql, /from public,anon,authenticated,service_role/);
  assert.doesNotMatch(sql, /grant (?:all|insert|update|delete).*to (?:anon|authenticated)/i);
});

test("public marketplace no longer includes legacy unreviewed listings", () => {
  const source = readFileSync(new URL("../src/lib/marketplace/products.ts", import.meta.url), "utf8");
  assert.equal(source.match(/\.eq\("review_state", "approved"\)/g)?.length, 2);
  assert.doesNotMatch(source, /\.in\("review_state"/);
});
