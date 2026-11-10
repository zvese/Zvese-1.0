import type { Metadata } from "next";
import Link from "next/link";
import { AlertCircleIcon, ScanSearchIcon, ShieldCheckIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { requireSellerReviewer } from "@/lib/admin/authorization";
import type {
  SellerApplicantProfile,
  SellerApplicationReviewRecord,
  SellerReviewQueueProfile,
} from "@/lib/admin/seller-review-data";
import {
  buildDeterministicBrandSignals,
  type BrandSignalSubject,
} from "@/lib/moderation/brand-signals";

export const metadata: Metadata = {
  title: "Seller Reviews | Admin",
  description: "Review pending Zvese seller applications.",
};

function formatApplicationDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function AdminSellerQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { supabase, membership } = await requireSellerReviewer("/admin/sellers");
  const { error: pageError } = await searchParams;

  const { data: sellerRows, error: sellerError } = await supabase
    .from("seller_profiles")
    .select(
      "id, user_id, store_name, store_slug, store_description, logo_url, country_code, default_currency, status, created_at"
    )
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (sellerError) {
    throw new Error("Could not load the pending seller review queue.");
  }

  const sellers = (sellerRows ?? []) as SellerReviewQueueProfile[];
  const sellerIds = sellers.map((seller) => seller.id);
  const applicantIds = sellers.map((seller) => seller.user_id);

  const [profilesResult, reviewsResult, comparisonResult] = await Promise.all([
    applicantIds.length > 0
      ? supabase
          .from("profiles")
          .select("id, display_name, handle, avatar_url")
          .in("id", applicantIds)
      : Promise.resolve({ data: [], error: null }),
    sellerIds.length > 0
      ? supabase
          .from("seller_application_reviews")
          .select(
            "id, seller_profile_id, review_type, status, risk_score, confidence, recommendation, signals, evidence_refs, rationale, provider, model, model_version, policy_version, created_at, completed_at"
          )
          .in("seller_profile_id", sellerIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    sellers.length > 0
      ? supabase
          .from("seller_profiles")
          .select("id, store_name, store_slug")
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (profilesResult.error || reviewsResult.error || comparisonResult.error) {
    throw new Error("Could not load seller review context.");
  }

  const applicantProfiles = (profilesResult.data ?? []) as SellerApplicantProfile[];
  const reviews = (reviewsResult.data ?? []) as SellerApplicationReviewRecord[];
  const comparisonSubjects = (comparisonResult.data ?? []).map((candidate) => ({
    id: String(candidate.id),
    storeName: String(candidate.store_name),
    storeSlug: String(candidate.store_slug),
  })) satisfies BrandSignalSubject[];

  const applicantById = new Map(
    applicantProfiles.map((profile) => [profile.id, profile])
  );
  const latestReviewBySeller = new Map<string, SellerApplicationReviewRecord>();

  for (const review of reviews) {
    if (!latestReviewBySeller.has(review.seller_profile_id)) {
      latestReviewBySeller.set(review.seller_profile_id, review);
    }
  }

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-medium text-primary">Zvese administration</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">
            Pending seller reviews
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Review applications, advisory brand-similarity signals, and recorded
            assessments before making an auditable decision.
          </p>
        </div>
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground">
          <ShieldCheckIcon className="size-4 text-primary" />
          {membership.role.replace("_", " ")}
        </div>
      </div>

      {pageError ? (
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircleIcon className="size-5 shrink-0" />
          <p>{pageError}</p>
        </div>
      ) : null}

      <div className="mt-8 space-y-4">
        {sellers.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-10 text-center shadow-xs">
            <ShieldCheckIcon className="mx-auto size-9 text-primary" />
            <h2 className="mt-4 text-lg font-semibold">No pending applications</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The seller review queue is currently clear.
            </p>
          </div>
        ) : (
          sellers.map((seller) => {
            const applicant = applicantById.get(seller.user_id);
            const latestReview = latestReviewBySeller.get(seller.id);
            const deterministicSignals = buildDeterministicBrandSignals(
              {
                id: seller.id,
                storeName: seller.store_name,
                storeSlug: seller.store_slug,
              },
              comparisonSubjects
            );

            return (
              <article
                key={seller.id}
                className="rounded-2xl border border-border bg-card p-5 shadow-xs sm:p-6"
              >
                <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-lg font-semibold">
                        {seller.store_name}
                      </h2>
                      <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                        {seller.status}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-sm text-muted-foreground">
                      @{seller.store_slug}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        Applicant: {applicant?.display_name || applicant?.handle || "Profile available"}
                      </span>
                      <span>Country: {seller.country_code ?? "Not provided"}</span>
                      <span>Currency: {seller.default_currency}</span>
                      <span>Applied: {formatApplicationDate(seller.created_at)}</span>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col items-start gap-3 sm:flex-row sm:items-center">
                    <div className="text-xs text-muted-foreground">
                      <div className="flex items-center gap-1.5 font-medium text-foreground">
                        <ScanSearchIcon className="size-4 text-primary" />
                        {deterministicSignals.length} candidate signal
                        {deterministicSignals.length === 1 ? "" : "s"}
                      </div>
                      <p className="mt-1">
                        {latestReview
                          ? `Latest stored review: ${latestReview.status}`
                          : "No stored review yet"}
                      </p>
                    </div>
                    <Button asChild>
                      <Link href={`/admin/sellers/${seller.id}`}>Review</Link>
                    </Button>
                  </div>
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
