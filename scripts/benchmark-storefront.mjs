// GET-only benchmark. Stores timings/counts, never HTML, cookies or credentials.
import { writeFileSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
const port = Number(process.argv[2] || 3001);
if (![3001, 3002].includes(port)) throw new Error("Only local benchmark ports are allowed");
const origin = `http://localhost:${port}`;
const output = process.argv[3] || "docs/performance-baseline.json";
const samples = Math.max(1, Math.min(10, Number(process.argv[4]) || 5));
const results = { timestamp: new Date().toISOString(), port, samples, routes: {}, bundle: {}, notes: ["Node HTTP client; no browser render/decode/hydration or field Web Vitals", "Sequential samples; percentiles use nearest rank; small sample, not load testing"] };
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
async function request(path, headers = {}) {
  const start = performance.now();
  const response = await fetch(new URL(path, origin), { redirect: "manual", headers, signal: AbortSignal.timeout(60_000) });
  const ttfb = performance.now() - start;
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { response, bytes, ttfb, total: performance.now() - start };
}
async function measure(label, path) {
  const rows = []; let last;
  for (let i = 0; i < samples; i++) {
    last = await request(path);
    rows.push({ status: last.response.status, ttfbMs: Math.round(last.ttfb), totalMs: Math.round(last.total), bytes: last.bytes.length, ...(label === "productImage" ? { serverTiming: last.response.headers.get("server-timing") } : {}) });
  }
  results.routes[label] = { samples: rows, ttfb: Object.fromEntries([.5, .75, .95].map(p => [`p${p * 100}`, percentile(rows.map(r => r.ttfbMs), p)])), total: Object.fromEntries([.5, .75, .95].map(p => [`p${p * 100}`, percentile(rows.map(r => r.totalMs), p)])) };
  console.log(JSON.stringify({ stage: label, ...results.routes[label] }));
  return last;
}
try {
  const page = await measure("marketplace", "/marketplace");
  const html = new TextDecoder().decode(page.bytes);
  const detail = html.match(/href="(\/marketplace\/[^"?]+)"/)?.[1];
  const image = html.match(/src="(\/api\/product-(?:files|thumbnails)\/[^" ]+)"/)?.[1]?.replaceAll("&amp;", "&");
  const listing = html.match(/\/checkout\/([a-f0-9-]{36})/)?.[1];
  if (detail) await measure("productDetail", detail);
  if (image) {
    const last = await measure("productImage", image);
    results.imageCacheControl = last.response.headers.get("cache-control");
    results.imageContentType = last.response.headers.get("content-type");
    const etag = last.response.headers.get("etag");
    if (etag) {
      const conditional = await request(image, { "If-None-Match": etag });
      results.conditionalImage = { status: conditional.response.status, totalMs: Math.round(conditional.total), bytes: conditional.bytes.length };
    }
  }
  for (const [label, path] of [["search", "/marketplace?q=Zvese"], ["home", "/"], ["signIn", "/sign-in"], ["cart", "/cart"], ["accountGuest", "/account"], ["adminGuest", "/admin/products"], ...(listing ? [["checkoutGuest", `/checkout/${listing}`]] : [])]) await measure(label, path);
  const chunks = [...new Set([...html.matchAll(/src="([^" ]+\.js(?:\?[^" ]*)?)"/g)].map(m => m[1]))].filter(path => path.startsWith("/_next/"));
  let raw = 0, gzip = 0;
  for (const path of chunks) { const r = await request(path); raw += r.bytes.length; gzip += gzipSync(r.bytes).length; }
  results.bundle = { marketplaceScriptFiles: chunks.length, uncompressedBytes: raw, estimatedGzipBytes: gzip };
  results.buildId = readFileSync(port === 3001 ? ".next/BUILD_ID" : ".next-perf/BUILD_ID", "utf8").trim();
} catch {
  results.error = "Benchmark request failed or timed out; no raw error or response logged";
  process.exitCode = 1;
} finally {
  writeFileSync(output, JSON.stringify(results, null, 2) + "\n");
  console.log(JSON.stringify({ output, error: results.error ?? null, bundle: results.bundle }));
}
