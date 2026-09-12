import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createProductSystemClient } from "@/lib/supabase/product-system";
import { isUuid } from "@/lib/admin/seller-review-data";
import { loadVerifiedFile, parseByteRange, type DeliveryDescriptor } from "@/lib/marketplace/file-delivery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// No signed URL is returned. RLS is rechecked after byte/hash/version verification.
// Revocation applies to subsequent requests; already-delivered bytes cannot be recalled.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const headers = new Headers({
    "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox",
  });
  const unavailable = () => new NextResponse("Not found", { status: 404, headers });
  const { id } = await params;
  if (!isUuid(id)) return unavailable();
  const supabase = await createClient();
  const { data: file, error } = await supabase.from("product_files")
    .select("id,mime_type,original_name,size_bytes,content_validation_state").eq("id", id).maybeSingle();
  if (error || !file || file.content_validation_state !== "passed") return unavailable();
  const range = parseByteRange(request.headers.get("range"), file.size_bytes);
  if (range === "invalid") {
    headers.set("Content-Range", `bytes */${file.size_bytes}`);
    return new NextResponse(null, { status: 416, headers });
  }
  try {
    const system = createProductSystemClient();
    const bytes = await loadVerifiedFile({
      size: file.size_bytes,
      authorized: async () => {
        const { data, error } = await supabase.from("product_files").select("id").eq("id", id).maybeSingle();
        return !error && !!data;
      },
      descriptor: async () => {
        const { data, error } = await system.rpc("get_validated_file_delivery", { p_file_id: id });
        return error ? null : (data?.[0] as DeliveryDescriptor | undefined) ?? null;
      },
      download: async (path) => {
        const { data, error } = await system.storage.from("product-validated-files").download(path);
        return error ? null : data;
      },
    });
    if (!bytes) return unavailable();
    headers.set("Content-Type", file.mime_type);
    headers.set("Accept-Ranges", "bytes");
    if (!file.mime_type.startsWith("image/") && !file.mime_type.startsWith("video/")) {
      headers.set("Content-Disposition", `attachment; filename="product-document"; filename*=UTF-8''${encodeURIComponent(file.original_name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`);
    }
    const body = range ? bytes.slice(range.start, range.end + 1) : bytes;
    headers.set("Content-Length", String(body.byteLength));
    if (range) headers.set("Content-Range", `bytes ${range.start}-${range.end}/${bytes.byteLength}`);
    return new NextResponse(new Blob([body as Uint8Array<ArrayBuffer>]), { status: range ? 206 : 200, headers });
  } catch {
    // Never return service credentials, storage paths, or internal error details.
    return new NextResponse("File temporarily unavailable", { status: 503, headers });
  }
}
