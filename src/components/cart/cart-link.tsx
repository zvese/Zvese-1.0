"use client";

import Link from "next/link";
import { ShoppingCartIcon } from "lucide-react";

import { useCart } from "@/components/cart/cart-provider";
import { cn } from "@/lib/utils";

export function CartLink({ className }: { className?: string }) {
  const { itemCount, ready } = useCart();
  const count = ready ? itemCount : 0;

  return (
    <Link
      href="/cart"
      className={cn("relative inline-flex items-center gap-2 font-medium", className)}
      aria-label={`Cart with ${count} item${count === 1 ? "" : "s"}`}
    >
      <ShoppingCartIcon className="size-4" aria-hidden="true" />
      <span>Cart</span>
      {count > 0 ? (
        <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-xs font-semibold text-primary-foreground">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  );
}
