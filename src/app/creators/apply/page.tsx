import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { applyForSellerProfile } from "@/app/creators/apply/actions";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { COUNTRY_OPTIONS, CURRENCY_OPTIONS } from "@/config/marketplace-options";
import {
  getCurrentSellerDecisionNotice,
  getCurrentSellerProfile,
} from "@/lib/marketplace/sellers";
import { createClient } from "@/lib/supabase/server";
import { signInPath } from "@/lib/auth/redirects";
import { BackButton } from "@/components/navigation/back-button";

export const metadata: Metadata = {
  title: "Apply to Sell | Creators",
  description: "Apply for a creator and seller store on Zvese.",
};

export default async function ApplyPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(signInPath("/creators/apply", "Please sign in to apply as a seller."));
  }

  const { data: sellerProfile } = await getCurrentSellerProfile();
  const { data: sellerDecision } =
    sellerProfile
      ? await getCurrentSellerDecisionNotice()
      : { data: null };
  const { error } = await searchParams;

  // If user already has an existing seller profile
  if (sellerProfile) {
    if (sellerProfile.status === "pending") {
      return (
        <section className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
          <div className="rounded-2xl border border-border bg-card p-8 shadow-xs">
            <div className="inline-flex rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground">
              {sellerDecision?.decision === "hold" ? "Held" : "Under Review"}
            </div>
            <h1 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
              {sellerDecision?.decision === "hold"
                ? "Application Held for Review"
                : "Application Under Review"}
            </h1>
            <p className="mt-3 text-muted-foreground leading-relaxed">
              Your application for <strong>{sellerProfile.store_name}</strong> (
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                {sellerProfile.store_slug}
              </code>
              ){" "}
              {sellerDecision?.decision === "hold"
                ? "requires further review by the Zvese administration team."
                : "has been received and is currently being reviewed by the Zvese administration team."}
            </p>
            {sellerDecision?.decision === "hold" &&
            sellerDecision.public_reason ? (
              <div className="mt-5 rounded-xl border border-border bg-background/70 p-4 text-sm">
                <p className="font-semibold">Reason</p>
                <p className="mt-2 leading-relaxed text-muted-foreground">
                  {sellerDecision.public_reason}
                </p>
              </div>
            ) : null}
            <p className="mt-4 text-sm text-muted-foreground">
              Once approved, you will be able to create and publish products on
              the marketplace.
            </p>
            <div className="mt-8 flex gap-4">
              <Button asChild variant="outline">
                <Link href="/account">Go to Account</Link>
              </Button>
              <Button asChild>
                <Link href="/marketplace">Explore Marketplace</Link>
              </Button>
            </div>
          </div>
        </section>
      );
    }

    if (sellerProfile.status === "active") {
      return (
        <section className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
          <div className="rounded-2xl border border-border bg-card p-8 shadow-xs">
            <div className="inline-flex rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              Approved
            </div>
            <h1 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
              Application Approved
            </h1>
            <p className="mt-3 text-muted-foreground leading-relaxed">
              Your Zvese seller application for{" "}
              <strong>{sellerProfile.store_name}</strong> has been approved. Your
              seller account is active.
            </p>
            <div className="mt-8 flex gap-4">
              <Button asChild>
                <Link href="/account/listings/new">Create a listing</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/account">Account Dashboard</Link>
              </Button>
            </div>
          </div>
        </section>
      );
    }

    if (sellerProfile.status === "rejected") {
      return (
        <section className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
          <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-8 shadow-xs">
            <div className="inline-flex rounded-full bg-destructive/10 px-3 py-1 text-xs font-semibold text-destructive">
              Rejected
            </div>
            <h1 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
              Application Not Approved
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Your seller application for{" "}
              <strong>{sellerProfile.store_name}</strong> was not approved. This
              page will not create a duplicate application or reactivate the
              seller profile.
            </p>
            {sellerDecision?.public_reason ? (
              <div className="mt-5 rounded-xl border border-border bg-background/70 p-4 text-sm">
                <p className="font-semibold">Reason</p>
                <p className="mt-2 leading-relaxed text-muted-foreground">
                  {sellerDecision.public_reason}
                </p>
              </div>
            ) : null}
            <p className="mt-4 text-sm text-muted-foreground">
              Contact Zvese support for clarification. Reapplication and appeals
              will be introduced through a separate reviewed policy.
            </p>
            <div className="mt-6">
              <Button asChild variant="outline">
                <Link href="/account">Return to Account</Link>
              </Button>
            </div>
          </div>
        </section>
      );
    }

    // Suspended or Closed
    return (
      <section className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-8 shadow-xs">
          <div className="inline-flex rounded-full bg-destructive/10 px-3 py-1 text-xs font-semibold text-destructive">
            {sellerProfile.status.toUpperCase()}
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
            Seller Account {sellerProfile.status}
          </h1>
          <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
            Your seller profile for <strong>{sellerProfile.store_name}</strong> is
            currently {sellerProfile.status}. Please contact Zvese support for
            assistance.
          </p>
          <div className="mt-6">
            <Button asChild variant="outline">
              <Link href="/account">Return to Account</Link>
            </Button>
          </div>
        </div>
      </section>
    );
  }

  // User has no seller profile -> Show application form
  return (
    <section className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <BackButton fallback="/creators" />
      <div className="mb-8">
        <p className="text-sm font-medium text-primary">Zvese Creator Program</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          Apply to become a seller
        </h1>
        <p className="mt-3 text-muted-foreground">
          Launch your store on Zvese&apos;s zero-inventory global marketplace.
          Reach customers worldwide.
        </p>
      </div>

      {error ? (
        <div className="mb-6 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <form
        action={applyForSellerProfile}
        className="space-y-6 rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-xs"
      >
        <div>
          <label htmlFor="store_name" className="block text-sm font-medium">
            Store name <span className="text-destructive">*</span>
          </label>
          <input
            id="store_name"
            name="store_name"
            type="text"
            required
            minLength={2}
            maxLength={160}
            placeholder="e.g. Apex Artisans"
            className="mt-2 w-full rounded-md border border-input bg-background px-3.5 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            The public display name for your brand or store (2–160 characters).
          </p>
        </div>

        <div>
          <label htmlFor="store_slug" className="block text-sm font-medium">
            Store handle / slug <span className="text-destructive">*</span>
          </label>
          <input
            id="store_slug"
            name="store_slug"
            type="text"
            required
            minLength={2}
            maxLength={160}
            pattern="^(?!.*\.\.)[a-z0-9_](?:[a-z0-9._]*[a-z0-9_])?$"
            placeholder="e.g. apex.artisans"
            className="mt-2 w-full rounded-md border border-input bg-background px-3.5 py-2.5 text-sm font-mono outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            Use 2–160 lowercase letters, numbers, periods, or underscores. Periods
            cannot be first, last, or consecutive.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <label htmlFor="country_code" className="block text-sm font-medium">
              Country
            </label>
            <SearchableSelect
              id="country_code"
              name="country_code"
              options={COUNTRY_OPTIONS}
              placeholder="Select country..."
              searchPlaceholder="Search countries..."
              noResultsText="No countries or territories found."
              clearable
              className="mt-2"
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Primary country of operation.
            </p>
          </div>

          <div>
            <label
              htmlFor="default_currency"
              className="block text-sm font-medium"
            >
              Default currency <span className="text-destructive">*</span>
            </label>
            <SearchableSelect
              id="default_currency"
              name="default_currency"
              options={CURRENCY_OPTIONS}
              placeholder="Select currency..."
              searchPlaceholder="Search currencies..."
              noResultsText="No currencies found."
              required
              className="mt-2"
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Currency used for your product listings.
            </p>
          </div>
        </div>

        <div>
          <label
            htmlFor="store_description"
            className="block text-sm font-medium"
          >
            Store description
          </label>
          <textarea
            id="store_description"
            name="store_description"
            rows={4}
            maxLength={1000}
            placeholder="Tell buyers what you create and what makes your products unique..."
            className="mt-2 w-full rounded-md border border-input bg-background px-3.5 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            Optional summary shown on your store profile.
          </p>
        </div>

        <div className="pt-2">
          <Button type="submit" size="lg" className="w-full sm:w-auto">
            Submit Application
          </Button>
        </div>
      </form>
    </section>
  );
}
