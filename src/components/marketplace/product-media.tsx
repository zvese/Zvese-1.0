import { createClient } from "@/lib/supabase/server";

export async function ProductMedia({ listingId }: { listingId: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_listing_public_files", { p_listing_id: listingId });
  const files = data as { id: string; original_name: string; mime_type: string }[] | null;
  if (error) return <p className="text-sm text-muted-foreground">Product media is temporarily unavailable.</p>;
  return <div className="space-y-4">
    {files?.map((file) => {
      const url = `/api/product-files/${file.id}`;
      if (file.mime_type.startsWith("image/")) {
        // eslint-disable-next-line @next/next/no-img-element
        return <img key={file.id} src={url} alt={file.original_name} className="max-h-96 w-full rounded-xl object-contain" />;
      }
      if (file.mime_type.startsWith("video/")) return <video key={file.id} src={url} controls preload="metadata" className="max-h-96 w-full rounded-xl" />;
      return <a key={file.id} href={url} className="block text-sm underline" target="_blank" rel="noreferrer">Download {file.original_name}</a>;
    })}
  </div>;
}
