import type { Metadata } from "next";

import { CartPage } from "@/components/cart/cart-page";

export const metadata: Metadata = {
  title: "Shopping Cart",
  description: "Review products staged for secure checkout on Zvese.",
};

export default function ShoppingCartPage() {
  return <CartPage />;
}
