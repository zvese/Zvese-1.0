import type { Metadata } from "next";
import Link from "next/link";
import { createProductSystemClient } from "@/lib/supabase/product-system";
import { requireProductModerator, loadProductReview } from "@/lib/admin/product-review-server";

export const metadata: Metadata = { title: "Product Reviews | Admin" };

export default async function ProductReviewQueue({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireProductModerator("/admin/products");
  const requested = Number((await searchParams).page ?? 1);
  const page = Number.isSafeInteger(requested) && requested > 0 && requested <= 10000 ? requested : 1;
  const system = createProductSystemClient();
  const { data, error } = await system.from("listings").select("id")
    .eq("review_state", "pending_review").gt("current_revision", 0).is("deleted_at", null)
    .order("submitted_at").order("id").range((page - 1) * 25, page * 25 - 1);
  if (error) throw new Error("Could not load the product review queue.");
  const records = await Promise.all((data ?? []).map((row) => loadProductReview(row.id)));
  const pending = records.filter((record) => record && record.reviewState === "pending_review" && !record.deletedAt);
  return <section className="mx-auto max-w-5xl px-4 py-12">
    <Link className="text-sm underline" href="/admin/sourcing">AI sourcing workspace</Link>
    <h1 className="text-3xl font-bold">Product reviews</h1>
    <p className="mt-3 text-muted-foreground">Submitted product revisions awaiting manual review. Only active super administrators can decide them.</p>
    {pending.length === 0 && <p className="mt-8">No pending submissions on this page.</p>}
    <ul className="mt-8 space-y-4">{pending.map((record) => record && <li key={record.id} className="rounded-xl border p-5">
      <Link className="font-semibold underline" href={`/admin/products/${record.id}`}>{record.snapshot.product.title}</Link>
      <p className="mt-2 text-sm">{record.sellerName} · Seller: {record.sellerStatus} · Revision {record.revision}</p>
      <p className="text-sm">Listing: {record.listingStatus} · Availability: {record.availability} (source managed)</p>
      <p className="text-sm">{record.snapshot.files.length} submitted files · {record.files.filter((file) => file.validation === "passed").length} passed validation</p>
      <p className="mt-2 break-all text-xs text-muted-foreground">Listing {record.id} · Submitted {record.submittedAt}</p>
    </li>)}</ul>
    <nav aria-label="Review queue pages" className="mt-8 flex gap-5">
      {page > 1 && <Link className="underline" href={`/admin/products?page=${page - 1}`}>Previous</Link>}
      {data?.length === 25 && <Link className="underline" href={`/admin/products?page=${page + 1}`}>Next</Link>}
    </nav>
  </section>;
}
