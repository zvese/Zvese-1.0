import Link from "next/link";
import type { Delivery, Order } from "@/lib/orders/server";
import { money } from "@/lib/orders/checkout";

export function DeliverySummary({ delivery }: { delivery: Delivery }) {
  return <address className="mt-3 not-italic text-sm">
    <p>{delivery.recipient_name} · {delivery.phone}</p>
    <p>{delivery.address_line1}</p>{delivery.address_line2 && <p>{delivery.address_line2}</p>}
    <p>{delivery.city}, {delivery.region} {delivery.postal_code}</p><p>{delivery.country}</p>
  </address>;
}

export function OrderSummary({ order, admin = false, destination = false }: { order: Order; admin?: boolean; destination?: boolean }) {
  return <article className="space-y-3 rounded-xl border p-5">
    <Link className="break-all font-semibold underline" href={`/account/orders/${order.id}`}>Order {order.id}</Link>
    <p className="text-sm">{new Date(order.created_at).toLocaleString("en")} · {order.status} · {order.delivery_method}</p>
    {admin && <p className="break-all text-sm">Buyer ID: {order.buyer_user_id}</p>}
    <ul>{order.order_items.map(item => <li key={item.id} className="py-2">
      <p>{item.product_name} · {item.seller_name}</p>
      <p className="text-sm">{item.quantity} × {money(item.unit_price, item.currency)} = {money(item.line_total, item.currency)}</p>
    </li>)}</ul>
    <p className="font-semibold">Total: {money(order.subtotal, order.currency)} {order.currency}</p>
    {destination && <DeliverySummary delivery={order} />}
  </article>;
}

export function OrderPagination({ page, hasNext, path }: { page: number; hasNext: boolean; path: string }) {
  return <nav aria-label="Order pages" className="flex gap-5 py-6">
    {page > 1 && <Link className="underline" href={`${path}?page=${page - 1}`}>Previous</Link>}
    {hasNext && <Link className="underline" href={`${path}?page=${page + 1}`}>Next</Link>}
  </nav>;
}
