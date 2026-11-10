import "server-only";
import { randomUUID, createHash } from "node:crypto";
import { requireProductModerator, loadProductReview } from "./product-review-server";
import { isSelfReview } from "./product-review";
import { createProductSystemClient } from "@/lib/supabase/product-system";
import { validateRaster } from "@/lib/marketplace/raster-validation";

export async function validateSubmittedImage(listingId: string, fileId: string) {
  const actor = await requireProductModerator(`/admin/products/${listingId}`);
  const record = await loadProductReview(listingId);
  const submitted = record?.snapshot.files.find(file => file.id === fileId);
  if (!record || !submitted || isSelfReview(actor.id, record) || record.reviewState !== "pending_review" || record.deletedAt || record.sellerStatus !== "active")
    throw new Error("Submission unavailable for validation.");
  const system = createProductSystemClient();
  const { data: file, error } = await system.from("product_files")
    .select("id,listing_id,bucket_id,object_path,storage_version,mime_type,size_bytes,reservation_state,content_validation_state")
    .eq("id", fileId).eq("listing_id", listingId).maybeSingle();
  if (error || !file || file.reservation_state !== "finalized" || file.content_validation_state !== "pending" ||
      file.storage_version !== submitted.storage_version || file.bucket_id !== "product-images" || file.size_bytes > 10 * 1024 * 1024)
    throw new Error("Image version is no longer eligible.");
  const extension = String(file.object_path).split(".").pop();
  if (!extension || !["jpg", "jpeg", "png", "webp"].includes(extension)) throw new Error("Unsupported image extension.");
  const source = system.storage.from(file.bucket_id);
  const checkedFile = file;
async function unchanged() {
    const result = await source.info(checkedFile.object_path);
    if (result.error || result.data.version !== checkedFile.storage_version || result.data.size !== Number(checkedFile.size_bytes) || result.data.contentType !== checkedFile.mime_type)
      throw new Error("Storage metadata changed.");
  }
  await unchanged();
  const downloaded = await source.download(file.object_path);
  if (downloaded.error || downloaded.data.size !== Number(file.size_bytes)) throw new Error("Image download unavailable.");
  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  const validated = await validateRaster(bytes, file.mime_type, Number(file.size_bytes));
  await unchanged();
  const currentActor = await requireProductModerator();
  if (currentActor.id !== actor.id) throw new Error("Moderator session changed.");
  const path = `validated/${file.id}/${validated.sha256}.${extension}`;
  const vault = system.storage.from("product-validated-files");
  const uploaded = await vault.upload(path, bytes, { contentType: file.mime_type, upsert: false, cacheControl: "0" });
  if (uploaded.error) throw new Error("Vault copy could not be created. Preserve existing objects for review.");
  const info = await vault.info(path);
  const copy = await vault.download(path);
  if (info.error || copy.error || copy.data.size !== bytes.length || info.data.size !== bytes.length || info.data.contentType !== file.mime_type)
    throw new Error("Vault copy verification failed.");
  if (createHash("sha256").update(new Uint8Array(await copy.data.arrayBuffer())).digest("hex") !== validated.sha256)
    throw new Error("Vault content mismatch.");
  const job = randomUUID();
  const { error: validationError } = await system.rpc("record_product_file_validation", {
    p_file_id: file.id, p_storage_version: file.storage_version, p_job_id: job, p_state: "passed",
    p_sha256: validated.sha256, p_validator: "bounded-raster-decoder-v1",
    p_evidence_reference: `evidence://image-validation/${actor.id}/${job}`,
    p_vault_path: path, p_vault_version: info.data.version,
  });
  if (validationError) throw new Error("Validation could not be recorded. Preserve the vault copy for review.");
}
