import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Static contract tests only. PostgreSQL/Storage integration remains a separate gate.
const sql = readFileSync(new URL("../supabase/migrations/20260908130000_zero_inventory_product_files.sql", import.meta.url), "utf8");
const functions = [...sql.matchAll(/create function ([\w.]+)\([\s\S]*?\$\$;/g)].map(([body, name]) => ({ name, body }));
test("proposal has one transaction, unique function definitions and fixed definer search paths", () => {
  assert.equal((sql.match(/^begin;/gm) ?? []).length, 1);
  assert.equal((sql.match(/^commit;/gm) ?? []).length, 1);
  assert.equal(sql.trim().endsWith("commit;"), true);
  assert.equal(functions.length, 22);
  assert.equal(new Set(functions.map((f) => f.name)).size, functions.length);
  for (const f of functions) assert.match(f.body, /security definer set search_path=''/, f.name);
  const finalize = functions.find((f) => f.name === "public.finish_product_file").body;
  assert.match(finalize, /f\.expires_at<=clock_timestamp\(\)/, "expiry must use wall time after locks, not transaction-start now()");
});
test("all product functions have explicit closed default grants and privileged RPCs are service-only", () => {
  const revokeLoop = sql.slice(sql.indexOf('-- Close default function EXECUTE'));
  for (const { name } of functions) assert.ok(revokeLoop.includes(`'${name.split('.').pop()}'`), `${name} must have default EXECUTE revoked`);
  assert.match(revokeLoop, /revoke all on function %s from public,anon,authenticated,service_role/);
  for (const name of ["record_product_review", "record_product_file_validation", "get_product_review_input", "get_validated_file_delivery", "reconcile_product_files"]) {
    const grants = sql.match(/^grant execute .*$/gm).filter((line) => line.includes(`public.${name}(`));
    assert.equal(grants.length, 1, name);
    assert.ok(grants[0].endsWith("to service_role;"), name);
  }
  assert.match(sql, /revoke all on public.products,public.listings from public,anon,authenticated,service_role/);
});
test("vault validation binds the exact hash, file identity and reserved allowed extension", () => {
  const validate = functions.find((f) => f.name === "public.record_product_file_validation").body;
  assert.ok(validate.includes("p_sha256 is null or char_length(p_sha256)<>64 or p_sha256 !~ '^[a-f0-9]{64}$'"));
  assert.ok(validate.includes("v_ext:=substring(f.object_path from '\\.([^.]+)$')"));
  assert.ok(validate.includes("allowed.extension=v_ext and allowed.mime=f.mime_type"));
  assert.ok(validate.includes("v_expected_path:='validated/'||f.id::text||'/'||p_sha256||'.'||v_ext"));
  assert.ok(validate.includes("p_vault_path is distinct from v_expected_path"));
  assert.doesNotMatch(validate, /p_vault_path\s*!~|\{36\}/);
  for (const guard of ["o.bucket_id='product-validated-files'", "o.name=p_vault_path", "o.version=p_vault_version", "o.metadata->>'mimetype'=f.mime_type", "(o.metadata->>'size')::bigint=f.size_bytes", "f.reservation_state<>'finalized'", "f.storage_version is distinct from p_storage_version", "s.status='active'", "file_id=f.id or job_id=p_job_id"]) assert.ok(validate.includes(guard), guard);
  const allowed = [...validate.matchAll(/\('([^']+)','([^']+)'\)/g)].map((match) => match.slice(1));
  assert.deepEqual(allowed, [
    ["jpg", "image/jpeg"], ["jpeg", "image/jpeg"], ["png", "image/png"], ["webp", "image/webp"],
    ["mp4", "video/mp4"], ["webm", "video/webm"], ["pdf", "application/pdf"], ["txt", "text/plain"], ["csv", "text/csv"],
    ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ]);
});
test("no direct product Storage read/sign path is granted; all five buckets remain private", () => {
  for (const bucket of ["product-images", "product-videos", "product-public-documents", "product-private-documents", "product-validated-files"]) {
    assert.ok(sql.includes(`('${bucket}','${bucket}',false,`));
  }
  assert.match(sql, /as restrictive for select to anon,authenticated/);
  const route = readFileSync(new URL("../src/app/api/product-files/[id]/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route, /createSignedUrl|NextResponse.redirect/);
  assert.match(route, /loadVerifiedFile/);
  const client = readFileSync(new URL("../src/lib/supabase/product-system.ts", import.meta.url), "utf8");
  assert.match(client, /import "server-only"/);
});
