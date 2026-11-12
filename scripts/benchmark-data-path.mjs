// Read-only remote queries through anonymous RLS and GET-only validated descriptor
// RPCs. No SQL, inserts, uploads, auth mutations or raw record logging.
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as catalogQuery from "../src/lib/marketplace/catalog-query.ts";
import { loadPublicThumbnail } from "../src/lib/marketplace/public-thumbnail.ts";
import { transformThumbnail } from "../src/lib/marketplace/thumbnail-transform.ts";
nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const timings = [];
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: async (url, init) => {
  const start = performance.now();
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  // Classify only; never log URL/headers/query strings/response bodies.
  timings.push({ kind: String(url).includes('/storage/') ? 'storage' : String(url).includes('/rpc/') ? 'rpc' : 'select', status: response.status, headersMs: Math.round(performance.now() - start) });
  return response;
} } };
const catalog = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, options);
const system = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
function load(path) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { exports, require(name) {
    if (name === '@/lib/supabase/catalog') return { createCatalogClient: () => catalog };
    if (name === 'react') return { cache: fn => fn };
    if (name === './catalog-query') return catalogQuery;
    throw new Error('Unexpected dependency');
  } });
  return exports;
}
const products = load('src/lib/marketplace/products.ts');
const images = load('src/lib/marketplace/public-card-images.ts');
const report = { queries: [], thumbnails: [], transport: timings };
try {
  let listing;
  for (const term of ['', 'Zvese', '%', '_', '*', '.*', '"),id.not.is.null']) {
    const start = performance.now(); const count = timings.length;
    const result = await products.getActiveMarketplaceListings(undefined, term, 1);
    report.queries.push({ case: term === '' ? 'page' : term === 'Zvese' ? 'known-search' : 'literal-special-characters', totalMs: Math.round(performance.now() - start), requests: timings.length - count, count: result.data?.length ?? null, failed: !!result.error });
    if (!term) listing = result.data?.[0];
    if (result.error) process.exitCode = 1;
  }
  if (listing) {
    const count = timings.length, start = performance.now();
    const map = await images.getPublicCardImages([listing.id]);
    report.imageMetadata = { requests: timings.length - count, totalMs: Math.round(performance.now() - start), images: Object.keys(map).length };
    const id = map[listing.id];
    if (id) for (let i = 0; i < 5; i++) {
      const stages = { accessMs: 0, storageMs: 0, transformMs: 0 };
      const start = performance.now(), count = timings.length;
      const result = await loadPublicThumbnail(640, {
        read: async () => {
          const start = performance.now();
          const [file, descriptor] = await Promise.all([
            catalog.from('product_files').select('id,size_bytes,mime_type').eq('id', id).eq('visibility', 'public').eq('reservation_state', 'finalized').eq('content_validation_state', 'passed').maybeSingle(),
            system.rpc('get_validated_file_delivery', { p_file_id: id }, { get: true }),
          ]);
          stages.accessMs += performance.now() - start;
          if (file.error || descriptor.error || !file.data || !descriptor.data?.[0]) return null;
          report.originalBytes = Number(file.data.size_bytes);
          return { id, size: Number(file.data.size_bytes), mime: file.data.mime_type, descriptor: descriptor.data[0] };
        },
        download: async path => {
          const start = performance.now();
          const { data, error } = await system.storage.from('product-validated-files').download(path);
          stages.storageMs += performance.now() - start;
          return error ? null : data;
        },
        transform: async (...args) => {
          const start = performance.now(); const output = await transformThumbnail(...args);
          stages.transformMs += performance.now() - start; return output;
        },
      });
      report.thumbnails.push({ sample: i + 1, totalMs: Math.round(performance.now() - start), requests: timings.length - count, bytes: result?.bytes.length ?? null, ...Object.fromEntries(Object.entries(stages).map(([k, v]) => [k, Math.round(v)])) });
      console.log(JSON.stringify(report.thumbnails.at(-1)));
    }
  }
} catch { report.error = 'Read-only benchmark failed; details omitted'; process.exitCode = 1; }
writeFileSync('docs/performance-data-path.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ queries: report.queries, imageMetadata: report.imageMetadata, originalBytes: report.originalBytes, error: report.error ?? null }));
