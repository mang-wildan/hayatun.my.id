import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@hayatun/shared"],
  // Satu domain di semua lingkungan tanpa CORS. Di produksi Nginx yang meneruskan /api/* (ARCHITECTURE §1).
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000"}/api/:path*` }];
  },
};

export default config;
