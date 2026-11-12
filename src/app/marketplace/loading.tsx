export default function MarketplaceLoading() {
  return <section className="mx-auto max-w-7xl px-4 py-16" aria-busy="true" aria-label="Loading marketplace">
    <p role="status">Loading products…</p>
    <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map(id => <div key={id} className="rounded-xl border p-6"><div className="aspect-[4/3] rounded-lg bg-muted" /><div className="mt-4 h-6 w-2/3 rounded bg-muted" /><div className="mt-4 h-4 w-1/3 rounded bg-muted" /></div>)}
    </div>
  </section>;
}
