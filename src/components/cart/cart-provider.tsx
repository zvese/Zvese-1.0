"use client";

import * as React from "react";

import {
  addCartItem,
  CART_STORAGE_KEY,
  cartItemCount,
  parseStoredCart,
  setCartQuantity,
  type CartItem,
} from "@/lib/cart";

interface CartContextValue {
  items: CartItem[];
  itemCount: number;
  ready: boolean;
  addItem: (item: Omit<CartItem, "quantity">) => void;
  removeItem: (listingId: string) => void;
  updateQuantity: (listingId: string, quantity: number) => void;
}

const CartContext = React.createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<CartItem[]>([]);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    try {
      setItems(parseStoredCart(window.localStorage.getItem(CART_STORAGE_KEY)));
    } catch {
      setItems([]);
    }
    setReady(true);

    function syncCart(event: StorageEvent) {
      if (event.key === CART_STORAGE_KEY) setItems(parseStoredCart(event.newValue));
    }
    window.addEventListener("storage", syncCart);
    return () => window.removeEventListener("storage", syncCart);
  }, []);

  React.useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
    } catch {
      // The cart remains usable in memory when browser storage is unavailable.
    }
  }, [items, ready]);

  const value = React.useMemo<CartContextValue>(() => ({
    items,
    itemCount: cartItemCount(items),
    ready,
    addItem: (item) => setItems((current) => addCartItem(current, item)),
    removeItem: (listingId) =>
      setItems((current) => current.filter((item) => item.listingId !== listingId)),
    updateQuantity: (listingId, quantity) =>
      setItems((current) => setCartQuantity(current, listingId, quantity)),
  }), [items, ready]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = React.useContext(CartContext);
  if (!context) throw new Error("useCart must be used inside CartProvider.");
  return context;
}
