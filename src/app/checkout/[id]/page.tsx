import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isUuid } from "@/lib/admin/seller-review-data";
import { requireBuyer } from "@/lib/orders/server";
import { money } from "@/lib/orders/checkout";
import { CheckoutForm } from "@/components/orders/checkout-form";
import { commerceEnabled } from "@/lib/orders/commerce-server";
import type { ShippingRate } from "@/lib/orders/commerce";
import { placeOrder } from "./actions";
import { BackButton } from "@/components/navigation/back-button";

export const metadata = { title: "Checkout | Zvese" };
export default async function CheckoutPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { client, user } = await requireBuyer(`/checkout/${id}`);
  const { data, error } = await client.rpc("get_checkout_listing", { p_listing_id: id });
  if (error) throw new Error("Could not load checkout. Please try again later.");
  const listing = data?.[0];
  if (!listing) return <section className="mx-auto max-w-xl space-y-5 px-4 py-16">
    <h1 className="text-2xl font-bold">Product is not available to order</h1>
    <p>The listing must have a current approval and confirmed source availability.</p>
    <Link className="underline" href="/marketplace">Back to marketplace</Link>
  </section>;
  const context = { listingId: id, revision: listing.revision as number, checkoutId: randomUUID(), buyerId: user.id };
  const sandbox = commerceEnabled();
  let rates: ShippingRate[] = [];
  if (sandbox) {
    const result = await client.from("shipping_rates").select("id,label,method,country,region,city,currency,amount_minor").eq("active", true).eq("currency", listing.currency);
    if (result.error) throw new Error("Shipping configuration is unavailable. Checkout is paused.");
    rates = (result.data ?? []).map(rate => ({ ...rate, amount_minor: Number(rate.amount_minor) })) as ShippingRate[];
  }
  async function submit(form: FormData) { "use server"; await placeOrder(context, form); }
  const message = (await searchParams).error;
  return <section className="mx-auto max-w-2xl space-y-6 px-4 py-12">
    <BackButton />
    <h1 className="text-3xl font-bold">Checkout</h1>
    {message && <p role="alert" className="text-destructive">{message} <Link className="underline" href="/account/orders">View orders</Link></p>}
    <div className="rounded-xl border p-5 space-y-2">
      <h2 className="text-xl font-semibold">{listing.product_name}</h2><p>Seller: {listing.seller_name}</p>
      <p>Quantity: 1 · Unit price: {money(listing.unit_price, listing.currency)} {listing.currency}</p>
      <p className="font-semibold">Subtotal: {money(listing.unit_price, listing.currency)} {listing.currency}</p>
      <p className="text-sm">{sandbox ? "Test checkout only. Review the configured shipping charge below. Payment is a separate step after the order is created." : "This creates a pending order. No payment is collected. Delivery preference is recorded; no delivery charge or delivery date is quoted."}</p>
    </div>
    <CheckoutForm action={submit} rates={rates} subtotal={Number(listing.unit_price)} currency={listing.currency} sandbox={sandbox} />
  </section>;
}
