"use client";

import { useState } from "react";
import { ImageIcon } from "lucide-react";

export function ProductCardImageView({ src, title, priority = false }: { src: string | null; title: string; priority?: boolean }) {
  const [failed, setFailed] = useState(false);
  return <div className="mb-4 flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-lg bg-muted">
    {src && !failed ? (
      // Public-only thumbnails revalidate access even for a browser-cache hit.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={`${src}?w=640`} srcSet={`${src}?w=320 320w, ${src}?w=640 640w, ${src}?w=960 960w`}
        sizes="(max-width: 639px) calc(100vw - 80px), (max-width: 1023px) 44vw, 360px"
        alt={title} width={640} height={640} loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : "auto"}
        decoding="async" className="h-full w-full object-contain" onError={() => setFailed(true)} />
    ) : (
      <div className="flex flex-col items-center gap-2 p-4 text-sm text-muted-foreground">
        <ImageIcon className="size-8" aria-hidden="true" />
        <span>No image available</span>
      </div>
    )}
  </div>;
}
