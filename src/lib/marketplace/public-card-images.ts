import { createCatalogClient } from "@/lib/supabase/catalog";

export async function getPublicCardImages(listingIds: string[]): Promise<Record<string, string>> {
  const images: Record<string, string> = {};
  if (!listingIds.length) return images;
  try {
    // Anonymous RLS restricts rows to validated public files of the currently
    // published submission. No owner/admin session and no direct Storage URLs.
    const { data, error } = await createCatalogClient().from("product_files")
      .select("id,listing_id,created_at").in("listing_id", listingIds)
      .eq("visibility", "public").eq("reservation_state", "finalized").eq("content_validation_state", "passed")
      .in("mime_type", ["image/jpeg", "image/png", "image/webp"])
      .order("created_at").order("id").limit(24 * 12);
    if (!error) for (const file of data ?? []) if (!images[file.listing_id]) images[file.listing_id] = file.id;
  } catch { /* Keep a stable placeholder when media metadata is unavailable. */ }
  return images;
}
