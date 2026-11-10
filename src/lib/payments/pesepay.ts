import { createCipheriv, createDecipheriv, timingSafeEqual } from "node:crypto";
import type { PaymentStatus } from "../orders/commerce.ts";

// Sandbox only. Live processing requires a separately reviewed activation change.
// Protocol: https://developers.pesepay.com/api/introduction/
const BASE = "https://api.test.sandbox.pesepay.com/payments-engine/v1";
type Credentials = { integrationKey: string; encryptionKey: string };
type Json = Record<string, unknown>;
export type ExpectedPayment = { reference: string; amountMinor: number; currency: string };

function keyBytes(key: string) {
  const bytes = Buffer.from(key, "utf8");
  if (bytes.length !== 32 || key.length !== 32) throw new Error("Payment encryption configuration invalid.");
  return bytes;
}
export function encryptPayload(value: unknown, key: string) {
  const bytes = keyBytes(key);
  const cipher = createCipheriv("aes-256-cbc", bytes, bytes.subarray(0, 16));
  return Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]).toString("base64");
}
export function decryptPayload(payload: unknown, key: string): Json {
  if (typeof payload !== "string" || payload.length > 65536 || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) throw new Error("Invalid payment response.");
  const bytes = keyBytes(key);
  const decipher = createDecipheriv("aes-256-cbc", bytes, bytes.subarray(0, 16));
  const value = JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload, "base64")), decipher.final()]).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid payment response.");
  return value;
}
export function authenticCallback(actual: string | null, expected: string) {
  if (!actual || !expected) return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function validReference(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
}
export function decimalMinor(value: unknown) {
  if (typeof value !== "number" && typeof value !== "string") throw new Error("Invalid payment amount.");
  const text = String(value);
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(text)) throw new Error("Invalid payment amount.");
  const [whole, fraction = ""] = text.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor)) throw new Error("Invalid payment amount.");
  return minor;
}
export function reconcilePesepay(value: Json, expected: ExpectedPayment): PaymentStatus {
  const amounts = value.amountDetails as Json | undefined;
  if (value.referenceNumber !== expected.reference || !amounts || amounts.currencyCode !== expected.currency ||
      decimalMinor(amounts.amount) !== expected.amountMinor) throw new Error("Payment reconciliation mismatch.");
  switch (value.transactionStatus) {
    case "SUCCESS": return "paid";
    case "FAILED": return "failed";
    case "CANCELLED": return "cancelled";
    case "REVERSED": return "refunded";
    case "PENDING": case "PROCESSING": case "PARTIALLY_PAID": case "CREATED": return "pending";
    default: throw new Error("Unrecognized payment status; manual review required.");
  }
}
export function safePaymentRedirect(value: unknown) {
  if (typeof value !== "string") throw new Error("Invalid checkout redirect.");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !(url.hostname === "pesepay.com" || url.hostname.endsWith(".pesepay.com"))) throw new Error("Invalid checkout redirect.");
  return url.href;
}

export function pesepaySandbox(credentials: Credentials, transport: typeof fetch = fetch) {
  keyBytes(credentials.encryptionKey);
  if (!credentials.integrationKey) throw new Error("Payment configuration missing.");
  async function request(path: string, body?: Json) {
    const response = await transport(`${BASE}${path}`, {
      method: body ? "POST" : "GET", redirect: "error", cache: "no-store",
      signal: AbortSignal.timeout(15000),
      headers: { authorization: credentials.integrationKey, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify({ payload: encryptPayload(body, credentials.encryptionKey) }) } : {}),
    });
    if (!response.ok) throw new Error("Payment provider request failed; do not retry initiation.");
    const envelope = await response.json();
    return decryptPayload(envelope.payload, credentials.encryptionKey);
  }
  return {
    async initiate(input: { attemptId: string; amountMinor: number; currency: string; returnUrl: string; resultUrl: string }) {
      if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 || input.amountMinor > 999999999999 ||
          !["USD", "ZWG"].includes(input.currency)) throw new Error("Unsupported payment amount or currency.");
      const value = await request("/payments/initiate", {
        amountDetails: { amount: input.amountMinor / 100, currencyCode: input.currency },
        reasonForPayment: `Zvese order ${input.attemptId}`, merchantReference: input.attemptId,
        returnUrl: input.returnUrl, resultUrl: input.resultUrl,
      });
      if (!validReference(value.referenceNumber)) throw new Error("Invalid payment reference; manual reconciliation required.");
      return { reference: value.referenceNumber, redirectUrl: safePaymentRedirect(value.redirectUrl) };
    },
    async check(expected: ExpectedPayment) {
      if (!validReference(expected.reference)) throw new Error("Invalid payment reference.");
      // Never follow a caller-supplied pollUrl (SSRF); rebuild the documented URL.
      return reconcilePesepay(await request(`/payments/check-payment?referenceNumber=${encodeURIComponent(expected.reference)}`), expected);
    },
  };
}
