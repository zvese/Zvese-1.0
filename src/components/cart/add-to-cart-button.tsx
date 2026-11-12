"use client";

import * as React from "react";
import { CheckIcon, ShoppingCartIcon } from "lucide-react";

import { useCartActions } from "@/components/cart/cart-provider";
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
  const { addItem, ready } = useCartActions();
  const [added, setAdded] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  React.useEffect(() => () => clearTimeout(timer.current), []);

  function add() {
    if (disabled || !ready) return;
    addItem(item);
    setAdded(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setAdded(false), 1400);
  }

  return (
    <Button type="button" variant="outline" disabled={disabled || !ready} onClick={add} className={className}>
      {added ? <CheckIcon className="size-4" aria-hidden="true" /> : <ShoppingCartIcon className="size-4" aria-hidden="true" />}
      {added ? "Added" : "Add to cart"}
    </Button>
  );
}
