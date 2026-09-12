import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  CheckCircle2Icon,
  MailWarningIcon,
  ScanSearchIcon,
  ShieldAlertIcon,
} from "lucide-react";

import {
  decideSellerApplication,
  retrySellerDecisionEmail,
} from "@/app/admin/sellers/actions";
import { Button } from "@/components/ui/button";
import { requireSellerReviewer } from "@/lib/admin/authorization";
import type {
  SellerApplicantProfile,
  SellerApplicationDecisionRecord,
  SellerApplicationReviewRecord,
  SellerReviewQueueProfile,
} from "@/lib/admin/seller-review-data";
import {
  isUuid,
  parseStoredSignalSummaries,
} from "@/lib/admin/seller-review-data";
import {
  buildDeterministicBrandSignals,
  type BrandSignalSubject,
} from "@/lib/moderation/brand-signals";

export const metadata: Metadata = {
  title: "Seller Application Review | Admin",
  description: "Review and decide a Zvese seller application.",
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function hasRetryableEmail(value: unknown): boolean {
  const row = Array.isArray(value) ? value[0] : null;

  return (
    typeof row === "object" &&
    row !== null &&
    "can_retry" in row &&
    row.can_retry === true
  );
}

export default async function AdminSellerReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ message?: string; error?: string }>;
}) {
  const { id } = await params;
  const { message, error: pageError } = await searchParams;
  const { supabase, user } = await requireSellerReviewer();

  if (!isUuid(id)) {
    notFound();
  }

  const { data: sellerRow, error: sellerError } = await supabase
    .from("seller_profiles")
    .select(
      "id, user_id, store_name, store_slug, store_description, logo_url, country_code, default_currency, status, created_at"
    )
    .eq("id", id)
    .maybeSingle();

  if (sellerError) {
    throw new Error("Could not load this seller application.");
  }

  if (!sellerRow) {
    notFound();
  }

  const seller = sellerRow as SellerReviewQueueProfile;

  const [profileResult, reviewsResult, decisionsResult, comparisonResult] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, display_name, handle, avatar_url")
        .eq("id", seller.user_id)
        .maybeSingle(),
      supabase
        .from("seller_application_reviews")
        .select(
          "id, seller_profile_id, review_type, status, risk_score, confidence, recommendation, signals, evidence_refs, rationale, provider, model, model_version, policy_version, created_at, completed_at"
        )
        .eq("seller_profile_id", seller.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("seller_application_decisions")
        .select(
          "id, seller_profile_id, review_id, decision, from_status, to_status, public_reason, internal_reason, policy_version, created_at"
        )
        .eq("seller_profile_id", seller.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("seller_profiles")
        .select("id, store_name, store_slug"),
    ]);

  if (
    profileResult.error ||
    reviewsResult.error ||
    decisionsResult.error ||
    comparisonResult.error
  ) {
    throw new Error("Could not load seller review context.");
  }

  const applicant = profileResult.data as SellerApplicantProfile | null;
  const reviews = (reviewsResult.data ?? []) as SellerApplicationReviewRecord[];
  const decisions = (decisionsResult.data ?? []) as SellerApplicationDecisionRecord[];
  const emailRetryResult =
    decisions.length > 0
      ? await supabase.rpc("get_seller_decision_email_retry_state", {
          p_seller_profile_id: seller.id,
        })
      : { data: [], error: null };

  if (emailRetryResult.error) {
    throw new Error("Could not load notification email status.");
  }

  const canRetryNotificationEmail = hasRetryableEmail(emailRetryResult.data);
  const comparisonSubjects = (comparisonResult.data ?? []).map((candidate) => ({
    id: String(candidate.id),
    storeName: String(candidate.store_name),
    storeSlug: String(candidate.store_slug),
  })) satisfies BrandSignalSubject[];
  const signals = buildDeterministicBrandSignals(
    {
      id: seller.id,
      storeName: seller.store_name,
      storeSlug: seller.store_slug,
    },
    comparisonSubjects
  );
  const isSelfReview = seller.user_id === user.id;

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
      <Button asChild variant="ghost" size="sm">
        <Link href="/admin/sellers">
          <ArrowLeftIcon className="size-4" />
          Pending queue
        </Link>
      </Button>

      {message ? (
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-primary/20 bg-accent p-4 text-sm text-accent-foreground">
          <CheckCircle2Icon className="size-5 shrink-0 text-primary" />
          <p>{message}</p>
        </div>
      ) : null}

      {pageError ? (
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircleIcon className="size-5 shrink-0" />
          <p>{pageError}</p>
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <article className="rounded-2xl border border-border bg-card p-6 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-5">
              <div>
                <p className="text-sm font-medium text-primary">Seller application</p>
                <h1 className="mt-1 text-3xl font-bold tracking-tight">
                  {seller.store_name}
                </h1>
                <p className="mt-1 font-mono text-sm text-muted-foreground">
                  @{seller.store_slug}
                </p>
              </div>
              <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                {seller.status}
              </span>
            </div>

            <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Applicant</dt>
                <dd className="mt-1 font-medium">
                  {applicant?.display_name || "Display name not provided"}
                </dd>
                {applicant?.handle ? (
                  <dd className="font-mono text-xs text-muted-foreground">
                    @{applicant.handle}
                  </dd>
                ) : null}
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Applied</dt>
                <dd className="mt-1 font-medium">
                  {formatDate(seller.created_at)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Country</dt>
                <dd className="mt-1 font-medium">
                  {seller.country_code ?? "Not provided"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Currency</dt>
                <dd className="mt-1 font-medium">{seller.default_currency}</dd>
              </div>
            </dl>

            <div className="mt-5 border-t border-border pt-5">
              <h2 className="text-sm font-semibold">Store description</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                {seller.store_description || "No description was provided."}
              </p>
            </div>
          </article>

          <article className="rounded-2xl border border-border bg-card p-6 shadow-xs">
            <div className="flex items-center gap-2">
              <ScanSearchIcon className="size-5 text-primary" />
              <h2 className="text-lg font-semibold">Review signals</h2>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              These are candidate similarity signals, not findings of copying or
              legal infringement. Review the underlying identity and context.
            </p>

            <div className="mt-5 space-y-3">
              {signals.length === 0 ? (
                <p className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                  No deterministic name or handle similarity candidates were found.
                </p>
              ) : (
                signals.map((signal, index) => (
                  <div
                    key={`${signal.code}-${signal.matchedSellerProfileId}-${index}`}
                    className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4"
                  >
                    <div className="flex flex-wrap justify-between gap-2 text-sm">
                      <span className="font-semibold">{signal.summary}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        score {signal.score.toFixed(2)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
                      {signal.code.replaceAll("_", " ")} · {signal.severity}
                    </p>
                  </div>
                ))
              )}
            </div>

            {reviews.length > 0 ? (
              <div className="mt-6 border-t border-border pt-5">
                <h3 className="text-sm font-semibold">Stored assessments</h3>
                <div className="mt-3 space-y-3">
                  {reviews.map((review) => {
                    const summaries = parseStoredSignalSummaries(review.signals);

                    return (
                      <div key={review.id} className="rounded-xl border border-border p-4 text-sm">
                        <div className="flex flex-wrap justify-between gap-2">
                          <span className="font-medium">
                            {review.review_type} · {review.status}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatDate(review.created_at)}
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Recommendation: {review.recommendation ?? "none"} · Policy: {review.policy_version}
                        </p>
                        {review.rationale ? (
                          <p className="mt-2 text-muted-foreground">{review.rationale}</p>
                        ) : null}
                        {summaries.length > 0 ? (
                          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                            {summaries.map((summary) => (
                              <li key={summary}>{summary}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </article>

          {decisions.length > 0 ? (
            <article className="rounded-2xl border border-border bg-card p-6 shadow-xs">
              <h2 className="text-lg font-semibold">Decision history</h2>
              <div className="mt-4 space-y-3">
                {decisions.map((decision) => (
                  <div key={decision.id} className="rounded-xl border border-border p-4 text-sm">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="font-semibold capitalize">{decision.decision}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(decision.created_at)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {decision.from_status} → {decision.to_status} · {decision.policy_version}
                    </p>
                    {decision.public_reason ? (
                      <p className="mt-2">Public: {decision.public_reason}</p>
                    ) : null}
                    {decision.internal_reason ? (
                      <p className="mt-2 text-muted-foreground">
                        Internal: {decision.internal_reason}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </article>
          ) : null}
        </div>

        <aside className="h-fit rounded-2xl border border-border bg-card p-6 shadow-xs lg:sticky lg:top-24">
          <h2 className="text-lg font-semibold">Decision</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Every decision is recorded immutably. Only pending applications can
            be approved, rejected, or held.
          </p>

          {canRetryNotificationEmail && !isSelfReview ? (
            <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
                <MailWarningIcon className="size-4" />
                Notification email needs attention
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                The seller decision is already recorded. Retrying sends only
                the existing notification email and does not create another
                decision or message.
              </p>
              <form action={retrySellerDecisionEmail} className="mt-3">
                <input
                  type="hidden"
                  name="seller_profile_id"
                  value={seller.id}
                />
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  className="w-full"
                >
                  Retry notification email
                </Button>
              </form>
            </div>
          ) : null}

          {isSelfReview ? (
            <div className="mt-5 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              <div className="flex items-center gap-2 font-semibold">
                <ShieldAlertIcon className="size-4" />
                Self-review blocked
              </div>
              <p className="mt-2">
                Another authorized administrator must review this application.
              </p>
            </div>
          ) : seller.status !== "pending" ? (
            <p className="mt-5 rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
              This application is {seller.status} and cannot receive a normal
              pending decision.
            </p>
          ) : (
            <div className="mt-5 space-y-5">
              <form action={decideSellerApplication}>
                <input type="hidden" name="seller_profile_id" value={seller.id} />
                <input type="hidden" name="decision" value="approve" />
                <label htmlFor="approve-reason" className="text-sm font-medium">
                  Optional internal approval note
                </label>
                <textarea
                  id="approve-reason"
                  name="internal_reason"
                  maxLength={2000}
                  rows={3}
                  className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <Button type="submit" className="mt-3 w-full">
                  Approve seller
                </Button>
              </form>

              <form action={decideSellerApplication} className="border-t border-border pt-5">
                <input type="hidden" name="seller_profile_id" value={seller.id} />
                <input type="hidden" name="decision" value="hold" />
                <label htmlFor="hold-reason" className="text-sm font-medium">
                  Creator-visible hold reason <span className="text-destructive">*</span>
                </label>
                <textarea
                  id="hold-reason"
                  name="public_reason"
                  required
                  maxLength={2000}
                  rows={3}
                  className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <label
                  htmlFor="hold-internal-reason"
                  className="mt-3 block text-sm font-medium"
                >
                  Optional internal note
                </label>
                <textarea
                  id="hold-internal-reason"
                  name="internal_reason"
                  maxLength={2000}
                  rows={3}
                  className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <Button type="submit" variant="outline" className="mt-3 w-full">
                  Hold for review
                </Button>
              </form>

              <form action={decideSellerApplication} className="border-t border-border pt-5">
                <input type="hidden" name="seller_profile_id" value={seller.id} />
                <input type="hidden" name="decision" value="reject" />
                <label htmlFor="reject-reason" className="text-sm font-medium">
                  Public rejection reason <span className="text-destructive">*</span>
                </label>
                <textarea
                  id="reject-reason"
                  name="public_reason"
                  required
                  maxLength={2000}
                  rows={4}
                  className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <label
                  htmlFor="reject-internal-reason"
                  className="mt-3 block text-sm font-medium"
                >
                  Optional internal note
                </label>
                <textarea
                  id="reject-internal-reason"
                  name="internal_reason"
                  maxLength={2000}
                  rows={3}
                  className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <Button type="submit" variant="destructive" className="mt-3 w-full">
                  Reject application
                </Button>
              </form>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
