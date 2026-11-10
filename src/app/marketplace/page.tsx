import type { Metadata } from "next";
import Link from "next/link";
import { SearchIcon } from "lucide-react";
import { AddToCartButton } from "@/components/cart/add-to-cart-button";
import { Button } from "@/components/ui/button";
import {
  getActiveCategories,
  getActiveMarketplaceListings,
} from "@/lib/marketplace/products";
import { filterMarketplaceListings } from "@/lib/marketplace/search";
import { canBuy } from "@/lib/orders/checkout";

export const metadata: Metadata = {
  title: "Marketplace",
  description: "Discover products from creators and sellers worldwide on Zvese.",
};

export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string | string[]; q?: string | string[] }>;
}) {
  const { category, q } = await searchParams;
  const categorySlug = typeof category === "string" ? category.trim().slice(0, 160) : undefined;
  const searchQuery = typeof q === "string" ? q.trim().slice(0, 100) : "";

  const [{ data: listings }, { data: categories }] = await Promise.all([
    getActiveMarketplaceListings(),
    getActiveCategories(),
  ]);

  const activeListings = filterMarketplaceListings(listings ?? [], searchQuery, categorySlug);
  const activeCategories = categories ?? [];

  // Find the active category object for display purposes
  const activeCategory = categorySlug
    ? activeCategories.find((c) => c.slug === categorySlug) ?? null
    : null;

  function marketplaceHref(category?: string, keepSearch = true) {
    const params = new URLSearchParams();
    if (keepSearch && searchQuery) params.set("q", searchQuery);
    if (category) params.set("category", category);
    const query = params.toString();
    return query ? `/marketplace?${query}` : "/marketplace";
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      {/* Header */}
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
        Marketplace
      </h1>
      <p className="mt-4 max-w-2xl text-muted-foreground">
        Discover products from independent creators and sellers worldwide.
      </p>

      <form action="/marketplace" method="get" className="mt-8 flex max-w-2xl flex-col gap-3 sm:flex-row">
        {categorySlug ? <input type="hidden" name="category" value={categorySlug} /> : null}
        <label className="relative flex-1">
          <span className="sr-only">Search marketplace</span>
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            name="q"
            type="search"
            defaultValue={searchQuery}
            maxLength={100}
            placeholder="Search products, brands, or stores"
            className="h-11 w-full rounded-md border bg-background pl-10 pr-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <Button type="submit" size="lg">Search</Button>
        {searchQuery ? <Button variant="outline" size="lg" asChild><Link href={marketplaceHref(categorySlug, false)}>Clear</Link></Button> : null}
      </form>

      {/* Category filter strip */}
      <nav
        className="mt-8 flex flex-wrap gap-2"
        aria-label="Filter by category"
      >
          <Link
            href={marketplaceHref()}
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
              href={marketplaceHref(cat.slug)}
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

      {/* Active category label */}
      {activeCategory && (
        <p className="mt-4 text-sm text-muted-foreground">
          Showing results for{" "}
          <span className="font-semibold text-foreground">
            {activeCategory.name}
          </span>
        </p>
      )}
      {searchQuery ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Search results for <span className="font-semibold text-foreground">“{searchQuery}”</span>
        </p>
      ) : null}

      {/* Listing grid / empty state */}
      {activeListings.length === 0 ? (
        <div className="mt-10 rounded-xl border bg-card p-8">
          <h2 className="text-lg font-semibold">
            {categorySlug
              ? "No matching listings in this category."
              : searchQuery
                ? "No listings match your search."
              : "The first listings are coming soon."}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {categorySlug || searchQuery
              ? "Try browsing all categories or check back later."
              : "Create an account to become one of Zvese\u2019s first creators."}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            {categorySlug || searchQuery ? (
              <Button asChild variant="outline">
                <Link href="/marketplace">Clear filters</Link>
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
          {activeListings.map((listing) => {
            const available = canBuy(listing.availability_state, listing.review_state);
            const title = listing.title || listing.product.title;
            return (
              <article key={listing.id} className="group flex flex-col rounded-xl border bg-card p-6 transition-shadow hover:shadow-md">
                <Link href={`/marketplace/${listing.product.slug}`} className="flex-1">
                <p className="text-sm text-muted-foreground">
                  {listing.seller?.store_name ?? "Zvese creator"}
                </p>
                <h2 className="mt-2 text-xl font-semibold group-hover:text-primary transition-colors">
                  {title}
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
                </Link>
                <div className="mt-5 flex flex-wrap gap-2">
                  <Button asChild size="sm"><Link href={`/marketplace/${listing.product.slug}`}>View product</Link></Button>
                  <AddToCartButton
                    disabled={!available}
                    item={{
                      listingId: listing.id,
                      productSlug: listing.product.slug,
                      title,
                      sellerName: listing.seller.store_name,
                      unitPriceMinor: listing.price_minor,
                      currency: listing.currency,
                    }}
                  />
                </div>
                {!available ? <p className="mt-2 text-xs text-destructive">Currently unavailable to buy or add to cart.</p> : null}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
