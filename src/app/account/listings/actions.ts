"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/admin/seller-review-data";
import { SOURCE_TYPES, validateProductFile, type FileVisibility, type UploadReservation } from "@/lib/marketplace/product-files";

async function activeSellerClient() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.from("seller_profiles").select("id").eq("user_id", user.id).eq("status", "active").maybeSingle();
  return !error && data ? supabase : null;
}

export async function saveListing(formData: FormData): Promise<{ error?: string; listingId?: string }> {
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const priceText = String(formData.get("price") ?? "");
  const price = Number(priceText);
  const sourceType = String(formData.get("source_type") ?? "");
  const partner = String(formData.get("partner_reference") ?? "").trim();
  const listingId = String(formData.get("listing_id") ?? "");
  if (title.length < 3 || title.length > 160 || description.length < 10 || description.length > 2000
    || !/^\d+(\.\d{1,2})?$/.test(priceText) || !Number.isFinite(price) || price < 0.01 || price > 1_000_000
    || !SOURCE_TYPES.some((type) => type === sourceType) || partner.length < 2 || partner.length > 300
    || (listingId && !isUuid(listingId))) return { error: "Please complete the product and source details correctly." };
  const supabase = await activeSellerClient();
  if (!supabase) return { error: "An active seller account is required." };
  const { data, error } = await supabase.rpc("save_source_listing", {
    p_title: title, p_description: description, p_price_minor: Math.round(price * 100),
    p_source_type: sourceType, p_partner_reference: partner, p_listing_id: listingId || null,
  });
  if (error || typeof data !== "string") return { error: "Could not save this draft. Check your seller status and try again." };
  revalidatePath("/account/listings/new");
  return { listingId: data };
}

export async function reserveFile(listingId: string, visibility: FileVisibility, name: string, mime: string, size: number): Promise<{ error?: string; file?: UploadReservation }> {
  if (!isUuid(listingId) || !["public", "private"].includes(visibility)) return { error: "Invalid upload request." };
  const invalid = validateProductFile({ name, type: mime, size }, visibility);
  if (invalid) return { error: invalid };
  const supabase = await activeSellerClient();
  if (!supabase) return { error: "An active seller account is required." };
  const { data, error } = await supabase.rpc("reserve_product_file", {
    p_listing_id: listingId, p_visibility: visibility, p_name: name, p_mime: mime, p_size: size,
  });
  const file = Array.isArray(data) ? data[0] : data;
  if (error || !file?.id || !file?.object_path) return { error: "Could not reserve this file. Only editable drafts allow uploads, with a maximum of 12 files." };
  return { file: file as UploadReservation };
}

export async function finishFile(fileId: string): Promise<{ error?: string }> {
  if (!isUuid(fileId)) return { error: "Invalid file." };
  const supabase = await activeSellerClient();
  if (!supabase) return { error: "An active seller account is required." };
  const { error } = await supabase.rpc("finish_product_file", { p_file_id: fileId });
  return error ? { error: "Upload could not be confirmed. Remove the incomplete file and try again." } : {};
}

export async function removeFile(fileId: string): Promise<{ error?: string }> {
  if (!isUuid(fileId)) return { error: "Invalid file." };
  const supabase = await activeSellerClient();
  if (!supabase) return { error: "An active seller account is required." };
  // Detach from this draft; retain immutable evidence and queue cleanup separately.
  const { error } = await supabase.rpc("remove_product_file", { p_file_id: fileId });
  return error ? { error: "Could not remove the file record. Try again." } : {};
}

export async function submitListing(listingId: string): Promise<{ error?: string }> {
  if (!isUuid(listingId)) return { error: "Invalid listing." };
  const supabase = await activeSellerClient();
  if (!supabase) return { error: "An active seller account is required." };
  const { error } = await supabase.rpc("submit_source_listing", { p_listing_id: listingId });
  if (error) return { error: "Could not submit. Finish or remove incomplete uploads and confirm your source details." };
  revalidatePath("/account/listings/new");
  return {};
}

export async function beginRevision(listingId: string): Promise<{ error?: string }> {
  if (!isUuid(listingId)) return { error: "Invalid listing." };
  const supabase = await activeSellerClient();
  if (!supabase) return { error: "An active seller account is required." };
  const { error } = await supabase.rpc("begin_listing_revision", { p_listing_id: listingId });
  if (error) return { error: "Could not start a revision. Shared legacy products require a controlled transition." };
  revalidatePath("/account/listings/new");
  revalidatePath("/marketplace", "layout");
  return {};
}
