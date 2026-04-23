import type { NextConfig } from "next";

// Dropped `output: "export"` (2026-04-19): the static-export mode required every
// dynamic route (/moulds/[id], /products/[id], /fillings/[id], ...) to enumerate
// its paths via `generateStaticParams()` at build time. That worked under the
// old Dexie/IndexedDB model because all data lived in the client. Now that the
// data layer is Supabase, UUIDs aren't available at build time, so we ship as
// an SSR app and Vercel renders routes on demand.
//
// The `public/_redirects` / `public/_headers` files that paired with the old
// export output are harmless left in place — Vercel ignores them on SSR — so
// we don't strip them in this change.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  async redirects() {
    return [
      { source: "/collections", destination: "/variants", permanent: true },
      { source: "/collections/:path*", destination: "/variants/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
