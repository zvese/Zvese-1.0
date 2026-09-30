import { requireBuyer, requireOrderAdmin, ORDER_SELECT, type Order } from "@/lib/orders/server";
import { orderPage } from "@/lib/orders/checkout";
import { OrderSummary, OrderPagination } from "@/components/orders/order-summary";

export const metadata = { title: "Orders | Admin" };
export default async function AdminOrders({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireOrderAdmin();
  const { client } = await requireBuyer();
  const page = orderPage((await searchParams).page);
  const { data, error } = await client.from("orders").select(ORDER_SELECT)
    .order("created_at", { ascending: false }).order("id").range((page - 1) * 50, page * 50 - 1);
  if (error) throw new Error("Could not load orders.");
  const orders = (data ?? []) as Order[];
  return <section className="mx-auto max-w-4xl space-y-6 px-4 py-12">
    <h1 className="text-3xl font-bold">All orders</h1>
    {!orders.length && <p>No orders on this page.</p>}
    {orders.map(order => <OrderSummary key={order.id} order={order} admin />)}
    <OrderPagination page={page} hasNext={orders.length === 50} path="/admin/orders" />
  </section>;
}
