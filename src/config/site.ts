export const siteConfig = {
  name: "Zvese",
  company: "Zvese Ltd",
  slogan: "Everything For Everyone",
  description:
    "AI-powered global zero-inventory ecommerce marketplace combining marketplace commerce, creator economy, and global fulfillment.",
  url: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  links: {
    marketplace: "/marketplace",
    creators: "/creators",
    about: "/about",
    contact: "/contact",
  },
} as const;

export type SiteConfig = typeof siteConfig;
