import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Opt-in isolated benchmark build; never overwrites the running .next build.
  ...(process.env.ZVESE_PERF_BUILD === "1" ? { distDir: ".next-perf", typescript: { tsconfigPath: "tsconfig.perf.json" } } : {}),
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default nextConfig;
