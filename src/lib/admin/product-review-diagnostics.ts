type ReviewReadStage = "queue" | "review_listing_join" | "submission_columns" | "review_input" | "file_validation_columns";
type ReadFailure = { code?: string; message?: string };

// Only fixed categories, SQLSTATE/PostgREST codes, and HTTP status may leave
// this boundary. Never log the raw error, query, headers, record, or identity.
export function productReviewDiagnostic(stage: ReviewReadStage, error: ReadFailure | null, status?: number) {
  const message = error?.message ?? "";
  let category = error ? "unclassified" : "ok";
  if (/invalid api key/i.test(message)) category = "invalid_api_key";
  else if (/permission denied/i.test(message)) category = "permission_denied";
  else if (/column .* does not exist/i.test(message)) category = "missing_column";
  else if (/schema cache|could not find the table/i.test(message)) category = "schema_cache_or_missing_object";
  else if (/jwt|token.*expired/i.test(message)) category = "invalid_or_expired_authentication";
  else if (/fetch failed|abort|timeout/i.test(message)) category = "network_or_timeout";
  const code = /^(?:[A-Z0-9]{5}|PGRST\d{3})$/.test(error?.code ?? "") ? error!.code : null;
  return { stage, status: Number.isInteger(status) && status! >= 0 && status! <= 599 ? status : null, code, category };
}

const messages: Record<ReviewReadStage, string> = {
  queue: "Could not load the product review queue.",
  review_listing_join: "Could not load product review.",
  submission_columns: "Could not load submitted revision.",
  review_input: "Could not load submitted revision.",
  file_validation_columns: "Could not load validation summary.",
};

export function productReviewReadError(stage: ReviewReadStage, error: ReadFailure, status?: number): Error {
  const diagnostic = productReviewDiagnostic(stage, error, status);
  console.error("[product-review]", diagnostic);
  return new Error(diagnostic.category === "invalid_api_key"
    ? "Product review server API key was rejected. Verify SUPABASE_SERVICE_ROLE_KEY belongs to NEXT_PUBLIC_SUPABASE_URL."
    : messages[stage]);
}
