import Link from "next/link";
import { requireBuyer, ORDER_SELECT, type Order } from "@/lib/orders/server";
import { orderPage } from "@/lib/orders/checkout";
import { OrderSummary, OrderPagination } from "@/components/orders/order-summary";
import { getOrderCommerce } from "@/lib/orders/commerce-server";
import { CommerceSummary } from "@/components/orders/commerce-summary";

export const metadata = { title: "Your orders | Zvese" };
export default async function BuyerOrders({ searchParams }: { searchParams: Promise<{ page?: string; error?: string }> }) {
  const { client, user } = await requireBuyer("/account/orders");
  const params = await searchParams;
  const page = orderPage(params.page);
  const { data, error } = await client.from("orders").select(ORDER_SELECT).eq("buyer_user_id", user.id)
    .order("created_at", { ascending: false }).order("id").range((page - 1) * 50, page * 50 - 1);
  if (error) throw new Error("Could not load your orders.");
  const orders = (data ?? []) as Order[];
  const commerce = new Map();
  for (const order of orders) commerce.set(order.id, await getOrderCommerce(client, order.id));
  return <section className="mx-auto max-w-3xl space-y-6 px-4 py-12">
    <h1 className="text-3xl font-bold">Your orders</h1>
    {params.error && <p role="alert">{params.error}</p>}
    <Link className="underline" href="/marketplace">Browse marketplace</Link>
    {!orders.length && <p>No orders on this page.</p>}
    {orders.map(order => <div key={order.id} className="space-y-2"><OrderSummary order={order} />{commerce.get(order.id) && <CommerceSummary value={commerce.get(order.id)} />}</div>)}
    <OrderPagination page={page} hasNext={orders.length === 50} path="/account/orders" />
  </section>;
}
