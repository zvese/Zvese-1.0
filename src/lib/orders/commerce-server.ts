import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Commerce } from "./commerce";

export function commerceEnabled() { return process.env.ZVESE_COMMERCE_ENABLED === "true"; }
export async function getOrderCommerce(client: SupabaseClient, orderId: string): Promise<Commerce | null> {
  if (!commerceEnabled()) return null;
  const { data, error } = await client.from("order_commerce").select("order_id,shipping_minor,total_minor,currency,payment_status,fulfillment_status,mode,tracking_reference,cancel_requested,refund_requested").eq("order_id", orderId).maybeSingle();
  if (error) throw new Error("Order payment details are currently unavailable. No payment success has been assumed.");
  return data as Commerce | null;
}
