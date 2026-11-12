import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { ThumbnailCache } from "../src/lib/marketplace/thumbnail-cache.ts";
import { loadPublicThumbnail } from "../src/lib/marketplace/public-thumbnail.ts";
import { transformThumbnail } from "../src/lib/marketplace/thumbnail-transform.ts";

const original = new Uint8Array([1, 2, 3]);
const image = { id: "file", mime: "image/png", size: 3, descriptor: { vault_path: "private-vault-path", vault_version: "v1", content_sha256: createHash("sha256").update(original).digest("hex") } };
function fixture() {
  const counts = { read: 0, download: 0, transform: 0 };
  const io = {
    read: async () => { counts.read++; return image; },
    download: async () => { counts.download++; return new Blob([original]); },
    transform: async () => { counts.transform++; return new Uint8Array([4, 5]); },
  };
  return { counts, io, cache: new ThumbnailCache() };
}
test("warm public thumbnail avoids repeat Storage download and transform but rechecks access twice", async () => {
  const f = fixture();
  const first = await loadPublicThumbnail(640, f.io, f.cache);
  const second = await loadPublicThumbnail(640, f.io, f.cache);
  assert.equal(first.etag, second.etag);
  assert.deepEqual(f.counts, { read: 4, download: 1, transform: 1 });
  assert.doesNotMatch(first.etag, /private-vault-path/);
});
test("private, unpublished, unvalidated or revoked metadata cannot use cached bytes", async () => {
  const f = fixture();
  await loadPublicThumbnail(640, f.io, f.cache);
  f.io.read = async () => null;
  assert.equal(await loadPublicThumbnail(640, f.io, f.cache), null);
  assert.equal(f.counts.download, 1);
});
test("withdrawal or descriptor change during cached/uncached request denies response", async () => {
  for (const warm of [false, true]) for (const after of [null, { ...image, descriptor: { ...image.descriptor, vault_version: "v2" } }, { ...image, size: 4 }]) {
    const f = fixture();
    if (warm) await loadPublicThumbnail(640, f.io, f.cache);
    let reads = 0;
    f.io.read = async () => ++reads === 1 ? image : after;
    assert.equal(await loadPublicThumbnail(640, f.io, f.cache), null);
  }
});
test("tampered original, unsupported MIME, oversized source and arbitrary sizes fail closed", async () => {
  const f = fixture();
  f.io.download = async () => new Blob([new Uint8Array([7, 8, 9])]);
  await assert.rejects(loadPublicThumbnail(640, f.io, f.cache), /mismatch/);
  assert.equal(f.counts.transform, 0);
  for (const changed of [{ ...image, mime: "application/pdf" }, { ...image, size: 11 * 1024 * 1024 }]) {
    f.io.read = async () => changed;
    assert.equal(await loadPublicThumbnail(640, f.io, f.cache), null);
  }
  assert.equal(await loadPublicThumbnail(100000, f.io, f.cache), null);
});
test("concurrent identical requests share work while each caller rechecks authorization", async () => {
  const f = fixture();
  const results = await Promise.all(Array.from({ length: 10 }, () => loadPublicThumbnail(640, f.io, f.cache)));
  assert.ok(results.every(Boolean));
  assert.deepEqual(f.counts, { read: 20, download: 1, transform: 1 });
});
test("LRU byte cap, TTL, failed-producer recovery and bounded in-flight queue", async (t) => {
  let clock = 100;
  t.mock.method(Date, "now", () => clock);
  const cache = new ThumbnailCache(4, 10, 1);
  let generated = 0;
  const make = async () => { generated++; return new Uint8Array(3); };
  await cache.get("a", make); await cache.get("b", make); await cache.get("a", make);
  assert.equal(generated, 3);
  clock += 11; await cache.get("a", make); assert.equal(generated, 4);
  await assert.rejects(cache.get("failed", async () => { throw new Error("failed"); }));
  await cache.get("failed", make);
  let finish;
  const pending = cache.get("pending", () => new Promise(resolve => { finish = resolve; }));
  await Promise.resolve();
  await assert.rejects(cache.get("excess", make), /capacity/);
  finish(new Uint8Array(1)); await pending;
});
test("real thumbnail decoder bounds size, preserves ratio, emits WebP and rejects MIME mismatch", async () => {
  const png = await sharp({ create: { width: 1600, height: 800, channels: 3, background: "#2463eb" } }).png().toBuffer();
  const result = await transformThumbnail(png, 320, "image/png");
  const metadata = await sharp(result).metadata();
  assert.equal(metadata.format, "webp"); assert.equal(metadata.width, 320); assert.equal(metadata.height, 160);
  assert.ok(result.length < png.length);
  await assert.rejects(transformThumbnail(png, 320, "image/jpeg"));
});
