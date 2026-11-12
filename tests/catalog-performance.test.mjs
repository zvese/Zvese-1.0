import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as filters from "../src/lib/marketplace/catalog-query.ts";
function fixture(path, result) {
  const calls = [];
  const query = Object.fromEntries(["select", "eq", "in", "or", "filter", "order", "range", "limit"].map(method => [method, (...args) => {
    calls.push([method, ...args]); return ["range", "limit"].includes(method) ? Promise.resolve(result) : query;
  }]));
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { exports, require(name) {
    if (name === "react") return { cache: fn => fn };
    if (name === "./catalog-query") return filters;
    if (name === "@/lib/supabase/catalog") return { createCatalogClient: () => ({ from(table) { calls.push(["from", table]); return query; } }) };
    throw new Error("Unexpected dependency");
  } });
  return { exports, calls };
}
test("24 cards use a single bounded anonymous metadata query, deterministically select first image", async () => {
  const f = fixture("src/lib/marketplace/public-card-images.ts", { data: [{ id: "first", listing_id: "listing" }, { id: "later", listing_id: "listing" }], error: null });
  const images = await f.exports.getPublicCardImages(Array.from({ length: 24 }, (_, n) => `listing-${n}`));
  assert.equal(images.listing, "first");
  assert.equal(f.calls.filter(([name]) => name === "from").length, 1);
  for (const [field, value] of [["visibility", "public"], ["reservation_state", "finalized"], ["content_validation_state", "passed"]]) {
    assert.ok(f.calls.some(call => call[0] === "eq" && call[1] === field && call[2] === value));
  }
  assert.deepEqual(f.calls.at(-1), ["limit", 288]);
});
test("no cards avoids media request; metadata errors fail closed", async () => {
  const f = fixture("src/lib/marketplace/public-card-images.ts", { data: [{ id: "ignored", listing_id: "listing" }], error: {} });
  assert.equal(Object.keys(await f.exports.getPublicCardImages([])).length, 0);
  assert.equal(f.calls.length, 0);
  assert.equal(Object.keys(await f.exports.getPublicCardImages(["listing"])).length, 0);
});
test("catalog bounds database rows before normalization, preserving all approval filters", async () => {
  const rows = Array.from({ length: 25 }, (_, n) => ({ id: `${n}`, product: {}, seller: {} }));
  const f = fixture("src/lib/marketplace/products.ts", { data: rows, error: null });
  const result = await f.exports.getActiveMarketplaceListings(undefined, "", 2);
  assert.equal(result.data.length, 24); assert.equal(result.hasNext, true);
  assert.deepEqual(f.calls.at(-1), ["range", 24, 48]);
  for (const [field, value] of [["status", "active"], ["review_state", "approved"], ["seller.status", "active"], ["product.status", "active"]]) assert.ok(f.calls.some(call => call[0] === "eq" && call[1] === field && call[2] === value));
});
test("search and category filters execute in database before pagination across product and seller fields", async () => {
  const f = fixture("src/lib/marketplace/products.ts", { data: [], error: null });
  await f.exports.getActiveMarketplaceListings("clothing", "cotton", 1);
  assert.match(f.calls.find(c => c[0] === "select")[1], /category:categories!inner/);
  assert.ok(f.calls.some(c => c[0] === "eq" && c[1] === "product.category.slug" && c[2] === "clothing"));
  assert.ok(f.calls.some(c => c[0] === "or" && /description.imatch/.test(c[1]) && c[2]?.referencedTable === "product_search"));
  assert.ok(f.calls.some(c => c[0] === "or" && /product_search.not.is.null,seller_search.not.is.null/.test(c[1])));
  assert.equal(f.calls.at(-1)[0], "range");
});
test("literal wildcard/grammar characters cannot broaden the search filter", () => {
  assert.equal(filters.containsPattern("50%_*\\"), "50%_\\*\\\\");
  for (const literal of ["*", ".*", "[a-z]", "(foo|bar)", "50%_", "\\m", "x{3}"]) {
    const regex = new RegExp(filters.containsPattern(literal), "i");
    assert.ok(regex.test(`prefix${literal}suffix`));
    assert.equal(regex.test("unrelated text"), false);
  }
  assert.equal(filters.quotedFilter('a"),id.not.is.null'), '"a\\"),id.not.is.null"');
  for (const value of ["NaN", "-1", "10001", "1.5"]) assert.equal(filters.catalogPage(value), 1);
});
