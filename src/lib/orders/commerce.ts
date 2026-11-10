export interface ShippingRate {
  id: string; label: string; method: "standard" | "express";
  country: string; region: string; city: string; currency: string; amount_minor: number;
}

export function shippingQuote(rate: ShippingRate, destination: { country: string; region: string; city: string }, subtotal: number, currency: string) {
  if (rate.country !== destination.country.toUpperCase() ||
      (rate.region && rate.region.toLowerCase() !== destination.region.trim().toLowerCase()) ||
      (rate.city && rate.city.toLowerCase() !== destination.city.trim().toLowerCase()) || rate.currency !== currency)
    throw new Error("Delivery is not configured for this destination and currency.");
  if (!Number.isSafeInteger(subtotal) || subtotal < 0 || !Number.isSafeInteger(rate.amount_minor) || rate.amount_minor < 0 ||
      !Number.isSafeInteger(subtotal + rate.amount_minor)) throw new Error("Invalid order amount.");
  return { subtotal, shipping: rate.amount_minor, total: subtotal + rate.amount_minor, currency };
}

export type PaymentStatus = "unpaid" | "initiating" | "pending" | "paid" | "failed" | "cancelled" | "refunded";
export type FulfillmentStatus = "unfulfilled" | "sourcing" | "dispatched" | "delivered";
export interface Commerce {
  order_id: string; shipping_minor: number; total_minor: number; currency: string;
  payment_status: PaymentStatus; fulfillment_status: FulfillmentStatus; mode: "sandbox";
  tracking_reference: string | null; cancel_requested: boolean; refund_requested: boolean;
}

export function nextPaymentState(current: PaymentStatus, incoming: PaymentStatus): PaymentStatus {
  if (current === incoming) return current;
  if (current === "refunded") return current;
  if (current === "paid") return incoming === "refunded" ? incoming : current;
  // A delayed verified success may follow an earlier pending/failed observation.
  if (incoming === "paid" || incoming === "refunded") return incoming;
  if (current === "failed" || current === "cancelled") return current;
  return incoming;
}

export function canFulfill(payment: PaymentStatus, current: FulfillmentStatus, next: FulfillmentStatus, requestOpen: boolean) {
  return payment === "paid" && !requestOpen &&
    ((current === "unfulfilled" && next === "sourcing") || (current === "sourcing" && next === "dispatched") ||
     (current === "dispatched" && next === "delivered"));
}
