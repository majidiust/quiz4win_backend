import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    optimizePackageImports: ["lucide-react"],
    // Intro-video + avatar uploads flow through Next.js server actions, which
    // cap payloads at 1MB by default and 413 any real recording/photo. Match
    // the nginx 50M cap (deploy/nginx/host.quiz4win.com.conf).
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
};

export default nextConfig;
