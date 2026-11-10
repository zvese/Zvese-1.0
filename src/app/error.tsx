"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function PageError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <section className="mx-auto max-w-xl space-y-5 px-4 py-16">
    <h1 className="text-2xl font-bold">This page is temporarily unavailable</h1>
    <p role="alert">We could not load the current information. If you were placing an order or paying, check your order history before submitting again.</p>
    <div className="flex flex-wrap gap-4"><Button onClick={reset}>Reload page</Button><Link className="underline" href="/account/orders">Order history</Link><Link className="underline" href="/marketplace">Marketplace</Link></div>
  </section>;
}
