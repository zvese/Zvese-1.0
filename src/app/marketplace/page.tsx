import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  getActiveCategories,
  getActiveMarketplaceListings,
} from "@/lib/marketplace/products";

export const metadata: Metadata = {
  title: "Marketplace",
  description: "Discover products from creators and sellers worldwide on Zvese.",
};

export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category: categorySlug } = await searchParams;

  const [{ data: listings }, { data: categories }] = await Promise.all([
    getActiveMarketplaceListings(categorySlug),
    getActiveCategories(),
  ]);

  const activeListings = listings ?? [];
  const activeCategories = categories ?? [];

  // Find the active category object for display purposes
  const activeCategory = categorySlug
    ? activeCategories.find((c) => c.slug === categorySlug) ?? null
    : null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      {/* Header */}
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
        Marketplace
      </h1>
      <p className="mt-4 max-w-2xl text-muted-foreground">
        Discover products from independent creators and sellers worldwide.
      </p>

      {/* Category filter strip */}
      {activeCategories.length > 0 && (
        <nav
          className="mt-8 flex flex-wrap gap-2"
          aria-label="Filter by category"
        >
          <Link
            href="/marketplace"
            className={`inline-flex items-center rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              !categorySlug
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            }`}
          >
            All
          </Link>

          {activeCategories.map((cat) => (
            <Link
              key={cat.id}
              href={`/marketplace?category=${cat.slug}`}
              className={`inline-flex items-center rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                categorySlug === cat.slug
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              }`}
            >
              {cat.name}
            </Link>
          ))}
        </nav>
      )}

      {/* Active category label */}
      {activeCategory && (
        <p className="mt-4 text-sm text-muted-foreground">
          Showing results for{" "}
          <span className="font-semibold text-foreground">
            {activeCategory.name}
          </span>
        </p>
      )}

      {/* Listing grid / empty state */}
      {activeListings.length === 0 ? (
        <div className="mt-10 rounded-xl border bg-card p-8">
          <h2 className="text-lg font-semibold">
            {categorySlug
              ? "No listings in this category yet."
              : "The first listings are coming soon."}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {categorySlug
              ? "Try browsing all categories or check back later."
              : "Create an account to become one of Zvese\u2019s first creators."}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            {categorySlug ? (
              <Button asChild variant="outline">
                <Link href="/marketplace">Browse all</Link>
              </Button>
            ) : (
              <Button asChild>
                <Link href="/account/listings/new">Create a listing</Link>
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {activeListings.map((listing) => (
            <Link
              key={listing.id}
              href={`/marketplace/${listing.product.slug}`}
              className="group rounded-xl border bg-card p-6 transition-shadow hover:shadow-md"
            >
              <article>
                <p className="text-sm text-muted-foreground">
                  {listing.seller?.store_name ?? "Zvese creator"}
                </p>
                <h2 className="mt-2 text-xl font-semibold group-hover:text-primary transition-colors">
                  {listing.title || listing.product?.title}
                </h2>
                {listing.product?.category && (
                  <span className="mt-2 inline-block rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-foreground">
                    {listing.product.category.name}
                  </span>
                )}
                <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">
                  {listing.product?.description}
                </p>
                <p className="mt-6 font-semibold">
                  {new Intl.NumberFormat("en-US", {
                    style: "currency",
                    currency: listing.currency || "USD",
                  }).format(listing.price_minor / 100)}
                </p>
              </article>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
