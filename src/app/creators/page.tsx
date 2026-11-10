import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon, SparklesIcon, ShieldCheckIcon, GlobeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getCurrentSellerProfile } from "@/lib/marketplace/sellers";

export const metadata: Metadata = {
  title: "Creators",
  description: "Join the Zvese creator economy and build your brand globally.",
};

const perks = [
  {
    icon: GlobeIcon,
    title: "Global Reach",
    description: "Sell to customers worldwide without managing warehouse overhead.",
  },
  {
    icon: SparklesIcon,
    title: "Zero-Inventory Freedom",
    description: "Publish your listings with on-demand and smart fulfillment models.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Direct Platform Support",
    description: "Transparent verified seller onboarding and dedicated merchant support.",
  },
];

export default async function CreatorsPage() {
  const { data: sellerProfile } = await getCurrentSellerProfile();
  const isActiveSeller = sellerProfile?.status === "active";

  return (
    <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-sm font-medium text-primary">Creator & Seller Economy</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
          Build and scale your brand on Zvese
        </h1>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">
          Join Zvese&apos;s zero-inventory marketplace. Launch your creator store,
          connect with buyers globally, and let our platform power your commerce.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button size="lg" asChild>
            <Link href={isActiveSeller ? "/account#seller-dashboard" : "/creators/apply"}>
              {isActiveSeller
                ? "Seller Dashboard"
                : sellerProfile
                  ? "View seller status"
                  : "Apply to become a seller"}
              <ArrowRightIcon className="size-4" />
            </Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href="/marketplace">Explore marketplace</Link>
          </Button>
        </div>
      </div>

      <div className="mx-auto mt-16 grid max-w-5xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {perks.map((perk) => (
          <article
            key={perk.title}
            className="rounded-xl border border-border bg-card p-6 shadow-xs transition-shadow hover:shadow-md"
          >
            <div className="mb-4 inline-flex rounded-lg bg-primary/10 p-2.5 text-primary">
              <perk.icon className="size-5" aria-hidden />
            </div>
            <h2 className="text-lg font-semibold text-foreground">
              {perk.title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {perk.description}
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}
