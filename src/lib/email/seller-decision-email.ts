import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { sendEmailViaResend } from "@/lib/email/resend-http";

interface ClaimedSellerDecisionEmail {
  outboxId: string;
  claimToken: string;
  recipientEmail: string;
  subject: string;
  body: string;
}

export type SellerDecisionEmailDispatchStatus =
  | "sent"
  | "failed"
  | "not_claimed";

function parseClaimedEmail(value: unknown): ClaimedSellerDecisionEmail | null {
  const row = Array.isArray(value) ? value[0] : null;

  if (
    typeof row !== "object" ||
    row === null ||
    !("outbox_id" in row) ||
    !("email_claim_token" in row) ||
    !("recipient_email" in row) ||
    !("email_subject" in row) ||
    !("email_body" in row) ||
    typeof row.outbox_id !== "string" ||
    typeof row.email_claim_token !== "string" ||
    typeof row.recipient_email !== "string" ||
    typeof row.email_subject !== "string" ||
    typeof row.email_body !== "string"
  ) {
    return null;
  }

  return {
    outboxId: row.outbox_id,
    claimToken: row.email_claim_token,
    recipientEmail: row.recipient_email,
    subject: row.email_subject,
    body: row.email_body,
  };
}

async function markFailed(
  supabase: SupabaseClient,
  claimedEmail: ClaimedSellerDecisionEmail,
  safeError: string
): Promise<void> {
  const { error } = await supabase.rpc("mark_seller_decision_email_failed", {
    p_outbox_id: claimedEmail.outboxId,
    p_claim_token: claimedEmail.claimToken,
    p_last_error: safeError,
  });

  if (error) {
    console.error("[seller-email] Could not mark the claimed email as failed.");
  }
}

export async function dispatchSellerDecisionEmail(
  supabase: SupabaseClient,
  decisionId: string
): Promise<SellerDecisionEmailDispatchStatus> {
  try {
    const { data, error } = await supabase.rpc("claim_seller_decision_email", {
      p_decision_id: decisionId,
    });

    if (error) {
      console.error("[seller-email] Could not claim the decision email event.");
      return "not_claimed";
    }

    const claimedEmail = parseClaimedEmail(data);

    if (!claimedEmail) {
      return "not_claimed";
    }

    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from = process.env.ZVESE_EMAIL_FROM?.trim();

    if (!apiKey || !from) {
      const safeError = "Transactional email configuration is missing.";
      console.error(`[seller-email] ${safeError}`);
      await markFailed(supabase, claimedEmail, safeError);
      return "failed";
    }

    const delivery = await sendEmailViaResend({
      apiKey,
      from,
      to: claimedEmail.recipientEmail,
      subject: claimedEmail.subject,
      text: claimedEmail.body,
      idempotencyKey: `seller-decision-${claimedEmail.outboxId}`,
    });

    if (!delivery.ok) {
      console.error(`[seller-email] ${delivery.safeError}`);
      await markFailed(supabase, claimedEmail, delivery.safeError);
      return "failed";
    }

    const { error: markSentError } = await supabase.rpc(
      "mark_seller_decision_email_sent",
      {
        p_outbox_id: claimedEmail.outboxId,
        p_claim_token: claimedEmail.claimToken,
        p_provider_message_id: delivery.providerMessageId,
      }
    );

    if (markSentError) {
      console.error("[seller-email] Delivery succeeded but sent state was not recorded.");
      return "failed";
    }

    return "sent";
  } catch {
    console.error("[seller-email] Unexpected email dispatch failure.");
    return "failed";
  }
}
