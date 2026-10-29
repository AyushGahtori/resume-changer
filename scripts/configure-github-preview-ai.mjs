import { readFileSync } from "node:fs";
import { publishGithubPreviewSecrets } from "./lib/github-preview-secrets.mjs";
const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
if (
  !process.argv.includes("--source-file") ||
  !process.argv.includes("--vercel-cli")
)
  throw new Error(
    "Explicit local configuration and Vercel CLI paths are required.",
  );
const entries = Object.fromEntries(
  readFileSync(arg("--source-file"), "utf8")
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = line.match(
        /^\s*(GEMINI_API_KEY|GEMINI_MODEL|GEMINI_REQUEST_TIMEOUT_MS)\s*=\s*(.*?)\s*$/,
      );
      if (!match) return [];
      return [[match[1], match[2].replace(/^(["'])(.*)\1$/, "$2")]];
    }),
);
if (!entries.GEMINI_API_KEY?.trim())
  throw new Error("The existing Gemini configuration is incomplete.");
publishGithubPreviewSecrets(
  { ...entries, AI_PROVIDER: "gemini" },
  arg("--vercel-cli"),
);
console.log(
  "Existing Gemini configuration copied to phase-one Preview only; no API call was made.",
);
