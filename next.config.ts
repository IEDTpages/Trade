import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: process.env.STATIC_EXPORT === "1" ? "export" : undefined,
  trailingSlash: process.env.STATIC_EXPORT === "1",
  basePath: process.env.STATIC_EXPORT === "1" ? process.env.PAGES_BASE_PATH || "" : "",
  assetPrefix: process.env.STATIC_EXPORT === "1" ? process.env.PAGES_BASE_PATH || "" : "",
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;
