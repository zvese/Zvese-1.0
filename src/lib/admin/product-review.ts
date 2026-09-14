import type { ProductReviewInput, ProductReviewRpcArgs } from "../marketplace/product-worker-contract";

export interface ProductModerator { id: string; role: string; isActive: boolean }
export interface ReviewContext {
  listingId: string; revision: number; snapshotHash: string; filesFingerprint: string; jobId: string;
}
export interface ProductReviewRecord {
  id: string; revision: number; reviewState: string; listingStatus: string; deletedAt: string | null;
  sellerUserId: string; productCreatorId: string; sellerStatus: string; sellerName: string;
  productStatus: string; productSlug: string; availability: string; submittedAt: string;
  snapshot: ProductReviewInput["snapshot"]; snapshotHash: string; filesFingerprint: string | null;
  files: { id: string; name: string; validation: string; reservation: string; storageVersion: string | null }[];
}
export interface ManualDecision { decision: string; availability: string; note: string }

export function isProductModerator(actor: ProductModerator | null): actor is ProductModerator {
  return !!actor?.id && actor.role === "super_admin" && actor.isActive === true;
}
export function isSelfReview(actorId: string, record: ProductReviewRecord): boolean {
  return actorId === record.sellerUserId || actorId === record.productCreatorId;
}
export function hasUnvalidatedFiles(record: ProductReviewRecord): boolean {
  return record.snapshot.files.some((submitted) => !record.files.some((file) =>
    file.id === submitted.id && file.validation === "passed" && file.reservation === "finalized"
    && file.storageVersion === submitted.storage_version));
}

export class ProductReviewError extends Error {}

// Authorization runs on every invocation, before any privileged read or write.
// The database still owns locking, uniqueness, file integrity and publication.
export async function performProductReview(context: ReviewContext, input: ManualDecision, io: {
  actor: () => Promise<ProductModerator | null>;
  load: (listingId: string) => Promise<ProductReviewRecord | null>;
  record: (args: ProductReviewRpcArgs) => Promise<{ code?: string } | null>;
  now: () => string;
}): Promise<ProductReviewRecord> {
  const actor = await io.actor();
  if (!isProductModerator(actor)) throw new ProductReviewError("Active super administrator access is required.");
  const record = await io.load(context.listingId);
  if (!record) throw new ProductReviewError("Submission unavailable.");
  if (isSelfReview(actor.id, record)) throw new ProductReviewError("You cannot review your own product or seller listing.");
  if (record.sellerStatus !== "active" || record.deletedAt) throw new ProductReviewError("The seller and listing must remain eligible for review.");
  if (record.reviewState !== "pending_review" || record.revision !== context.revision
    || record.snapshotHash !== context.snapshotHash || !record.filesFingerprint || record.filesFingerprint !== context.filesFingerprint) {
    throw new ProductReviewError("This submission changed or was already decided. Refresh before reviewing again.");
  }
  if ((input.decision !== "approved" && input.decision !== "rejected")
    || !["checking", "available", "unavailable"].includes(input.availability)
    || input.note.trim().length < 10 || input.note.trim().length > 2000) throw new ProductReviewError("Choose a decision, availability and a review note of 10–2,000 characters.");
  if (input.decision === "approved" && hasUnvalidatedFiles(record)) throw new ProductReviewError("Every submitted file must pass trusted validation before approval.");
  const currentActor = await io.actor();
  if (!isProductModerator(currentActor) || currentActor.id !== actor.id) throw new ProductReviewError("Your product-review authorization changed. Sign in again.");
  const error = await io.record({
    p_listing_id: record.id, p_expected_revision: context.revision, p_job_id: context.jobId,
    p_decision: input.decision, p_availability: input.availability as "checking" | "available" | "unavailable",
    p_snapshot_hash: context.snapshotHash, p_files_fingerprint: context.filesFingerprint,
    p_provenance: {
      kind: "manual", controller: `super_admin:${actor.id}`,
      source: {
        reference: `evidence://manual-product-review/${actor.id}/${context.jobId}`,
        observed_at: io.now(), availability: input.availability as "checking" | "available" | "unavailable",
      },
      policy: { version: "manual-product-review-v1", result: input.decision },
      // Stored in the existing private immutable review-event JSON, not public metadata.
      ...{ moderator_user_id: actor.id, review_note: input.note.trim() },
    },
  });
  if (error) {
    if (["40001", "23505", "40P01"].includes(error.code ?? "")) throw new ProductReviewError("This submission changed or another decision won. Refresh before retrying.");
    throw new ProductReviewError("The decision was not accepted. Refresh and check seller status and file validation.");
  }
  return record;
}
