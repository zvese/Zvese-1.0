// Cache only derived, verified public image bytes. Access decisions are never
// cached: callers must authorize before AND after every use, including 304s.
export class ThumbnailCache {
  private entries = new Map<string, { bytes: Uint8Array; expires: number }>();
  private pending = new Map<string, Promise<Uint8Array>>();
  private bytes = 0;
  private maxBytes: number;
  private ttlMs: number;
  private maxPending: number;
  private active = 0;
  private waiters: (() => void)[] = [];
  constructor(maxBytes = 32 * 1024 * 1024, ttlMs = 300_000, maxPending = 32) {
    this.maxBytes = maxBytes; this.ttlMs = ttlMs; this.maxPending = maxPending;
  }

  async get(key: string, produce: () => Promise<Uint8Array>): Promise<Uint8Array> {
    const hit = this.entries.get(key);
    if (hit && hit.expires > Date.now()) {
      this.entries.delete(key); this.entries.set(key, hit);
      return hit.bytes;
    }
    if (hit) { this.bytes -= hit.bytes.byteLength; this.entries.delete(key); }
    const pending = this.pending.get(key);
    if (pending) return pending;
    // Bound simultaneous full-resolution downloads/decodes, not just saved bytes.
    if (this.pending.size >= this.maxPending) throw new Error("Thumbnail capacity reached");
    const work = Promise.resolve().then(async () => {
      if (this.active >= 4) await new Promise<void>(resolve => this.waiters.push(resolve));
      else this.active++;
      try { return await produce(); }
      finally {
        const next = this.waiters.shift();
        if (next) next(); else this.active--;
      }
    }).then(bytes => {
      if (bytes.byteLength <= this.maxBytes) {
        while (this.bytes + bytes.byteLength > this.maxBytes && this.entries.size) {
          const oldest = this.entries.keys().next().value!;
          this.bytes -= this.entries.get(oldest)!.bytes.byteLength;
          this.entries.delete(oldest);
        }
        this.entries.set(key, { bytes, expires: Date.now() + this.ttlMs });
        this.bytes += bytes.byteLength;
      }
      return bytes;
    }).finally(() => { this.pending.delete(key); });
    this.pending.set(key, work);
    return work;
  }
}
