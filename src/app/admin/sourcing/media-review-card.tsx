import { Button } from "@/components/ui/button";
import { canApproveSourcingMedia, type SourcingMediaReview } from "@/lib/sourcing/media-review";

export interface SourcingMediaDetails extends SourcingMediaReview {
  id: string;
  source_url: string;
  provenance_type: string;
  variant_reference: string | null;
  quality_score: number;
  width: number | null;
  height: number | null;
  warnings: string[];
}

export function MediaReviewCard({ media, canDecide, action }: {
  media: SourcingMediaDetails;
  canDecide: boolean;
  action: (form: FormData) => Promise<never>;
}) {
  const approvable = canApproveSourcingMedia(media);
  return <li className="space-y-2 rounded-lg bg-muted/40 p-3 text-sm">
    <p className="font-semibold">{media.media_type.replaceAll("_", " ")} · role: {media.selected_role} · review: {media.review_status}</p>
    <a href={media.source_url} target="_blank" rel="noreferrer" className="block break-all underline">{media.source_url}</a>
    <p>Provenance: {media.provenance_type.replaceAll("_", " ")} · Rights: {media.rights_status.replaceAll("_", " ")}</p>
    <p>Match: {media.match_status.replaceAll("_", " ")} · Confidence: {(Number(media.match_confidence) * 100).toFixed(1)}% · Quality: {(Number(media.quality_score) * 100).toFixed(1)}%</p>
    <p>Width: {media.width ?? "unknown"} · Height: {media.height ?? "unknown"} · Variant: {media.variant_reference ?? "general"}</p>
    <p>Watermarked: {media.watermarked ? "Yes" : "No"} · Synthetic: {media.synthetic ? "Yes" : "No"}</p>
    {media.warnings.length > 0 && <ul aria-label="Media warnings" className="list-inside list-disc text-amber-800 dark:text-amber-300">
      {media.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
    </ul>}
    {canDecide && media.review_status === "pending" && <form action={action} className="space-y-3 border-t pt-3">
      <input type="hidden" name="media_id" value={media.id} />
      <label className="block">Administrator review note
        <textarea name="note" className="mt-1 w-full rounded-md border bg-background p-2" required minLength={10} maxLength={2000} rows={3} />
      </label>
      <p className="text-xs text-muted-foreground">Approval confirms you checked the source, usage rights, and exact product/variant match. Supplier claims alone are not confirmation.</p>
      {!approvable && <p className="text-xs text-destructive">Approval is blocked by rights, match confidence, watermark, or synthetic status. Reject this media and request suitable supplier media.</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="decision" value="approve" size="sm" disabled={!approvable}>Approve media</Button>
        <Button type="submit" name="decision" value="reject" size="sm" variant="destructive">Reject media</Button>
      </div>
    </form>}
  </li>;
}
