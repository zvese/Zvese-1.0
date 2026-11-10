"use client";

import Link from "next/link";
import { MinusIcon, PlusIcon, Trash2Icon } from "lucide-react";

import { useCart } from "@/components/cart/cart-provider";
import { BackButton } from "@/components/navigation/back-button";
import { Button } from "@/components/ui/button";
import { cartTotals, MAX_CART_QUANTITY } from "@/lib/cart";
import { money } from "@/lib/orders/checkout";

export function CartPage() {
  const { items, ready, removeItem, updateQuantity } = useCart();

  if (!ready) {
    return <p className="mx-auto max-w-5xl px-4 py-16 text-muted-foreground">Loading cart…</p>;
  }

  if (items.length === 0) {
    return (
      <section className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
        <h1 className="text-3xl font-bold tracking-tight">Your cart is empty</h1>
        <p className="mt-3 text-muted-foreground">Browse the marketplace to find products from Zvese sellers.</p>
        <Button asChild className="mt-8"><Link href="/marketplace">Continue shopping</Link></Button>
      </section>
    );
  }

  const totals = cartTotals(items);

  return (
    <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
      <BackButton />
      <h1 className="mt-6 text-3xl font-bold tracking-tight sm:text-4xl">Shopping cart</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Prices and availability are rechecked securely at checkout. Zvese currently checks out one unit from one seller listing at a time.
      </p>

      <div className="mt-8 space-y-4">
        {items.map((item) => (
          <article key={item.listingId} className="grid gap-5 rounded-xl border bg-card p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="min-w-0">
              <Link href={`/marketplace/${item.productSlug}`} className="text-lg font-semibold hover:text-primary hover:underline">
                {item.title}
              </Link>
              <p className="mt-1 text-sm text-muted-foreground">Sold by {item.sellerName}</p>
              <p className="mt-3 text-sm">Unit price: <span className="font-medium">{money(item.unitPriceMinor, item.currency)}</span></p>
              <p className="mt-1 font-semibold">Line total: {money(item.unitPriceMinor * item.quantity, item.currency)}</p>
            </div>

            <div className="flex flex-wrap items-center gap-3 sm:justify-end">
              <div className="inline-flex items-center rounded-md border" aria-label={`Quantity for ${item.title}`}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={item.quantity <= 1}
                  onClick={() => updateQuantity(item.listingId, item.quantity - 1)}
                  aria-label={`Decrease ${item.title} quantity`}
                >
                  <MinusIcon className="size-4" />
                </Button>
                <span className="min-w-10 text-center text-sm font-semibold tabular-nums" aria-live="polite">{item.quantity}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={item.quantity >= MAX_CART_QUANTITY}
                  onClick={() => updateQuantity(item.listingId, item.quantity + 1)}
                  aria-label={`Increase ${item.title} quantity`}
                >
                  <PlusIcon className="size-4" />
                </Button>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => removeItem(item.listingId)}>
                <Trash2Icon className="size-4" /> Remove
              </Button>
              <Button asChild size="sm">
                <Link href={`/checkout/${item.listingId}`}>Checkout one unit</Link>
              </Button>
            </div>
          </article>
        ))}
      </div>

      <div className="mt-8 rounded-xl border bg-muted/30 p-6">
        <h2 className="text-lg font-semibold">Cart subtotal</h2>
        <div className="mt-3 space-y-1">
          {Object.entries(totals).map(([currency, total]) => (
            <p key={currency} className="text-2xl font-bold">{money(total, currency)}</p>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Cart quantities are planning estimates. The verified checkout creates one canonical unit per completed checkout and does not trust these stored prices or quantities.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button asChild variant="outline"><Link href="/marketplace">Continue shopping</Link></Button>
          <Button asChild><Link href={`/checkout/${items[0].listingId}`}>Checkout first item</Link></Button>
        </div>
      </div>
    </section>
  );
}
