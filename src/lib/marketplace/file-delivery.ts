import { createHash } from "node:crypto";

export const MAX_DELIVERY_BYTES = 100 * 1024 * 1024;

export function matchesContentHash(bytes: Uint8Array, expected: string): boolean {
  return /^[a-f0-9]{64}$/.test(expected) && createHash("sha256").update(bytes).digest("hex") === expected;
}

// Single ranges only. Verify the entire immutable object before returning a slice.
export function parseByteRange(header: string | null, size: number): { start: number; end: number } | null | "invalid" {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size < 1) return "invalid";
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return "invalid";
  return { start, end };
}

export interface DeliveryDescriptor { vault_path: string; vault_version: string; content_sha256: string }

// Injectable I/O makes revocation and byte/version mismatches testable without a database.
export async function loadVerifiedFile(input: {
  size: number;
  authorized: () => Promise<boolean>;
  descriptor: () => Promise<DeliveryDescriptor | null>;
  download: (path: string) => Promise<Blob | null>;
}): Promise<Uint8Array | null> {
  if (!Number.isSafeInteger(input.size) || input.size < 1 || input.size > MAX_DELIVERY_BYTES || !await input.authorized()) return null;
  const before = await input.descriptor();
  if (!before) return null;
  const blob = await input.download(before.vault_path);
  if (!blob || blob.size !== input.size) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!matchesContentHash(bytes, before.content_sha256)) return null;
  const after = await input.descriptor();
  if (!after || after.vault_path !== before.vault_path || after.vault_version !== before.vault_version || after.content_sha256 !== before.content_sha256) return null;
  return await input.authorized() ? bytes : null;
}
