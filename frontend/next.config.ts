import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',  // Static export for Tauri
  images: {
    unoptimized: true  // Tauri doesn't support Next.js image optimization
  },
  // Don't use assetPrefix for Tauri v2 - it uses asset protocol
  trailingSlash: true,
};

export default nextConfig;
