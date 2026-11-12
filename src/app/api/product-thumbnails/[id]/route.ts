import { createCatalogClient } from "@/lib/supabase/catalog";
import { createProductSystemClient } from "@/lib/supabase/product-system";
import { isUuid } from "@/lib/admin/seller-review-data";
import { loadPublicThumbnail } from "@/lib/marketplace/public-thumbnail";
import { transformThumbnail } from "@/lib/marketplace/thumbnail-transform";
import type { DeliveryDescriptor } from "@/lib/marketplace/file-delivery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const start = performance.now();
  const timing = { access: 0, storage: 0, transform: 0 };
  const headers = new Headers({ "Cache-Control": "private, no-cache, must-revalidate", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
  const fail = (status: number) => { headers.set("Cache-Control", "no-store"); return new Response(null, { status, headers }); };
  const { id } = await params;
  const width = Number(new URL(request.url).searchParams.get("w") || 640);
  if (!isUuid(id)) return fail(404);
  try {
    const catalog = createCatalogClient();
    const system = createProductSystemClient();
    const result = await loadPublicThumbnail(width, {
      read: async () => {
        const started = performance.now();
        const [file, descriptor] = await Promise.all([
          catalog.from("product_files").select("id,size_bytes,mime_type")
            .eq("id", id).eq("visibility", "public").eq("reservation_state", "finalized")
            .eq("content_validation_state", "passed").maybeSingle(),
          system.rpc("get_validated_file_delivery", { p_file_id: id }),
        ]);
        timing.access += performance.now() - started;
        const value = descriptor.data?.[0] as DeliveryDescriptor | undefined;
        if (file.error || descriptor.error || !file.data || !value) return null;
        return { id, size: Number(file.data.size_bytes), mime: file.data.mime_type, descriptor: value };
      },
      download: async path => {
        const started = performance.now();
        const { data, error } = await system.storage.from("product-validated-files").download(path);
        timing.storage += performance.now() - started;
        return error ? null : data;
      },
      transform: async (bytes, width, mime) => {
        const started = performance.now();
        const output = await transformThumbnail(bytes, width, mime);
        timing.transform += performance.now() - started;
        return output;
      },
    });
    if (!result) return fail(404);
    headers.set("ETag", result.etag);
    headers.set("Server-Timing", `thumbnail;dur=${(performance.now() - start).toFixed(1)}, access;dur=${timing.access.toFixed(1)}, storage;dur=${timing.storage.toFixed(1)}, transform;dur=${timing.transform.toFixed(1)}`);
    if (request.headers.get("if-none-match") === result.etag) return new Response(null, { status: 304, headers });
    headers.set("Content-Type", "image/webp");
    headers.set("Content-Length", String(result.bytes.byteLength));
    return new Response(new Blob([result.bytes as Uint8Array<ArrayBuffer>]), { headers });
  } catch { return fail(503); }
}
