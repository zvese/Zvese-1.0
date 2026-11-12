import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { filterMarketplaceListings } from "../src/lib/marketplace/search.ts";
import { canBuy } from "../src/lib/orders/checkout.ts";
import { catalogPage } from "../src/lib/marketplace/catalog-query.ts";

const jsx = (type, props, key) => ({ type, props, key });
function compile(path, imports) {
  const exports = {};
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, URLSearchParams, require(name) {
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (!(name in imports)) throw new Error(`Unexpected dependency ${name}`);
      return imports[name];
    },
  });
  return exports;
}
const flatten = (node) => Array.isArray(node) ? node.flatMap(flatten)
  : node == null ? [] : [node, ...flatten(node.props?.children)];

function imageFixture(fileId) {
  const { ProductCardImage } = compile("src/components/marketplace/product-card-image.tsx", {
    "./product-card-image-view": { ProductCardImageView: "image-view" },
  });
  return ProductCardImage({ fileId, title: "Test product", priority: true });
}

test("card uses batched metadata without a per-card query or original download", () => {
  const node = imageFixture("approved-image");
  assert.equal(node.props.src, "/api/product-thumbnails/approved-image");
  assert.equal(node.props.title, "Test product");
  assert.equal(node.props.priority, true);
  assert.equal(node.key, node.props.src, "a replacement image resets client error state");
});

test("missing public image yields fallback, never a private/storage URL", () => {
  assert.equal(imageFixture(undefined).props.src, null);
});

test("image view uses bounded layout and alt text, then replaces a failed image with a clean placeholder", () => {
  let failed = false;
  const { ProductCardImageView } = compile("src/components/marketplace/product-card-image-view.tsx", {
    react: { useState: () => [failed, (value) => { failed = value; }] },
    "lucide-react": { ImageIcon: "svg" },
  });
  const render = (src) => ProductCardImageView({ src, title: "Test product" });
  const tree = render("/api/product-thumbnails/approved-image");
  assert.match(tree.props.className, /aspect-\[4\/3\]/);
  const img = flatten(tree).find((node) => node.type === "img");
  assert.equal(img.props.alt, "Test product");
  assert.equal(img.props.loading, "lazy");
  assert.match(img.props.srcSet, /w=320 320w.*w=640 640w.*w=960 960w/);
  assert.equal(img.props.width, 640);
  assert.equal(img.props.height, 640);
  assert.match(img.props.className, /object-contain/);
  img.props.onError();
  for (const src of ["/api/product-files/approved-image", null]) {
    const nodes = flatten(render(src));
    assert.equal(nodes.some((node) => node.type === "img"), false);
    assert.ok(nodes.includes("No image available"));
  }
});

test("marketplace wires listing images into product links while preserving cart eligibility", async () => {
  const listings = ["available", "checking", "unavailable"].map((availability) => ({
    id: availability, title: availability === "available" ? "Custom title" : null,
    product: { slug: `product-${availability}`, title: "Product title", category: null },
    seller: { store_name: "Fixture store" }, price_minor: 100, currency: "USD",
    review_state: "approved", availability_state: availability,
  }));
  const page = compile("src/app/marketplace/page.tsx", {
    "next/link": { default: "a" }, "lucide-react": { SearchIcon: "svg" },
    "@/components/ui/button": { Button: "button" },
    "@/components/cart/add-to-cart-button": { AddToCartButton: "cart-button" },
    "@/components/marketplace/product-card-image": { ProductCardImage: "card-image" },
    "@/components/marketplace/marketplace-search": { MarketplaceSearch: "search" },
    "@/lib/marketplace/catalog-query": { catalogPage },
    "@/lib/marketplace/public-card-images": { getPublicCardImages: async ids => Object.fromEntries(ids.map(id => [id, `image-${id}`])) },
    "@/lib/marketplace/products": {
      getActiveMarketplaceListings: async () => ({ data: listings }),
      getActiveCategories: async () => ({ data: [] }),
    },
    "@/lib/marketplace/search": { filterMarketplaceListings },
    "@/lib/orders/checkout": { canBuy },
  }).default;
  const nodes = flatten(await page({ searchParams: Promise.resolve({}) }));
  const articles = nodes.filter((node) => node.type === "article");
  assert.equal(articles.length, 3);
  articles.forEach((article, index) => {
    const link = flatten(article).find((node) => node.type === "a");
    const image = flatten(link).find((node) => node.type === "card-image");
    assert.equal(link.props.href, `/marketplace/${listings[index].product.slug}`);
    assert.equal(image.props.fileId, `image-${listings[index].id}`);
    assert.equal(image.props.priority, true);
    assert.equal(image.props.title, listings[index].title || listings[index].product.title);
    const cart = flatten(article).find((node) => node.type === "cart-button");
    assert.equal(cart.props.disabled, index !== 0);
  });
});
