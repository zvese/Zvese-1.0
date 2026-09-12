"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireSellerReviewer } from "@/lib/admin/authorization";
import { isUuid } from "@/lib/admin/seller-review-data";
import { dispatchSellerDecisionEmail } from "@/lib/email/seller-decision-email";

const SELLER_REVIEW_POLICY_VERSION = "seller-review-v1";
const SELLER_DECISIONS = ["approve", "reject", "hold"] as const;

type SellerDecision = (typeof SELLER_DECISIONS)[number];

function isSellerDecision(value: string): value is SellerDecision {
  return SELLER_DECISIONS.some((decision) => decision === value);
}

function redirectWithError(sellerProfileId: string, message: string): never {
  redirect(
    `/admin/sellers/${sellerProfileId}?error=${encodeURIComponent(message)}`
  );
}

function getDecisionId(value: unknown): string | null {
  const row = Array.isArray(value) ? value[0] : null;

  if (
    typeof row === "object" &&
    row !== null &&
    "decision_id" in row &&
    typeof row.decision_id === "string"
  ) {
    return row.decision_id;
  }

  return null;
}

function getRetryableDecisionId(value: unknown): string | null {
  const row = Array.isArray(value) ? value[0] : null;

  if (
    typeof row === "object" &&
    row !== null &&
    "decision_id" in row &&
    "can_retry" in row &&
    typeof row.decision_id === "string" &&
    row.can_retry === true
  ) {
    return row.decision_id;
  }

  return null;
}

export async function decideSellerApplication(formData: FormData) {
  const sellerProfileId = String(
    formData.get("seller_profile_id") ?? ""
  ).trim();
  const decisionValue = String(formData.get("decision") ?? "").trim();
  const publicReason = String(formData.get("public_reason") ?? "").trim();
  const internalReason = String(formData.get("internal_reason") ?? "").trim();
  const reviewIdValue = String(formData.get("review_id") ?? "").trim();

  if (!isUuid(sellerProfileId)) {
    redirect("/admin/sellers?error=Invalid seller application identifier.");
  }

  if (!isSellerDecision(decisionValue)) {
    redirectWithError(sellerProfileId, "Select a valid seller decision.");
  }

  if (reviewIdValue && !isUuid(reviewIdValue)) {
    redirectWithError(sellerProfileId, "Invalid review identifier.");
  }

  if (publicReason.length > 2000 || internalReason.length > 2000) {
    redirectWithError(
      sellerProfileId,
      "Public and internal reasons must not exceed 2,000 characters each."
    );
  }

  if (
    (decisionValue === "reject" || decisionValue === "hold") &&
    !publicReason
  ) {
    redirectWithError(
      sellerProfileId,
      `A creator-visible reason is required to ${decisionValue} this application.`
    );
  }

  const { supabase } = await requireSellerReviewer();
  const { data, error } = await supabase.rpc("decide_seller_application", {
    p_seller_profile_id: sellerProfileId,
    p_decision: decisionValue,
    p_review_id: reviewIdValue || null,
    p_public_reason:
      decisionValue === "reject" || decisionValue === "hold"
        ? publicReason
        : null,
    p_internal_reason: internalReason || null,
    p_policy_version: SELLER_REVIEW_POLICY_VERSION,
  });

  if (error) {
    const normalizedMessage = error.message.toLocaleLowerCase("en");

    if (normalizedMessage.includes("own seller application")) {
      redirectWithError(
        sellerProfileId,
        "You cannot review your own seller application."
      );
    }

    if (normalizedMessage.includes("only pending")) {
      redirectWithError(
        sellerProfileId,
        "This application is no longer pending. Refresh to see its current status."
      );
    }

    redirectWithError(
      sellerProfileId,
      "The seller decision could not be recorded. No status change was made."
    );
  }

  const decisionId = getDecisionId(data);

  if (decisionId) {
    await dispatchSellerDecisionEmail(supabase, decisionId);
  } else {
    console.error("[seller-email] Decision committed without a dispatch identifier.");
  }

  revalidatePath("/admin/sellers");
  revalidatePath(`/admin/sellers/${sellerProfileId}`);
  revalidatePath("/account");
  revalidatePath("/account/messages");
  revalidatePath("/creators/apply");

  const outcome =
    decisionValue === "approve"
      ? "approved"
      : decisionValue === "reject"
        ? "rejected"
        : "held for further review";

  redirect(
    `/admin/sellers/${sellerProfileId}?message=${encodeURIComponent(
      `Application ${outcome}.`
    )}`
  );
}

export async function retrySellerDecisionEmail(formData: FormData) {
  const sellerProfileId = String(
    formData.get("seller_profile_id") ?? ""
  ).trim();

  if (!isUuid(sellerProfileId)) {
    redirect("/admin/sellers?error=Invalid seller application identifier.");
  }

  const { supabase } = await requireSellerReviewer();
  const { data, error } = await supabase.rpc(
    "get_seller_decision_email_retry_state",
    { p_seller_profile_id: sellerProfileId }
  );

  if (error) {
    redirectWithError(
      sellerProfileId,
      "Could not verify the notification email retry state."
    );
  }

  const decisionId = getRetryableDecisionId(data);

  if (!decisionId) {
    redirectWithError(
      sellerProfileId,
      "This notification email is no longer available for retry."
    );
  }

  const deliveryStatus = await dispatchSellerDecisionEmail(
    supabase,
    decisionId
  );

  revalidatePath(`/admin/sellers/${sellerProfileId}`);

  if (deliveryStatus === "sent") {
    redirect(
      `/admin/sellers/${sellerProfileId}?message=${encodeURIComponent(
        "Notification email sent."
      )}`
    );
  }

  if (deliveryStatus === "failed") {
    redirectWithError(
      sellerProfileId,
      "Email delivery failed and remains available for retry."
    );
  }

  redirectWithError(
    sellerProfileId,
    "This notification email was already claimed or sent. Refresh and try again if needed."
  );
}
