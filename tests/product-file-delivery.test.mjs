import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { loadVerifiedFile, matchesContentHash, parseByteRange, MAX_DELIVERY_BYTES } from "../src/lib/marketplace/file-delivery.ts";

const bytes = new TextEncoder().encode("trusted bytes");
const descriptor = { vault_path: "internal/path", vault_version: "version-1", content_sha256: createHash("sha256").update(bytes).digest("hex") };
const fixture = (overrides = {}) => ({ size: bytes.length, authorized: async () => true, descriptor: async () => descriptor, download: async () => new Blob([bytes]), ...overrides });

test("returns only exact validated content, checking access on both sides of download", async () => {
  let checks = 0;
  assert.deepEqual(await loadVerifiedFile(fixture({ authorized: async () => { checks++; return true; } })), bytes);
  assert.equal(checks, 2);
  assert.equal(matchesContentHash(bytes, "not-a-hash"), false);
});
test("unauthorized/private cross-seller access fails before touching Storage", async () => {
  let downloaded = false;
  assert.equal(await loadVerifiedFile(fixture({ authorized: async () => false, download: async () => { downloaded = true; return new Blob([bytes]); } })), null);
  assert.equal(downloaded, false);
});
test("withdrawal or seller suspension during download prevents delivery", async () => {
  let checks = 0;
  assert.equal(await loadVerifiedFile(fixture({ authorized: async () => ++checks === 1 })), null);
});
test("changed bytes, version, hash, missing validation and size mismatches fail closed", async () => {
  const changed = bytes.slice(); changed[0] ^= 1;
  assert.equal(await loadVerifiedFile(fixture({ download: async () => new Blob([changed]) })), null);
  assert.equal(await loadVerifiedFile(fixture({ descriptor: async () => null })), null);
  assert.equal(await loadVerifiedFile(fixture({ size: bytes.length + 1 })), null);
  assert.equal(await loadVerifiedFile(fixture({ size: MAX_DELIVERY_BYTES + 1 })), null);
  for (const field of ["vault_path", "vault_version", "content_sha256"]) {
    let reads = 0;
    assert.equal(await loadVerifiedFile(fixture({ descriptor: async () => ++reads === 1 ? descriptor : { ...descriptor, [field]: "changed" } })), null);
  }
});
test("single HTTP byte ranges, suffixes, oversized ends and invalid requests", () => {
  assert.equal(parseByteRange(null, 100), null);
  assert.deepEqual(parseByteRange("bytes=0-9", 100), { start: 0, end: 9 });
  assert.deepEqual(parseByteRange("bytes=90-", 100), { start: 90, end: 99 });
  assert.deepEqual(parseByteRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.deepEqual(parseByteRange("bytes=0-999", 100), { start: 0, end: 99 });
  for (const header of ["bytes=-", "bytes=-0", "bytes=100-", "bytes=20-10", "bytes=0-1,4-5", "bytes=9007199254740992-", "other=0-9"]) assert.equal(parseByteRange(header, 100), "invalid", header);
});
