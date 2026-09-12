export const SOURCE_TYPES = ["supplier", "manufacturer", "production_partner", "pod_partner", "customization_partner", "other"] as const;
export type FileVisibility = "public" | "private";
export interface ProductFile {
  id: string;
  listing_id: string;
  visibility: FileVisibility;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  reservation_state: "reserved" | "finalized" | "cancelled" | "expired";
  expires_at: string;
  content_validation_state: "pending" | "passed" | "failed";
  created_at: string;
}
export interface UploadReservation { id: string; bucket_id: string; object_path: string; expires_at: string }
export const PRODUCT_FILE_SELECT = "id,listing_id,visibility,original_name,mime_type,size_bytes,reservation_state,expires_at,content_validation_state,created_at" as const;
const TYPES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  mp4: "video/mp4", webm: "video/webm", pdf: "application/pdf", txt: "text/plain", csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
export const PUBLIC_ACCEPT = ".jpg,.jpeg,.png,.webp,.mp4,.webm,.pdf";
export const PRIVATE_ACCEPT = ".pdf,.txt,.csv,.docx,.xlsx";
// Initial declaration gate only. Trusted byte inspection is required separately.
// Empty/mismatched browser MIME values fail closed; no generic MIME fallback.
export function validateProductFile(file: { name: string; type: string; size: number }, visibility: FileVisibility): string | null {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!file.name.includes(".") || file.name.length > 255 || /[\x00-\x1f\x7f/\\]/.test(file.name)) return "Invalid filename.";
  if (!TYPES[extension] || TYPES[extension] !== file.type) return "File extension and MIME type must match an allowed format.";
  const image = file.type.startsWith("image/");
  const video = file.type.startsWith("video/");
  if (visibility === "private" ? image || video : !(image || video || extension === "pdf")) return "This file type is not allowed in this section.";
  const maxMB = image ? 10 : video ? 100 : 25;
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > maxMB * 1024 * 1024) return `File must be nonempty and no larger than ${maxMB} MB.`;
  return null;
}
