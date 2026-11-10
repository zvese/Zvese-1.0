export const siteConfig = {
  name: "Zvese",
  company: "Zvese Ltd",
  slogan: "Everything For Everyone",
  description:
    "Discover reviewed products from independent sellers on Zvese, with clear order tracking and manually coordinated delivery.",
  url: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  links: {
    marketplace: "/marketplace",
    creators: "/creators",
    about: "/about",
    contact: "/contact",
  },
} as const;

export type SiteConfig = typeof siteConfig;
