import Link from "next/link";
import { ArrowRightIcon, GlobeIcon, SparklesIcon, TruckIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { siteConfig } from "@/config/site";

const pillars = [
  {
    icon: GlobeIcon,
    title: "Global Marketplace",
    description:
      "Connect buyers and sellers worldwide with zero-inventory fulfillment.",
  },
  {
    icon: SparklesIcon,
    title: "Creator Economy",
    description:
      "Empower creators to build brands and reach audiences at scale.",
  },
  {
    icon: TruckIcon,
    title: "Smart Fulfillment",
    description:
      "Streamlined logistics designed for speed, reliability, and reach.",
  },
] as const;

export function HeroSection() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-background to-background"
      />

      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8 lg:py-32">
        <div className="mx-auto max-w-3xl text-center">
          <p className="mb-4 inline-flex items-center rounded-full border border-primary/20 bg-accent px-4 py-1.5 text-sm font-medium text-primary">
            {siteConfig.company}
          </p>

          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            {siteConfig.name}
            <span className="mt-2 block text-primary">{siteConfig.slogan}</span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            {siteConfig.description}
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
            <Button size="lg" asChild>
              <Link href={siteConfig.links.marketplace}>
                Explore marketplace
                <ArrowRightIcon className="size-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href={siteConfig.links.creators}>Become a creator</Link>
            </Button>
          </div>
        </div>

        <div className="mx-auto mt-20 grid max-w-5xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {pillars.map((pillar) => (
            <article
              key={pillar.title}
              className="rounded-xl border border-border bg-card p-6 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="mb-4 inline-flex rounded-lg bg-primary/10 p-2.5 text-primary">
                <pillar.icon className="size-5" aria-hidden />
              </div>
              <h2 className="text-lg font-semibold text-foreground">
                {pillar.title}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {pillar.description}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
