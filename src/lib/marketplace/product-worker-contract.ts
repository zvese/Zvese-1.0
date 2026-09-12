// Contract only: no worker, scanner, supplier call or model invocation is implemented.
// These calls require server-held service_role credentials. Never expose a browser
// endpoint that forwards arbitrary requests to them.
export type Availability = "checking" | "available" | "unavailable";
export interface ProductReviewInput {
  listingId: string;
  expectedRevision: number;
  snapshot: {
    product: { id: string; title: string; description: string; price_minor: number; currency: string };
    source: { source_type: string; partner_reference: string };
    files: { id: string; storage_version: string; visibility: "public" | "private"; mime_type: string; size_bytes: number }[];
  };
  snapshotHash: string;
  filesFingerprint: string;
}
export interface ReviewProvenance {
  kind: "manual" | "model";
  controller: string;
  source: { reference: string; observed_at: string; availability: Availability };
  policy: { version: string; result: "approved" | "rejected" };
  model?: { provider: string; name: string; response_id: string; output_sha256: string };
}
export interface ProductReviewRpcArgs {
  p_listing_id: string;
  p_expected_revision: number;
  p_job_id: string;
  p_decision: "approved" | "rejected";
  p_availability: Availability;
  p_snapshot_hash: string;
  p_files_fingerprint: string;
  p_provenance: ReviewProvenance;
}
export interface ProductFileValidationRpcArgs {
  p_file_id: string;
  p_storage_version: string;
  p_job_id: string;
  p_state: "passed" | "failed";
  p_sha256: string;
  p_validator: string;
  p_evidence_reference: string;
  p_vault_path: string | null;
  p_vault_version: string | null;
}
