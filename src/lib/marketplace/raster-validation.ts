import sharp from "sharp";
import { createHash } from "node:crypto";

// MVP raster decoder, not an antivirus scanner. Videos/documents remain blocked
// pending a dedicated validator. Preserve original bytes for the approved vault contract.
export async function validateRaster(bytes: Uint8Array, mime: string, declaredSize: number) {
  if (!Number.isSafeInteger(declaredSize) || declaredSize < 1 || declaredSize > 10 * 1024 * 1024 || bytes.length !== declaredSize)
    throw new Error("Invalid image size.");
  const format = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" }[mime];
  if (!format) throw new Error("Only JPEG, PNG and WebP images are supported by this validator.");
  const image = sharp(bytes, { failOn: "warning", limitInputPixels: 16_000_000, animated: false });
  const metadata = await image.metadata();
  if (metadata.format !== format || !metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1)
    throw new Error("Image format mismatch or unsupported animation.");
  // metadata() alone does not decode pixels. Decode the complete bounded image.
  await image.timeout({ seconds: 10 }).raw().toBuffer();
  return { sha256: createHash("sha256").update(bytes).digest("hex"), width: metadata.width, height: metadata.height };
}
