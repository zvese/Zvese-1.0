import "server-only";
import { createProductSystemClient } from "@/lib/supabase/product-system";
import { pesepaySandbox } from "./pesepay";

export function paymentConfiguration() {
  if (process.env.ZVESE_COMMERCE_ENABLED !== "true" || process.env.ZVESE_PAYMENT_MODE !== "sandbox")
    throw new Error("Sandbox payments are not enabled.");
  const integrationKey = process.env.PESEPAY_INTEGRATION_KEY ?? "";
  const encryptionKey = process.env.PESEPAY_ENCRYPTION_KEY ?? "";
  const origin = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "");
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash)
    throw new Error("A verified HTTPS callback origin is required.");
  return { integrationKey, encryptionKey, origin: origin.origin, provider: pesepaySandbox({ integrationKey, encryptionKey }) };
}

// A browser return never supplies a payment result. Both reconciliation entry points
// use the saved reference, trusted amount and currency, and query Pesepay themselves.
export async function verifySavedPayment(filter: { orderId: string } | { reference: string }) {
  const { provider } = paymentConfiguration();
  const client = createProductSystemClient();
  let query = client.from("payment_attempts").select("id,provider_reference,amount_minor,currency,mode");
  query = "orderId" in filter ? query.eq("order_id", filter.orderId) : query.eq("provider_reference", filter.reference);
  const { data: attempt, error } = await query.maybeSingle();
  if (error || !attempt || !attempt.provider_reference || attempt.mode !== "sandbox") throw new Error("Payment reconciliation unavailable.");
  const { data: claimed, error: claimError } = await client.rpc("claim_payment_check", { p_attempt_id: attempt.id });
  if (claimError) throw new Error("Payment reconciliation unavailable.");
  if (!claimed) return false;
  const status = await provider.check({ reference: attempt.provider_reference, amountMinor: Number(attempt.amount_minor), currency: attempt.currency });
  const { error: applyError } = await client.rpc("apply_verified_payment", {
    p_attempt_id: attempt.id, p_reference: attempt.provider_reference,
    p_amount: attempt.amount_minor, p_currency: attempt.currency, p_status: status,
  });
  if (applyError) throw new Error("Verified payment could not be recorded; reconciliation required.");
  return true;
}
