import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: false,
  output: "standalone",
  // Server actions are used to forward image uploads (icon / thumbnail /
  // host avatar) to the api. Next.js caps server-action payloads at 1MB by
  // default, which 413s any real-world photo. Match the nginx 50M cap.
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "*.supabase.in" },
    ],
  },
  async headers() {
    return [
      {
        // Security + no-cache for all admin HTML pages.
        // Static assets (_next/static) are fingerprinted by Next.js and can
        // be cached indefinitely, so we exclude them here.
        source: "/((?!_next/static).*)",
        headers: [
          // ── Security ──────────────────────────────────────────────────────
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // ── Cache control ─────────────────────────────────────────────────
          // Force browsers (and any intermediate proxy / CDN) to always
          // revalidate before serving a cached copy. Admins always see the
          // latest deployed version without a hard-refresh.
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
      {
        // _next/static assets are content-addressed (hash in filename) —
        // safe to cache long-term in the browser.
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default nextConfig;
