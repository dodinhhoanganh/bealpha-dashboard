import type { NextConfig } from "next";

// Keep development origins explicit. LAN IPs and tunnel hosts are local
// configuration and must never be committed into a production artifact.
const devOrigins = [
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  ...(process.env.DASHBOARD_DEV_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
];

const nextConfig: NextConfig = {
  output: "standalone",
  distDir: process.env.NEXT_DIST_DIR || ".next",
  productionBrowserSourceMaps: false,
  allowedDevOrigins: devOrigins,

  // Disable x-powered-by header to avoid fingerprinting
  poweredByHeader: false,

  // Strict React mode for better error detection
  reactStrictMode: true,
  turbopack: { root: process.cwd() },

  experimental: {
    // Cap build workers to keep page-data collection reliable on constrained hosts.
    cpus: 2,
    serverSourceMaps: false,
  },

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-DNS-Prefetch-Control", value: "on" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
