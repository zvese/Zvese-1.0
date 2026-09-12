import { createClient } from "@/lib/supabase/server";
import type { Category } from "@/types";

// ─────────────────────────────────────────────────────────────────────────────
// Shared types
// ─────────────────────────────────────────────────────────────────────────────

export interface MarketplaceListing {
  id: string;
  seller_id: string;
  product_id: string;
  title: string | null;
  price_minor: number;
  currency: string;
  availability_state: "checking" | "available" | "unavailable";
  availability_mode: "source_managed";
  review_state: "approved" | "legacy_unreviewed";
  status: "draft" | "active" | "paused" | "archived";
  created_at: string;
  product: {
    id: string;
    title: string;
    slug: string;
    description: string | null;
    brand: string | null;
    category: {
      id: string;
      name: string;
      slug: string;
    } | null;
  };
  seller: {
    id: string;
    store_name: string;
    store_slug: string;
    logo_url: string | null;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Raw row shapes returned by Supabase (joined relations can be array or object)
// ─────────────────────────────────────────────────────────────────────────────

interface RawCategoryRow {
  id?: string;
  name?: string;
  slug?: string;
}

interface RawProductRow {
  id?: string;
  title?: string;
  slug?: string;
  description?: string | null;
  brand?: string | null;
  category?: RawCategoryRow | RawCategoryRow[] | null;
}

interface RawSellerRow {
  id?: string;
  store_name?: string;
  store_slug?: string;
  logo_url?: string | null;
}

interface RawListingRow {
  id: string;
  seller_id: string;
  product_id: string;
  title: string | null;
  price_minor: number;
  currency: string;
  availability_state: "checking" | "available" | "unavailable";
  availability_mode: "source_managed";
  review_state: "approved" | "legacy_unreviewed";
  status: "draft" | "active" | "paused" | "archived";
  created_at: string;
  product: RawProductRow | RawProductRow[];
  seller: RawSellerRow | RawSellerRow[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalisation helpers
// ─────────────────────────────────────────────────────────────────────────────

function normaliseListing(item: RawListingRow): MarketplaceListing {
  const product = Array.isArray(item.product) ? item.product[0] : item.product;
  const seller = Array.isArray(item.seller) ? item.seller[0] : item.seller;
  const rawCategory = product?.category;
  const category = rawCategory
    ? Array.isArray(rawCategory)
      ? rawCategory[0] ?? null
      : rawCategory
    : null;

  return {
    id: item.id,
    seller_id: item.seller_id,
    product_id: item.product_id,
    title: item.title,
    price_minor: item.price_minor,
    currency: item.currency,
    availability_state: item.availability_state,
    availability_mode: item.availability_mode,
    review_state: item.review_state,
    status: item.status,
    created_at: item.created_at,
    product: {
      id: product?.id ?? "",
      title: product?.title ?? "",
      slug: product?.slug ?? "",
      description: product?.description ?? null,
      brand: product?.brand ?? null,
      category: category?.id
        ? {
            id: category.id,
            name: category.name ?? "",
            slug: category.slug ?? "",
          }
        : null,
    },
    seller: {
      id: seller?.id ?? "",
      store_name: seller?.store_name ?? "",
      store_slug: seller?.store_slug ?? "",
      logo_url: seller?.logo_url ?? null,
    },
  };
}

// Shared Supabase select string for a listing with product + category + seller
const LISTING_SELECT = `
  id,
  seller_id,
  product_id,
  title,
  price_minor,
  currency,
  availability_state,
  availability_mode,
  review_state,
  status,
  created_at,
  product:products!inner (
    id,
    title,
    slug,
    description,
    brand,
    category:categories (
      id,
      name,
      slug
    )
  ),
  seller:seller_profiles!inner (
    id,
    store_name,
    store_slug,
    logo_url
  )
` as const;

// ─────────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches all active marketplace listings (active listing + active seller +
 * active product enforced by Supabase RLS).
 *
 * @param categorySlug  When provided, filters listings whose product belongs
 *                      to the category with this slug.
 */
export async function getActiveMarketplaceListings(
  categorySlug?: string
): Promise<{
  data: MarketplaceListing[] | null;
  error: Error | null;
}> {
  const supabase = await createClient();

  let query = supabase
    .from("listings")
    .select(LISTING_SELECT)
    .eq("status", "active")
    .in("review_state", ["approved", "legacy_unreviewed"])
    .eq("product.status", "active")
    .eq("seller.status", "active")
    .order("created_at", { ascending: false });

  if (categorySlug) {
    // Filter by the slug of the joined category on the product
    query = query.eq("product.category.slug", categorySlug);
  }

  const { data, error } = await query;

  if (error || !data) {
    return { data: null, error: error ? new Error(error.message) : null };
  }

  const listings = (data as unknown as RawListingRow[]).map(normaliseListing);
  return { data: listings, error: null };
}

/**
 * Fetches a single active listing by its product slug.
 * Returns null (not an error) when no matching active listing exists.
 */
export async function getListingByProductSlug(slug: string): Promise<{
  data: MarketplaceListing | null;
  error: Error | null;
}> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("listings")
    .select(LISTING_SELECT)
    .eq("status", "active")
    .in("review_state", ["approved", "legacy_unreviewed"])
    .eq("product.status", "active")
    .eq("seller.status", "active")
    .eq("product.slug", slug)
    .maybeSingle();

  if (error) {
    return { data: null, error: new Error(error.message) };
  }

  if (!data) {
    return { data: null, error: null };
  }

  return { data: normaliseListing(data as unknown as RawListingRow), error: null };
}

/**
 * Fetches all active categories, ordered alphabetically.
 * Used by the marketplace category filter strip.
 */
export async function getActiveCategories(): Promise<{
  data: Category[] | null;
  error: Error | null;
}> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("categories")
    .select("id, parent_id, name, slug, description, image_url, is_active, created_at, updated_at")
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error || !data) {
    return { data: null, error: error ? new Error(error.message) : null };
  }

  return { data: data as Category[], error: null };
}
