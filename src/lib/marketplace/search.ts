import type { MarketplaceListing } from "@/lib/marketplace/products";

export function filterMarketplaceListings(
  listings: MarketplaceListing[],
  query?: string | null,
  categorySlug?: string | null
) {
  const term = query?.trim().toLocaleLowerCase() ?? "";
  const category = categorySlug?.trim() ?? "";

  return listings.filter((listing) => {
    if (category && listing.product.category?.slug !== category) return false;
    if (!term) return true;
    return [
        listing.title,
        listing.product.title,
        listing.product.description,
        listing.product.brand,
        listing.seller.store_name,
      ].some((value) => value?.toLocaleLowerCase().includes(term));
  });
}
