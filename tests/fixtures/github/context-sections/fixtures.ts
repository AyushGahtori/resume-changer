import { createHash } from "node:crypto";
import type {
  PinnedBlobRequest,
  PinnedBlobResponse,
  PinnedBlobSource,
  PinnedFileIdentity,
  PinnedRepositoryIdentity,
  ReadSectionsInput,
} from "../../../../src/lib/github/context-sections";

export const TEST_REPOSITORY: PinnedRepositoryIdentity = {
  repositoryId: "repo-123",
  owner: "example",
  name: "sample-app",
  commitSha: "a".repeat(40),
};

export function gitBlobSha(bytes: Uint8Array): string {
  return createHash("sha1")
    .update(`blob ${bytes.byteLength}\0`, "utf8")
    .update(bytes)
    .digest("hex");
}

export function fileIdentity(
  path: string,
  bytes: Uint8Array,
  overrides: Partial<PinnedFileIdentity> = {},
): PinnedFileIdentity {
  return {
    fileId: path.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 180) || "file",
    path,
    blobSha: gitBlobSha(bytes),
    byteSize: bytes.byteLength,
    mode: "100644",
    ...overrides,
  };
}

export function makeReadInput(
  path: string,
  bytes: Uint8Array,
  overrides: Partial<ReadSectionsInput> = {},
): ReadSectionsInput {
  return {
    repository: TEST_REPOSITORY,
    file: fileIdentity(path, bytes),
    context: {
      authorizationNamespace: "test-account:grant-1",
      signal: new AbortController().signal,
      deadlineEpochMs: Date.now() + 60_000,
    },
    intent: "unknown",
    ...overrides,
  };
}

export function asBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function exactSizeText(byteSize: number): Uint8Array {
  const chunks: string[] = [];
  let remaining = byteSize;
  while (remaining > 0) {
    const take = Math.min(101, remaining);
    chunks.push(take === 1 ? "\n" : `${"x".repeat(take - 1)}\n`);
    remaining -= take;
  }
  return asBytes(chunks.join(""));
}

export function largeMarkdown(byteSize = 100 * 1024): Uint8Array {
  const sectionCount = 10;
  const intro =
    "# Architecture notes\n\nThis document describes the current repository modules.\n\n";
  const sections: string[] = [];
  for (let index = 0; index < sectionCount; index += 1) {
    const bodyLines = Array.from(
      { length: 26 },
      (_, line) =>
        `Module ${index} line ${line}: the request boundary validates identity and returns a bounded result.`,
    );
    sections.push(`## Module ${index}\n\n${bodyLines.join("\n\n")}`);
  }
  let text = `${intro}${sections.join("\n\n")}`;
  const fillerLine =
    "Additional bounded implementation context remains available to review.\n";
  while (
    Buffer.byteLength(text, "utf8") + Buffer.byteLength(fillerLine, "utf8") <=
    byteSize
  ) {
    text += fillerLine;
  }
  const missing = byteSize - Buffer.byteLength(text, "utf8");
  if (missing > 0) text += `${"x".repeat(Math.max(0, missing - 1))}\n`;
  return asBytes(text);
}

export function largeComponent(byteSize = 116 * 1024): Uint8Array {
  const prefix = [
    "export function LargeDashboard({ records }: { records: string[] }) {",
    "  const save = async () => {",
    "    return records.length;",
    "  };",
    "",
  ].join("\n");
  const suffix = [
    "  return <button onClick={save}>{records.length}</button>;",
    "}",
    "",
  ].join("\n");
  const fillerLine = `  // bounded synthetic component context ${"x".repeat(76)}\n`;
  let text = prefix;
  while (
    Buffer.byteLength(`${text}${fillerLine}${suffix}`, "utf8") <= byteSize
  ) {
    text += fillerLine;
  }
  const remaining = byteSize - Buffer.byteLength(`${text}${suffix}`, "utf8");
  if (remaining > 5) text += `  // ${"x".repeat(remaining - 6)}\n`;
  else if (remaining > 0) text += `${" ".repeat(remaining)}`;
  text += suffix;
  return asBytes(text);
}

export async function* chunkBytes(
  bytes: Uint8Array,
  chunkSize = 8 * 1024,
  onChunk?: (chunkIndex: number) => void,
): AsyncIterable<Uint8Array> {
  for (
    let offset = 0, index = 0;
    offset < bytes.byteLength;
    offset += chunkSize, index += 1
  ) {
    onChunk?.(index);
    yield bytes.slice(offset, Math.min(offset + chunkSize, bytes.byteLength));
  }
}

export function createFakeSource(
  bytesFor: (input: PinnedBlobRequest) => Uint8Array | Promise<Uint8Array>,
  options: {
    calls?: PinnedBlobRequest[];
    chunkSize?: number;
    response?: (input: PinnedBlobRequest) => Partial<PinnedBlobResponse>;
    isAuthorized?: () => boolean | Promise<boolean>;
  } = {},
): PinnedBlobSource & { calls: PinnedBlobRequest[] } {
  const calls = options.calls ?? [];
  return {
    calls,
    async isAuthorized() {
      return (await options.isAuthorized?.()) ?? true;
    },
    async openPinnedBlob(input) {
      calls.push(input);
      const bytes = await bytesFor(input);
      const response = options.response?.(input) ?? {};
      return {
        repositoryId: input.repository.repositoryId,
        commitSha: input.repository.commitSha,
        path: input.file.path,
        blobSha: input.file.blobSha,
        body: chunkBytes(bytes, options.chunkSize),
        ...response,
      };
    },
  };
}
