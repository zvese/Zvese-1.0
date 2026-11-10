import { isSupportedCurrencyCode } from "../../config/marketplace-options.ts";

export const SOURCING_PRICING_POLICY = "cost-plus-v1:under-10=2.00;under-100=1.65;otherwise=1.45";
const MAX_CATALOG_RECORDS = 50;

export interface SupplierContext {
  id: string;
  displayName: string;
  supplierType: "supplier" | "manufacturer" | "authorized_distributor";
  status: string;
}

export interface SourcingCategory {
  id: string;
  slug: string;
  isActive: boolean;
}

export interface DuplicateMatches {
  supplierProductId?: string | null;
  candidateId?: string | null;
  productId?: string | null;
  sourceUrlMatch?: boolean;
  manufacturerSkuMatch?: boolean;
}

export interface NormalizedMediaCandidate {
  mediaType: "image" | "video" | "rotation_360";
  sourceUrl: string;
  provenanceType: "supplier_catalog" | "manufacturer_official" | "authorized_distributor" | "licensed_source" | "existing_zvese" | "synthetic";
  rightsStatus: "claimed_authorized" | "unknown" | "restricted";
  variant: string | null;
  width: number | null;
  height: number | null;
  watermarked: boolean;
  synthetic: boolean;
  matchStatus: "matched" | "review_required" | "rejected";
  matchConfidence: number;
  qualityScore: number;
  selectedRole: "none" | "hero" | "gallery" | "video";
  reviewStatus: "pending";
  warnings: string[];
}

export interface NormalizedSourcingProduct {
  title: string;
  description: string;
  brand: string | null;
  categoryId: string;
  categorySlug: string;
  supplierId: string;
  supplierName: string;
  sourceSku: string;
  manufacturerSku: string | null;
  gtin: string | null;
  sourceReference: string;
  sourceUrl: string | null;
  sourceCostMinor: number;
  proposedPriceMinor: number;
  currency: string;
  grossMarginBps: number;
  pricingPolicy: string;
  variants: Array<{ name: string; value: string; sku: string | null; availability: "checking" | "available" | "unavailable" }>;
  sizes: string[];
  availability: "checking" | "available" | "unavailable";
  stockQuantity: number | null;
  handlingTimeMinDays: number;
  handlingTimeMaxDays: number;
  shipping: { countries: string[]; methods: string[]; shipsInternationally: boolean };
  moq: number;
  lastAvailabilityCheck: string | null;
  lastPriceCheck: string | null;
  media: NormalizedMediaCandidate[];
  mediaStatus: "ready" | "review_required" | "incomplete";
}

export interface SourcingValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  normalized: NormalizedSourcingProduct | null;
  duplicate: DuplicateMatches;
}

type UnknownRecord = Record<string, unknown>;

function object(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

function text(value: unknown, max: number) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).trim().replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").slice(0, max);
}

function integer(value: unknown, minimum: number, maximum: number, fallback: number | null = null) {
  const parsed = typeof value === "number" ? value : Number(String(value ?? ""));
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

export function safeSourceUrl(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value);
  if (!raw || raw !== raw.trim() || raw.length > 2000 || /[\u0000-\u0020\u007f]/.test(raw)
    || /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(raw)) return null;
  const authority = /^https:\/\/([^/?#]+)/.exec(raw)?.[1] ?? "";
  const rawHost = authority.endsWith(":443") ? authority.slice(0, -4) : authority;
  if (/^[0-9.]+$/.test(rawHost)
    && !/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(rawHost)) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.hash || (url.port && url.port !== "443")
      || !host || host.includes(":") || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return null;
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host)
      && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return null;
    const octets = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) ? host.split(".").map(Number) : null;
    if (octets && (octets.some((octet) => octet > 255) || [0, 10, 127].includes(octets[0]) || octets[0] >= 224
      || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127)
      || (octets[0] === 169 && octets[1] === 254) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && [0, 168].includes(octets[1]))
      || (octets[0] === 192 && octets[1] === 88 && octets[2] === 99)
      || (octets[0] === 198 && [18, 19].includes(octets[1]))
      || (octets[0] === 198 && octets[1] === 51 && octets[2] === 100)
      || (octets[0] === 203 && octets[1] === 0 && octets[2] === 113))) return null;
    url.hostname = host;
    url.port = "";
    return url.toString().replace(/%[0-9a-f]{2}/gi, (escape) => escape.toUpperCase());
  } catch {
    return null;
  }
}

export function moneyToMinor(value: unknown): number | null {
  const candidate = typeof value === "number" ? String(value) : text(value, 40);
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(candidate)) return null;
  const [whole, fraction = ""] = candidate.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(minor) && minor > 0 && minor <= 100_000_000 ? minor : null;
}

export function recommendSalePrice(sourceCostMinor: number) {
  const multiplier = sourceCostMinor < 1_000 ? 2 : sourceCostMinor < 10_000 ? 1.65 : 1.45;
  return Math.max(sourceCostMinor + 1, Math.ceil(sourceCostMinor * multiplier));
}

export function grossMarginBps(costMinor: number, saleMinor: number) {
  if (!Number.isSafeInteger(costMinor) || !Number.isSafeInteger(saleMinor) || saleMinor <= 0) return null;
  return Math.round(((saleMinor - costMinor) / saleMinor) * 10_000);
}

export function mapSourceAvailability(value: unknown, verified = false): "checking" | "available" | "unavailable" {
  const state = text(value, 50).toLowerCase().replace(/[\s-]+/g, "_");
  if (["unavailable", "out_of_stock", "discontinued", "false", "0"].includes(state)) return "unavailable";
  if (verified && ["available", "in_stock", "true", "1"].includes(state)) return "available";
  return "checking";
}

function isoDate(value: unknown) {
  const candidate = text(value, 100);
  if (!candidate) return null;
  const date = new Date(candidate);
  if (!Number.isFinite(date.getTime()) || date.getTime() > Date.now() + 5 * 60_000) return null;
  return date.toISOString();
}

function parseStringArray(value: unknown, maximum = 100) {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[|,]/) : [];
  return [...new Set(raw.map((item) => text(item, 100)).filter(Boolean))].slice(0, maximum);
}

function normalizeVariants(value: unknown, verifiedAvailability: boolean) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((entry) => {
    const item = object(entry);
    if (!item) return [];
    const name = text(item.name ?? item.option, 100);
    const variantValue = text(item.value ?? item.label, 100);
    if (!name || !variantValue) return [];
    return [{
      name,
      value: variantValue,
      sku: text(item.sku, 160) || null,
      availability: mapSourceAvailability(item.availability ?? item.stock, verifiedAvailability),
    }];
  });
}

function mediaInput(record: UnknownRecord) {
  const direct = Array.isArray(record.media) ? record.media : [];
  const images = Array.isArray(record.images) ? record.images.map((item) => typeof item === "string" ? { url: item, type: "image" } : item) : [];
  const videos = Array.isArray(record.videos) ? record.videos.map((item) => typeof item === "string" ? { url: item, type: "video" } : item) : [];
  return [...direct, ...images, ...videos].slice(0, 30);
}

function normalizeMedia(record: UnknownRecord, identity: { sourceSku: string; manufacturerSku: string | null; gtin: string | null; brand: string | null; title: string; variants: string[] }) {
  const candidates: NormalizedMediaCandidate[] = [];
  const seen = new Set<string>();
  for (const raw of mediaInput(record)) {
    const item = typeof raw === "string" ? { url: raw } : object(raw);
    if (!item) continue;
    const sourceUrl = safeSourceUrl(item.url ?? item.source_url);
    if (!sourceUrl || seen.has(sourceUrl)) continue;
    seen.add(sourceUrl);
    const kind = text(item.type ?? item.media_type, 30).toLowerCase();
    const mediaType = kind === "video" ? "video" : kind === "360" || kind === "rotation_360" ? "rotation_360" : "image";
    const provenanceValue = text(item.provenance ?? item.source, 60).toLowerCase();
    const synthetic = item.synthetic === true || provenanceValue === "synthetic";
    const provenanceType: NormalizedMediaCandidate["provenanceType"] = synthetic
      ? "synthetic"
      : provenanceValue === "manufacturer_official" || provenanceValue === "manufacturer"
        ? "manufacturer_official"
        : provenanceValue === "authorized_distributor"
          ? "authorized_distributor"
          : provenanceValue === "licensed_source"
            ? "licensed_source"
            : provenanceValue === "existing_zvese"
              ? "existing_zvese"
              : "supplier_catalog";
    const watermarked = item.watermarked === true;
    const variant = text(item.variant ?? item.color ?? item.size, 120) || null;
    const warnings: string[] = [];
    if (watermarked) warnings.push("Watermarked media is excluded from selection.");
    if (synthetic) warnings.push("Synthetic media must be identified and manually reviewed; it is not authentic manufacturer media.");
    if (variant && identity.variants.length && !identity.variants.some((known) => known.toLowerCase() === variant.toLowerCase())) warnings.push("Media variant does not match a normalized product variant.");

    let match = 0.35;
    if (text(item.source_sku ?? item.sku, 160).toLowerCase() === identity.sourceSku.toLowerCase()) match += 0.3;
    if (identity.manufacturerSku && text(item.manufacturer_sku ?? item.model, 160).toLowerCase() === identity.manufacturerSku.toLowerCase()) match += 0.15;
    if (identity.gtin && text(item.gtin ?? item.ean ?? item.upc, 32) === identity.gtin) match += 0.2;
    if (identity.brand && text(item.brand, 160).toLowerCase() === identity.brand.toLowerCase()) match += 0.1;
    if (text(item.product_name ?? item.title, 200).toLowerCase() === identity.title.toLowerCase()) match += 0.1;
    if (warnings.some((warning) => warning.includes("does not match"))) match -= 0.35;

    const width = integer(item.width, 1, 20_000);
    const height = integer(item.height, 1, 20_000);
    const pixels = width && height ? width * height : 0;
    const quality = mediaType === "image" ? Math.min(1, pixels / 4_000_000) : 0.6;
    const rightsStatus: NormalizedMediaCandidate["rightsStatus"] = item.authorized === true || item.licensed === true
      ? "claimed_authorized"
      : item.restricted === true ? "restricted" : "unknown";
    if (rightsStatus === "claimed_authorized") warnings.push("Media authorization is supplier-claimed and requires administrator confirmation.");
    else warnings.push("Media rights are not confirmed.");
    const matchConfidence = Math.max(0, Math.min(0.99, Number(match.toFixed(2))));
    const matchStatus: NormalizedMediaCandidate["matchStatus"] = warnings.some((warning) => warning.includes("does not match"))
      ? "rejected"
      : matchConfidence >= 0.6 ? "matched" : "review_required";
    candidates.push({
      mediaType,
      sourceUrl,
      provenanceType,
      rightsStatus,
      variant,
      width,
      height,
      watermarked,
      synthetic,
      matchStatus,
      matchConfidence,
      qualityScore: Number(quality.toFixed(2)),
      selectedRole: "none",
      reviewStatus: "pending",
      warnings,
    });
  }

  const eligibleImages = candidates.filter((item) => item.mediaType === "image" && !item.watermarked && !item.synthetic && item.rightsStatus === "claimed_authorized" && item.matchStatus === "matched" && item.matchConfidence >= 0.6)
    .sort((a, b) => (b.matchConfidence + b.qualityScore) - (a.matchConfidence + a.qualityScore));
  if (eligibleImages[0]) eligibleImages[0].selectedRole = "hero";
  eligibleImages.slice(1, 6).forEach((item) => { item.selectedRole = "gallery"; });
  candidates.filter((item) => item.mediaType !== "image" && !item.watermarked && !item.synthetic && item.rightsStatus === "claimed_authorized" && item.matchStatus === "matched" && item.matchConfidence >= 0.6)
    .forEach((item) => { item.selectedRole = "video"; });
  return candidates;
}

export function normalizeSourcingRecord(raw: unknown, context: {
  supplier: SupplierContext;
  categories: SourcingCategory[];
  defaultCategorySlug?: string | null;
  duplicate?: DuplicateMatches;
  availabilityVerified?: boolean;
}): SourcingValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const duplicate = context.duplicate ?? {};
  const record = object(raw);
  if (!record) return { valid: false, errors: ["Catalog record must be an object."], warnings, normalized: null, duplicate };
  if (context.supplier.status !== "active") errors.push("Supplier is not active.");

  const title = text(record.title ?? record.product_name ?? record.name, 160);
  const description = text(record.description ?? record.summary, 2000);
  const brand = text(record.brand ?? record.manufacturer, 160) || null;
  const sourceSku = text(record.source_sku ?? record.sku, 160);
  const manufacturerSku = text(record.manufacturer_sku ?? record.model_number ?? record.model, 160) || null;
  const gtin = text(record.gtin ?? record.ean ?? record.upc, 32).replace(/[^0-9]/g, "") || null;
  const sourceReference = text(record.source_reference ?? record.partner_reference ?? record.source_url ?? record.url, 300);
  const rawUrl = record.source_url ?? record.url;
  const sourceUrl = rawUrl ? safeSourceUrl(rawUrl) : null;
  const currency = text(record.currency, 3).toUpperCase();
  const sourceCostMinor = moneyToMinor(record.source_cost ?? record.cost ?? record.supplier_cost);
  const proposedInput = record.proposed_price ?? record.sale_price;
  const proposedPriceMinor = proposedInput === undefined || proposedInput === null || proposedInput === ""
    ? sourceCostMinor ? recommendSalePrice(sourceCostMinor) : null
    : moneyToMinor(proposedInput);
  const categorySlug = text(record.category_slug ?? record.category ?? context.defaultCategorySlug, 160).toLowerCase();
  const category = context.categories.find((item) => item.isActive && item.slug === categorySlug);

  if (title.length < 3) errors.push("Product title is required and must contain at least 3 characters.");
  if (description.length < 10) errors.push("Product description is required and must contain at least 10 characters.");
  if (sourceSku.length < 2) errors.push("Supplier source SKU is required.");
  if (!sourceReference || (rawUrl && !sourceUrl)) errors.push("A valid source reference or safe HTTPS source URL is required.");
  if (!sourceCostMinor) errors.push("Supplier cost must be a positive amount with no more than 2 decimal places.");
  if (!isSupportedCurrencyCode(currency)) errors.push("Currency is not supported by Zvese.");
  if (!proposedPriceMinor || proposedPriceMinor > 100_000_000 || (sourceCostMinor && proposedPriceMinor <= sourceCostMinor)) errors.push("Proposed sale price must be greater than supplier cost and no more than 1,000,000 currency units.");
  if (!category) errors.push("An active existing Zvese category is required.");
  if (gtin && !/^\d{8,14}$/.test(gtin)) errors.push("GTIN/EAN/UPC must contain 8 to 14 digits.");

  if (duplicate.supplierProductId) warnings.push("Supplier SKU already exists in the supplier catalog.");
  if (duplicate.candidateId) warnings.push("Supplier SKU already exists in the sourcing review queue.");
  if (duplicate.productId) warnings.push("A possible duplicate Zvese product was found.");
  if (duplicate.sourceUrlMatch) warnings.push("Source URL already exists in the supplier catalog.");
  if (duplicate.manufacturerSkuMatch) warnings.push("Manufacturer SKU/model already exists; confirm this is a distinct variant before approval.");

  if (errors.length || !sourceCostMinor || !proposedPriceMinor || !category) {
    return { valid: false, errors, warnings, normalized: null, duplicate };
  }

  const lastAvailabilityCheck = isoDate(record.last_availability_check ?? record.availability_checked_at);
  const lastPriceCheck = isoDate(record.last_price_check ?? record.price_checked_at);
  const availabilityVerified = context.availabilityVerified === true && Boolean(lastAvailabilityCheck);
  const availability = mapSourceAvailability(record.availability ?? record.stock_status ?? record.in_stock, availabilityVerified);
  if (availability === "checking") warnings.push("Source availability requires verification before the listing can become available.");
  if (!lastPriceCheck) warnings.push("Supplier price has not been independently checked.");

  const variants = normalizeVariants(record.variants, availabilityVerified);
  const sizes = parseStringArray(record.sizes);
  const handlingMin = integer(record.handling_time_min_days ?? record.handling_days, 0, 365, 0) ?? 0;
  const handlingMax = integer(record.handling_time_max_days ?? record.handling_days, handlingMin, 365, handlingMin) ?? handlingMin;
  const shippingRecord = object(record.shipping) ?? {};
  const shipping = {
    countries: parseStringArray(shippingRecord.countries ?? record.shipping_countries, 250).map((country) => country.toUpperCase()).filter((country) => /^[A-Z]{2}$/.test(country)),
    methods: parseStringArray(shippingRecord.methods ?? record.shipping_methods, 50),
    shipsInternationally: shippingRecord.international === true || record.ships_internationally === true,
  };
  const moq = integer(record.moq ?? record.minimum_order_quantity, 1, 100_000, 1) ?? 1;
  const stockQuantity = integer(record.stock_quantity ?? record.quantity_available, 0, 1_000_000_000);
  const media = normalizeMedia(record, {
    sourceSku,
    manufacturerSku,
    gtin,
    brand,
    title,
    variants: [...sizes, ...variants.map((variant) => variant.value)],
  });
  const selected = media.filter((item) => item.selectedRole !== "none");
  const mediaStatus = selected.some((item) => item.selectedRole === "hero")
    ? media.some((item) => item.warnings.length > 0) ? "review_required" : "ready"
    : "incomplete";
  if (mediaStatus === "incomplete") warnings.push("Authentic authorized hero media is missing; request supplier or manufacturer media.");
  if (media.some((item) => item.warnings.length > 0)) warnings.push("One or more media candidates require rights, watermark, variant, or authenticity review.");

  const margin = grossMarginBps(sourceCostMinor, proposedPriceMinor);
  return {
    valid: true,
    errors,
    warnings: [...new Set(warnings)],
    duplicate,
    normalized: {
      title,
      description,
      brand,
      categoryId: category.id,
      categorySlug: category.slug,
      supplierId: context.supplier.id,
      supplierName: context.supplier.displayName,
      sourceSku,
      manufacturerSku,
      gtin,
      sourceReference,
      sourceUrl,
      sourceCostMinor,
      proposedPriceMinor,
      currency,
      grossMarginBps: margin ?? 0,
      pricingPolicy: proposedInput === undefined || proposedInput === null || proposedInput === "" ? SOURCING_PRICING_POLICY : "admin-provided-price-v1",
      variants,
      sizes,
      availability,
      stockQuantity,
      handlingTimeMinDays: handlingMin,
      handlingTimeMaxDays: handlingMax,
      shipping,
      moq,
      lastAvailabilityCheck,
      lastPriceCheck,
      media,
      mediaStatus,
    },
  };
}

export function parseJsonCatalog(value: string) {
  if (value.length > 500_000) throw new Error("Catalog input is too large.");
  const parsed: unknown = JSON.parse(value);
  const records = Array.isArray(parsed) ? parsed : [parsed];
  if (!records.length || records.length > MAX_CATALOG_RECORDS) throw new Error(`Catalog must contain 1 to ${MAX_CATALOG_RECORDS} records.`);
  return records;
}
