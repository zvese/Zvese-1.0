import type { Metadata } from "next";
import Link from "next/link";
import { AddToCartButton } from "@/components/cart/add-to-cart-button";
import { ProductCardImage } from "@/components/marketplace/product-card-image";
import { Button } from "@/components/ui/button";
import {
  getActiveCategories,
  getActiveMarketplaceListings,
} from "@/lib/marketplace/products";
import { filterMarketplaceListings } from "@/lib/marketplace/search";
import { canBuy } from "@/lib/orders/checkout";
import { getPublicCardImages } from "@/lib/marketplace/public-card-images";
import { catalogPage } from "@/lib/marketplace/catalog-query";
import { MarketplaceSearch } from "@/components/marketplace/marketplace-search";

export const metadata: Metadata = {
  title: "Marketplace",
  description: "Discover products from creators and sellers worldwide on Zvese.",
};

export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string | string[]; q?: string | string[]; page?: string }>;
}) {
  const { category, q, page: requestedPage } = await searchParams;
  const page = catalogPage(requestedPage);
  const categorySlug = typeof category === "string" ? category.trim().slice(0, 160) : undefined;
  const searchQuery = typeof q === "string" ? q.trim().slice(0, 100) : "";

  const [listingResult, categoryResult] = await Promise.allSettled([
    getActiveMarketplaceListings(categorySlug, searchQuery, page),
    getActiveCategories(),
  ]);

  const listings = listingResult.status === "fulfilled" ? listingResult.value.data : null;
  const categories = categoryResult.status === "fulfilled" ? categoryResult.value.data : null;
  const marketplaceUnavailable = listings === null || categories === null;

  const activeListings = filterMarketplaceListings(listings ?? [], searchQuery, categorySlug);
  const activeCategories = categories ?? [];
  const imageIds = marketplaceUnavailable ? {} : await getPublicCardImages(activeListings.map(listing => listing.id));
  const hasNext = listingResult.status === "fulfilled" && listingResult.value.hasNext;

  // Find the active category object for display purposes
  const activeCategory = categorySlug
    ? activeCategories.find((c) => c.slug === categorySlug) ?? null
    : null;

  function marketplaceHref(category?: string, keepSearch = true, targetPage = 1) {
    const params = new URLSearchParams();
    if (keepSearch && searchQuery) params.set("q", searchQuery);
    if (category) params.set("category", category);
    if (targetPage > 1) params.set("page", String(targetPage));
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

      <MarketplaceSearch query={searchQuery} category={categorySlug} />
      {searchQuery && <Link className="mt-3 inline-block text-sm underline" href={marketplaceHref(categorySlug, false)}>Clear search</Link>}

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
      {marketplaceUnavailable ? (
        <div className="mt-10 rounded-xl border bg-card p-8" role="status">
          <h2 className="text-lg font-semibold">Marketplace temporarily unavailable</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            We could not load products right now. Please try again later.
          </p>
        </div>
      ) : activeListings.length === 0 ? (
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
          {activeListings.map((listing, index) => {
            const available = canBuy(listing.availability_state, listing.review_state);
            const title = listing.title || listing.product.title;
            return (
              <article key={listing.id} className="group flex flex-col rounded-xl border bg-card p-6 transition-shadow hover:shadow-md">
                <Link href={`/marketplace/${listing.product.slug}`} prefetch={false} className="flex-1">
                <ProductCardImage fileId={imageIds[listing.id]} title={title} priority={index < 3} />
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
                  <Button asChild size="sm"><Link prefetch={false} href={`/marketplace/${listing.product.slug}`}>View product</Link></Button>
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
      {!marketplaceUnavailable && <nav aria-label="Marketplace pages" className="mt-8 flex gap-6">
        {page > 1 && <Link href={marketplaceHref(categorySlug, true, page - 1)}>Previous</Link>}
        {hasNext && <Link href={marketplaceHref(categorySlug, true, page + 1)}>Next</Link>}
      </nav>}
    </div>
  );
}
