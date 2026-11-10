"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireBuyer } from "@/lib/orders/server";
import { isUuid } from "@/lib/admin/seller-review-data";
import { createProductSystemClient } from "@/lib/supabase/product-system";
import { paymentConfiguration, verifySavedPayment } from "@/lib/payments/server";
import { safePaymentRedirect } from "@/lib/payments/pesepay";

async function ownedOrder(form: FormData) {
  const id = String(form.get("order_id") ?? "");
  if (!isUuid(id)) throw new Error("Invalid order.");
  const { client, user } = await requireBuyer(`/account/orders/${id}`);
  const { data, error } = await client.from("orders").select("id").eq("id", id).eq("buyer_user_id", user.id).maybeSingle();
  if (error || !data) throw new Error("Order unavailable.");
  return { id, client };
}
function message(id: string, text: string): never { redirect(`/account/orders/${id}?message=${encodeURIComponent(text)}`); }

export async function startPayment(form: FormData) {
  const { id, client } = await ownedOrder(form);
  let destination: string;
  try {
    const { origin, provider } = paymentConfiguration(); // Fail before reserving without usable configuration.
    const { data: attempt, error } = await client.rpc("reserve_order_payment", { p_order_id: id });
    if (error || !attempt) throw new Error("Payment unavailable.");
    if (!attempt.claimed) {
      if (attempt.status !== "pending" || !attempt.redirect_url) throw new Error("Payment attempt needs review.");
      destination = safePaymentRedirect(attempt.redirect_url);
    } else {
      // One provider initiation only. If response/storage fails, the reserved attempt
      // remains locked for manual reconciliation; never automatically create another.
      const result = await provider.initiate({ attemptId: attempt.id, amountMinor: Number(attempt.amount_minor), currency: attempt.currency,
        returnUrl: `${origin}/account/orders/${id}`, resultUrl: `${origin}/api/payments/pesepay` });
      const { error: bindError } = await createProductSystemClient().rpc("bind_payment_reference", {
        p_attempt_id: attempt.id, p_reference: result.reference, p_redirect: result.redirectUrl,
      });
      if (bindError) throw new Error("Payment binding failed.");
      destination = result.redirectUrl;
    }
  } catch {
    message(id, "Payment could not be opened. If an attempt began, do not pay again. Ask support to reconcile it using this order ID.");
  }
  redirect(destination);
}
export async function refreshPayment(form: FormData) {
  const { id } = await ownedOrder(form);
  let checked = false;
  try { checked = await verifySavedPayment({ orderId: id }); }
  catch { message(id, "Payment status is unconfirmed. No payment success has been assumed. Contact support if funds were taken."); }
  revalidatePath(`/account/orders/${id}`);
  message(id, checked ? "Payment status checked with the provider." : "A status check is already in progress. Wait before checking again.");
}
export async function requestResolution(form: FormData) {
  const { id, client } = await ownedOrder(form);
  const kind = String(form.get("kind"));
  if (kind !== "cancel" && kind !== "refund") throw new Error("Invalid request.");
  const { error } = await client.rpc("request_order_resolution", { p_order_id: id, p_kind: kind });
  if (error) message(id, "This request could not be recorded. Contact support with your order ID.");
  revalidatePath(`/account/orders/${id}`);
  message(id, "Request recorded for manual review. This does not itself cancel or refund a payment.");
}
