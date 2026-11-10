import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = () => read("supabase/migrations/20261001140000_ai_sourcing_foundation.sql");

test("sourcing tables use explicit least-privilege service grants and deny browser roles", () => {
  const sql = migration();
  for (const table of ["suppliers", "supplier_products", "sourcing_imports", "sourcing_candidates", "sourcing_media_candidates",
    "sourcing_review_events", "sourcing_media_review_events", "supplier_status_events", "supplier_availability_verification_events"]) {
    assert.match(sql, new RegExp(`create table public\\.${table}`));
  }
  assert.match(sql, /revoke all on public\.%I from public,anon,authenticated,service_role/);
  assert.match(sql, /grant select on public\.suppliers[\s\S]+public\.supplier_availability_verification_events to service_role/);
  assert.match(sql, /grant insert \([^;]+\)\s+on public\.sourcing_imports to service_role/);
  assert.match(sql, /grant insert \([^;]+\)\s+on public\.sourcing_candidates to service_role/);
  assert.match(sql, /grant insert \([^;]+\)\s+on public\.sourcing_media_candidates to service_role/);
  assert.doesNotMatch(sql, /grant insert on public\.(?:sourcing_candidates|sourcing_media_candidates) to service_role/);
  assert.doesNotMatch(sql, /grant all/i);
  assert.doesNotMatch(sql, /grant\s+(?:delete|truncate|references|trigger|update)[^;]+to service_role/i);
  assert.doesNotMatch(sql, /grant insert(?:\s*\([^)]*\))? on [^;]*(?:sourcing_review_events|sourcing_media_review_events|supplier_status_events|supplier_availability_verification_events)/i);
  assert.match(sql, /revoke all on function public\.create_supplier[\s\S]+from public,anon,authenticated,service_role/);
  assert.match(sql, /grant execute on function public\.create_supplier[\s\S]+public\.record_sourcing_media_decision\(uuid,uuid,text,text\)[\s\S]+public\.record_sourcing_decision\(uuid,uuid,text,text\) to service_role/);
  assert.doesNotMatch(sql, /grant execute on function public\.(?:create_supplier|set_supplier_status|record_supplier_availability_verification|record_sourcing_media_decision|record_sourcing_decision)[^;]+(?:anon|authenticated)/);
});

test("normal sourcing imports have only the exact service-role insert surface", () => {
  const sql = migration();
  const actions = read("src/app/admin/sourcing/actions.ts");
  const grantedColumns = sql.match(/grant insert \(([^;]+)\)\s+on public\.sourcing_imports to service_role;/i)?.[1]
    .split(",").map((column) => column.trim()).filter(Boolean).sort();
  const requiredColumns = ["supplier_id", "import_type", "source_reference", "status", "raw_payload", "summary",
    "submitted_by"].sort();

  assert.deepEqual(grantedColumns, requiredColumns);
  for (const column of requiredColumns) assert.match(actions, new RegExp(`\\b${column}:`));
  assert.doesNotMatch(grantedColumns.join(","), /\bcompleted_at\b/);
  assert.doesNotMatch(actions, /\bcompleted_at:/);
  assert.doesNotMatch(sql, /grant\s+(?:update|delete|truncate|references|trigger)(?:\s*\([^)]*\))?\s+on\s+(?:table\s+)?public\.sourcing_imports\s+to\s+service_role/i);
  assert.doesNotMatch(sql, /grant\s+insert(?:\s*\([^)]*\))?\s+on\s+(?:table\s+)?public\.sourcing_imports\s+to\s+(?:public|anon|authenticated)\b/i);
  assert.match(sql, /revoke all on public\.%I from public,anon,authenticated,service_role/);
});

test("sourcing import completion timestamps are database-owned and status-consistent", () => {
  const sql = migration();
  assert.match(sql, /create function private\.set_sourcing_import_completed_at\(\)[\s\S]+new\.status in \('validated','failed','completed'\)/);
  assert.match(sql, /new\.completed_at:=greatest\(new\.created_at,pg_catalog\.clock_timestamp\(\)\)/);
  assert.match(sql, /else\s+new\.completed_at:=null/);
  assert.match(sql, /create trigger set_sourcing_import_completed_at before insert or update[\s\S]+on public\.sourcing_imports/);
  assert.match(sql, /status in \('validated','failed','completed'\) and completed_at is not null/);
  assert.match(sql, /status in \('received','normalized'\) and completed_at is null/);
  assert.match(sql, /completed_at is null or completed_at >= created_at/);
  assert.match(sql, /revoke all on function[\s\S]+private\.set_sourcing_import_completed_at\(\)[\s\S]+from public,anon,authenticated,service_role/);
});

test("ordinary imports cannot fabricate candidate or media decision state", () => {
  const sql = migration();
  const candidateColumns = sql.match(/grant insert \(([^;]+)\)\s+on public\.sourcing_candidates to service_role;/)?.[1] ?? "";
  const mediaColumns = sql.match(/grant insert \(([^;]+)\)\s+on public\.sourcing_media_candidates to service_role;/)?.[1] ?? "";
  assert.ok(candidateColumns);
  assert.ok(mediaColumns);
  for (const protectedColumn of ["status", "decided_by", "decided_at", "decision_note", "created_product_id",
    "created_listing_id", "created_supplier_product_id", "availability_verification_state"]) {
    assert.doesNotMatch(candidateColumns, new RegExp(`\\b${protectedColumn}\\b`));
  }
  assert.doesNotMatch(mediaColumns, /\breview_status\b/);
  assert.match(sql, /status text not null default 'needs_review'/);
  assert.match(sql, /review_status text not null default 'pending'/);
  assert.match(sql, /create function private\.enforce_initial_sourcing_candidate\(\)[\s\S]+new\.status is distinct from 'needs_review'[\s\S]+new\.decided_by is not null[\s\S]+new\.decided_at is not null[\s\S]+new\.created_product_id is not null[\s\S]+new\.created_listing_id is not null[\s\S]+new\.created_supplier_product_id is not null/);
  assert.match(sql, /create trigger enforce_initial_sourcing_candidate before insert/);
  assert.match(sql, /create function private\.enforce_open_media_candidate\(\)[\s\S]+new\.review_status is distinct from 'pending'/);
  assert.doesNotMatch(sql, /\.from\("sourcing_candidates"\)\.insert\([\s\S]{0,1600}\bstatus:/);
});

test("audit evidence cannot be updated, deleted, truncated, or directly fabricated", () => {
  const sql = migration();
  for (const prefix of ["sourcing_review_events", "sourcing_media_review_events", "supplier_status_events", "supplier_availability_events"]) {
    assert.match(sql, new RegExp(`create trigger ${prefix}_immutable before update or delete`));
    assert.match(sql, new RegExp(`create trigger ${prefix}_no_truncate before truncate`));
  }
  assert.match(sql, /reviewed_snapshot jsonb not null/);
  assert.match(sql, /snapshot_hash text not null check \(snapshot_hash ~ '\^\[a-f0-9\]\{64\}\$'\)/);
  assert.match(sql, /v_snapshot_hash:=encode\(extensions\.digest\(convert_to\(v_snapshot::text,'UTF8'\),'sha256'\),'hex'\)/);
  assert.match(sql, /insert into public\.sourcing_review_events[\s\S]+v_snapshot,v_snapshot_hash/);
  assert.match(sql, /insert into public\.sourcing_media_review_events[\s\S]+v_snapshot,v_snapshot_hash/);
  assert.match(sql, /'normalized_snapshot',c\.normalized_snapshot,'source_snapshot',c\.source_snapshot/);
  assert.match(sql, /'media',v_media/);
});

test("supplier deactivation and verified availability are durable database invariants", () => {
  const sql = migration();
  assert.match(sql, /new\.availability_state='available'[\s\S]+new\.availability_verification_state<>'verified'[\s\S]+s\.status='active'/);
  assert.match(sql, /new\.availability_mode='source_managed' and new\.availability_state='available'[\s\S]+sp\.availability_verification_state='verified' and s\.status='active'/);
  assert.match(sql, /if new\.status<>'active'[\s\S]+availability_state='unavailable',availability_verification_state='unverified'[\s\S]+update public\.listings l set availability_state='unavailable'/);
  assert.match(sql, /create function public\.record_supplier_availability_verification[\s\S]+Active super administrator required/);
  assert.match(sql, /Fresh trusted availability evidence is required/);
  assert.match(sql, /update public\.supplier_products set availability_state=p_availability,availability_verification_state='verified'/);
  assert.match(sql, /availability_state text not null check \(availability_state in \('checking','unavailable'\)\)/);
  assert.match(sql, /availability_verification_state text not null default 'unverified' check \(availability_verification_state = 'unverified'\)/);
  assert.doesNotMatch(sql, /if new\.status='active'[\s\S]{0,300}availability_state='available'/);
});

test("media provenance is consistent, immutable, and included in reviewed evidence", () => {
  const sql = migration();
  assert.match(sql, /check \(\(provenance_type='synthetic'\) = synthetic\)/);
  assert.match(sql, /review_status<>'approved' or \(not watermarked and not synthetic and rights_status='claimed_authorized' and match_status='matched'\)/);
  assert.match(sql, /review_status<>'rejected' or selected_role='none'/);
  assert.match(sql, /selected_role <> 'hero' or \(media_type='image' and not watermarked and not synthetic[\s\S]+match_status='matched'/);
  assert.match(sql, /create trigger sourcing_media_immutable before update or delete/);
  assert.match(sql, /create function private\.enforce_sourcing_media_decision_transition\(\)[\s\S]+old\.review_status='pending'[\s\S]+new\.review_status in \('approved','rejected'\)/);
  assert.match(sql, /perform 1 from public\.sourcing_candidates c[\s\S]+c\.status in \('needs_review','held'\) for share/);
  assert.match(sql, /create trigger enforce_open_media_candidate before insert/);
  assert.match(sql, /'provenance_type',m\.provenance_type,'rights_status',m\.rights_status[\s\S]+'review_status',m\.review_status/);
  assert.match(sql, /create function public\.record_sourcing_media_decision[\s\S]+Active super administrator required[\s\S]+m\.match_confidence<0\.600[\s\S]+update public\.sourcing_media_candidates set review_status=v_to_status[\s\S]+insert into public\.sourcing_media_review_events/);
});

test("normalized duplicate identities and import supplier identity are enforced concurrently", () => {
  const sql = migration();
  assert.match(sql, /source_sku_identity text generated always as \(lower\(btrim\(source_sku\)\)\) stored/);
  assert.match(sql, /manufacturer_sku_identity text generated always as \(lower\(btrim\(manufacturer_sku\)\)\) stored/);
  assert.match(sql, /source_url_identity text generated always as \(private\.normalize_sourcing_https_url\(source_url\)\) stored/);
  assert.match(sql, /unique \(import_id, source_sku_identity\)/);
  assert.match(sql, /create unique index sourcing_candidates_live_supplier_sku_idx/);
  assert.match(sql, /create unique index sourcing_candidates_live_supplier_gtin_idx/);
  assert.match(sql, /create index sourcing_candidates_manufacturer_sku_idx/);
  assert.match(sql, /create index sourcing_candidates_source_url_idx/);
  assert.match(sql, /unique \(id, supplier_id\)/);
  assert.match(sql, /foreign key \(import_id, supplier_id\) references public\.sourcing_imports\(id, supplier_id\) on delete restrict/);
  assert.match(sql, /pg_advisory_xact_lock[\s\S]+Supplier product already exists/);
});

test("currency, canonical cost, price, and gross margin constraints agree", () => {
  const sql = migration();
  assert.match(sql, /create function private\.is_supported_sourcing_currency/);
  assert.match(sql, /'USD'[\s\S]+'ZAR'[\s\S]+'ZWG'/);
  assert.doesNotMatch(sql, /currency ~ '\^\[A-Z\]\{3\}\$'/);
  assert.match(sql, /source_cost_minor between 1 and 100000000/);
  assert.match(sql, /proposed_price_minor > source_cost_minor and proposed_price_minor <= 100000000/);
  assert.match(sql, /abs\(estimated_gross_margin_bps - round\(\(\(proposed_price_minor-source_cost_minor\)::numeric\/proposed_price_minor\)\*10000\)::integer\) <= 1/);
});

test("source URLs are canonical HTTPS references and reject local or malformed forms", () => {
  const sql = migration();
  assert.match(sql, /create function private\.normalize_sourcing_https_url/);
  assert.match(sql, /v_url ~ '\[\[:cntrl:\]\[:space:\]\]' or v_url ~ '#'/);
  assert.match(sql, /Only standard HTTPS URLs are allowed/);
  assert.match(sql, /v_host = 'localhost' or v_host like '%\.localhost' or v_host like '%\.local'/);
  assert.match(sql, /v_octets\[1\] in \(0,10,127\)/);
  assert.match(sql, /Canonical dotted-decimal IP address required/);
  assert.match(sql, /v_host !~ '\^\(0\|\[1-9\]\[0-9\]\{0,2\}\)\(\\\.\(0\|\[1-9\]\[0-9\]\{0,2\}\)\)\{3\}\$'/);
  assert.match(sql, /v_octets\[1\]=198 and v_octets\[2\]=51 and v_octets\[3\]=100/);
  assert.match(sql, /v_octets\[1\]=203 and v_octets\[2\]=0 and v_octets\[3\]=113/);
  assert.match(sql, /source_url = private\.normalize_sourcing_https_url\(source_url\)/);
  assert.doesNotMatch(sql, /http_get|net\.http|fetch\s*\(/i);
});

test("approval remains service-only, active-super-admin, atomic, and draft-only", () => {
  const sql = migration();
  assert.match(sql, /am\.role='super_admin' and am\.is_active=true/);
  assert.match(sql, /s\.status<>'active'/);
  assert.match(sql, /seller\.status<>'active'/);
  assert.match(sql, /insert into public\.products[\s\S]+c\.brand,'draft'/);
  assert.match(sql, /insert into public\.listings[\s\S]+source_managed[\s\S]+c\.availability_state,'draft'/);
  assert.match(sql, /review_state\)[\s\S]+,'draft'\)/);
  assert.doesNotMatch(sql, /insert into public\.listing_submissions/);
  assert.doesNotMatch(sql, /insert into public\.product_review_events/);
  assert.doesNotMatch(sql, /create (?:or replace )?function public\.record_product_review/);
  assert.doesNotMatch(sql, /alter table public\.(?:orders|order_items|payments)/);
  assert.match(sql, /\nbegin;[\s\S]+commit;\s*$/);
});

test("admin sourcing code reauthorizes and uses controlled RPCs and canonical server values", () => {
  const actions = read("src/app/admin/sourcing/actions.ts");
  const page = read("src/app/admin/sourcing/page.tsx");
  assert.match(actions, /getProductModerator\(\)/);
  assert.match(actions, /const current = await activeSuperAdmin\(\)/);
  assert.match(actions, /\.rpc\("create_supplier"/);
  assert.match(actions, /\.rpc\("record_sourcing_decision"/);
  assert.match(actions, /source_cost_minor: normalized\.sourceCostMinor/);
  assert.match(actions, /availabilityVerified: false/);
  assert.match(actions, /match_status: media\.matchStatus/);
  assert.doesNotMatch(actions, /availability_verification_state:|status: "needs_review"|review_status:/);
  assert.doesNotMatch(actions, /\bfetch\s*\(/);
  assert.doesNotMatch(actions, /form\.get\("(?:source_cost_minor|proposed_price_minor|availability_state|created_product_id)"\)/);
  assert.match(page, /requireProductModerator\("\/admin\/sourcing"\)/);
  assert.match(page, /Approval does not publish/);
});
