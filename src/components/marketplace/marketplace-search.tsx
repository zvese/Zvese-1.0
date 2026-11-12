"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function MarketplaceSearch({ query, category }: { query: string; category?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <form action="/marketplace" method="get" aria-busy={pending}
    className="mt-8 flex max-w-2xl flex-col gap-3 sm:flex-row" onSubmit={event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const params = new URLSearchParams();
      const term = String(form.get("q") ?? "").trim().slice(0, 100);
      if (term) params.set("q", term);
      if (category) params.set("category", category);
      // Submit-only search: zero requests per keystroke. Next owns superseding
      // navigations; there is no independent response state that can go stale.
      startTransition(() => router.push(`/marketplace?${params}`));
    }}>
    {category && <input type="hidden" name="category" value={category} />}
    <label className="relative flex-1">
      <span className="sr-only">Search marketplace</span>
      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <input key={query} name="q" type="search" defaultValue={query} maxLength={100} placeholder="Search products, brands, or stores"
        className="h-11 w-full rounded-md border bg-background pl-10 pr-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
    </label>
    <Button type="submit" size="lg">{pending ? "Searching…" : "Search"}</Button>
    <span role="status" className="sr-only">{pending ? "Searching products…" : ""}</span>
  </form>;
}
