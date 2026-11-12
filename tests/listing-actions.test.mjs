import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as productFiles from "../src/lib/marketplace/product-files.ts";

const listingId = "3fab3a47-27f0-4e8a-894e-6b38e6ef895a";
function actionsFixture(response, active = true) {
  const calls = [];
  const seller = { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: active ? { id: "seller" } : null, error: null }; } };
  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: "user" } } }) },
    from: () => seller,
    rpc: async (...args) => { calls.push(args); return response; },
  };
  const exports = {};
  const source = readFileSync(new URL("../src/app/account/listings/actions.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports,
    require(name) {
      if (name === "next/cache") return { revalidatePath() {} };
      if (name.includes("supabase/server")) return { createClient: async () => supabase };
      if (name.includes("seller-review-data")) return { isUuid: (value) => value === listingId };
      if (name.includes("product-files")) return productFiles;
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return { actions: exports, calls, reserve: (mime = "image/png") => exports.reserveFile(listingId, "public", "OG Wacho.png", mime, 100) };
}

test("reservation validates file and active seller before calling the RPC", async () => {
  const invalid = actionsFixture({});
  assert.ok((await invalid.reserve("text/html")).error);
  assert.equal(invalid.calls.length, 0);
  const inactive = actionsFixture({}, false);
  assert.match((await inactive.reserve()).error, /active seller/);
  assert.equal(inactive.calls.length, 0);
});

test("reservation passes exact metadata to RPC and reads its table result", async () => {
  const record = { id: "file", bucket_id: "product-images", object_path: "incoming/reserved.png", expires_at: "2099-01-01" };
  const f = actionsFixture({ data: [record], error: null });
  assert.equal((await f.reserve()).file, record);
  assert.equal(f.calls[0][0], "reserve_product_file");
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0][1])), {
    p_listing_id: listingId, p_visibility: "public", p_name: "OG Wacho.png", p_mime: "image/png", p_size: 100,
  });
});

test("structured RPC rejection permits retry; lost or malformed response requires reconciliation", async () => {
  const denied = await actionsFixture({ data: null, error: { code: "42501", message: "private diagnostic" } }).reserve();
  assert.equal(denied.uncertain, false);
  assert.doesNotMatch(denied.error, /private diagnostic/);
  for (const response of [{ data: null, error: { code: "", message: "fetch failed" } }, { data: null, error: null }]) {
    assert.equal((await actionsFixture(response).reserve()).uncertain, true);
  }
});
