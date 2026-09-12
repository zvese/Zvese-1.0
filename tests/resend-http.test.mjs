import assert from "node:assert/strict";
import test from "node:test";

import { sendEmailViaResend } from "../src/lib/email/resend-http.ts";

test("Resend delivery uses text content and a stable idempotency key", async () => {
  const calls = [];
  const fetchImplementation = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ id: "email-test-id" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await sendEmailViaResend(
    {
      apiKey: "test-api-key",
      from: "Zvese <test@example.invalid>",
      to: "creator@example.invalid",
      subject: "Safe seller decision",
      text: "Creator-safe content only.",
      idempotencyKey: "seller-decision-outbox-id",
    },
    fetchImplementation
  );

  assert.deepEqual(result, { ok: true, providerMessageId: "email-test-id" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal(calls[0].init.headers["Idempotency-Key"], "seller-decision-outbox-id");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    from: "Zvese <test@example.invalid>",
    to: ["creator@example.invalid"],
    subject: "Safe seller decision",
    text: "Creator-safe content only.",
  });
});

test("Resend provider failures return only a safe retryable error", async () => {
  const result = await sendEmailViaResend(
    {
      apiKey: "test-api-key",
      from: "Zvese <test@example.invalid>",
      to: "creator@example.invalid",
      subject: "Safe seller decision",
      text: "Creator-safe content only.",
      idempotencyKey: "seller-decision-outbox-id",
    },
    async () => new Response("provider-internal-detail", { status: 503 })
  );

  assert.deepEqual(result, {
    ok: false,
    safeError: "Resend request failed with HTTP 503.",
  });
  assert.equal(JSON.stringify(result).includes("provider-internal-detail"), false);
});
