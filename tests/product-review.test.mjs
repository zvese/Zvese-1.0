import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { performProductReview, hasUnvalidatedFiles } from "../src/lib/admin/product-review.ts";

const actor = { id: "moderator", role: "super_admin", isActive: true };
const context = { listingId: "listing", revision: 1, snapshotHash: "snapshot", filesFingerprint: "files", jobId: "server-job" };
const input = { decision: "approved", availability: "checking", note: "Manual review: availability is not yet confirmed." };
const record = () => ({
  id: "listing", revision: 1, reviewState: "pending_review", listingStatus: "draft", deletedAt: null,
  sellerUserId: "seller", productCreatorId: "creator", sellerStatus: "active", sellerName: "Test store",
  productStatus: "draft", productSlug: "product-test", availability: "checking", submittedAt: "2026-09-12T12:00:00Z",
  snapshot: { product: { id: "product", title: "Submitted title", description: "Description", price_minor: 1200, currency: "USD" },
    source: { source_type: "other", partner_reference: "Declared reference" }, files: [] },
  snapshotHash: "snapshot", filesFingerprint: "files", files: [],
});
function fixture(changes = {}, identity = actor) {
  const current = { ...record(), ...changes };
  const calls = [];
  let reads = 0;
  const io = { actor: async () => identity, load: async () => { reads++; return current; },
    record: async (args) => { calls.push(args); return null; }, now: () => "2026-09-12T12:00:00Z" };
  return { io, current, calls, reads: () => reads };
}
test("non-admin, seller-review-only and inactive super admins denied before privileged reads", async () => {
  for (const identity of [null, { ...actor, role: "seller" }, { ...actor, role: "seller_reviewer" }, { ...actor, isActive: false }]) {
    const f = fixture({}, identity);
    await assert.rejects(performProductReview(context, input, f.io), /super administrator/);
    assert.equal(f.reads(), 0); assert.equal(f.calls.length, 0);
  }
});
test("active super admin can approve an attachment-free revision with server audit provenance", async () => {
  const f = fixture();
  await performProductReview(context, { ...input, p_provenance: { moderator_user_id: "forged" }, jobId: "browser-job" }, f.io);
  assert.equal(f.calls.length, 1);
  const call = f.calls[0];
  assert.equal(call.p_job_id, context.jobId); assert.equal(call.p_expected_revision, 1);
  assert.equal(call.p_snapshot_hash, "snapshot"); assert.equal(call.p_files_fingerprint, "files");
  assert.equal(call.p_provenance.moderator_user_id, actor.id);
  assert.equal(call.p_provenance.kind, "manual"); assert.equal(call.p_provenance.review_note, input.note);
  assert.equal(call.p_provenance.source.reference, "evidence://manual-product-review/moderator/server-job");
  assert.equal(call.p_availability, "checking");
});
test("seller or product-creator self-review denied", async () => {
  for (const field of ["sellerUserId", "productCreatorId"]) {
    const f = fixture({ [field]: actor.id });
    await assert.rejects(performProductReview(context, input, f.io), /own product/);
    assert.equal(f.calls.length, 0);
  }
});
test("stale revision, snapshot, file set and previously decided state denied", async () => {
  for (const changes of [{ revision: 2 }, { snapshotHash: "changed" }, { filesFingerprint: "changed" }, { filesFingerprint: null }, { reviewState: "approved" }, { reviewState: "rejected" }]) {
    const f = fixture(changes);
    await assert.rejects(performProductReview(context, input, f.io), /changed or was already decided/);
    assert.equal(f.calls.length, 0);
  }
});
test("pending, failed, missing and mismatched-version attachments cannot be approved", async () => {
  for (const files of [[], [{ id: "file", validation: "pending", reservation: "finalized", storageVersion: "v1" }],
    [{ id: "file", validation: "failed", reservation: "finalized", storageVersion: "v1" }],
    [{ id: "file", validation: "passed", reservation: "finalized", storageVersion: "v2" }]]) {
    const base = record(); base.snapshot.files = [{ id: "file", storage_version: "v1" }];
    const f = fixture({ snapshot: base.snapshot, files });
    assert.equal(hasUnvalidatedFiles(f.current), true);
    await assert.rejects(performProductReview(context, input, f.io), /trusted validation/);
    assert.equal(f.calls.length, 0);
    await performProductReview(context, { ...input, decision: "rejected" }, f.io);
    assert.equal(f.calls[0].p_decision, "rejected");
  }
});
test("suspension and withdrawal block review; authorization is rechecked before writing", async () => {
  for (const changes of [{ sellerStatus: "suspended" }, { deletedAt: "2026-09-12" }]) {
    const f = fixture(changes);
    await assert.rejects(performProductReview(context, input, f.io), /eligible/);
    assert.equal(f.calls.length, 0);
  }
  const f = fixture(); let checks = 0;
  f.io.actor = async () => ++checks === 1 ? actor : { ...actor, isActive: false };
  await assert.rejects(performProductReview(context, input, f.io), /authorization changed/);
  assert.equal(f.calls.length, 0);
});
test("database stale/duplicate/concurrency errors fail safely without a new job or retry", async () => {
  for (const code of ["40001", "23505", "40P01", "55000", "42501"]) {
    const f = fixture();
    f.io.record = async (args) => { f.calls.push(args); return { code }; };
    await assert.rejects(performProductReview(context, input, f.io));
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].p_job_id, context.jobId);
  }
});
test("two overlapping decisions rely on RPC uniqueness; loser receives a safe failure", async () => {
  const f = fixture(); let writes = 0;
  f.io.record = async () => ++writes === 1 ? null : { code: "23505" };
  const results = await Promise.allSettled([performProductReview(context, input, f.io), performProductReview(context, { ...input, decision: "rejected" }, f.io)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
});
test("pages/actions keep privileged values in the encrypted closure and use only the review RPC", () => {
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const page = read("src/app/admin/products/[id]/page.tsx");
  const queue = read("src/app/admin/products/page.tsx");
  const action = read("src/app/admin/products/actions.ts");
  assert.match(page, /await requireProductModerator\(\)/);
  assert.match(page, /jobId: randomUUID\(\)/);
  assert.match(page, /"use server";\s*await decideProduct\(context, form\)/);
  assert.match(queue, /\.eq\("review_state", "pending_review"\)/);
  assert.match(action, /actor: getProductModerator/);
  assert.match(action, /createProductSystemClient\(\)\.rpc\("record_product_review", args\)/);
  assert.doesNotMatch(action, /\.update\(|form\.get\("(?:provenance|job_id|moderator_user_id|snapshot_hash|revision)"\)/);
});
