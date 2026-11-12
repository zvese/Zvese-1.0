import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as diagnostics from "../src/lib/admin/product-review-diagnostics.ts";
import * as review from "../src/lib/admin/product-review.ts";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function compile(path, imports) {
  const exports = {};
  const output = ts.transpileModule(source(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(output, { exports, Error, require(name) {
    if (name === "server-only") return {};
    if (!(name in imports)) throw new Error(`Unexpected import ${name}`);
    return imports[name];
  } });
  return exports;
}

test("moderator gate denies unauthenticated, non-admin, seller-reviewer and inactive users before privileged reads", async () => {
  for (const [user, membership] of [
    [null, null], [{ id: "actor" }, null],
    [{ id: "actor" }, { user_id: "actor", role: "seller_reviewer", is_active: true }],
    [{ id: "actor" }, { user_id: "actor", role: "super_admin", is_active: false }],
    [{ id: "actor" }, { user_id: "other", role: "super_admin", is_active: true }],
  ]) {
    let systemReads = 0;
    const query = { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: membership, error: null }) };
    const server = compile("src/lib/admin/product-review-server.ts", {
      "next/navigation": { redirect(path) { throw new Error(`redirect:${path}`); } },
      "@/lib/auth/redirects": { signInPath: () => "/sign-in" },
      "@/lib/supabase/server": { createClient: async () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) }, from: () => query }) },
      "@/lib/supabase/product-system": { createProductSystemClient() { systemReads++; throw new Error("Unexpected privileged read"); } },
      "./product-review": review,
      "./product-review-diagnostics": diagnostics,
    });
    await assert.rejects(server.requireProductModerator(), /redirect:/);
    assert.equal(systemReads, 0);
  }
});

function queueFixture(result, authorize = true) {
  const calls = [];
  const query = Object.fromEntries(["select", "eq", "gt", "is", "order", "range"].map((name) => [name, (...args) => {
    calls.push([name, ...args]);
    return name === "range" ? Promise.resolve(result) : query;
  }]));
  const jsx = (type, props) => ({ type, props });
  const page = compile("src/app/admin/products/page.tsx", {
    "react/jsx-runtime": { jsx, jsxs: jsx }, "next/link": { default: "a" },
    "@/lib/admin/product-review-diagnostics": diagnostics,
    "@/lib/supabase/product-system": { createProductSystemClient() { calls.push(["system"]); return { from(table) { calls.push(["from", table]); return query; } }; } },
    "@/lib/admin/product-review-server": {
      requireProductModerator: async () => { calls.push(["authorize"]); if (!authorize) throw new Error("Access denied"); },
      loadProductReview: async (id) => { calls.push(["detail", id]); return {
        id, reviewState: "pending_review", deletedAt: null, snapshot: { product: { title: "Fixture product" }, files: [] }, files: [],
      }; },
    },
  }).default;
  return { calls, render: (pageNumber = "1") => page({ searchParams: Promise.resolve({ page: pageNumber }) }) };
}

test("queue authorizes first, retains pending/revision/deletion filters, stable sort and bounded pagination", async () => {
  const f = queueFixture({ data: [{ id: "fixture" }], error: null, status: 200 });
  const rendered = await f.render("2");
  assert.equal(rendered.type, "section");
  assert.deepEqual(f.calls, [
    ["authorize"], ["system"], ["from", "listings"], ["select", "id"],
    ["eq", "review_state", "pending_review"], ["gt", "current_revision", 0], ["is", "deleted_at", null],
    ["order", "submitted_at"], ["order", "id"], ["range", 25, 49], ["detail", "fixture"],
  ]);
  const denied = queueFixture({}, false);
  await assert.rejects(denied.render(), /Access denied/);
  assert.deepEqual(denied.calls, [["authorize"]]);
});

test("invalid page is bounded and an empty queue renders successfully", async () => {
  const f = queueFixture({ data: [], error: null, status: 200 });
  await f.render("10001");
  assert.deepEqual(f.calls.at(-1), ["range", 0, 24]);
  assert.equal(f.calls.some(([name]) => name === "detail"), false);
});

test("401 invalid API key has actionable server error, sanitized diagnostics, and no detail reads", async (t) => {
  const log = t.mock.method(console, "error", () => {});
  const f = queueFixture({ data: null, status: 401, error: {
    message: "Invalid API key", details: "private fixture detail", hint: "private fixture hint", token: "private fixture token",
  } });
  await assert.rejects(f.render(), /Verify SUPABASE_SERVICE_ROLE_KEY belongs to NEXT_PUBLIC_SUPABASE_URL/);
  assert.equal(f.calls.some(([name]) => name === "detail"), false);
  assert.deepEqual(log.mock.calls[0].arguments, ["[product-review]", { stage: "queue", status: 401, code: null, category: "invalid_api_key" }]);
  assert.doesNotMatch(JSON.stringify(log.mock.calls[0].arguments), /private fixture/);
});

test("schema, permission, RPC and network errors stay distinguishable without raw messages or data", () => {
  for (const [message, code, category] of [
    ["permission denied for table private_name", "42501", "permission_denied"],
    ["column private_name does not exist", "42703", "missing_column"],
    ["Could not find function in schema cache", "PGRST202", "schema_cache_or_missing_object"],
    ["JWT expired", "PGRST301", "invalid_or_expired_authentication"],
    ["fetch failed at private address", "", "network_or_timeout"],
  ]) {
    const result = diagnostics.productReviewDiagnostic("review_input", { message, code }, 400);
    assert.equal(result.category, category);
    assert.equal(result.code, code || null);
    assert.doesNotMatch(JSON.stringify(result), /private_name|private address|JWT expired/);
  }
  assert.equal(diagnostics.productReviewDiagnostic("queue", { code: "sensitive-invalid-code", message: "private data" }).code, null);
});
