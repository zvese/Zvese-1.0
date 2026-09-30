import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { isUuid } from "@/lib/admin/seller-review-data";
import { requireBuyer } from "@/lib/orders/server";
import { deliveryFields, money } from "@/lib/orders/checkout";
import { placeOrder } from "./actions";

export const metadata = { title: "Checkout | Zvese" };
export default async function CheckoutPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }>;
}) {
  const { client, user } = await requireBuyer();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { data, error } = await client.rpc("get_checkout_listing", { p_listing_id: id });
  if (error) throw new Error("Could not load checkout. Please try again later.");
  const listing = data?.[0];
  if (!listing) return <section className="mx-auto max-w-xl space-y-5 px-4 py-16">
    <h1 className="text-2xl font-bold">Product is not available to order</h1>
    <p>The listing must have a current approval and confirmed source availability.</p>
    <Link className="underline" href="/marketplace">Back to marketplace</Link>
  </section>;
  const context = { listingId: id, revision: listing.revision as number, checkoutId: randomUUID(), buyerId: user.id };
  async function submit(form: FormData) { "use server"; await placeOrder(context, form); }
  const message = (await searchParams).error;
  return <section className="mx-auto max-w-2xl space-y-6 px-4 py-12">
    <h1 className="text-3xl font-bold">Checkout</h1>
    {message && <p role="alert" className="text-destructive">{message} <Link className="underline" href="/account/orders">View orders</Link></p>}
    <div className="rounded-xl border p-5 space-y-2">
      <h2 className="text-xl font-semibold">{listing.product_name}</h2><p>Seller: {listing.seller_name}</p>
      <p>Quantity: 1 · Unit price: {money(listing.unit_price, listing.currency)} {listing.currency}</p>
      <p className="font-semibold">Subtotal: {money(listing.unit_price, listing.currency)} {listing.currency}</p>
      <p className="text-sm">This creates a pending order. No payment is collected. Delivery preference is recorded; no delivery charge or delivery date is quoted.</p>
    </div>
    <form action={submit} className="space-y-5">
      {deliveryFields.map(field => <label key={field.name} className="block text-sm font-medium">{field.label}
        <input name={field.name} type={field.name === "phone" ? "tel" : "text"} autoComplete={field.autoComplete}
          required={field.min > 0} minLength={field.min || undefined} maxLength={field.max}
          className="mt-2 w-full rounded-md border bg-background p-3" />
      </label>)}
      <label className="block text-sm font-medium">Delivery method
        <select name="delivery_method" defaultValue="standard" required className="mt-2 w-full rounded-md border bg-background p-3">
          <option value="standard">Standard</option><option value="express">Express</option>
        </select>
      </label>
      <Button type="submit">Place pending order</Button>
    </form>
  </section>;
}
