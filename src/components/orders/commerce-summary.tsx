import type { Commerce } from "@/lib/orders/commerce";
import { money } from "@/lib/orders/checkout";

export function CommerceSummary({ value }: { value: Commerce }) {
  return <div className="space-y-2 rounded-lg border p-4">
    <p className="font-semibold">Sandbox order — no real-money payment or delivery</p>
    <p>Shipping: {money(value.shipping_minor, value.currency)}</p>
    <p>Total including shipping: {money(value.total_minor, value.currency)} {value.currency}</p>
    <p>Payment: {value.payment_status} · Fulfillment: {value.fulfillment_status}</p>
    {value.tracking_reference && <p>Dispatch / tracking reference: {value.tracking_reference}</p>}
    {value.cancel_requested && <p>Cancellation requested — awaiting manual review.</p>}
    {value.refund_requested && <p>Refund requested — awaiting manual review.</p>}
  </div>;
}
