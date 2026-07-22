import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.STATIC_EXPORT === "1" ? "export" : undefined,
  trailingSlash: process.env.STATIC_EXPORT === "1",
  basePath: process.env.STATIC_EXPORT === "1" ? process.env.PAGES_BASE_PATH || "" : "",
  assetPrefix: process.env.STATIC_EXPORT === "1" ? process.env.PAGES_BASE_PATH || "" : "",
};

export default nextConfig;
