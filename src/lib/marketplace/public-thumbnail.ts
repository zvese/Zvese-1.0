import { createHash } from "node:crypto";
import { matchesContentHash, type DeliveryDescriptor } from "./file-delivery.ts";
import { ThumbnailCache } from "./thumbnail-cache.ts";

export interface PublicImage { id: string; size: number; mime: string; descriptor: DeliveryDescriptor }
export const THUMBNAIL_WIDTHS = [320, 640, 960] as const;
const cache = new ThumbnailCache();
const identity = (image: PublicImage, width: number) => JSON.stringify([
  "webp-v1", image.id, image.size, image.mime, image.descriptor.vault_path,
  image.descriptor.vault_version, image.descriptor.content_sha256, width,
]);

export async function loadPublicThumbnail(width: number, io: {
  read: () => Promise<PublicImage | null>;
  download: (path: string) => Promise<Blob | null>;
  transform: (bytes: Uint8Array, width: number, mime: string) => Promise<Uint8Array>;
}, imageCache = cache) {
  if (!THUMBNAIL_WIDTHS.some(value => value === width)) return null;
  const before = await io.read();
  if (!before || !["image/jpeg", "image/png", "image/webp"].includes(before.mime)
    || !Number.isSafeInteger(before.size) || before.size < 1 || before.size > 10 * 1024 * 1024) return null;
  const key = identity(before, width);
  const bytes = await imageCache.get(key, async () => {
    const blob = await io.download(before.descriptor.vault_path);
    if (!blob || blob.size !== before.size) throw new Error("Image unavailable");
    const original = new Uint8Array(await blob.arrayBuffer());
    if (!matchesContentHash(original, before.descriptor.content_sha256)) throw new Error("Image mismatch");
    return io.transform(original, width, before.mime);
  });
  // Revalidate current anonymous visibility and the immutable descriptor after
  // download/transform/cache wait. Never let an ETag shortcut this check.
  const after = await io.read();
  if (!after || identity(after, width) !== key) return null;
  return { bytes, etag: `"${createHash("sha256").update(bytes).digest("hex")}"` };
}
