import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireProductModerator } from "@/lib/admin/product-review-server";
import { createProductSystemClient } from "@/lib/supabase/product-system";
import { createSupplier, decideSourcingCandidate, decideSourcingMedia, importSupplierCatalog, updateSupplierStatus } from "./actions";
import { sourcingMediaApprovalBlocker } from "@/lib/sourcing/media-review";
import { MediaReviewCard, type SourcingMediaDetails } from "./media-review-card";

export const metadata: Metadata = { title: "AI Sourcing | Admin" };

type Supplier = { id: string; code: string; display_name: string; supplier_type: string; status: string; website_url: string | null };
type Seller = { id: string; store_name: string; store_slug: string; status: string };
type Category = { id: string; name: string; slug: string; is_active: boolean };
type Candidate = {
  id: string; source_sku: string; manufacturer_sku: string | null; gtin: string | null; source_reference: string; source_url: string | null;
  title: string; description: string; brand: string | null; source_cost_minor: number; proposed_price_minor: number; currency: string;
  estimated_gross_margin_bps: number; pricing_policy: string; availability_state: string; availability_verification_state: string; stock_quantity: number | null; variants: unknown[];
  sizes: string[]; handling_time_min_days: number; handling_time_max_days: number; shipping: unknown; minimum_order_quantity: number;
  last_availability_check: string | null; last_price_check: string | null; source_snapshot: unknown; warnings: string[]; validation_errors: string[];
  duplicate_supplier_product_id: string | null; duplicate_candidate_id: string | null; duplicate_product_id: string | null; duplicate_source_url: boolean;
  media_status: string; status: string; created_product_id: string | null; created_listing_id: string | null; created_at: string;
  supplier: { display_name: string; code: string; status: string } | Array<{ display_name: string; code: string; status: string }>;
  target_seller: { store_name: string; store_slug: string; status: string } | Array<{ store_name: string; store_slug: string; status: string }>;
  category: { name: string; slug: string; is_active: boolean } | Array<{ name: string; slug: string; is_active: boolean }>;
  sourcing_media_candidates: SourcingMediaDetails[];
};
type ImportRow = { id: string; import_type: string; source_reference: string; status: string; summary: { accepted?: number; rejected?: Array<{ index: number; errors: string[] }> }; created_at: string; supplier: { display_name: string } | Array<{ display_name: string }> };

function relation<T>(value: T | T[]) { return Array.isArray(value) ? value[0] : value; }
function money(value: number, currency: string) {
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(value / 100);
}

export default async function SourcingAdminPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string }> }) {
  await requireProductModerator("/admin/sourcing");
  const system = createProductSystemClient();
  const [{ data: supplierData, error: supplierError }, { data: sellerData, error: sellerError }, { data: categoryData, error: categoryError },
    { data: candidateData, error: candidateError }, { data: importData, error: importError }] = await Promise.all([
    system.from("suppliers").select("id,code,display_name,supplier_type,status,website_url").order("display_name"),
    system.from("seller_profiles").select("id,store_name,store_slug,status").eq("status", "active").order("store_name"),
    system.from("categories").select("id,name,slug,is_active").eq("is_active", true).order("name"),
    system.from("sourcing_candidates").select("*,supplier:suppliers!supplier_id(display_name,code,status),target_seller:seller_profiles!target_seller_id(store_name,store_slug,status),category:categories!category_id(name,slug,is_active),sourcing_media_candidates(*)").order("created_at", { ascending: false }).limit(50),
    system.from("sourcing_imports").select("id,import_type,source_reference,status,summary,created_at,supplier:suppliers!supplier_id(display_name)").order("created_at", { ascending: false }).limit(10),
  ]);
  if (supplierError || sellerError || categoryError || candidateError || importError) throw new Error("Could not load the sourcing workspace. Confirm the sourcing migration has been applied in this environment.");
  const suppliers = (supplierData ?? []) as Supplier[];
  const sellers = (sellerData ?? []) as Seller[];
  const categories = (categoryData ?? []) as Category[];
  const candidates = (candidateData ?? []) as Candidate[];
  const imports = (importData ?? []) as ImportRow[];
  const feedback = await searchParams;
  const inputClass = "mt-1 w-full rounded-md border bg-background p-2 text-sm";

  return <section className="mx-auto max-w-7xl space-y-10 px-4 py-12">
    <div>
      <Link href="/admin/products" className="text-sm underline">Product review queue</Link>
      <h1 className="mt-3 text-3xl font-bold">AI-assisted sourcing</h1>
      <p className="mt-2 max-w-4xl text-muted-foreground">Normalize supplier data into reviewable Zvese drafts. Sourcing approval creates only a draft product and source-managed draft listing. The seller must still submit it through the existing product moderation flow before publication.</p>
      <p className="mt-2 text-sm text-muted-foreground">URLs are recorded as references only. This MVP does not fetch, scrape, copy, or upload third-party media.</p>
    </div>
    {feedback.message && <p role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">{feedback.message}</p>}
    {feedback.error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-destructive">{feedback.error}</p>}

    <div className="grid gap-6 lg:grid-cols-2">
      <form action={createSupplier} className="space-y-4 rounded-xl border p-5">
        <div><h2 className="text-xl font-semibold">Add supplier</h2><p className="text-sm text-muted-foreground">Only active suppliers can be imported.</p></div>
        <label className="block text-sm">Supplier code<input className={inputClass} name="code" required minLength={2} maxLength={80} pattern="[a-z0-9][a-z0-9-]+" placeholder="acme-manufacturing" /></label>
        <label className="block text-sm">Display name<input className={inputClass} name="display_name" required minLength={2} maxLength={160} /></label>
        <label className="block text-sm">Type<select className={inputClass} name="supplier_type" defaultValue="supplier"><option value="supplier">Supplier</option><option value="manufacturer">Manufacturer</option><option value="authorized_distributor">Authorized distributor</option></select></label>
        <label className="block text-sm">Initial status<select className={inputClass} name="status" defaultValue="pending"><option value="pending">Pending</option><option value="active">Active</option><option value="held">Held</option><option value="suspended">Suspended</option><option value="rejected">Rejected</option><option value="closed">Closed</option></select></label>
        <label className="block text-sm">Official HTTPS website (optional)<input className={inputClass} type="url" name="website_url" maxLength={2000} placeholder="https://manufacturer.example" /></label>
        <Button type="submit">Add supplier</Button>
      </form>

      <div className="rounded-xl border p-5">
        <h2 className="text-xl font-semibold">Suppliers</h2>
        {!suppliers.length && <p className="mt-3 text-sm text-muted-foreground">No suppliers yet.</p>}
        <ul className="mt-4 space-y-3">{suppliers.map((supplier) => <li key={supplier.id} className="rounded-lg bg-muted/40 p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><strong>{supplier.display_name}</strong> <span className="text-muted-foreground">({supplier.code})</span><p>{supplier.supplier_type.replaceAll("_", " ")} · {supplier.status}</p></div>
          <form action={updateSupplierStatus} className="flex gap-2"><input type="hidden" name="supplier_id" value={supplier.id} /><select aria-label={`Status for ${supplier.display_name}`} name="status" defaultValue={supplier.status} className="rounded-md border bg-background px-2"><option value="pending">Pending</option><option value="active">Active</option><option value="held">Held</option><option value="suspended">Suspended</option><option value="rejected">Rejected</option><option value="closed">Closed</option></select><Button size="sm" variant="outline">Update</Button></form></div>
        </li>)}</ul>
      </div>
    </div>

    <form action={importSupplierCatalog} className="space-y-4 rounded-xl border p-5">
      <div><h2 className="text-xl font-semibold">Import catalog data</h2><p className="text-sm text-muted-foreground">JSON/API/manual inputs use JSON object(s); CSV uses a header row. Maximum 50 records and 500 KB. API data is accepted as a supplied payload—no URL is executed.</p></div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">Active supplier<select className={inputClass} name="supplier_id" required defaultValue=""><option value="" disabled>Select</option>{suppliers.filter((supplier) => supplier.status === "active").map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.display_name}</option>)}</select></label>
        <label className="text-sm">Target active seller<select className={inputClass} name="target_seller_id" required defaultValue=""><option value="" disabled>Select</option>{sellers.map((seller) => <option key={seller.id} value={seller.id}>{seller.store_name}</option>)}</select></label>
        <label className="text-sm">Default category<select className={inputClass} name="category_slug" required defaultValue=""><option value="" disabled>Select</option>{categories.map((category) => <option key={category.id} value={category.slug}>{category.name}</option>)}</select></label>
        <label className="text-sm">Input type<select className={inputClass} name="import_type" defaultValue="json"><option value="json">JSON catalog</option><option value="csv">CSV catalog</option><option value="manual">Manual JSON</option><option value="api_catalog">Supplier API payload</option></select></label>
      </div>
      <label className="block text-sm">Catalog/feed reference<input className={inputClass} name="source_reference" required minLength={2} maxLength={300} placeholder="Supplier feed 2026-10-01 or catalog:edition-4" /></label>
      <label className="block text-sm">Catalog payload<textarea className={`${inputClass} font-mono`} name="payload" required rows={12} maxLength={500001} placeholder={'{"title":"Cotton Shirt","description":"Official supplier description","source_sku":"SHIRT-01","source_cost":"10.00","currency":"USD","source_url":"https://supplier.example/products/SHIRT-01","availability":"in_stock","category":"clothing","images":[{"url":"https://supplier.example/media/SHIRT-01.jpg","authorized":true,"source_sku":"SHIRT-01","width":2000,"height":2000}]}'}/></label>
      <Button type="submit" disabled={!suppliers.some((supplier) => supplier.status === "active") || !sellers.length || !categories.length}>Validate and queue drafts</Button>
      {(!sellers.length || !categories.length) && <p className="text-sm text-destructive">At least one active seller and active existing category are required before importing.</p>}
    </form>

    <div>
      <h2 className="text-xl font-semibold">Recent imports</h2>
      {!imports.length && <p className="mt-3 text-sm text-muted-foreground">No imports yet.</p>}
      <ul className="mt-4 space-y-2">{imports.map((item) => { const supplier = relation(item.supplier); return <li key={item.id} className="rounded-lg border p-3 text-sm"><strong>{supplier?.display_name ?? "Unknown supplier"}</strong> · {item.import_type.replaceAll("_", " ")} · {item.status} · accepted {item.summary?.accepted ?? 0} · rejected {item.summary?.rejected?.length ?? 0}<p className="break-words text-xs text-muted-foreground">{item.source_reference} · {new Date(item.created_at).toLocaleString()}</p>{item.summary?.rejected?.map((rejected) => <p key={rejected.index} className="mt-1 text-xs text-destructive">Record {rejected.index}: {rejected.errors.join(" ")}</p>)}</li>; })}</ul>
    </div>

    <div>
      <h2 className="text-xl font-semibold">Sourcing review queue</h2>
      {!candidates.length && <p className="mt-3 text-muted-foreground">No sourced candidates yet.</p>}
      <div className="mt-5 space-y-6">{candidates.map((candidate) => {
        const supplier = relation(candidate.supplier); const seller = relation(candidate.target_seller); const category = relation(candidate.category);
        const duplicates = [candidate.duplicate_supplier_product_id, candidate.duplicate_candidate_id, candidate.duplicate_product_id].filter(Boolean);
        const canDecide = candidate.status === "needs_review" || candidate.status === "held";
        const mediaBlocker = sourcingMediaApprovalBlocker(candidate.sourcing_media_candidates);
        return <article key={candidate.id} className="rounded-xl border p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-wide text-muted-foreground">{candidate.status.replaceAll("_", " ")} · media {mediaBlocker ? candidate.media_status.replaceAll("_", " ") : "ready"}</p><h3 className="text-xl font-semibold">{candidate.title}</h3><p className="text-sm">{supplier?.display_name} → {seller?.store_name} · {category?.name}</p></div><div className="text-right text-sm"><p>Cost <strong>{money(candidate.source_cost_minor, candidate.currency)}</strong></p><p>Proposed <strong>{money(candidate.proposed_price_minor, candidate.currency)}</strong></p><p>Gross margin <strong>{(candidate.estimated_gross_margin_bps / 100).toFixed(2)}%</strong></p></div></div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="space-y-2 text-sm"><h4 className="font-semibold">Normalized Zvese draft</h4><p className="whitespace-pre-wrap">{candidate.description}</p><p>Brand: {candidate.brand ?? "Not provided"}</p><p>SKU: {candidate.source_sku} · Manufacturer SKU: {candidate.manufacturer_sku ?? "—"} · GTIN: {candidate.gtin ?? "—"}</p><p>Availability: <strong>{candidate.availability_state}</strong> ({candidate.availability_verification_state}) · Stock reference: {candidate.stock_quantity ?? "unknown"}</p><p>Handling: {candidate.handling_time_min_days}–{candidate.handling_time_max_days} days · MOQ: {candidate.minimum_order_quantity}</p><p>Sizes: {candidate.sizes.length ? candidate.sizes.join(", ") : "None"} · Variants: {candidate.variants.length}</p><p className="text-xs text-muted-foreground">Pricing: {candidate.pricing_policy} · Last stock check: {candidate.last_availability_check ?? "unverified"} · Last price check: {candidate.last_price_check ?? "unverified"}</p></div>
            <div className="space-y-2 text-sm"><h4 className="font-semibold">Original/source product</h4><p className="break-words">Reference: {candidate.source_reference}</p>{candidate.source_url && <a className="break-all underline" href={candidate.source_url} target="_blank" rel="noreferrer">Open safe HTTPS source reference</a>}<pre className="max-h-52 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs">{JSON.stringify(candidate.source_snapshot, null, 2)}</pre></div>
          </div>
          {(candidate.warnings.length > 0 || candidate.validation_errors.length > 0 || duplicates.length > 0 || candidate.duplicate_source_url) && <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm"><h4 className="font-semibold">Warnings and validation</h4>{candidate.validation_errors.map((warning) => <p key={warning} className="text-destructive">{warning}</p>)}{candidate.warnings.map((warning) => <p key={warning}>{warning}</p>)}{duplicates.length > 0 && <p>Duplicate record links detected: {duplicates.join(", ")}</p>}{candidate.duplicate_source_url && <p>Duplicate source URL detected.</p>}</div>}
          <div className="mt-4">
            <h4 className="font-semibold">Media discovery</h4>
            {!candidate.sourcing_media_candidates.length && <p className="text-sm text-muted-foreground">Media incomplete. Request authorized supplier/manufacturer media before draft approval.</p>}
            <ul className="mt-2 grid gap-3 md:grid-cols-2">{candidate.sourcing_media_candidates.map((media) =>
              <MediaReviewCard key={media.id} media={media} canDecide={canDecide} action={decideSourcingMedia} />
            )}</ul>
            {mediaBlocker && <p className="mt-3 text-sm text-destructive">{mediaBlocker}</p>}
          </div>
          {candidate.created_listing_id && <p className="mt-4 text-sm">Draft listing created: <Link className="underline" href="/account/listings/new">{candidate.created_listing_id}</Link>. It is not submitted or published.</p>}
          {canDecide && <form action={decideSourcingCandidate} className="mt-5 space-y-3 border-t pt-4"><input type="hidden" name="candidate_id" value={candidate.id} /><label className="block text-sm">Decision note<textarea className={inputClass} name="note" minLength={10} maxLength={2000} required rows={3} /></label><div className="flex flex-wrap gap-2"><Button name="decision" value="approve" disabled={duplicates.length > 0 || candidate.validation_errors.length > 0 || Boolean(mediaBlocker)}>Approve as draft</Button><Button name="decision" value="hold" variant="outline">Hold</Button><Button name="decision" value="reject" variant="destructive">Reject</Button></div><p className="text-xs text-muted-foreground">Approval does not publish. Duplicate or invalid candidates cannot be approved. Shared source URLs remain review warnings because legitimate variants can share a supplier page.</p></form>}
        </article>;
      })}</div>
    </div>
  </section>;
}
