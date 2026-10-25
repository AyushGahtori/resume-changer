import type { NextConfig } from "next";
import path from "node:path";

const pdfAssets = [
  "./.runtime/pdf/**",
  "./node_modules/pdfjs-dist/legacy/build/*.mjs",
];

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  typescript: { tsconfigPath: process.env.NEXT_TSCONFIG ?? "tsconfig.json" },
  outputFileTracingRoot: path.resolve(process.cwd()),
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas"],
  outputFileTracingIncludes: {
    "/api/[...path]": pdfAssets,
  },
};

export default nextConfig;
