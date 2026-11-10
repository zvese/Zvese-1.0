export const CART_STORAGE_KEY = "zvese:mvp-cart:v1";
export const MAX_CART_QUANTITY = 99;
const MAX_CART_ITEMS = 50;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CartItem {
  listingId: string;
  productSlug: string;
  title: string;
  sellerName: string;
  unitPriceMinor: number;
  currency: string;
  quantity: number;
}

function isCartItem(value: unknown): value is CartItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<CartItem>;
  return (
    typeof item.listingId === "string" && UUID_PATTERN.test(item.listingId) &&
    typeof item.productSlug === "string" && item.productSlug.length > 0 && item.productSlug.length <= 200 &&
    typeof item.title === "string" && item.title.length > 0 && item.title.length <= 500 &&
    typeof item.sellerName === "string" && item.sellerName.length > 0 && item.sellerName.length <= 500 &&
    typeof item.unitPriceMinor === "number" &&
    Number.isSafeInteger(item.unitPriceMinor) &&
    item.unitPriceMinor >= 0 &&
    item.unitPriceMinor <= 999999999999 &&
    typeof item.currency === "string" &&
    /^[A-Z]{3}$/.test(item.currency) &&
    typeof item.quantity === "number" &&
    Number.isSafeInteger(item.quantity) &&
    item.quantity >= 1 &&
    item.quantity <= MAX_CART_QUANTITY
  );
}

export function parseStoredCart(value: string | null): CartItem[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed.filter(isCartItem).filter(item => {
      if (seen.has(item.listingId)) return false;
      seen.add(item.listingId); return true;
    }).slice(0, MAX_CART_ITEMS);
  } catch {
    return [];
  }
}

export function addCartItem(items: CartItem[], item: Omit<CartItem, "quantity">) {
  if (!isCartItem({ ...item, quantity: 1 })) return items;
  const existing = items.find((candidate) => candidate.listingId === item.listingId);
  if (!existing) return items.length >= MAX_CART_ITEMS ? items : [...items, { ...item, quantity: 1 }];
  return items.map((candidate) =>
    candidate.listingId === item.listingId
      ? { ...candidate, quantity: Math.min(MAX_CART_QUANTITY, candidate.quantity + 1) }
      : candidate
  );
}

export function setCartQuantity(items: CartItem[], listingId: string, quantity: number) {
  if (!Number.isSafeInteger(quantity)) return items;
  if (quantity < 1) return items.filter((item) => item.listingId !== listingId);
  return items.map((item) =>
    item.listingId === listingId
      ? { ...item, quantity: Math.min(MAX_CART_QUANTITY, quantity) }
      : item
  );
}

export function cartItemCount(items: CartItem[]) {
  return items.reduce((count, item) => count + item.quantity, 0);
}

export function cartTotals(items: CartItem[]) {
  return items.reduce<Record<string, number>>((totals, item) => {
    totals[item.currency] = (totals[item.currency] ?? 0) + item.unitPriceMinor * item.quantity;
    return totals;
  }, {});
}
