import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About",
  description: "Learn about Zvese Ltd and our mission to make commerce accessible to everyone.",
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">About</h1>
      <p className="mt-4 max-w-2xl text-muted-foreground">
        Zvese Ltd is building an AI-powered global zero-inventory ecommerce
        marketplace. Our mission is simple: Everything For Everyone.
      </p>
    </div>
  );
}
