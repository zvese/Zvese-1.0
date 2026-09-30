import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftIcon, StoreIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getListingByProductSlug } from "@/lib/marketplace/products";
import { ProductMedia } from "@/components/marketplace/product-media";
import { canBuy } from "@/lib/orders/checkout";

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic metadata
// ─────────────────────────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { data: listing } = await getListingByProductSlug(slug);

  if (!listing) {
    return {
      title: "Listing Not Found",
      description: "This listing could not be found on the Zvese marketplace.",
    };
  }

  const title = listing.title || listing.product.title;
  const description =
    listing.product.description ??
    `Buy ${title} from ${listing.seller.store_name} on Zvese.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Availability helper
// ─────────────────────────────────────────────────────────────────────────────

function formatAvailability(state: "checking" | "available" | "unavailable", reviewState: string) {
  if (reviewState === "legacy_unreviewed") return { label: "Legacy listing: source availability has not been verified", available: false };
  return {
    label: state === "available" ? "Available through fulfillment partner" : state === "unavailable" ? "Currently unavailable from source" : "Availability is being verified",
    available: state === "available",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default async function ListingDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { data: listing, error } = await getListingByProductSlug(slug);

  // ── Not found / error state ───────────────────────────────────────────────
  if (error || !listing) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24 sm:px-6 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Listing not found</h1>
        <p className="mt-3 text-muted-foreground">
          This listing may have been removed or is no longer available.
        </p>
        <Button asChild className="mt-8">
          <Link href="/marketplace">
            <ArrowLeftIcon className="mr-2 size-4" />
            Back to Marketplace
          </Link>
        </Button>
      </div>
    );
  }

  const displayTitle = listing.title || listing.product.title;
  const price = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: listing.currency,
  }).format(listing.price_minor / 100);

  const availability = formatAvailability(listing.availability_state, listing.review_state);

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
      {/* ── Breadcrumb ──────────────────────────────────────────────────── */}
      <nav
        className="mb-8 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground"
        aria-label="Breadcrumb"
      >
        <Link
          href="/marketplace"
          className="hover:text-primary transition-colors"
        >
          Marketplace
        </Link>

        {listing.product.category && (
          <>
            <span aria-hidden="true">/</span>
            <Link
              href={`/marketplace?category=${listing.product.category.slug}`}
              className="hover:text-primary transition-colors"
            >
              {listing.product.category.name}
            </Link>
          </>
        )}

        <span aria-hidden="true">/</span>
        <span className="text-foreground font-medium truncate max-w-[16rem]">
          {displayTitle}
        </span>
      </nav>

      <div className="grid gap-12 lg:grid-cols-2">
        {/* ── Left column: Product info ────────────────────────────────── */}
        <div>
          <ProductMedia listingId={listing.id} />
          {/* Category badge */}
          {listing.product.category && (
            <Link
              href={`/marketplace?category=${listing.product.category.slug}`}
              className="inline-flex items-center rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground hover:bg-primary/10 hover:text-primary transition-colors"
            >
              {listing.product.category.name}
            </Link>
          )}

          {/* Title */}
          <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
            {displayTitle}
          </h1>

          {/* Brand */}
          {listing.product.brand && (
            <p className="mt-2 text-sm text-muted-foreground">
              by{" "}
              <span className="font-medium text-foreground">
                {listing.product.brand}
              </span>
            </p>
          )}

          {/* Price */}
          <p className="mt-6 text-3xl font-bold text-primary">{price}</p>

          {/* Availability */}
          <p
            className={`mt-2 text-sm font-medium ${
              availability.available
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-destructive"
            }`}
          >
            {availability.label}
          </p>

          <div className="mt-5">
            {canBuy(listing.availability_state, listing.review_state) ? (
              <Button asChild><Link href={`/checkout/${listing.id}`}>Buy now</Link></Button>
            ) : <Button disabled>Buy now</Button>}
          </div>

          {/* Description */}
          {listing.product.description && (
            <div className="mt-8">
              <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                Description
              </h2>
              <p className="mt-3 leading-relaxed text-foreground whitespace-pre-line">
                {listing.product.description}
              </p>
            </div>
          )}
        </div>

        {/* ── Right column: Seller info ────────────────────────────────── */}
        <div className="space-y-6">
          {/* Seller card */}
          <div className="rounded-2xl border border-border bg-card p-6 shadow-xs">
            <div className="flex items-center gap-3">
              {listing.seller.logo_url ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={listing.seller.logo_url}
                  alt={`${listing.seller.store_name} logo`}
                  className="size-12 rounded-full object-cover border border-border"
                />
              ) : (
                <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <StoreIcon className="size-6" />
                </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground">Sold by</p>
                <p className="font-semibold text-foreground">
                  {listing.seller.store_name}
                </p>
                <p className="text-xs font-mono text-muted-foreground">
                  @{listing.seller.store_slug}
                </p>
              </div>
            </div>
          </div>

          {/* Listing meta */}
          <div className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-3 text-sm">
            <h2 className="font-semibold text-foreground">Listing details</h2>
            <div className="flex justify-between text-muted-foreground">
              <span>Currency</span>
              <span className="font-medium text-foreground">
                {listing.currency}
              </span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Availability managed by</span>
              <span className="font-medium text-foreground capitalize">
                Fulfillment source / system
              </span>
            </div>

          </div>
        </div>
      </div>

      {/* ── Back link ────────────────────────────────────────────────────── */}
      <div className="mt-12">
        <Button asChild variant="outline" size="sm">
          <Link href="/marketplace">
            <ArrowLeftIcon className="mr-2 size-4" />
            Back to Marketplace
          </Link>
        </Button>
      </div>
    </div>
  );
}
