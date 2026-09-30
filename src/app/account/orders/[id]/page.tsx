import Link from "next/link";
import { notFound } from "next/navigation";
import { isUuid } from "@/lib/admin/seller-review-data";
import { requireBuyer, ORDER_SELECT, type Order } from "@/lib/orders/server";
import { OrderSummary } from "@/components/orders/order-summary";

export const metadata = { title: "Order confirmation | Zvese" };
export default async function OrderConfirmation({ params }: { params: Promise<{ id: string }> }) {
  const { client } = await requireBuyer();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  // Orders RLS admits only the buyer or an active super admin, never a seller solely because of a sale.
  const { data, error } = await client.from("orders").select(ORDER_SELECT).eq("id", id).maybeSingle();
  if (error) throw new Error("Could not load this order.");
  if (!data) notFound();
  return <section className="mx-auto max-w-3xl space-y-6 px-4 py-12">
    <h1 className="text-3xl font-bold">Order received</h1>
    <p>Your order is pending. No payment has been collected.</p>
    <OrderSummary order={data as Order} destination />
    <Link className="underline" href="/account/orders">Your order history</Link>
  </section>;
}
