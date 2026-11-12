// Read-only, no cookies or browser tokens. Never print raw errors or row data.
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { productReviewDiagnostic } from "../src/lib/admin/product-review-diagnostics.ts";

nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.log(JSON.stringify({ stage: "configuration", result: "missing_url_or_system_key" }));
  process.exitCode = 1;
} else {
  const system = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }) },
  });
  function report(stage, result) {
    const { error, status, data } = result;
    console.log(JSON.stringify({ ...productReviewDiagnostic(stage, error, status), rowCount: Array.isArray(data) ? data.length : null }));
    if (error) process.exitCode = 1;
  }
  const queue = await system.from("listings").select("id")
    .eq("review_state", "pending_review").gt("current_revision", 0).is("deleted_at", null)
    .order("submitted_at").order("id").range(0, 24);
  report("queue", queue);
  // Zero-row requests exercise required schema/permissions without returning PII.
  for (const [stage, table, columns] of [
    ["review_listing_join", "listings", "id,current_revision,review_state,status,deleted_at,availability_state,seller:seller_profiles!inner(user_id,status,store_name),product:products!inner(created_by,status,slug)"],
    ["submission_columns", "listing_submissions", "snapshot,snapshot_hash,submitted_at"],
    ["file_validation_columns", "product_files", "id,original_name,content_validation_state,reservation_state,storage_version"],
  ]) report(stage, await system.from(table).select(columns).limit(0));

  // Exercise the full read path for this bounded queue page. Results remain in
  // memory; output contains no IDs, titles, seller identities, snapshots or hashes.
  for (const row of queue.data ?? []) {
    const listing = await system.from("listings")
      .select("id,current_revision,review_state,status,deleted_at,availability_state,seller:seller_profiles!inner(user_id,status,store_name),product:products!inner(created_by,status,slug)")
      .eq("id", row.id).maybeSingle();
    report("review_listing_join", listing);
    if (listing.error || !listing.data?.current_revision) continue;
    const submission = await system.from("listing_submissions").select("snapshot,snapshot_hash,submitted_at")
      .eq("listing_id", row.id).eq("revision", listing.data.current_revision).maybeSingle();
    report("submission_columns", submission);
    // GET invokes this STABLE read-only RPC in a read-only transaction.
    const input = await system.rpc("get_product_review_input", {
      p_listing_id: row.id, p_expected_revision: listing.data.current_revision,
    }, { get: true });
    report("review_input", input);
    const ids = submission.data?.snapshot?.files?.map((file) => file.id) ?? [];
    if (ids.length) report("file_validation_columns", await system.from("product_files")
      .select("id,original_name,content_validation_state,reservation_state,storage_version")
      .eq("listing_id", row.id).in("id", ids));
  }
}
