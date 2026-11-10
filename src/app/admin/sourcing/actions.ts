"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isUuid } from "@/lib/admin/seller-review-data";
import { getProductModerator } from "@/lib/admin/product-review-server";
import { isProductModerator } from "@/lib/admin/product-review";
import { parseCsvCatalog } from "@/lib/sourcing/csv";
import { normalizeSourcingRecord, parseJsonCatalog, safeSourceUrl, type DuplicateMatches } from "@/lib/sourcing/pipeline";
import { createProductSystemClient } from "@/lib/supabase/product-system";
import { sourcingMediaApprovalBlocker } from "@/lib/sourcing/media-review";

function field(form: FormData, name: string, maximum: number) {
  return String(form.get(name) ?? "").trim().slice(0, maximum);
}

function destination(message: string, error = false) {
  return `/admin/sourcing?${error ? "error" : "message"}=${encodeURIComponent(message)}`;
}

async function activeSuperAdmin() {
  const actor = await getProductModerator();
  if (!isProductModerator(actor)) throw new Error("Active super administrator access is required.");
  return actor;
}

export async function createSupplier(form: FormData): Promise<never> {
  let outcome = destination("Supplier created.");
  try {
    const actor = await activeSuperAdmin();
    const code = field(form, "code", 80).toLowerCase();
    const displayName = field(form, "display_name", 160);
    const supplierType = field(form, "supplier_type", 40);
    const status = field(form, "status", 40);
    const websiteInput = field(form, "website_url", 2000);
    const websiteUrl = websiteInput ? safeSourceUrl(websiteInput) : null;
    if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(code) || displayName.length < 2
      || !["supplier", "manufacturer", "authorized_distributor"].includes(supplierType)
      || !["pending", "active", "held", "suspended", "rejected", "closed"].includes(status)
      || (websiteInput && !websiteUrl)) throw new Error("Enter valid supplier details and an optional safe HTTPS website.");
    const current = await activeSuperAdmin();
    if (current.id !== actor.id) throw new Error("Your sourcing authorization changed. Sign in again.");
    const { error } = await createProductSystemClient().rpc("create_supplier", {
      p_admin_id: actor.id, p_code: code, p_display_name: displayName, p_supplier_type: supplierType,
      p_status: status, p_website_url: websiteUrl,
    });
    if (error) throw new Error(error.code === "23505" ? "That supplier code already exists." : "Could not create the supplier.");
    revalidatePath("/admin/sourcing");
  } catch (error) {
    outcome = destination(error instanceof Error ? error.message : "Could not create the supplier.", true);
  }
  redirect(outcome);
}

export async function updateSupplierStatus(form: FormData): Promise<never> {
  let outcome = destination("Supplier status updated.");
  try {
    const actor = await activeSuperAdmin();
    const supplierId = field(form, "supplier_id", 50);
    const status = field(form, "status", 40);
    if (!isUuid(supplierId) || !["pending", "active", "held", "suspended", "rejected", "closed"].includes(status)) throw new Error("Choose a valid supplier status.");
    const current = await activeSuperAdmin();
    if (current.id !== actor.id) throw new Error("Your sourcing authorization changed. Sign in again.");
    const { error } = await createProductSystemClient().rpc("set_supplier_status", {
      p_supplier_id: supplierId, p_admin_id: actor.id, p_status: status,
    });
    if (error) throw new Error("Could not update the supplier status.");
    revalidatePath("/admin/sourcing");
  } catch (error) {
    outcome = destination(error instanceof Error ? error.message : "Could not update the supplier status.", true);
  }
  redirect(outcome);
}

async function findDuplicates(system: ReturnType<typeof createProductSystemClient>, supplierId: string, normalized: NonNullable<ReturnType<typeof normalizeSourcingRecord>["normalized"]>): Promise<DuplicateMatches> {
  const noResult = () => Promise.resolve({ data: null, error: null });
  const liveStatuses = ["needs_review", "held", "approved"];
  const [supplierSku, candidateSku, supplierGtin, candidateGtin, supplierManufacturer, candidateManufacturer,
    sourceProduct, sourceCandidate, product] = await Promise.all([
    system.from("supplier_products").select("id").eq("supplier_id", supplierId).eq("source_sku_identity", normalized.sourceSku.toLowerCase()).limit(1).maybeSingle(),
    system.from("sourcing_candidates").select("id").eq("supplier_id", supplierId).eq("source_sku_identity", normalized.sourceSku.toLowerCase()).in("status", liveStatuses).limit(1).maybeSingle(),
    normalized.gtin ? system.from("supplier_products").select("id").eq("supplier_id", supplierId).eq("gtin", normalized.gtin).limit(1).maybeSingle() : noResult(),
    normalized.gtin ? system.from("sourcing_candidates").select("id").eq("supplier_id", supplierId).eq("gtin", normalized.gtin).in("status", liveStatuses).limit(1).maybeSingle() : noResult(),
    normalized.manufacturerSku ? system.from("supplier_products").select("id").eq("supplier_id", supplierId).eq("manufacturer_sku_identity", normalized.manufacturerSku.toLowerCase()).limit(1).maybeSingle() : noResult(),
    normalized.manufacturerSku ? system.from("sourcing_candidates").select("id").eq("supplier_id", supplierId).eq("manufacturer_sku_identity", normalized.manufacturerSku.toLowerCase()).in("status", liveStatuses).limit(1).maybeSingle() : noResult(),
    normalized.sourceUrl ? system.from("supplier_products").select("id").eq("supplier_id", supplierId).eq("source_url_identity", normalized.sourceUrl).limit(1).maybeSingle() : noResult(),
    normalized.sourceUrl ? system.from("sourcing_candidates").select("id").eq("supplier_id", supplierId).eq("source_url_identity", normalized.sourceUrl).in("status", liveStatuses).limit(1).maybeSingle() : noResult(),
    !normalized.gtin && !normalized.manufacturerSku ? system.from("products").select("id").eq("title", normalized.title).limit(1).maybeSingle() : noResult(),
  ]);
  if ([supplierSku.error, candidateSku.error, supplierGtin.error, candidateGtin.error, supplierManufacturer.error,
    candidateManufacturer.error, sourceProduct.error, sourceCandidate.error, product.error].some(Boolean)) throw new Error("Could not complete duplicate checks.");
  return {
    supplierProductId: supplierSku.data?.id ?? supplierGtin.data?.id ?? null,
    candidateId: candidateSku.data?.id ?? candidateGtin.data?.id ?? null,
    productId: product.data?.id ?? null,
    sourceUrlMatch: Boolean(sourceProduct.data || sourceCandidate.data),
    manufacturerSkuMatch: Boolean(supplierManufacturer.data || candidateManufacturer.data),
  };
}

export async function importSupplierCatalog(form: FormData): Promise<never> {
  let outcome = destination("Catalog import completed.");
  try {
    const actor = await activeSuperAdmin();
    const supplierId = field(form, "supplier_id", 50);
    const sellerId = field(form, "target_seller_id", 50);
    const categorySlug = field(form, "category_slug", 160).toLowerCase();
    const importType = field(form, "import_type", 30);
    const sourceReference = field(form, "source_reference", 300);
    const payload = field(form, "payload", 500_001);
    if (!isUuid(supplierId) || !isUuid(sellerId) || sourceReference.length < 2
      || !["api_catalog", "csv", "json", "manual"].includes(importType)) throw new Error("Select a supplier, seller, category, import type, and source reference.");
    const records = importType === "csv" ? parseCsvCatalog(payload) : parseJsonCatalog(payload);
    const system = createProductSystemClient();
    const [supplierResult, sellerResult, categoriesResult] = await Promise.all([
      system.from("suppliers").select("id,display_name,supplier_type,status").eq("id", supplierId).maybeSingle(),
      system.from("seller_profiles").select("id,status").eq("id", sellerId).maybeSingle(),
      system.from("categories").select("id,slug,is_active").eq("is_active", true),
    ]);
    if (supplierResult.error || !supplierResult.data || supplierResult.data.status !== "active") throw new Error("An active supplier is required.");
    if (sellerResult.error || !sellerResult.data || sellerResult.data.status !== "active") throw new Error("An active target seller is required.");
    if (categoriesResult.error || !(categoriesResult.data ?? []).some((category) => category.slug === categorySlug)) throw new Error("An active existing category is required.");

    const supplier = { id: supplierResult.data.id, displayName: supplierResult.data.display_name,
      supplierType: supplierResult.data.supplier_type as "supplier" | "manufacturer" | "authorized_distributor", status: supplierResult.data.status };
    const categories = (categoriesResult.data ?? []).map((category) => ({ id: category.id, slug: category.slug, isActive: category.is_active }));
    const accepted: Array<{ source: Record<string, unknown>; result: ReturnType<typeof normalizeSourcingRecord> }> = [];
    const rejected: Array<{ index: number; errors: string[] }> = [];
    const batchSkus = new Set<string>();
    const batchGtins = new Set<string>();
    for (const [index, record] of records.entries()) {
      const initial = normalizeSourcingRecord(record, { supplier, categories, defaultCategorySlug: categorySlug, availabilityVerified: false });
      if (!initial.valid || !initial.normalized) { rejected.push({ index: index + 1, errors: initial.errors }); continue; }
      const skuKey = initial.normalized.sourceSku.toLowerCase();
      const gtinKey = initial.normalized.gtin;
      if (batchSkus.has(skuKey) || (gtinKey !== null && batchGtins.has(gtinKey))) {
        rejected.push({ index: index + 1, errors: ["Duplicate supplier SKU or GTIN within this import."] });
        continue;
      }
      batchSkus.add(skuKey);
      if (gtinKey) batchGtins.add(gtinKey);
      const duplicate = await findDuplicates(system, supplierId, initial.normalized);
      if (duplicate.candidateId) {
        rejected.push({ index: index + 1, errors: ["A live sourcing candidate already uses this supplier SKU or GTIN."] });
        continue;
      }
      const result = normalizeSourcingRecord(record, { supplier, categories, defaultCategorySlug: categorySlug, duplicate, availabilityVerified: false });
      accepted.push({ source: record as Record<string, unknown>, result });
    }

    const current = await activeSuperAdmin();
    if (current.id !== actor.id) throw new Error("Your sourcing authorization changed. Sign in again.");
    const rawPayload = records.length === 1 ? records[0] : records;
    const { data: importRow, error: importError } = await system.from("sourcing_imports").insert({
      supplier_id: supplierId, import_type: importType, source_reference: sourceReference,
      status: accepted.length ? "validated" : "failed", raw_payload: rawPayload,
      summary: { accepted: accepted.length, rejected }, submitted_by: actor.id,
    }).select("id").single();
    if (importError || !importRow) throw new Error("Could not record the sourcing import.");

    for (const item of accepted) {
      const normalized = item.result.normalized!;
      const duplicate = item.result.duplicate;
      const { data: candidate, error: candidateError } = await system.from("sourcing_candidates").insert({
        import_id: importRow.id, supplier_id: supplierId, target_seller_id: sellerId, category_id: normalized.categoryId,
        source_sku: normalized.sourceSku, manufacturer_sku: normalized.manufacturerSku, gtin: normalized.gtin,
        source_reference: normalized.sourceReference, source_url: normalized.sourceUrl, title: normalized.title,
        description: normalized.description, brand: normalized.brand, source_cost_minor: normalized.sourceCostMinor,
        proposed_price_minor: normalized.proposedPriceMinor, currency: normalized.currency,
        estimated_gross_margin_bps: normalized.grossMarginBps, pricing_policy: normalized.pricingPolicy,
        availability_state: normalized.availability,
        stock_quantity: normalized.stockQuantity, variants: normalized.variants,
        sizes: normalized.sizes, handling_time_min_days: normalized.handlingTimeMinDays,
        handling_time_max_days: normalized.handlingTimeMaxDays, shipping: normalized.shipping,
        minimum_order_quantity: normalized.moq, last_availability_check: normalized.lastAvailabilityCheck,
        last_price_check: normalized.lastPriceCheck, normalized_snapshot: normalized, source_snapshot: item.source,
        warnings: item.result.warnings, validation_errors: item.result.errors,
        duplicate_supplier_product_id: duplicate.supplierProductId ?? null, duplicate_candidate_id: duplicate.candidateId ?? null,
        duplicate_product_id: duplicate.productId ?? null, duplicate_source_url: duplicate.sourceUrlMatch === true,
        media_status: normalized.mediaStatus,
      }).select("id").single();
      if (candidateError || !candidate) throw new Error("Import was recorded, but a draft candidate could not be saved. Review the import audit before retrying.");
      if (normalized.media.length) {
        const { error: mediaError } = await system.from("sourcing_media_candidates").insert(normalized.media.map((media) => ({
          candidate_id: candidate.id, media_type: media.mediaType, source_url: media.sourceUrl,
          provenance_type: media.provenanceType, rights_status: media.rightsStatus, variant_reference: media.variant,
          match_status: media.matchStatus, width: media.width, height: media.height,
          watermarked: media.watermarked, synthetic: media.synthetic,
          match_confidence: media.matchConfidence, quality_score: media.qualityScore,
          selected_role: media.selectedRole, warnings: media.warnings,
        })));
        if (mediaError) throw new Error("Candidate saved, but its media references need administrator follow-up.");
      }
    }
    outcome = destination(`Import complete: ${accepted.length} candidate(s) queued; ${rejected.length} rejected during validation.`);
    revalidatePath("/admin/sourcing");
  } catch (error) {
    outcome = destination(error instanceof Error ? error.message : "Could not import the supplier catalog.", true);
  }
  redirect(outcome);
}

export async function decideSourcingMedia(form: FormData): Promise<never> {
  let outcome = destination("Media review recorded. Product publication still requires the existing moderation flow.");
  try {
    const actor = await activeSuperAdmin();
    const mediaId = field(form, "media_id", 50);
    const decision = field(form, "decision", 20);
    const note = String(form.get("note") ?? "").trim();
    if (!isUuid(mediaId) || !["approve", "reject"].includes(decision)
      || note.length < 10 || note.length > 2000 || /[\u0000-\u001f\u007f]/.test(note)) {
      throw new Error("Choose approve or reject and enter a review note of 10–2000 characters without control characters.");
    }
    const system = createProductSystemClient();
    const current = await activeSuperAdmin();
    if (current.id !== actor.id) throw new Error("Your sourcing authorization changed. Sign in again.");
    const { error } = await system.rpc("record_sourcing_media_decision", {
      p_media_id: mediaId, p_admin_id: current.id, p_decision: decision, p_note: note,
    });
    if (error) throw new Error("Media review was not accepted. Refresh and check that the candidate is open, media is pending, and approval meets the rights and match requirements.");
    revalidatePath("/admin/sourcing");
  } catch (error) {
    outcome = destination(error instanceof Error ? error.message : "Could not record the media review.", true);
  }
  redirect(outcome);
}

export async function decideSourcingCandidate(form: FormData): Promise<never> {
  let outcome = destination("Sourcing decision recorded.");
  try {
    const actor = await activeSuperAdmin();
    const candidateId = field(form, "candidate_id", 50);
    const decision = field(form, "decision", 20);
    const note = field(form, "note", 2000);
    if (!isUuid(candidateId) || !["approve", "reject", "hold"].includes(decision) || note.length < 10) throw new Error("Choose a decision and enter a note of at least 10 characters.");
    const system = createProductSystemClient();
    if (decision === "approve") {
      const { data, error } = await system.from("sourcing_media_candidates")
        .select("media_type,selected_role,review_status,rights_status,match_status,match_confidence,watermarked,synthetic")
        .eq("candidate_id", candidateId);
      if (error || !data) throw new Error("Could not verify required media. Refresh before approving.");
      const blocker = sourcingMediaApprovalBlocker(data);
      if (blocker) throw new Error(blocker);
    }
    const current = await activeSuperAdmin();
    if (current.id !== actor.id) throw new Error("Your sourcing authorization changed. Sign in again.");
    const { error } = await system.rpc("record_sourcing_decision", {
      p_candidate_id: candidateId, p_admin_id: actor.id, p_decision: decision, p_note: note,
    });
    if (error) throw new Error(["40001", "23505", "40P01", "55000"].includes(error.code ?? "")
      ? "This candidate changed, is duplicated, or was already decided. Refresh before retrying."
      : "The decision was not accepted. Check supplier, seller, category, validation, and duplicate status.");
    revalidatePath("/admin/sourcing");
    revalidatePath("/account/listings/new");
  } catch (error) {
    outcome = destination(error instanceof Error ? error.message : "Could not record the sourcing decision.", true);
  }
  redirect(outcome);
}
