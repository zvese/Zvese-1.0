import { ProductCardImageView } from "./product-card-image-view";

export function ProductCardImage({ fileId, title, priority = false }: { fileId?: string; title: string; priority?: boolean }) {
  const src = fileId ? `/api/product-thumbnails/${fileId}` : null;
  return <ProductCardImageView key={src ?? "no-image"} src={src} title={title} priority={priority} />;
}
