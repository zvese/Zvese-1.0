import assert from "node:assert/strict";
import test from "node:test";

import { parseCsvCatalog } from "../src/lib/sourcing/csv.ts";
import {
  grossMarginBps,
  mapSourceAvailability,
  moneyToMinor,
  normalizeSourcingRecord,
  parseJsonCatalog,
  recommendSalePrice,
  safeSourceUrl,
} from "../src/lib/sourcing/pipeline.ts";

const supplier = { id: "11111111-1111-4111-8111-111111111111", displayName: "Acme Manufacturing", supplierType: "manufacturer", status: "active" };
const categories = [{ id: "22222222-2222-4222-8222-222222222222", slug: "clothing", isActive: true }];
const valid = {
  title: "Cotton Shirt", description: "Official cotton shirt product description.", brand: "Acme",
  source_sku: "SHIRT-01", manufacturer_sku: "AC-S01", gtin: "1234567890123",
  source_cost: "12.50", currency: "USD", source_url: "https://supplier.example/products/SHIRT-01",
  availability: "in_stock", last_availability_check: "2026-09-30T12:00:00Z", category: "clothing",
  handling_time_min_days: 2, handling_time_max_days: 5, moq: 1, sizes: ["S", "M"],
  variants: [{ name: "Color", value: "Blue", sku: "SHIRT-01-B", availability: "in_stock" }],
  shipping: { countries: ["ZW", "ZA"], methods: ["courier"], international: true },
  images: [{ url: "https://supplier.example/media/SHIRT-01.jpg", provenance: "manufacturer_official", authorized: true,
    source_sku: "SHIRT-01", product_name: "Cotton Shirt", width: 2400, height: 2400 }],
};

test("valid supplier import normalizes canonical cost, deterministic price, draft availability, and media", () => {
  const result = normalizeSourcingRecord(valid, { supplier, categories, availabilityVerified: false });
  assert.equal(result.valid, true);
  assert.equal(result.normalized.sourceCostMinor, 1250);
  assert.equal(result.normalized.proposedPriceMinor, recommendSalePrice(1250));
  assert.equal(result.normalized.grossMarginBps, grossMarginBps(1250, recommendSalePrice(1250)));
  assert.equal(result.normalized.availability, "checking", "untrusted catalog availability cannot become available");
  assert.equal(result.normalized.variants[0].availability, "checking");
  assert.equal(result.normalized.media[0].selectedRole, "hero");
  assert.equal(result.normalized.media[0].matchStatus, "matched");
  assert.equal(result.normalized.media[0].reviewStatus, "pending");
  assert.equal(result.normalized.mediaStatus, "review_required");
  assert.match(result.normalized.media[0].warnings.join(" "), /supplier-claimed/);
});

test("inactive supplier, missing source data, invalid category, currency, and unsafe URL are rejected", () => {
  const result = normalizeSourcingRecord({ title: "Bad Product", description: "Long enough description", source_sku: "X1",
    source_cost: "5.00", currency: "BTC", source_url: "http://127.0.0.1/private", category: "missing" },
  { supplier: { ...supplier, status: "suspended" }, categories });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /Supplier is not active/);
  assert.match(result.errors.join(" "), /safe HTTPS source URL/);
  assert.match(result.errors.join(" "), /Currency is not supported/);
  assert.match(result.errors.join(" "), /active existing Zvese category/);

  const missing = normalizeSourcingRecord({ ...valid, source_url: undefined, source_reference: undefined }, { supplier, categories });
  assert.equal(missing.valid, false);
  assert.match(missing.errors.join(" "), /source reference/);
});

test("duplicate matches remain explicit warnings that review can block", () => {
  const duplicate = { supplierProductId: "supplier-product", candidateId: "candidate", productId: "product", sourceUrlMatch: true };
  const result = normalizeSourcingRecord(valid, { supplier, categories, duplicate });
  assert.equal(result.valid, true);
  assert.equal(result.duplicate, duplicate);
  assert.match(result.warnings.join(" "), /already exists in the supplier catalog/);
  assert.match(result.warnings.join(" "), /sourcing review queue/);
  assert.match(result.warnings.join(" "), /possible duplicate Zvese product/);
});

test("canonical money and availability mapping reject malformed values", () => {
  assert.equal(moneyToMinor("12.50"), 1250);
  assert.equal(moneyToMinor("12.345"), null);
  assert.equal(moneyToMinor("-1"), null);
  assert.equal(moneyToMinor("1000000.01"), null);
  assert.equal(mapSourceAvailability("in_stock", false), "checking");
  assert.equal(mapSourceAvailability("in_stock", true), "available");
  assert.equal(mapSourceAvailability("out_of_stock", false), "unavailable");
  assert.equal(safeSourceUrl("https://manufacturer.example/item"), "https://manufacturer.example/item");
  assert.equal(safeSourceUrl("https://8.8.8.8/catalog/item"), "https://8.8.8.8/catalog/item");
  for (const value of ["http://example.com", "https://localhost/x", "https://0177.0.0.1/x", "https://012.0.0.1/x",
    "https://127.0.0.1/x", "https://10.0.0.1/x", "https://100.64.0.1/x", "https://192.0.0.1/x",
    "https://192.0.2.1/x", "https://192.88.99.1/x", "https://198.18.0.1/x", "https://198.51.100.25/x",
    "https://203.0.113.25/x", "https://224.0.0.1/x",
    "https://user:secret@example.com/x", "https://example.com:8443/x", "https://example.com/x#fragment",
    "https://example.com/%0aheader", " https://example.com/x", "https://example.com/x ", "javascript:alert(1)", "//example.com/x"]) {
    assert.equal(safeSourceUrl(value), null, value);
  }
});

test("media ranking rejects watermarks, synthetic claims, wrong variants, and unknown rights", () => {
  const record = { ...valid, variants: [{ name: "Color", value: "Blue" }], images: [
    { url: "https://supplier.example/watermark.jpg", authorized: true, source_sku: "SHIRT-01", watermarked: true, width: 3000, height: 3000 },
    { url: "https://supplier.example/synthetic.jpg", authorized: true, source_sku: "SHIRT-01", synthetic: true, width: 3000, height: 3000 },
    { url: "https://supplier.example/red.jpg", authorized: true, source_sku: "SHIRT-01", variant: "Red", width: 3000, height: 3000 },
    { url: "https://supplier.example/unknown.jpg", source_sku: "SHIRT-01", width: 3000, height: 3000 },
  ] };
  const result = normalizeSourcingRecord(record, { supplier, categories });
  assert.equal(result.normalized.media.every((item) => item.selectedRole === "none"), true);
  assert.equal(result.normalized.media.find((item) => item.sourceUrl.endsWith("/red.jpg")).matchStatus, "rejected");
  assert.equal(result.normalized.media.every((item) => item.reviewStatus === "pending"), true);
  assert.equal(result.normalized.mediaStatus, "incomplete");
  assert.match(result.warnings.join(" "), /media candidates require/);
});

test("JSON and CSV catalog inputs are bounded and parsed without prototype keys", () => {
  assert.equal(parseJsonCatalog(JSON.stringify(valid)).length, 1);
  const csv = 'title,description,source_sku,source_cost,currency,source_url,category\n"Cotton Shirt","Official shirt description",SHIRT-01,12.50,USD,https://supplier.example/item,clothing';
  assert.equal(parseCsvCatalog(csv)[0].source_sku, "SHIRT-01");
  assert.throws(() => parseCsvCatalog("constructor,title\nx,y"), /safe snake_case/);
  assert.throws(() => parseJsonCatalog("[]"), /1 to 50/);
});
