export interface SourcingMediaReview {
  media_type: string;
  selected_role: string;
  review_status: string;
  rights_status: string;
  match_status: string;
  match_confidence: number;
  watermarked: boolean;
  synthetic: boolean;
}

// Keep aligned with the controlled media RPC and the database draft-approval gate.
export function canApproveSourcingMedia(media: SourcingMediaReview): boolean {
  return media.rights_status === "claimed_authorized" && media.match_status === "matched"
    && media.watermarked === false && media.synthetic === false
    && Number.isFinite(Number(media.match_confidence)) && Number(media.match_confidence) >= 0.6;
}

export function sourcingMediaApprovalBlocker(media: SourcingMediaReview[]): string | null {
  const selected = media.filter((item) => item.selected_role !== "none");
  if (!selected.some((item) => item.selected_role === "hero" && item.media_type === "image")) {
    return "An authorized hero image is required before draft approval. Request supplier media.";
  }
  if (selected.some((item) => item.review_status !== "approved" || !canApproveSourcingMedia(item))) {
    return "Approve the hero image and all selected gallery/video media before approving this draft.";
  }
  return null;
}
