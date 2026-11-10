import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { isUuid } from "@/lib/admin/seller-review-data";
import { requireProductModerator, loadProductReview } from "@/lib/admin/product-review-server";
import { hasUnvalidatedFiles, isSelfReview, type ReviewContext } from "@/lib/admin/product-review";
import { decideProduct } from "../actions";
import { validateImage } from "../validate-image";

export const metadata: Metadata = { title: "Review Product | Admin" };

export default async function ProductReviewDetail({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const actor = await requireProductModerator(`/admin/products/${id}`);
  const record = await loadProductReview(id);
  if (!record) notFound();
  const pageError = (await searchParams).error;
  const selfReview = isSelfReview(actor.id, record);
  const filesBlocked = hasUnvalidatedFiles(record);
  const canDecide = !selfReview && record.sellerStatus === "active" && !record.deletedAt
    && record.reviewState === "pending_review" && !!record.filesFingerprint;
  const context: ReviewContext = {
    listingId: id, revision: record.revision, snapshotHash: record.snapshotHash,
    filesFingerprint: record.filesFingerprint ?? "", jobId: randomUUID(),
  };
  // Next encrypts captured values in this Server Action closure. A retry of the
  // same rendered form keeps its job UUID and exact reviewed revision/fingerprints.
  async function submitDecision(form: FormData) {
    "use server";
    await decideProduct(context, form); // Re-authenticates inside every invocation.
  }
  const inputClass = "mt-2 w-full rounded-md border bg-background p-3";
  return <section className="mx-auto max-w-4xl space-y-6 px-4 py-12">
    <Link href="/admin/products" className="underline">Back to product reviews</Link>
    <h1 className="text-3xl font-bold">{record.snapshot.product.title}</h1>
    {pageError && <p role="alert" className="text-destructive">{pageError}</p>}
    <div className="rounded-xl border p-5 space-y-2">
      <h2 className="text-lg font-semibold">Submitted revision {record.revision}</h2>
      <p className="whitespace-pre-wrap">{record.snapshot.product.description}</p>
      <p>Price: {new Intl.NumberFormat("en", { style: "currency", currency: record.snapshot.product.currency }).format(record.snapshot.product.price_minor / 100)}</p>
      <p>Source type: {record.snapshot.source.source_type.replaceAll("_", " ")}</p>
      <p className="break-words">Source reference: {record.snapshot.source.partner_reference}</p>
      <p>Availability: {record.availability} — source managed; no seller-owned inventory.</p>
      <p>Seller: {record.sellerName} ({record.sellerStatus})</p>
      <p>Listing: {record.listingStatus} · Review: {record.reviewState.replaceAll("_", " ")} · Product: {record.productStatus}</p>
      <p className="break-all text-xs">Listing ID: {record.id} · Product ID: {record.snapshot.product.id}</p>
      <p className="text-xs">Submitted: {record.submittedAt}</p>
      <p className="break-all text-xs">Snapshot SHA256: {record.snapshotHash}</p>
      {record.filesFingerprint && <p className="break-all text-xs">File fingerprint: {record.filesFingerprint}</p>}
    </div>
    <div className="rounded-xl border p-5">
      <h2 className="text-lg font-semibold">Submitted files</h2>
      {!record.snapshot.files.length && <p className="mt-2">No attachments. This revision can be approved without file validation.</p>}
      <ul className="mt-3 space-y-3">{record.snapshot.files.map((file) => {
        const status = record.files.find((item) => item.id === file.id);
        return <li key={file.id} className="break-words text-sm">
          <p>{status?.name ?? file.id} · {file.visibility} · {file.mime_type} · {file.size_bytes} bytes</p>
          <p>Trusted validation: {status?.validation ?? "missing"} · Upload: {status?.reservation ?? "missing"}</p>
          <p className="break-all text-xs">Submitted file: {file.id} · Version: {file.storage_version}</p>
          {canDecide && status?.validation === "pending" && ["image/jpeg", "image/png", "image/webp"].includes(file.mime_type) && <form action={validateImage} className="mt-2">
            <input type="hidden" name="listing_id" value={id} /><input type="hidden" name="file_id" value={file.id} />
            <Button type="submit" variant="outline" size="sm">Validate image bytes and preserve verified copy</Button>
          </form>}
        </li>;
      })}</ul>
      {filesBlocked && <p className="mt-3 text-destructive">Approval is blocked until every submitted file passes trusted validation. Rejection remains available.</p>}
      <p className="mt-3 text-sm">The image validator supports static JPEG, PNG and WebP only. It fully decodes bounded image data; it is not an antivirus scan. Videos and documents need a separate trusted validator.</p>
    </div>
    {selfReview && <p role="alert">You cannot review your own product or seller listing.</p>}
    {!canDecide && !selfReview && <p>This submission is no longer eligible for a decision. Check its review and seller status.</p>}
    {canDecide && <form action={submitDecision} className="rounded-xl border p-5 space-y-5">
      <h2 className="text-lg font-semibold">Manual decision</h2>
      <p className="text-sm">Record your assessment of this exact revision. Keep availability as checking when it has not been confirmed. Approval controls publication separately from availability.</p>
      <label className="block">Source-managed availability
        <select name="availability" defaultValue="checking" required className={inputClass}>
          <option value="checking">Checking — unconfirmed</option><option value="available">Available — confirmed in review</option><option value="unavailable">Unavailable</option>
        </select>
      </label>
      <label className="block">Internal review note and basis for availability
        <textarea name="note" required minLength={10} maxLength={2000} rows={5} className={inputClass} />
      </label>
      <p className="text-xs text-muted-foreground">Your authenticated moderator identity, note and decision will be recorded privately with this revision.</p>
      <div className="flex gap-3">
        <Button type="submit" name="decision" value="approved" disabled={filesBlocked}>Approve and publish</Button>
        <Button type="submit" name="decision" value="rejected" variant="outline">Reject</Button>
      </div>
    </form>}
    {record.reviewState === "approved" && <Link className="inline-block underline" href={`/marketplace/${record.productSlug}`}>View marketplace listing</Link>}
  </section>;
}
