import { readFile } from "node:fs/promises";
import ignore from "ignore";
import { describe, expect, it } from "vitest";

describe("deployment source packaging", () => {
  it("excludes private records, credentials and local caches while retaining application data code", async () => {
    const filter = ignore().add(await readFile(".vercelignore", "utf8"));
    for (const filename of [
      "data/resume-library.json",
      "data/generations/private.pdf",
      "storage/resume.pdf",
      ".runtime/account-migration.json",
      ".runtime/java/runtime.bin",
      ".env.local",
      ".vercel/project.json",
      ".git",
      ".next/cache/webpack/large.pack",
      ".next-cloud-test/cache/webpack/large.pack",
      ".next-test/server/private.js",
      "test-results/private-trace.zip",
      "node_modules/large-package/data.bin",
    ])
      expect(filter.ignores(filename), filename).toBe(true);
    for (const filename of [
      "src/lib/data/achievement-search.ts",
      "src/lib/data/loaders.ts",
      "src/lib/data/writers.ts",
      "src/lib/cloud/server-account.ts",
      "src/app/api/[...path]/route.ts",
      "src/app/api/history/handler.ts",
      "src/middleware.ts",
      "scripts/prepare-pdf-runtime.mjs",
      "scripts/warm-tectonic-cache.mjs",
      "examples/sample-resume-library.json",
      "templates/metadata.json",
      "package-lock.json",
    ])
      expect(filter.ignores(filename), filename).toBe(false);
  });
});
