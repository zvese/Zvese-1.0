import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contact",
  description: "Get in touch with the Zvese team.",
};

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Contact</h1>
      <p className="mt-4 max-w-2xl text-muted-foreground">
        Contact options will be available soon. For early partnerships, reach
        out through your preferred channel once we launch.
      </p>
    </div>
  );
}
