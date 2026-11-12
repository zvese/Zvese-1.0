import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ClockIcon,
  MailIcon,
  PlusIcon,
  ShieldAlertIcon,
  StoreIcon,
} from "lucide-react";

import { signOut } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import { signInPath } from "@/lib/auth/redirects";
import {
  getCurrentSellerDecisionNotice,
  getCurrentSellerProfile,
} from "@/lib/marketplace/sellers";
import { createClient } from "@/lib/supabase/server";
import { getPageUser } from "@/lib/auth/page-user";

export const metadata: Metadata = {
  title: "Account",
  description: "Manage your Zvese account and seller profile.",
};

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string; error?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getPageUser();

  if (!user) {
    redirect(signInPath("/account", "Please sign in to continue."));
  }

  const [unread, profileResult, sellerResult] = await Promise.all([supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .is("read_at", null),
    supabase
    .from("profiles")
    .select("display_name, handle, bio, avatar_url")
    .eq("id", user.id)
    .maybeSingle(), getCurrentSellerProfile()]);
  const { count: unreadCount, error: unreadCountError } = unread;
  const { data: profile } = profileResult;
  const { data: sellerProfile } = sellerResult;
  const { data: sellerDecision } =
    sellerProfile
      ? await getCurrentSellerDecisionNotice()
      : { data: null };
  const { message, error } = await searchParams;

  const displayName = profile?.display_name || user.email?.split("@")[0] || "User";

  return (
    <section className="mx-auto w-full max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
      {/* Feedback alerts */}
      {message ? (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-primary/20 bg-accent p-4 text-sm text-accent-foreground">
          <CheckCircle2Icon className="size-5 shrink-0 text-primary" />
          <p>{message}</p>
        </div>
      ) : null}

      {error ? (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircleIcon className="size-5 shrink-0" />
          <p>{error}</p>
        </div>
      ) : null}

      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <p className="text-sm font-medium text-primary">Your Zvese account</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">
            Welcome, {displayName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{user.email}</p>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm"><Link href="/account/orders">Your orders</Link></Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/account/messages">
              <MailIcon className="size-4" />
              Messages
              {!unreadCountError && unreadCount !== null && unreadCount > 0 ? (
                <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-xs font-semibold tabular-nums text-primary-foreground">
                  {unreadCount}
                  <span className="sr-only"> unread</span>
                </span>
              ) : null}
            </Link>
          </Button>
          {unreadCountError ? (
            <span className="text-xs text-muted-foreground" role="status">
              Unread count unavailable
            </span>
          ) : null}
          <form action={signOut}>
            <Button type="submit" variant="outline" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </div>

      <div className="mt-10 grid gap-8">
        {/* Seller / Creator Status Card */}
        <div id="seller-dashboard" className="scroll-mt-24 rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-xs">
          <div className="flex items-center justify-between border-b border-border pb-5">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <StoreIcon className="size-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-foreground">
                  Seller & Creator Status
                </h2>
                <p className="text-xs text-muted-foreground">
                  Zero-inventory marketplace merchant profile
                </p>
              </div>
            </div>

            {sellerProfile ? (
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wider ${
                  sellerProfile.status === "active"
                    ? "bg-primary/10 text-primary"
                    : sellerProfile.status === "pending"
                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                    : "bg-destructive/10 text-destructive"
                }`}
              >
                {sellerProfile.status}
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                Not Enrolled
              </span>
            )}
          </div>

          <div className="mt-6">
            {!sellerProfile ? (
              <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
                <div className="max-w-xl">
                  <h3 className="font-semibold text-foreground">
                    Start selling on Zvese
                  </h3>
                  <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                    You do not have an active seller profile. Apply to launch
                    your creator store, publish products, and reach buyers
                    worldwide.
                  </p>
                </div>
                <Button asChild className="shrink-0">
                  <Link href="/creators/apply">Apply to become a seller</Link>
                </Button>
              </div>
            ) : sellerProfile.status === "pending" ? (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5 text-sm">
                <div className="flex items-center gap-2 font-semibold text-amber-700 dark:text-amber-400">
                  <ClockIcon className="size-4 shrink-0" />
                  <span>
                    {sellerDecision?.decision === "hold"
                      ? "Application Held for Review"
                      : "Application Under Review"}
                  </span>
                </div>
                <p className="mt-2 leading-relaxed text-muted-foreground">
                  Your seller application for{" "}
                  <strong className="text-foreground">
                    {sellerProfile.store_name}
                  </strong>{" "}
                  (
                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                    {sellerProfile.store_slug}
                  </code>
                  ){" "}
                  {sellerDecision?.decision === "hold"
                    ? "requires further review by Zvese administration."
                    : "is currently being reviewed by Zvese administration. You will be notified once a decision is made."}
                </p>
                {sellerDecision?.decision === "hold" &&
                sellerDecision.public_reason ? (
                  <div className="mt-4 rounded-lg border border-border bg-background/60 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-foreground">
                      Reason
                    </p>
                    <p className="mt-1.5 leading-relaxed text-muted-foreground">
                      {sellerDecision.public_reason}
                    </p>
                  </div>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
                  <div>
                    <span className="font-medium text-foreground">Currency:</span>{" "}
                    {sellerProfile.default_currency}
                  </div>
                  {sellerProfile.country_code ? (
                    <div>
                      <span className="font-medium text-foreground">Country:</span>{" "}
                      {sellerProfile.country_code}
                    </div>
                  ) : null}
                  <div>
                    <span className="font-medium text-foreground">Applied on:</span>{" "}
                    {new Date(sellerProfile.created_at).toLocaleDateString()}
                  </div>
                </div>
              </div>
            ) : sellerProfile.status === "active" ? (
              <div>
                <div className="mb-5 rounded-xl border border-primary/20 bg-primary/5 p-4">
                  <div className="flex items-center gap-2 font-semibold text-primary">
                    <CheckCircle2Icon className="size-4 shrink-0" />
                    <span>Application Approved</span>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    Your Zvese seller application has been approved. Your seller
                    account is active.
                  </p>
                </div>
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                  <div>
                    <h3 className="text-base font-bold text-foreground">
                      {sellerProfile.store_name}
                    </h3>
                    <p className="mt-0.5 text-xs font-mono text-muted-foreground">
                      zvese.com/creators/{sellerProfile.store_slug}
                    </p>
                    {sellerProfile.store_description ? (
                      <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
                        {sellerProfile.store_description}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-3 shrink-0">
                    <Button asChild size="sm">
                      <Link href="/account/listings/new">
                        <PlusIcon className="size-4" />
                        Add product
                      </Link>
                    </Button>
                    <Button asChild variant="outline" size="sm">
                      <Link href="/marketplace">Marketplace</Link>
                    </Button>
                    <Button asChild variant="outline" size="sm"><Link href="/account/orders/sales">Your sales</Link></Button>
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-4 border-t border-border/60 pt-4 sm:grid-cols-3 text-xs text-muted-foreground">
                  <div>
                    <span className="font-medium text-foreground">Default Currency:</span>{" "}
                    {sellerProfile.default_currency}
                  </div>
                  <div>
                    <span className="font-medium text-foreground">Country:</span>{" "}
                    {sellerProfile.country_code ?? "Global"}
                  </div>
                  <div>
                    <span className="font-medium text-foreground">Member Since:</span>{" "}
                    {new Date(sellerProfile.created_at).toLocaleDateString()}
                  </div>
                </div>
              </div>
            ) : sellerProfile.status === "rejected" ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-sm">
                <div className="flex items-center gap-2 font-semibold text-destructive">
                  <ShieldAlertIcon className="size-4 shrink-0" />
                  <span>Application Not Approved</span>
                </div>
                <p className="mt-2 leading-relaxed text-muted-foreground">
                  Your seller application for{" "}
                  <strong className="text-foreground">
                    {sellerProfile.store_name}
                  </strong>{" "}
                  was not approved. A new application or reactivation is not
                  created automatically.
                </p>
                {sellerDecision?.public_reason ? (
                  <div className="mt-4 rounded-lg border border-border bg-background/60 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-foreground">
                      Reason
                    </p>
                    <p className="mt-1.5 leading-relaxed text-muted-foreground">
                      {sellerDecision.public_reason}
                    </p>
                  </div>
                ) : null}
                <p className="mt-4 text-xs text-muted-foreground">
                  Contact Zvese support if you need clarification. A formal
                  appeals workflow will be added separately.
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-sm">
                <div className="flex items-center gap-2 font-semibold text-destructive">
                  <ShieldAlertIcon className="size-4 shrink-0" />
                  <span>Seller Account {sellerProfile.status.toUpperCase()}</span>
                </div>
                <p className="mt-2 leading-relaxed text-muted-foreground">
                  Your seller account for{" "}
                  <strong className="text-foreground">
                    {sellerProfile.store_name}
                  </strong>{" "}
                  is currently {sellerProfile.status}. Please contact Zvese
                  support for assistance regarding this status.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Profile Details Card */}
        <div id="profile" className="scroll-mt-24 rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-xs">
          <h2 className="text-lg font-semibold text-foreground">
            Account Profile
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Display Name</p>
              <p className="font-medium text-foreground mt-0.5">{displayName}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Email Address</p>
              <p className="font-medium text-foreground mt-0.5">{user.email}</p>
            </div>
            {profile?.handle ? (
              <div>
                <p className="text-xs text-muted-foreground">User Handle</p>
                <p className="font-mono text-foreground mt-0.5">@{profile.handle}</p>
              </div>
            ) : null}
            <div>
              <p className="text-xs text-muted-foreground">User ID</p>
              <p className="font-mono text-xs text-muted-foreground mt-0.5 truncate">
                {user.id}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
