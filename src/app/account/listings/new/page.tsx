import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentSellerProfile } from "@/lib/marketplace/sellers";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/admin/seller-review-data";
import { PRODUCT_FILE_SELECT, type ProductFile } from "@/lib/marketplace/product-files";
import { ListingForm, type ListingDraft } from "./listing-form";
import { signInPath } from "@/lib/auth/redirects";
import { BackButton } from "@/components/navigation/back-button";

export const metadata: Metadata = { title: "Create Listing | Zvese", description: "Prepare a source-managed product for review." };

export default async function NewListingPage({ searchParams }: { searchParams: Promise<{ draft?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(signInPath("/account/listings/new", "Please sign in to create listings."));
  const { data: seller } = await getCurrentSellerProfile();
  if (!seller || seller.status !== "active") return (
    <section className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-bold">Active Seller Profile Required</h1>
      <p className="mt-3">Only approved, active sellers can create and manage listings.</p>
      <Link href={seller ? "/account" : "/creators/apply"} className="mt-6 inline-block underline">{seller ? "View account status" : "Apply to become a seller"}</Link>
    </section>
  );
  const { draft: draftId } = await searchParams;
  const { data: listings, error: listingsError } = await supabase.from("listings")
    .select("id, product_id, price_minor, currency, current_revision, review_state, availability_state, product:products(title, description)")
    .eq("seller_id", seller.id).is("deleted_at", null).order("created_at", { ascending: false });
  if (listingsError) return <section className="mx-auto max-w-2xl px-4 py-16"><h1 className="text-2xl font-bold">Product publishing unavailable</h1><p className="mt-3">Could not load your listings. Please try again later.</p></section>;
  const row = draftId && isUuid(draftId) ? listings?.find((listing) => listing.id === draftId) : undefined;
  let draft: ListingDraft | null = null;
  let files: ProductFile[] = [];
  if (draftId && !row) return <section className="mx-auto max-w-2xl px-4 py-16">Listing unavailable. <Link href="/account/listings/new" className="underline">Create a new listing</Link></section>;
  if (row) {
    const [{ data: source, error: sourceError }, { data: attachments, error: attachmentsError }] = await Promise.all([
      supabase.from("listing_sources").select("source_type, partner_reference").eq("listing_id", row.id).maybeSingle(),
      supabase.from("listing_draft_files").select("file_id").eq("listing_id", row.id),
    ]);
    if (attachmentsError) throw new Error("Could not load draft attachments.");
    const { data: storedFiles, error: filesError } = attachments?.length
      ? await supabase.from("product_files").select(PRODUCT_FILE_SELECT).in("id", attachments.map((file) => file.file_id)).order("created_at")
      : { data: [], error: null };
    if (sourceError || filesError) throw new Error("Could not load listing files and source details.");
    const product = Array.isArray(row.product) ? row.product[0] : row.product;
    draft = { id: row.id, title: product?.title ?? "", description: product?.description ?? "", price_minor: row.price_minor,
      review_state: row.review_state, source_type: source?.source_type ?? "supplier", partner_reference: source?.partner_reference ?? "" };
    files = (storedFiles ?? []) as ProductFile[];
  }
  return <section className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
    <BackButton fallback="/account" />
    <p className="text-sm text-primary">{seller.store_name}</p>
    <h1 className="mt-1 text-3xl font-bold">{draft ? "Your product listing" : "Create a listing"}</h1>
    <p className="mt-2 text-muted-foreground">Add product and source details, upload files, then submit for review.</p>
    {row && <p className="mt-3 text-sm">Submission revision: {row.current_revision}. Availability: {row.availability_state}. Review: {row.review_state.replaceAll("_", " ")}.</p>}
    <ListingForm key={draft?.id ?? "new"} currency={row?.currency ?? seller.default_currency} draft={draft} initialFiles={files} />
    <div className="mt-10"><h2 className="text-lg font-semibold">Your saved listings</h2>
      <ul className="mt-3 space-y-2">{listings?.map((listing) => {
        const product = Array.isArray(listing.product) ? listing.product[0] : listing.product;
        return <li key={listing.id}><Link href={`/account/listings/new?draft=${listing.id}`} className="underline">{product?.title ?? "Product"}</Link> — {listing.review_state.replaceAll("_", " ")}</li>;
      })}</ul>
      {draft && <Link href="/account/listings/new" className="mt-5 inline-block underline">Create another listing</Link>}
    </div>
  </section>;
}
