import type { JobAnalysisResult } from "./contracts";

export type ActiveJobContextInput = {
  company: string;
  roleTitle: string;
  jobUrl: string;
  jobDescription: string;
  analysis: JobAnalysisResult;
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export async function createJobContextId(input: ActiveJobContextInput) {
  const context = canonicalJson({
    company: input.company.trim(),
    roleTitle: input.roleTitle.trim(),
    jobUrl: input.jobUrl.trim(),
    jobDescription: input.jobDescription.trim(),
    analysis: input.analysis,
  });
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(context),
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
