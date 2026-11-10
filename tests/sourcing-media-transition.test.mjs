import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/20261001140000_ai_sourcing_foundation.sql");
const functionBody = (source, name) => {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `Missing function ${name}`);
  const end = source.indexOf("end; $$;", start);
  assert.ok(end > start);
  return source.slice(start, end + 8).replaceAll("\r\n", "\n");
};
const guard = functionBody(sql, "private.enforce_sourcing_media_decision_transition");

test("media transition guard excludes exactly the review state and stored generated identity", () => {
  // Match the entire acceptance predicate: no additional OR branch or evidence exclusion is allowed.
  assert.match(guard, /if old\.review_status='pending' and new\.review_status in \('approved','rejected'\)\s*--[^\n]+\n\s*and \(to_jsonb\(new\) - ARRAY\['review_status','source_url_identity'\]\)\s*is not distinct from \(to_jsonb\(old\) - ARRAY\['review_status','source_url_identity'\]\) then\s*return new;\s*end if;/);
  assert.equal([...guard.matchAll(/return new;/g)].length, 1);
  assert.match(guard, /tg_op='DELETE'[\s\S]*raise exception 'Sourcing media evidence is immutable'/);
  assert.match(guard, /end if;\s*raise exception 'Sourcing media may only be decided through the controlled review operation'/);
  // source_url, selected_role and every other real column therefore remain in the whole-row comparison.
  assert.doesNotMatch(guard, /new\.\w+\s*:=/);
});

test("generated identity has no direct write grant and is derived solely from immutable source_url", () => {
  const mediaTable = sql.split("create table public.sourcing_media_candidates (")[1].split("\n);")[0];
  assert.match(mediaTable, /source_url_identity text generated always as \(private\.normalize_sourcing_https_url\(source_url\)\) stored/);
  const mediaGrant = sql.match(/grant insert \(([^;]+)\)\s+on public\.sourcing_media_candidates to service_role;/)[1];
  assert.doesNotMatch(mediaGrant, /\b(?:review_status|source_url_identity)\b/);
  assert.doesNotMatch(sql, /grant\s+(?:all|update|delete|truncate)\b/i);
  assert.match(sql, /revoke all on public\.%I from public,anon,authenticated,service_role/);
});

test("controlled approve/reject RPC mutates only review_status and atomically records immutable evidence", () => {
  const rpc = functionBody(sql, "public.record_sourcing_media_decision");
  const update = rpc.match(/update public\.sourcing_media_candidates\s+set ([^;]+);/)[1];
  assert.equal(update.trim(), "review_status=v_to_status where id=m.id");
  assert.match(rpc, /case p_decision when 'approve' then 'approved' else 'rejected' end/);
  assert.match(rpc, /m\.review_status<>'pending'/);
  assert.match(rpc, /am\.role='super_admin' and am\.is_active=true/);
  assert.match(rpc, /for update/);
  assert.match(rpc, /extensions\.digest\(convert_to\(v_snapshot::text,'UTF8'\),'sha256'\)/);
  assert.match(rpc, /update public\.sourcing_media_candidates[\s\S]+insert into public\.sourcing_media_review_events[\s\S]+v_snapshot,v_snapshot_hash/);
  assert.doesNotMatch(rpc, /exception when|commit;|insert into public\.(?:products|listings)/i);
  assert.match(sql, /create trigger sourcing_media_review_events_immutable before update or delete/);
  assert.match(sql, /create trigger sourcing_media_review_events_no_truncate before truncate/);
  assert.match(sql, /revoke all on function public\.create_supplier[^;]+public\.record_sourcing_media_decision\(uuid,uuid,text,text\)[^;]+from public,anon,authenticated,service_role/);
});

test("local synchronization patches contain the exact same media guard", () => {
  for (const file of ["20261002_sourcing_media_review_local.sql", "20261005_media_generated_identity_local.sql"]) {
    const patch = read(`supabase/patches/${file}`);
    assert.equal(functionBody(patch, "private.enforce_sourcing_media_decision_transition"), guard);
  }
  const patch = read("supabase/patches/20261005_media_generated_identity_local.sql");
  assert.equal([...patch.matchAll(/create or replace function/g)].length, 1);
  assert.doesNotMatch(patch, /(?:alter table|grant |revoke |update public\.|delete from)/i);
});
