"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isUuid } from "@/lib/admin/seller-review-data";
import { validateSubmittedImage } from "@/lib/admin/image-validation-server";

export async function validateImage(form: FormData) {
  const listing = String(form.get("listing_id") ?? ""), file = String(form.get("file_id") ?? "");
  if (!isUuid(listing) || !isUuid(file)) throw new Error("Invalid image selection.");
  try { await validateSubmittedImage(listing, file); }
  catch {
    redirect(`/admin/products/${listing}?error=Image%20validation%20did%20not%20complete.%20Do%20not%20bypass%20the%20publication%20guard.%20Review%20the%20file%20version%20and%20any%20existing%20vault%20copy%20before%20another%20attempt.`);
  }
  revalidatePath(`/admin/products/${listing}`);
  redirect(`/admin/products/${listing}`);
}
