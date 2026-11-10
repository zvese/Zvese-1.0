"use client";

import * as React from "react";
import { CheckIcon, ShoppingCartIcon } from "lucide-react";

import { useCart } from "@/components/cart/cart-provider";
import { Button } from "@/components/ui/button";
import type { CartItem } from "@/lib/cart";

export function AddToCartButton({
  item,
  disabled = false,
  className,
}: {
  item: Omit<CartItem, "quantity">;
  disabled?: boolean;
  className?: string;
}) {
  const { addItem } = useCart();
  const [added, setAdded] = React.useState(false);

  function add() {
    addItem(item);
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1400);
  }

  return (
    <Button type="button" variant="outline" disabled={disabled} onClick={add} className={className}>
      {added ? <CheckIcon className="size-4" aria-hidden="true" /> : <ShoppingCartIcon className="size-4" aria-hidden="true" />}
      {added ? "Added" : "Add to cart"}
    </Button>
  );
}
