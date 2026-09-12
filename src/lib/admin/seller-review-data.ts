import type { SellerProfile, SellerStatus } from "@/types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SellerApplicantProfile {
  id: string;
  display_name: string | null;
  handle: string | null;
  avatar_url: string | null;
}

export interface SellerApplicationReviewRecord {
  id: string;
  seller_profile_id: string;
  review_type: "deterministic" | "ai" | "manual";
  status: "queued" | "running" | "completed" | "failed" | "superseded";
  risk_score: number | null;
  confidence: number | null;
  recommendation: "approve" | "hold" | "reject" | "no_action" | null;
  signals: unknown[];
  evidence_refs: unknown[];
  rationale: string | null;
  provider: string | null;
  model: string | null;
  model_version: string | null;
  policy_version: string;
  created_at: string;
  completed_at: string | null;
}

export interface SellerApplicationDecisionRecord {
  id: string;
  seller_profile_id: string;
  review_id: string | null;
  decision: "approve" | "reject" | "hold" | "reopen";
  from_status: SellerStatus;
  to_status: SellerStatus;
  public_reason: string | null;
  internal_reason: string | null;
  policy_version: string;
  created_at: string;
}

export type SellerReviewQueueProfile = Pick<
  SellerProfile,
  | "id"
  | "user_id"
  | "store_name"
  | "store_slug"
  | "store_description"
  | "logo_url"
  | "country_code"
  | "default_currency"
  | "status"
  | "created_at"
>;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function parseStoredSignalSummaries(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (
      typeof item === "object" &&
      item !== null &&
      "summary" in item &&
      typeof item.summary === "string"
    ) {
      return [item.summary];
    }

    return [];
  });
}
