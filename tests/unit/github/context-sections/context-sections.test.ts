import { describe, expect, it } from "vitest";
import {
  createContextSectionReader,
  compareExperimentalReadCeilings,
  type PinnedBlobRequest,
} from "../../../../src/lib/github/context-sections";
import {
  asBytes,
  createFakeSource,
  exactSizeText,
  fileIdentity,
  largeComponent,
  largeMarkdown,
  makeReadInput,
} from "../../../fixtures/github/context-sections/fixtures";

describe("experimental GitHub context section reader", () => {
  it("does not repopulate a cleared cache when a prior read completes", async () => {
    const bytes = asBytes("export const cached = true;\n");
    let release!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const source = createFakeSource(async () => {
      markStarted();
      await pending;
      return bytes;
    });
    const reader = createContextSectionReader(source);
    const input = makeReadInput("src/cached.ts", bytes);
    const first = reader.readSections(input);
    await started;
    reader.clearMemoryCache();
    release();
    expect((await first).ok).toBe(true);
    expect(reader.getMemoryStats().cacheEntries).toBe(0);
    expect((await reader.readSections(input)).ok).toBe(true);
    expect(source.calls).toHaveLength(2);
  });

  it("compares the current 64 KiB ceiling with the experimental 256 KiB ceiling", async () => {
    for (const size of [63 * 1024, 64 * 1024, 65 * 1024]) {
      const bytes = exactSizeText(size);
      const input = makeReadInput("docs/readme.txt", bytes);
      const reader = createContextSectionReader(createFakeSource(() => bytes));
      const result = await reader.readSections(input);

      expect(bytes.byteLength).toBe(size);
      expect(result.ok).toBe(true);
      expect(compareExperimentalReadCeilings(size)).toEqual({
        valid: true,
        baselineEligible: size <= 64 * 1024,
        experimentalEligible: true,
        recoveredBeyondBaseline: size > 64 * 1024,
      });
    }
  });

  it("extracts exact bounded sections from 100 KiB Markdown", async () => {
    const bytes = largeMarkdown(100 * 1024);
    const input = makeReadInput("docs/architecture.md", bytes, {
      intent: "overview",
      relevanceTerms: ["request boundary", "modules"],
    });
    const result = await createContextSectionReader(
      createFakeSource(() => bytes),
    ).readSections(input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sourceBytes).toBe(100 * 1024);
    expect(result.sections.length).toBeGreaterThan(1);
    for (const section of result.sections) {
      expect(section.lineStart).toBeGreaterThan(0);
      expect(section.lineEnd).toBeGreaterThanOrEqual(section.lineStart);
      expect(Buffer.byteLength(section.excerpt, "utf8")).toBeLessThanOrEqual(
        12_000,
      );
      expect(section.lineEnd - section.lineStart + 1).toBeLessThanOrEqual(200);
      expect(section.contentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(section.evidenceStatus).toBe("documented");
    }
  });

  it("keeps large component signatures partial and extracts useful nested declarations", async () => {
    const bytes = largeComponent(116 * 1024);
    const input = makeReadInput("src/components/large-dashboard.tsx", bytes, {
      intent: "implementation",
      relevanceTerms: ["dashboard", "save"],
    });
    const result = await createContextSectionReader(
      createFakeSource(() => bytes),
    ).readSections(input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sourceBytes).toBeGreaterThan(100 * 1024);
    expect(
      result.sections.some(
        (section) =>
          section.kind === "signature" &&
          section.completeness === "partial" &&
          section.partialContext?.includes("signature only"),
      ),
    ).toBe(true);
    expect(
      result.sections.some(
        (section) =>
          section.kind === "nested-declaration" &&
          section.excerpt.includes("save"),
      ),
    ).toBe(true);
    expect(
      result.limitations.some((item) => item.includes("partial signature")),
    ).toBe(true);
  });

  it("accepts an exactly 256 KiB source and rejects streamed bytes beyond it", async () => {
    const bytes = exactSizeText(256 * 1024);
    const exactSource = createFakeSource(() => bytes);
    const exact = await createContextSectionReader(exactSource).readSections(
      makeReadInput("docs/exact.txt", bytes),
    );
    expect(exact.ok).toBe(true);
    expect(exactSource.calls).toHaveLength(1);

    const declaredBytes = exactSizeText(256 * 1024);
    const overBytes = new Uint8Array(declaredBytes.byteLength + 1);
    overBytes.set(declaredBytes);
    overBytes[overBytes.length - 1] = 0x0a;
    const overInput = makeReadInput("docs/over.txt", declaredBytes);
    const overSource = createFakeSource(() => overBytes);
    const over =
      await createContextSectionReader(overSource).readSections(overInput);
    expect(over).toMatchObject({
      ok: false,
      error: { code: "file-too-large" },
    });
  });

  it("screens the entire bounded body, including a credential canary near EOF", async () => {
    const canary = `ghp_${"A".repeat(36)}`;
    const prefix = "# safe notes\n\n" + "ordinary context\n".repeat(200);
    const bytes = asBytes(`${prefix}\n${"x".repeat(40)} ${canary}`);
    const result = await createContextSectionReader(
      createFakeSource(() => bytes),
    ).readSections(makeReadInput("docs/notes.md", bytes));

    expect(result).toMatchObject({
      ok: false,
      error: { code: "unsafe-content" },
    });
    expect(JSON.stringify(result)).not.toContain(canary);
  });

  it("rejects a line above the source line limit rather than cropping it", async () => {
    const bytes = asBytes(`export const value = "${"x".repeat(3_000)}";\n`);
    const result = await createContextSectionReader(
      createFakeSource(() => bytes),
    ).readSections(makeReadInput("src/value.ts", bytes));

    expect(result).toMatchObject({
      ok: false,
      error: { code: "line-too-long" },
    });
  });

  it("keeps metadata, downloaded bytes, decoded memory, and excerpt budgets separate", async () => {
    const bytes = asBytes("export const value = true;\n");
    const tooLargeMetadata = createFakeSource(() => bytes);
    const metadataRejected = await createContextSectionReader(
      tooLargeMetadata,
    ).readSections(
      makeReadInput("src/metadata.ts", bytes, {
        file: fileIdentity("src/metadata.ts", bytes, {
          byteSize: 256 * 1024 + 1,
        }),
      }),
    );
    expect(metadataRejected).toMatchObject({
      ok: false,
      error: { code: "file-too-large" },
    });
    expect(tooLargeMetadata.calls).toHaveLength(0);

    const decodedBudget = createFakeSource(() => bytes);
    const decodedRejected = await createContextSectionReader(
      decodedBudget,
    ).readSections(
      makeReadInput("src/decoded.ts", bytes, {
        budget: { maxDecodedMemoryBytes: 8 },
      }),
    );
    expect(decodedRejected).toMatchObject({
      ok: false,
      error: { code: "decoded-memory-limit" },
    });
  });

  it("rejects invalid UTF-8 and binary data disguised as text", async () => {
    const invalidBytes = new Uint8Array([0xff, 0xfe, 0xfd]);
    const invalidResult = await createContextSectionReader(
      createFakeSource(() => invalidBytes),
    ).readSections(makeReadInput("src/invalid.ts", invalidBytes));
    expect(invalidResult).toMatchObject({
      ok: false,
      error: { code: "invalid-utf8" },
    });

    const binaryBytes = asBytes("const value = 1;\u0000\n");
    const binaryResult = await createContextSectionReader(
      createFakeSource(() => binaryBytes),
    ).readSections(makeReadInput("src/binary.ts", binaryBytes));
    expect(binaryResult).toMatchObject({
      ok: false,
      error: { code: "binary-content" },
    });
  });

  it("rejects path traversal, secret paths, binary modes, and encoded traversal", async () => {
    const bytes = asBytes("safe\n");
    const source = createFakeSource(() => bytes);
    const reader = createContextSectionReader(source);
    const traversal = await reader.readSections(
      makeReadInput("src/../secret.ts", bytes),
    );
    const encoded = await reader.readSections(
      makeReadInput("src/%2e%2e/secret.ts", bytes),
    );
    const secretPath = await reader.readSections(
      makeReadInput("config/.env.example", bytes),
    );
    const svgPath = await reader.readSections(
      makeReadInput("docs/mockup.svg", bytes),
    );
    const symlink = await reader.readSections(
      makeReadInput("src/link.ts", bytes, {
        file: fileIdentity("src/link.ts", bytes, { mode: "120000" }),
      }),
    );

    expect(traversal).toMatchObject({
      ok: false,
      error: { code: "blocked-path" },
    });
    expect(encoded).toMatchObject({
      ok: false,
      error: { code: "blocked-path" },
    });
    expect(secretPath).toMatchObject({
      ok: false,
      error: { code: "blocked-path" },
    });
    expect(svgPath).toMatchObject({
      ok: false,
      error: { code: "blocked-path" },
    });
    expect(symlink).toMatchObject({
      ok: false,
      error: { code: "invalid-input" },
    });
    expect(source.calls).toHaveLength(0);
  });

  it("verifies the pinned identity, actual size, and Git blob hash", async () => {
    const expected = asBytes("the pinned source\n");
    const different = asBytes("bad pinned source\n");
    const mismatchSource = createFakeSource(() => different);
    const hashMismatch = await createContextSectionReader(
      mismatchSource,
    ).readSections(makeReadInput("src/source.ts", expected));
    expect(hashMismatch).toMatchObject({
      ok: false,
      error: { code: "source-mismatch" },
    });

    const sizeLieInput = makeReadInput("src/size.ts", expected, {
      file: fileIdentity("src/size.ts", expected, {
        byteSize: expected.byteLength - 1,
      }),
    });
    const sizeLie = await createContextSectionReader(
      createFakeSource(() => expected),
    ).readSections(sizeLieInput);
    expect(sizeLie).toMatchObject({
      ok: false,
      error: { code: "source-size-mismatch" },
    });

    const identityMismatch = await createContextSectionReader(
      createFakeSource(() => expected, {
        response: () => ({ commitSha: "b".repeat(40) }),
      }),
    ).readSections(makeReadInput("src/identity.ts", expected));
    expect(identityMismatch).toMatchObject({
      ok: false,
      error: { code: "source-mismatch" },
    });
  });

  it("uses authorization scope in the memory key and deduplicates same-scope reads", async () => {
    const bytes = asBytes("export const useful = true;\n");
    let authorized = true;
    let authorizationChecks = 0;
    const source = createFakeSource(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return bytes;
      },
      {
        isAuthorized: () => {
          authorizationChecks += 1;
          return authorized;
        },
      },
    );
    const reader = createContextSectionReader(source);
    const input = makeReadInput("src/useful.ts", bytes);
    const [first, duplicate] = await Promise.all([
      reader.readSections(input),
      reader.readSections(input),
    ]);

    expect(first.ok).toBe(true);
    expect(duplicate.ok).toBe(true);
    expect(source.calls).toHaveLength(1);
    expect(first.ok && first.cacheHit).toBe(false);
    expect(duplicate.ok && duplicate.cacheHit).toBe(true);

    const otherScope = await reader.readSections({
      ...input,
      context: {
        ...input.context,
        authorizationNamespace: "other-account:grant-1",
      },
    });
    expect(otherScope.ok).toBe(true);
    expect(source.calls).toHaveLength(2);
    expect(authorizationChecks).toBe(3);

    authorized = false;
    const revokedCacheHit = await reader.readSections(input);
    expect(revokedCacheHit).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(source.calls).toHaveLength(2);
    expect(authorizationChecks).toBe(4);
  });

  it("clears cached excerpts without resetting conservative run accounting", async () => {
    const bytes = asBytes("export const cached = true;\n");
    const source = createFakeSource(() => bytes);
    const reader = createContextSectionReader(source);
    const input = makeReadInput("src/cached.ts", bytes);
    const first = await reader.readSections(input);
    expect(first.ok).toBe(true);
    expect(reader.getMemoryStats().cacheEntries).toBe(1);

    reader.clearMemoryCache();
    expect(reader.getMemoryStats()).toMatchObject({
      cacheEntries: 0,
      cacheBytes: 0,
      usedRunBytes: bytes.byteLength,
    });

    const second = await reader.readSections(input);
    expect(second.ok).toBe(true);
    expect(source.calls).toHaveLength(2);
    expect(reader.getMemoryStats().usedRunBytes).toBe(bytes.byteLength * 2);
  });

  it("cancels an in-progress stream and never returns a partial excerpt", async () => {
    const bytes = asBytes("export const value = true;\n".repeat(100));
    const controller = new AbortController();
    let streamClosed = false;
    const source = {
      async isAuthorized() {
        return true;
      },
      async openPinnedBlob(input: PinnedBlobRequest) {
        return {
          repositoryId: input.repository.repositoryId,
          commitSha: input.repository.commitSha,
          path: input.file.path,
          blobSha: input.file.blobSha,
          body: (async function* () {
            try {
              yield bytes.slice(0, 10);
              controller.abort();
              yield bytes.slice(10);
            } finally {
              streamClosed = true;
            }
          })(),
        };
      },
    };
    const input = makeReadInput("src/slow.ts", bytes, {
      context: {
        authorizationNamespace: "test-account:grant-1",
        signal: controller.signal,
        deadlineEpochMs: Date.now() + 60_000,
      },
    });
    const result = await createContextSectionReader(source).readSections(input);

    expect(result).toMatchObject({ ok: false, error: { code: "cancelled" } });
    expect(streamClosed).toBe(true);
  });

  it("preserves completed files when a later file in the batch fails", async () => {
    const firstBytes = asBytes("export const first = true;\n");
    const secondBytes = asBytes("export const second = true;\n");
    const source = createFakeSource((input) => {
      if (input.file.path === "src/second.ts")
        throw new Error("synthetic transport failure");
      return firstBytes;
    });
    const reader = createContextSectionReader(source);
    const base = makeReadInput("src/first.ts", firstBytes);
    const batch = await reader.readMany({
      repository: base.repository,
      files: [base.file, fileIdentity("src/second.ts", secondBytes)],
      context: base.context,
      intent: "implementation",
    });

    expect(batch.successfulFiles).toBe(1);
    expect(batch.failedFiles).toBe(1);
    expect(batch.results[0]?.result.ok).toBe(true);
    expect(batch.results[1]?.result).toMatchObject({
      ok: false,
      error: { code: "source-error" },
    });
    expect(reader.getMemoryStats().cacheEntries).toBe(1);
  });

  it("enforces the aggregate run budget and a request deadline before transport", async () => {
    const bytes = exactSizeText(256 * 1024);
    const source = createFakeSource(() => bytes);
    const reader = createContextSectionReader(source);
    const base = makeReadInput("src/a.txt", bytes);
    const first = await reader.readSections(base);
    const second = await reader.readSections({
      ...base,
      file: fileIdentity("src/b.txt", bytes),
    });
    const third = await reader.readSections({
      ...base,
      file: fileIdentity("src/c.txt", bytes),
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(third).toMatchObject({
      ok: false,
      error: { code: "run-budget-exceeded" },
    });
    expect(source.calls).toHaveLength(2);

    const expiredSource = createFakeSource(() => bytes);
    const expired = await createContextSectionReader(expiredSource, {
      now: () => 100,
    }).readSections(
      makeReadInput("src/expired.txt", bytes, {
        context: {
          authorizationNamespace: "test-account:grant-1",
          signal: new AbortController().signal,
          deadlineEpochMs: 99,
        },
      }),
    );
    expect(expired).toMatchObject({
      ok: false,
      error: { code: "deadline-exceeded" },
    });
    expect(expiredSource.calls).toHaveLength(0);
  });
});
