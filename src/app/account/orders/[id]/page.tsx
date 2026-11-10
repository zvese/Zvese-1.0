import Link from "next/link";
import { notFound } from "next/navigation";
import { isUuid } from "@/lib/admin/seller-review-data";
import { requireBuyer, ORDER_SELECT, type Order } from "@/lib/orders/server";
import { OrderSummary } from "@/components/orders/order-summary";
import { getOrderCommerce } from "@/lib/orders/commerce-server";
import { CommerceSummary } from "@/components/orders/commerce-summary";
import { startPayment, refreshPayment, requestResolution } from "./actions";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Order confirmation | Zvese" };
export default async function OrderConfirmation({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ message?: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { client } = await requireBuyer(`/account/orders/${id}`);
  // Orders RLS admits only the buyer or an active super admin, never a seller solely because of a sale.
  const { data, error } = await client.from("orders").select(ORDER_SELECT).eq("id", id).maybeSingle();
  if (error) throw new Error("Could not load this order.");
  if (!data) notFound();
  const commerce = await getOrderCommerce(client, id);
  const message = (await searchParams).message;
  return <section className="mx-auto max-w-3xl space-y-6 px-4 py-12">
    <h1 className="text-3xl font-bold">Order received</h1>
    {message && <p role="status">{message}</p>}
    <p>{commerce?.payment_status === "paid" ? "Sandbox payment confirmed by the provider. This is a test order, not a real purchase." : "This page does not confirm payment. Check the payment status below before taking further action."}</p>
    <OrderSummary order={data as Order} destination />
    {commerce ? <>
      <CommerceSummary value={commerce} />
      {!commerce.cancel_requested && ["unpaid", "pending"].includes(commerce.payment_status) && <form action={startPayment}><input type="hidden" name="order_id" value={id} /><Button>Continue to Pesepay sandbox</Button></form>}
      {commerce.payment_status !== "unpaid" && <form action={refreshPayment}><input type="hidden" name="order_id" value={id} /><Button variant="outline">Check payment with provider</Button></form>}
      <form action={requestResolution} className="flex flex-wrap gap-3">
        <input type="hidden" name="order_id" value={id} />
        {!commerce.cancel_requested && ["unfulfilled", "sourcing"].includes(commerce.fulfillment_status) && <Button variant="outline" name="kind" value="cancel">Request cancellation</Button>}
        {!commerce.refund_requested && commerce.payment_status === "paid" && <Button variant="outline" name="kind" value="refund">Request refund review</Button>}
      </form>
    </> : <p>No payment has been collected for this pending order. Payment and shipping charges are not configured for it.</p>}
    <Link className="underline" href="/account/orders">Your order history</Link>
  </section>;
}
