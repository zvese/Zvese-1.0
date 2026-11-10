import { requireBuyer, requireOrderAdmin, ORDER_SELECT, type Order } from "@/lib/orders/server";
import { orderPage } from "@/lib/orders/checkout";
import { OrderSummary, OrderPagination } from "@/components/orders/order-summary";
import { getOrderCommerce } from "@/lib/orders/commerce-server";
import { CommerceSummary } from "@/components/orders/commerce-summary";
import { advanceFulfillment } from "./actions";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Orders | Admin" };
export default async function AdminOrders({ searchParams }: { searchParams: Promise<{ page?: string; message?: string }> }) {
  await requireOrderAdmin("/admin/orders");
  const { client } = await requireBuyer("/admin/orders");
  const page = orderPage((await searchParams).page);
  const { data, error } = await client.from("orders").select(ORDER_SELECT)
    .order("created_at", { ascending: false }).order("id").range((page - 1) * 50, page * 50 - 1);
  if (error) throw new Error("Could not load orders.");
  const orders = (data ?? []) as Order[];
  const commerce = new Map();
  for (const order of orders) commerce.set(order.id, await getOrderCommerce(client, order.id));
  return <section className="mx-auto max-w-4xl space-y-6 px-4 py-12">
    <h1 className="text-3xl font-bold">All orders</h1>
    <p>Manual supplier routing. Verify availability with the supplier before dispatch. Sandbox orders must never trigger a real shipment.</p>
    {(await searchParams).message && <p role="status">{(await searchParams).message}</p>}
    {!orders.length && <p>No orders on this page.</p>}
    {orders.map(order => {
      const value = commerce.get(order.id);
      const next = value?.fulfillment_status === "unfulfilled" ? "sourcing" : value?.fulfillment_status === "sourcing" ? "dispatched" : value?.fulfillment_status === "dispatched" ? "delivered" : null;
      return <div key={order.id} className="space-y-3">
        <OrderSummary order={order} admin destination />
        {value && <CommerceSummary value={value} />}
        {value?.payment_status === "paid" && !value.cancel_requested && !value.refund_requested && next && <form action={advanceFulfillment} className="space-y-2">
          <input type="hidden" name="order_id" value={order.id} /><input type="hidden" name="expected" value={value.fulfillment_status} /><input type="hidden" name="next" value={next} />
          {next === "dispatched" && <label className="block">Dispatch / tracking reference <input name="tracking" required maxLength={200} className="rounded border p-2" /></label>}
          <Button variant="outline">Sandbox: mark {next}</Button>
        </form>}
      </div>;
    })}
    <OrderPagination page={page} hasNext={orders.length === 50} path="/admin/orders" />
  </section>;
}
