import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow external connections to dev server without triggering Cross-Origin block
  allowedDevOrigins: ["171.241.39.152", "171.241.4.220", "26.146.124.60", "localhost", "192.168.1.7"],

  // Disable x-powered-by header to avoid fingerprinting
  poweredByHeader: false,

  // Strict React mode for better error detection
  reactStrictMode: true,

  // Security-related headers applied to all routes
  async rewrites() {
    const uploadServer = process.env.UPLOAD_SERVER_URL || "http://localhost:3001";
    return [
      {
        source: "/upload/:path*",
        destination: `${uploadServer}/upload/:path*`,
      },
      {
        source: "/stream/:path*",
        destination: `${uploadServer}/stream/:path*`,
      },
      {
        source: "/uploads/:path*",
        destination: `${uploadServer}/uploads/:path*`,
      },
    ];
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
