import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
import { loadPublicThumbnail } from "../src/lib/marketplace/public-thumbnail.ts";
import { ThumbnailCache } from "../src/lib/marketplace/thumbnail-cache.ts";

const id = "11111111-1111-4111-8111-111111111111";
function fixture() {
  const original = new Uint8Array([1, 2, 3]);
  const state = { visible: true, reads: 0, downloads: 0, transforms: 0 };
  const query = { select: () => query, eq: () => query, maybeSingle: async () => {
    state.reads++;
    return { data: state.visible ? { size_bytes: 3, mime_type: "image/png" } : null };
  } };
  const cache = new ThumbnailCache();
  const imports = {
    "@/lib/supabase/catalog": { createCatalogClient: () => ({ from: () => query }) },
    "@/lib/supabase/product-system": { createProductSystemClient: () => ({
      rpc: async () => ({ data: [{ vault_path: "hidden", vault_version: "v1", content_sha256: createHash("sha256").update(original).digest("hex") }] }),
      storage: { from: () => ({ download: async () => { state.downloads++; return { data: new Blob([original]) }; } }) },
    }) },
    "@/lib/admin/seller-review-data": { isUuid: value => value === id },
    "@/lib/marketplace/public-thumbnail": { loadPublicThumbnail: (width, io) => loadPublicThumbnail(width, io, cache) },
    "@/lib/marketplace/thumbnail-transform": { transformThumbnail: async () => { state.transforms++; return new Uint8Array([4, 5]); } },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/app/api/product-thumbnails/[id]/route.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, performance, Headers, Response, Blob, URL, require: name => {
    assert.ok(name in imports, `Unexpected import: ${name}`); return imports[name];
  } });
  return { state, get: (headers = {}, width = 640) => exports.GET(new Request(`http://localhost/api/product-thumbnails/${id}?w=${width}`, { headers }), { params: Promise.resolve({ id }) }) };
}

test("conditional thumbnail rechecks current public access; never public-caches or repeats the Storage download", async () => {
  const f = fixture();
  const first = await f.get();
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("content-type"), "image/webp");
  assert.equal(first.headers.get("cache-control"), "private, no-cache, must-revalidate");
  assert.equal(first.headers.get("content-length"), "2");
  assert.doesNotMatch(first.headers.get("server-timing"), /hidden|v1/);
  const etag = first.headers.get("etag");
  const second = await f.get({ "If-None-Match": etag });
  assert.equal(second.status, 304);
  assert.equal((await second.arrayBuffer()).byteLength, 0);
  assert.equal(f.state.reads, 4);
  assert.equal(f.state.downloads, 1);
  assert.equal(f.state.transforms, 1);
  f.state.visible = false;
  const denied = await f.get({ "If-None-Match": etag, Cookie: "untrusted-session=cannot-bypass-public-access" });
  assert.equal(denied.status, 404);
  assert.equal(denied.headers.get("cache-control"), "no-store");
  assert.equal(denied.headers.get("etag"), null);
});

test("arbitrary thumbnail widths cannot trigger database, storage or processing work", async () => {
  const f = fixture();
  for (const width of [0, -1, 99999, "garbage"]) assert.equal((await f.get({}, width)).status, 404);
  assert.equal(f.state.reads, 0); assert.equal(f.state.downloads, 0);
});

test("only the anonymous thumbnail endpoint skips session refresh", async () => {
  let calls = 0;
  const exports = {};
  const source = readFileSync(new URL("../src/middleware.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, require: name => name === "next/server" ? { NextResponse: { next: () => "public" } } : { updateSession: async () => { calls++; return "checked"; } },
  });
  assert.equal(await exports.middleware({ nextUrl: { pathname: `/api/product-thumbnails/${id}` } }), "public");
  for (const pathname of [`/api/product-files/${id}`, "/admin/products", "/checkout/test", "/account", `/api/product-thumbnails/${id}/private`]) {
    assert.equal(await exports.middleware({ nextUrl: { pathname } }), "checked");
  }
  assert.equal(calls, 5);
});
