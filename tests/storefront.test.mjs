import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  addCartItem,
  CART_STORAGE_KEY,
  cartItemCount,
  cartTotals,
  parseStoredCart,
  setCartQuantity,
} from "../src/lib/cart.ts";
import { filterMarketplaceListings } from "../src/lib/marketplace/search.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const baseItem = {
  listingId: "11111111-1111-4111-8111-111111111111",
  productSlug: "blue-shirt",
  title: "Blue Shirt",
  sellerName: "Harare Threads",
  unitPriceMinor: 2500,
  currency: "USD",
};

test("cart adds, persists, changes quantity, removes, counts, and totals safely", () => {
  let items = addCartItem([], baseItem);
  items = addCartItem(items, baseItem);
  assert.equal(items[0].quantity, 2);
  assert.equal(cartItemCount(items), 2);
  assert.deepEqual(cartTotals(items), { USD: 5000 });

  items = setCartQuantity(items, baseItem.listingId, 4);
  assert.equal(items[0].quantity, 4);
  assert.deepEqual(parseStoredCart(JSON.stringify(items)), items);
  assert.equal(setCartQuantity(items, baseItem.listingId, 0).length, 0);
  assert.equal(CART_STORAGE_KEY, "zvese:mvp-cart:v1");
});

test("stored cart rejects malformed or unsafe browser data", () => {
  assert.deepEqual(parseStoredCart("not json"), []);
  assert.deepEqual(parseStoredCart(JSON.stringify([{ ...baseItem, listingId: "not-a-uuid", quantity: 1 }])), []);
  assert.deepEqual(parseStoredCart(JSON.stringify([{ ...baseItem, unitPriceMinor: -1, quantity: 1 }])), []);
  assert.deepEqual(parseStoredCart(JSON.stringify([{ ...baseItem, quantity: 100 }])), []);
});

test("marketplace search is trimmed and case-insensitive across product and seller fields", () => {
  const listing = {
    title: null,
    product: { title: "Blue Shirt", description: "Soft cotton", brand: "Zvese Basics", category: { slug: "clothing" } },
    seller: { store_name: "Harare Threads" },
  };
  const other = {
    title: "Coffee Mug",
    product: { title: "Mug", description: null, brand: null, category: { slug: "home" } },
    seller: { store_name: "Kitchen Store" },
  };

  for (const query of [" shirt ", "COTTON", "basics", "harare"]) {
    assert.deepEqual(filterMarketplaceListings([listing, other], query), [listing]);
  }
  assert.deepEqual(filterMarketplaceListings([listing, other], "  "), [listing, other]);
  assert.deepEqual(filterMarketplaceListings([listing, other], "", "clothing"), [listing]);
  assert.deepEqual(filterMarketplaceListings([listing, other], "shirt", "home"), []);
});

test("marketplace combines URL search, active categories, secure availability gates, and cart actions", () => {
  const page = read("src/app/marketplace/page.tsx");
  const products = read("src/lib/marketplace/products.ts");
  const productPage = read("src/app/marketplace/[slug]/page.tsx");

  const searchForm = read("src/components/marketplace/marketplace-search.tsx");
  assert.match(searchForm, /name="q"/);
  assert.match(searchForm, /name="category"/);
  assert.match(page, /marketplaceHref\(cat\.slug\)/);
  assert.match(page, /filterMarketplaceListings\(listings \?\? \[\], searchQuery, categorySlug\)/);
  assert.match(page, /disabled=\{!available\}/);
  assert.match(products, /\.eq\("is_active", true\)/);
  assert.match(products, /listing\.product\.category\?\.slug === categorySlug/);
  assert.match(products, /\.eq\("status", "active"\)/);
  assert.match(products, /\.eq\("seller\.status", "active"\)/);
  assert.match(productPage, /disabled=\{!availableToBuy\}/);
});

test("cart UI persists locally but checkout receives only the listing route", () => {
  const provider = read("src/components/cart/cart-provider.tsx");
  const cartPage = read("src/components/cart/cart-page.tsx");
  const checkout = read("src/app/checkout/[id]/page.tsx");

  assert.match(provider, /window\.localStorage\.getItem\(CART_STORAGE_KEY\)/);
  assert.match(provider, /window\.localStorage\.setItem\(CART_STORAGE_KEY/);
  assert.match(cartPage, /href=\{`\/checkout\/\$\{item\.listingId\}`\}/);
  assert.doesNotMatch(cartPage, /unit_price|seller_profile_id|availability_state|review_state/);
  assert.match(checkout, /client\.rpc\("get_checkout_listing", \{ p_listing_id: id \}\)/);
});

test("active seller navigation replaces Creators and cart appears at both breakpoints", () => {
  const navbar = read("src/components/layout/navbar.tsx");
  assert.match(navbar, /isActiveSeller\s*\? \{ label: "Seller Dashboard"/);
  assert.match(navbar, /: \{ label: "Creators"/);
  assert.equal((navbar.match(/<CartLink/g) ?? []).length, 2);
  assert.doesNotMatch(navbar, /isActiveSeller \? \([\s\S]*Apply to become a seller/);
});
