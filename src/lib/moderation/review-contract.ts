export const SELLER_REVIEW_TYPES = ["deterministic", "ai", "manual"] as const;
export const SELLER_REVIEW_RECOMMENDATIONS = [
  "approve",
  "hold",
  "reject",
  "no_action",
] as const;

export type SellerReviewType = (typeof SELLER_REVIEW_TYPES)[number];
export type SellerReviewRecommendation =
  (typeof SELLER_REVIEW_RECOMMENDATIONS)[number];

export type SellerReviewSignalSeverity = "low" | "medium" | "high";

export interface SellerReviewSignal {
  code: string;
  severity: SellerReviewSignalSeverity;
  score: number;
  summary: string;
  matchedSellerProfileId?: string;
}

export interface SellerReviewEvidenceReference {
  kind: "seller_profile" | "profile" | "listing" | "product" | "image";
  referenceId: string;
  summary: string;
}

/**
 * Structured contract for future deterministic, AI, and manual assessments.
 * This data is advisory. Only the trusted seller-decision RPC can change status.
 */
export interface StructuredSellerReview {
  reviewType: SellerReviewType;
  riskScore: number;
  confidence: number;
  recommendation: SellerReviewRecommendation;
  signals: SellerReviewSignal[];
  evidenceReferences: SellerReviewEvidenceReference[];
  rationale: string;
  provider: string | null;
  model: string | null;
  modelVersion: string | null;
  policyVersion: string;
}

export function isUnitInterval(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}
