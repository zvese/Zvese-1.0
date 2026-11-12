import sharp from "sharp";

export async function transformThumbnail(bytes: Uint8Array, width: number, mime: string): Promise<Uint8Array> {
  const image = sharp(bytes, { failOn: "warning", limitInputPixels: 16_000_000, animated: false });
  const info = await image.metadata();
  const format = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" }[mime];
  if (!format || info.format !== format || (info.pages ?? 1) !== 1) throw new Error("Unsupported image");
  return image.rotate().resize({ width, height: width, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 78, effort: 3 }).timeout({ seconds: 5 }).toBuffer();
}
