"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { beginRevision, finishFile, removeFile, reserveFile, saveListing, submitListing } from "../actions";
import { SOURCE_TYPES, PUBLIC_ACCEPT, PRIVATE_ACCEPT, validateProductFile, type ProductFile, type FileVisibility } from "@/lib/marketplace/product-files";
import { listingRequest, ListingRequestUncertain } from "@/lib/marketplace/listing-request";

export interface ListingDraft {
  id: string; title: string; description: string; price_minor: number;
  source_type: string; partner_reference: string; review_state: string;
}
interface Selection { id: string; file: File; visibility: FileVisibility }

function LocalPreview({ file }: { file: File }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  if (!url) return null;
  if (file.type.startsWith("image/")) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={file.name} className="mt-2 h-32 max-w-full rounded object-contain" />;
  }
  if (file.type.startsWith("video/")) return <video src={url} controls preload="metadata" className="mt-2 max-h-48 max-w-full rounded" />;
  return null;
}

export function ListingForm({ currency, draft, initialFiles }: { currency: string; draft: ListingDraft | null; initialFiles: ProductFile[] }) {
  const [listingId, setListingId] = useState(draft?.id ?? "");
  const [files, setFiles] = useState(initialFiles);
  const [selected, setSelected] = useState<Selection[]>([]);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [needsRecovery, setNeedsRecovery] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [locked, setLocked] = useState(!!draft && draft.review_state !== "draft");
  const [reviewState, setReviewState] = useState(draft?.review_state ?? "draft");
  const inputClass = "mt-2 w-full rounded-md border border-input bg-background px-3.5 py-2.5 text-sm";

  function selectFiles(list: FileList | null, visibility: FileVisibility) {
    if (!list) return;
    const additions: Selection[] = [];
    const errors: string[] = [];
    for (const file of Array.from(list)) {
      const invalid = validateProductFile(file, visibility);
      if (invalid) errors.push(`${file.name}: ${invalid}`);
      else if (files.length + selected.length + additions.length >= 12) errors.push("Maximum 12 files per listing.");
      else additions.push({ id: crypto.randomUUID(), file, visibility });
    }
    setSelected((previous) => [...previous, ...additions]);
    setError(errors.join(" "));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || busy || locked || needsRecovery) return;
    const formData = new FormData(event.currentTarget);
    formData.set("listing_id", listingId);
    const submit = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "submit";
    inFlight.current = true;
    setBusy(true); setError(""); setStatus("Saving draft...");
    try {
      const saved = await listingRequest(() => saveListing(formData), "Saving draft");
      if (saved.error || !saved.listingId) throw new Error(saved.error || "Could not save draft.");
      const id = saved.listingId;
      setListingId(id);
      // Do not change history between Server Actions: Next 15's restore action
      // can strand the following reservation in its action queue. Use the link below.
      const supabase = createClient();
      for (let index = 0; index < selected.length; index++) {
        const selection = selected[index];
        setStatus(`Reserving ${index + 1} of ${selected.length}: ${selection.file.name}`);
        const reserved = await listingRequest(() => reserveFile(id, selection.visibility, selection.file.name, selection.file.type, selection.file.size), `Reserving ${selection.file.name}`);
        if (reserved.error || !reserved.file) throw new Error(reserved.error || "Could not reserve upload.");
        const record = reserved.file;
        setFiles((previous) => [...previous, {
          id: record.id, listing_id: id, visibility: selection.visibility,
          original_name: selection.file.name, mime_type: selection.file.type, size_bytes: selection.file.size,
          reservation_state: "reserved", content_validation_state: "pending",
          expires_at: record.expires_at, created_at: new Date().toISOString(),
        }]);
        setSelected((previous) => previous.filter((item) => item.id !== selection.id));
        setStatus(`Uploading ${index + 1} of ${selected.length}: ${selection.file.name}`);
        const { error: uploadError } = await listingRequest(() => supabase.storage.from(record.bucket_id).upload(record.object_path, selection.file, {
          contentType: selection.file.type, upsert: false, cacheControl: "60",
        }), `Uploading ${selection.file.name}`, 300_000);
        if (uploadError) throw new Error(`Upload failed for ${selection.file.name}. Remove the incomplete entry and select the file again.`);
        setStatus(`Confirming upload: ${selection.file.name}`);
        const finished = await listingRequest(() => finishFile(record.id), `Confirming ${selection.file.name}`);
        if (finished.error) throw new Error(finished.error);
        setFiles((previous) => previous.map((file) => file.id === record.id ? { ...file, reservation_state: "finalized" } : file));
      }
      if (submit) {
        setStatus("Submitting for review...");
        const result = await listingRequest(() => submitListing(id), "Submitting for review");
        if (result.error) throw new Error(result.error);
        setLocked(true);
        setReviewState("pending_review");
        setStatus("Submitted for review. Availability is checking. This listing is not published and no AI verification has taken place.");
      } else setStatus("Draft and uploads saved. Use the saved draft link below to return.");
    } catch (failure) {
      if (failure instanceof ListingRequestUncertain) setNeedsRecovery(true);
      setStatus("");
      setError(failure instanceof Error ? failure.message : "Something went wrong. Your saved draft can be reopened.");
    } finally { inFlight.current = false; setBusy(false); }
  }

  async function remove(id: string) {
    if (inFlight.current || busy || locked || needsRecovery) return;
    inFlight.current = true;
    setBusy(true); setError("");
    try {
      const result = await listingRequest(() => removeFile(id), "Removing file");
      if (result.error) setError(result.error);
      else setFiles((previous) => previous.filter((file) => file.id !== id));
    } catch (failure) {
      setNeedsRecovery(true);
      setError(failure instanceof Error ? failure.message : "Could not remove the file. Reopen the saved draft to check it.");
    }
    finally { inFlight.current = false; setBusy(false); }
  }

  return (
    <form onSubmit={save} className="mt-8 space-y-6 rounded-2xl border border-border bg-card p-6 sm:p-8">
      <div className="rounded-lg bg-accent p-4 text-sm">
        Zvese and its sellers hold no inventory in this flow. Products are sourced through a fulfillment partner.
        Availability is source-managed and starts as checking. The system controls review and publication.
        No AI or supplier verification is currently performed automatically.
      </div>
      {locked && <p role="status">Listing state: {reviewState.replaceAll("_", " ")}. To edit, start a new revision. This withdraws any public listing until the new submission is approved.</p>}
      {locked && <Button type="button" variant="outline" disabled={busy || needsRecovery} onClick={async () => {
        if (inFlight.current || needsRecovery) return;
        inFlight.current = true;
        setBusy(true); setError("");
        try {
          const result = await listingRequest(() => beginRevision(listingId), "Starting revision");
          if (result.error) setError(result.error);
          else { setLocked(false); setReviewState("draft"); setStatus("New draft started. Previous review evidence is preserved. Submit again after editing."); }
        } catch (failure) {
          setNeedsRecovery(true);
          setError(failure instanceof Error ? failure.message : "Could not start a revision. Reopen the saved draft to check it.");
        }
        finally { inFlight.current = false; setBusy(false); }
      }}>Withdraw and start revised draft</Button>}
      <fieldset disabled={busy || locked || needsRecovery} className="space-y-5 disabled:opacity-70">
        <label className="block text-sm font-medium">Product name
          <input name="title" required minLength={3} maxLength={160} defaultValue={draft?.title} className={inputClass} />
        </label>
        <label className="block text-sm font-medium">Description
          <textarea name="description" required minLength={10} maxLength={2000} rows={5} defaultValue={draft?.description} className={inputClass} />
        </label>
        <label className="block text-sm font-medium">Price ({currency})
          <input name="price" type="number" required min="0.01" max="1000000" step="0.01" defaultValue={draft ? (draft.price_minor / 100).toFixed(2) : undefined} className={inputClass} />
        </label>
        <label className="block text-sm font-medium">Source / fulfillment partner type
          <select name="source_type" required defaultValue={draft?.source_type || "supplier"} className={inputClass}>
            {SOURCE_TYPES.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium">Source / partner name or reference (internal)
          <input name="partner_reference" required minLength={2} maxLength={300} defaultValue={draft?.partner_reference} className={inputClass} />
        </label>
        <p className="text-sm text-muted-foreground">Source availability must be confirmed by the system. There is no seller-owned stock quantity.</p>
        <label className="block text-sm font-medium">Public product media
          <p className="mt-1 text-xs text-muted-foreground">Visible to buyers only after approval. JPEG, PNG, WEBP: 10 MB; MP4, WEBM: 100 MB; public PDF: 25 MB.</p>
          <input type="file" multiple accept={PUBLIC_ACCEPT} className={inputClass} onChange={(event) => { selectFiles(event.target.files, "public"); event.target.value = ""; }} />
        </label>
        <label className="block text-sm font-medium">Private / internal documents
          <p className="mt-1 text-xs text-muted-foreground">Never shown to buyers. PDF, TXT, CSV, DOCX, XLSX: 25 MB each. Maximum 12 files total.</p>
          <input type="file" multiple accept={PRIVATE_ACCEPT} className={inputClass} onChange={(event) => { selectFiles(event.target.files, "private"); event.target.value = ""; }} />
        </label>
      </fieldset>
      <ul className="space-y-3">
        {files.map((file) => <li key={file.id} className="rounded border p-3 text-sm break-words">
          <p>{file.original_name} — {file.visibility === "private" ? "Private" : "Public after approval"} — {file.reservation_state === "finalized" ? `Uploaded; content validation ${file.content_validation_state}` : "Incomplete or expired upload: remove and retry"}</p>
          {file.content_validation_state === "passed" && <a href={`/api/product-files/${file.id}`} target="_blank" rel="noreferrer" className="mr-4 underline">View file</a>}
          <Button type="button" variant="ghost" size="sm" disabled={busy || locked || needsRecovery} onClick={() => remove(file.id)}>Remove</Button>
        </li>)}
        {selected.map((selection) => <li key={selection.id} className="rounded border p-3 text-sm break-words">
          <p>{selection.file.name} — {selection.visibility === "private" ? "Private" : "Public after approval"} — Ready to upload</p>
          <LocalPreview file={selection.file} />
          <Button type="button" variant="ghost" size="sm" disabled={busy || locked || needsRecovery} onClick={() => setSelected((previous) => previous.filter((item) => item.id !== selection.id))}>Remove</Button>
        </li>)}
      </ul>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <p role="status" aria-live="polite" className="text-sm">{status}</p>
      {!busy && (listingId || needsRecovery) && <a className="block text-sm underline" href={listingId ? `/account/listings/new?draft=${listingId}` : "/account/listings/new"}>
        {listingId ? "Reopen saved draft / copy this link to return" : "Check Your saved listings before creating another draft"}
      </a>}
      {!locked && <div className="flex flex-wrap gap-3">
        <Button type="submit" value="save" variant="outline" disabled={busy || needsRecovery}>Save draft and upload</Button>
        <Button type="submit" value="submit" disabled={busy || needsRecovery}>Submit for review</Button>
      </div>}
    </form>
  );
}
