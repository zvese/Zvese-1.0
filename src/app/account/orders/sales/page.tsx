import { redirect } from "next/navigation";
import { requireBuyer, type Sale } from "@/lib/orders/server";
import { money, orderPage } from "@/lib/orders/checkout";
import { DeliverySummary, OrderPagination } from "@/components/orders/order-summary";

export const metadata = { title: "Your sales | Zvese" };
export default async function SellerSales({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { client, user } = await requireBuyer();
  const { data: seller, error: sellerError } = await client.from("seller_profiles").select("id,status").eq("user_id", user.id).maybeSingle();
  if (sellerError || seller?.status !== "active") redirect("/account?error=Active%20seller%20access%20required.");
  const page = orderPage((await searchParams).page);
  const { data, error } = await client.rpc("get_my_sales", { p_offset: (page - 1) * 50 });
  if (error) throw new Error("Could not load your sales.");
  const sales = (data ?? []) as Sale[];
  return <section className="mx-auto max-w-3xl space-y-6 px-4 py-12">
    <h1 className="text-3xl font-bold">Your sales</h1>
    <p>Pending orders for your products. No payments have been collected.</p>
    {!sales.length && <p>No sales on this page.</p>}
    {sales.map((sale, index) => <article key={`${sale.order_id}-${index}`} className="rounded-xl border p-5 space-y-2">
      <h2 className="break-all font-semibold">Order {sale.order_id}</h2>
      <p>{sale.product_name} · Quantity: {sale.quantity}</p><p>{money(sale.line_total, sale.currency)} {sale.currency}</p>
      <p>{sale.status} · {sale.delivery_method} · {new Date(sale.created_at).toLocaleString("en")}</p>
      <DeliverySummary delivery={sale} />
    </article>)}
    <OrderPagination page={page} hasNext={sales.length === 50} path="/account/orders/sales" />
  </section>;
}
