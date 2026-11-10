import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { validateRaster } from "../src/lib/marketplace/raster-validation.ts";

test("trusted raster validation fully decodes JPEG/PNG/WebP and hashes the original bytes", async () => {
  for (const [format, mime] of [["jpeg", "image/jpeg"], ["png", "image/png"], ["webp", "image/webp"]]) {
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "white" } }).toFormat(format).toBuffer();
    const result = await validateRaster(bytes, mime, bytes.length);
    assert.equal(result.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(result.width, 8); assert.equal(result.height, 8);
    await assert.rejects(() => validateRaster(bytes, "image/gif", bytes.length));
    await assert.rejects(() => validateRaster(bytes, mime, bytes.length + 1));
    await assert.rejects(() => validateRaster(bytes.subarray(0, 12), mime, 12));
  }
});
test("raster gate rejects MIME lies, scripts, SVG and excessive dimensions", async () => {
  const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: "white" } }).png().toBuffer();
  await assert.rejects(() => validateRaster(png, "image/jpeg", png.length));
  for (const text of ["<script>alert(1)</script>", "<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'></svg>"]) {
    const bytes = Buffer.from(text); await assert.rejects(() => validateRaster(bytes, "image/png", bytes.length));
  }
  const huge = await sharp({ create: { width: 4001, height: 4000, channels: 3, background: "white" } }).png().toBuffer();
  await assert.rejects(() => validateRaster(huge, "image/png", huge.length));
});
