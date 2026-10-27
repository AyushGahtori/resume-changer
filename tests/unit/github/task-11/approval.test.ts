import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AnalysisResultSchema,
  ImportRecordSchema,
  PreparedSelectionSchema,
  err,
  ok,
  type ExecutionContext,
  type ImportRecord,
  type MeasurementResult,
  type PreparedSelection,
} from "../../../../src/lib/github/contracts";
import type { MeasurementPort } from "../../../../src/lib/github/ports";
import { createGithubApprovalPort } from "../../../../src/lib/data/writers";
import {
  ResumeLibraryV2Schema,
  type NormalizedResumeLibrary,
} from "../../../../src/lib/schemas/resume-data";
import { normalizeResumeLibrary } from "../../../../src/lib/github/server/library-migration";

const fixedNow = "2026-10-26T12:00:00.000Z";
const commitSha = "a".repeat(40);
const treeSha = "c".repeat(40);
const repoId = "123456789";
const consentHash = hash("selection-hash");
const latencyClause =
  "Recorded p95 API latency of 250 ms in checkout under a 1 MiB payload.";
const temporaryRoots: string[] = [];

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function makeBudget() {
  return {
    reserve: async () => ok({ reservationId: "reservation-1" }),
    commitUsage: async () =>
      ok({
        requests: 0,
        pullRequestRequests: 0,
        fetchedBodies: 0,
        fetchedBytes: 0,
        uniqueFiles: 0,
        uniqueLines: 0,
        transmittedLines: 0,
        inputTokens: 0,
        generationAttempts: 0,
      }),
    checkSelection: () => ok({ allowed: true, reason: null }),
    remaining: () =>
      ok({
        requests: 0,
        pullRequestRequests: 0,
        fetchedBodies: 0,
        fetchedBytes: 0,
        uniqueFiles: 0,
        uniqueLines: 0,
        transmittedLines: 0,
        inputTokens: 0,
        generationAttempts: 0,
      }),
    snapshot: () =>
      ok({
        requests: 0,
        pullRequestRequests: 0,
        fetchedBodies: 0,
        fetchedBytes: 0,
        uniqueFiles: 0,
        uniqueLines: 0,
        transmittedLines: 0,
        inputTokens: 0,
        generationAttempts: 0,
      }),
  };
}

function makeContext(root: string): ExecutionContext {
  return {
    personalRoot: root,
    access: {
      sessionId: "session-task-11",
      authorizationNamespace: "namespace-task-11",
      accountId: null,
      grantedRepositoryIds: [repoId],
    },
    signal: new AbortController().signal,
    now: () => new Date(fixedNow),
    runId: "run-task-11",
    deadline: "2026-10-26T13:00:00.000Z",
    budget: makeBudget(),
  };
}

async function createRoot(v1 = false) {
  const root = await mkdtemp(join(tmpdir(), "resume-changer-github-approval-"));
  temporaryRoots.push(root);
  const dataDir = join(root, "data");
  await mkdir(dataDir, { recursive: true });
  const file = join(dataDir, "resume-library.json");
  const sampleText = await readFile(
    join(process.cwd(), "examples", "sample-resume-library.json"),
    "utf8",
  );
  const contents = v1
    ? sampleText
    : `${JSON.stringify(normalizeResumeLibrary(JSON.parse(sampleText)), null, 2)}\n`;
  await writeFile(file, contents, "utf8");
  return {
    root,
    file,
    original: contents,
    library: normalizeResumeLibrary(JSON.parse(contents)),
  };
}

function makeScope() {
  return {
    repositoryId: repoId,
    owner: "sample-owner",
    name: "sample-project",
    canonicalUrl: "https://github.com/sample-owner/sample-project",
    visibility: "public" as const,
    ref: "main",
    commitSha,
    packagePath: "apps/web",
    selectedPullRequestNumbers: [41],
    selectedPaths: ["src/app.ts", "reports/latency.json"],
    contributionStatement:
      "I implemented the publishing validation and request timing changes.",
    identitySource: "user-provided" as const,
  };
}

function makeEvidence(input: {
  id: string;
  path: string;
  excerpt: string;
  category: "implementation" | "report";
  pointer:
    | { kind: "lines"; startLine: number; endLine: number }
    | { kind: "report-fields"; fields: string[] };
}) {
  return {
    id: input.id,
    snapshotId: "snapshot-staged",
    commitSha,
    path: input.path,
    blobSha: "b".repeat(40),
    pointer: input.pointer,
    excerpt: input.excerpt,
    excerptSha256: hash(input.excerpt),
    category: input.category,
    classification: "observed" as const,
  };
}

type ReviewOptions = {
  source?: "personal" | "demo";
  selectedDraftIds?: string[];
  unconfirmedMetric?: boolean;
  targetText?: string;
};

function makeReview(projectId: string, options: ReviewOptions = {}) {
  const selectedDraftIds = options.selectedDraftIds ?? [
    "draft-one",
    "draft-two",
  ];
  const scope = makeScope();
  const consentedAt = "2026-10-26T11:00:00.000Z";
  const codeEvidence = makeEvidence({
    id: "evidence-code",
    path: "src/app.ts",
    excerpt: "export function validatePublishInput() { return true; }",
    category: "implementation",
    pointer: { kind: "lines", startLine: 1, endLine: 1 },
  });
  const reportEvidence = makeEvidence({
    id: "evidence-latency",
    path: "reports/latency.json",
    excerpt: '{"checkout":{"p95_ms":250}}',
    category: "report",
    pointer: { kind: "report-fields", fields: ["checkout", "p95_ms"] },
  });
  const prepared = PreparedSelectionSchema.parse({
    importId: "import-task-11",
    runId: "run-task-11",
    version: 2,
    selectionHash: consentHash,
    scope,
    selectedFileIds: ["file-code", "file-report"],
    evidence: [codeEvidence, reportEvidence],
    limitations: ["No production traffic was inspected."],
    completeness: "complete",
    budget: {
      fetchedFiles: 2,
      fetchedBytes: 256,
      httpAttempts: 5,
      selectedUniqueFiles: 2,
      selectedUniqueLines: 2,
      selectedCharacters: 120,
      transmittedLinesByRequest: [2],
      cumulativeTransmittedLines: 2,
      estimatedInputTokens: 80,
      reportedInputTokens: 65,
      limitReason: null,
    },
    providerDisclosure: "This exact source selection was consented to.",
    consentedAt,
  });
  const resultId = "measurement-result-latency";
  const metricResult: MeasurementResult = {
    id: resultId,
    definitionId: "web-api-latency",
    version: 1,
    originalValues: [250],
    originalUnits: ["ms"],
    normalizedValues: [250],
    normalizedUnit: "ms",
    context: { operation: "checkout", payload: "1 MiB" },
    evidenceStatus: "measured",
    formulaVersion: "measurement-v1",
    roundingPolicy: "one-decimal-place",
    derivedQuantity: null,
    rendererId: "api-latency-v1",
    previewHash: hash(latencyClause),
    confirmed: !options.unconfirmedMetric,
  };
  const answerPayload = {
    questionId: "question-latency",
    version: 1,
    mode: "result" as const,
    originalValues: [250],
    originalUnits: ["ms"],
    definitionId: metricResult.definitionId,
    statistic: "p95",
    context: { operation: "checkout", payload: "1 MiB" },
    sourceEvidenceIds: [reportEvidence.id],
    attestation: "measured" as const,
  };
  const answer = {
    ...answerPayload,
    answerHash: hash(canonical(answerPayload)),
  };
  const draft = (id: string, text: string, metricResultIds: string[] = []) => ({
    id,
    version: 1,
    projectId,
    text,
    reviewedBaseText: text,
    claimIds: ["claim-publish"],
    supportStatus: "supported" as const,
    selectedForSave: false,
    contributionConfirmed: false,
    metricResultIds,
    approvalEligible: true,
    approvalErrors: [],
  });
  const drafts = [
    draft("draft-one", "Implemented publishing input validation."),
    draft(
      "draft-two",
      options.unconfirmedMetric
        ? "Implemented request timing instrumentation."
        : `Implemented request timing instrumentation. ${latencyClause}`,
      [resultId],
    ),
    draft(
      "draft-target",
      options.targetText ?? "Planned a target of 100% faster publishing.",
      ["measurement-target"],
    ),
  ];
  const edits = drafts.map((item) => ({
    draftId: item.id,
    version: 2,
    baseResultHash: hash(canonical(item)),
    text: item.text,
    selectedForSave: selectedDraftIds.includes(item.id),
    contributionConfirmed: true,
    confirmedMetricResultIds:
      item.id === "draft-two" && !options.unconfirmedMetric ? [resultId] : [],
    updatedAt: "2026-10-26T11:30:00.000Z",
  }));
  const record: ImportRecord = ImportRecordSchema.parse({
    id: "import-task-11",
    version: 5,
    source: options.source ?? "personal",
    destinationProjectId: projectId,
    authorizationNamespaceHash: hash("namespace-task-11"),
    scope,
    selectionVersion: 2,
    selectionHash: consentHash,
    lifecycle: "ready-to-review",
    activeRunId: null,
    consent: {
      reference: "consent-task-11",
      selectionVersion: 2,
      selectionHash: consentHash,
      consentedAt,
    },
    preparedSelectionRef: hash("prepared-ref"),
    resultRef: hash("result-ref"),
    draftRefs: drafts.map((item) => item.id),
    draftEdits: edits,
    savedIds: [],
    retentionDeadline: "2026-10-27T12:00:00.000Z",
    createdAt: "2026-10-26T10:00:00.000Z",
    updatedAt: "2026-10-26T11:30:00.000Z",
  });
  const result = AnalysisResultSchema.parse({
    summary: "Synthetic task 11 review.",
    claims: [
      {
        id: "claim-publish",
        text: "Implemented publishing input validation.",
        evidenceIds: [codeEvidence.id],
        userStatementIds: [],
        classification: "observed",
        confirmedByUser: true,
        confirmationVersion: 2,
        limitations: [],
      },
    ],
    drafts,
    questionSuggestions: [],
    limitations: [],
    model: "synthetic",
    finishReason: "stop",
    usage: {
      promptTokens: 10,
      cachedTokens: 0,
      outputTokens: 10,
      reasoningTokens: 0,
      totalTokens: 20,
    },
    selectionHash: consentHash,
  });
  const artifacts = {
    preparedRef: record.preparedSelectionRef!,
    resultRef: record.resultRef!,
    prepared,
    result,
    snapshot: {
      treeSha,
      inspectedAt: "2026-10-26T10:30:00.000Z",
      budgetsUsed: {
        filesFetched: 2,
        maxFetchedFileBytes: 128,
        decodedBytes: 256,
        upstreamBytes: 512,
        httpAttempts: 5,
        selectedFiles: 2,
        selectedCharacters: 120,
        maxSelectedFileCharacters: 80,
        maxRequestLines: 2,
        maxRequestFileLines: 1,
        uniqueLines: 2,
        transmittedLines: 2,
        maxRequestInputTokens: 80,
        reportedInputTokens: 65,
        estimatedInputTokens: 80,
      },
    },
    measurements: [
      {
        draftId: "draft-two",
        answer,
        result: metricResult,
        confirmedAt: "2026-10-26T11:20:00.000Z",
      },
    ],
    contributionRole: "Backend contributor",
  };
  return {
    record,
    artifacts,
    metricResult,
    selectedDraftIds,
  };
}

function fakeMeasurementPort(result: MeasurementResult): MeasurementPort {
  return {
    getApplicableDefinitions: () => ok([]),
    validateMeasurementAnswer: ({ answer }) => ok(answer),
    deriveMeasurementResult: () => ok({ ...result, confirmed: false }),
    renderMetricClause: () =>
      ok({ clause: latencyClause, previewHash: hash(latencyClause) }),
  };
}

function nextId() {
  let counter = 0;
  return () => `task-11-generated-${++counter}`;
}

function makeWriter(
  review: ReturnType<typeof makeReview>,
  options: {
    onResolve?: () => Promise<void> | void;
    renameFile?: typeof rename;
    onResolved?: () => void;
  } = {},
) {
  let resolutionCount = 0;
  const writer = createGithubApprovalPort({
    store: {
      get: async ({ id }) =>
        id === review.record.id
          ? ok(review.record)
          : err({ code: "not-found", message: "Not found.", retryable: false }),
    },
    resolveReview: async () => {
      resolutionCount += 1;
      await options.onResolve?.();
      return ok(review.artifacts);
    },
    measurements: fakeMeasurementPort(review.metricResult),
    now: () => new Date(fixedNow),
    id: nextId(),
    ...(options.renameFile ? { renameFile: options.renameFile } : {}),
  });
  return {
    writer,
    get resolutionCount() {
      return resolutionCount;
    },
  };
}

async function readLibrary(file: string): Promise<NormalizedResumeLibrary> {
  return ResumeLibraryV2Schema.parse(JSON.parse(await readFile(file, "utf8")));
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("GitHub approval writer", () => {
  it("saves only selected drafts with source provenance and locally verified metrics", async () => {
    const { root, file, library } = await createRoot();
    const review = makeReview(library.projects[0].id);
    const { writer } = makeWriter(review);

    const result = await writer.approveGithubImport(
      {
        importId: review.record.id,
        expectedVersion: review.record.version,
        selectedDraftIds: review.selectedDraftIds,
        idempotencyKey: "approval-valid-batch",
      },
      makeContext(root),
    );

    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.value.savedIds).toHaveLength(2);
    const saved = await readLibrary(file);
    const project = saved.projects.find(
      (item) => item.id === library.projects[0].id,
    )!;
    const imported = project.points.filter(
      (point) => point.source.type === "github-repository",
    );
    expect(imported).toHaveLength(2);
    expect(imported.map((point) => point.text)).toEqual([
      "Implemented publishing input validation.",
      `Implemented request timing instrumentation. ${latencyClause}`,
    ]);
    expect(imported[0].metrics).toEqual([]);
    expect(imported[1].metrics).toHaveLength(1);
    expect(imported.every((point) => point.githubEvidence)).toBe(true);
    expect(project.repositoryAttachments).toHaveLength(1);
    expect(saved.githubImportApprovals).toHaveLength(2);
    expect(result.value.savedIds).toEqual(imported.map((point) => point.id));
    expect(await readFile(`${file}.bak`, "utf8")).toContain(
      '"schemaVersion": 2',
    );
  });

  it("writes migrated v2 data and keeps the exact v1 backup", async () => {
    const { root, file, original, library } = await createRoot(true);
    const review = makeReview(library.projects[0].id, {
      selectedDraftIds: ["draft-one"],
    });
    const { writer } = makeWriter(review);

    const result = await writer.approveGithubImport(
      {
        importId: review.record.id,
        expectedVersion: review.record.version,
        selectedDraftIds: ["draft-one"],
        idempotencyKey: "approval-v1-migration",
      },
      makeContext(root),
    );

    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect((await readLibrary(file)).schemaVersion).toBe(2);
    expect(await readFile(`${file}.bak`, "utf8")).toBe(original);
  });

  it.each([
    [
      "demo imports",
      (review: ReturnType<typeof makeReview>) => {
        (review.record as { source: "personal" | "demo" }).source = "demo";
      },
    ],
    [
      "unknown evidence",
      (review: ReturnType<typeof makeReview>) => {
        review.artifacts.result.claims[0].evidenceIds = [
          "evidence-not-consented",
        ];
      },
    ],
    [
      "unconfirmed contribution",
      (review: ReturnType<typeof makeReview>) => {
        review.record.draftEdits[0].contributionConfirmed = false;
      },
    ],
    [
      "target numbers left in reviewed text",
      (review: ReturnType<typeof makeReview>) => {
        review.record.draftEdits[2].selectedForSave = true;
        review.record.draftEdits[2].text =
          "Target a 100% publishing improvement.";
      },
    ],
  ])("rejects %s without writing", async (_name, tamper) => {
    const { root, file, original, library } = await createRoot();
    const selectedDraftIds =
      _name === "target numbers left in reviewed text"
        ? ["draft-target"]
        : _name === "unconfirmed contribution"
          ? ["draft-one"]
          : ["draft-one"];
    const review = makeReview(library.projects[0].id, { selectedDraftIds });
    tamper(review);
    const { writer } = makeWriter(review);

    const result = await writer.approveGithubImport(
      {
        importId: review.record.id,
        expectedVersion: review.record.version,
        selectedDraftIds,
        idempotencyKey: `approval-reject-${_name.replaceAll(" ", "-")}`,
      },
      makeContext(root),
    );

    expect(result.ok).toBe(false);
    expect(await readFile(file, "utf8")).toBe(original);
  });

  it("rejects a reviewed draft whose base analysis hash changed", async () => {
    const { root, file, original, library } = await createRoot();
    const review = makeReview(library.projects[0].id, {
      selectedDraftIds: ["draft-one"],
    });
    review.record.draftEdits[0].baseResultHash = "f".repeat(64);
    const { writer } = makeWriter(review);

    const result = await writer.approveGithubImport(
      {
        importId: review.record.id,
        expectedVersion: review.record.version,
        selectedDraftIds: ["draft-one"],
        idempotencyKey: "approval-draft-hash-mismatch",
      },
      makeContext(root),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "version-conflict" },
    });
    expect(await readFile(file, "utf8")).toBe(original);
  });

  it("rejects a measurement answer whose reviewed hash no longer matches", async () => {
    const { root, file, original, library } = await createRoot();
    const review = makeReview(library.projects[0].id, {
      selectedDraftIds: ["draft-two"],
    });
    review.artifacts.measurements[0].answer.answerHash = "f".repeat(64);
    const { writer } = makeWriter(review);

    const result = await writer.approveGithubImport(
      {
        importId: review.record.id,
        expectedVersion: review.record.version,
        selectedDraftIds: ["draft-two"],
        idempotencyKey: "approval-measurement-hash-mismatch",
      },
      makeContext(root),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "version-conflict" },
    });
    expect(await readFile(file, "utf8")).toBe(original);
  });

  it("rejects measurements outside the draft's original result set", async () => {
    const { root, file, original, library } = await createRoot();
    const review = makeReview(library.projects[0].id, {
      selectedDraftIds: ["draft-two"],
    });
    review.record.draftEdits[1].confirmedMetricResultIds = [
      "measurement-not-in-result",
    ];
    const { writer } = makeWriter(review);

    const result = await writer.approveGithubImport(
      {
        importId: review.record.id,
        expectedVersion: review.record.version,
        selectedDraftIds: ["draft-two"],
        idempotencyKey: "approval-measurement-not-in-result",
      },
      makeContext(root),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "invalid-evidence" },
    });
    expect(await readFile(file, "utf8")).toBe(original);
  });

  it("omits a rejected measurement while allowing its qualitative draft", async () => {
    const { root, file, library } = await createRoot();
    const review = makeReview(library.projects[0].id, {
      selectedDraftIds: ["draft-two"],
      unconfirmedMetric: true,
    });
    const { writer } = makeWriter(review);

    const result = await writer.approveGithubImport(
      {
        importId: review.record.id,
        expectedVersion: review.record.version,
        selectedDraftIds: ["draft-two"],
        idempotencyKey: "approval-qualitative-only",
      },
      makeContext(root),
    );

    expect(result.ok, JSON.stringify(result)).toBe(true);
    const saved = await readLibrary(file);
    const point = saved.projects[0].points.find(
      (item) => item.source.type === "github-repository",
    );
    expect(point?.metrics).toEqual([]);
    expect(point?.githubEvidence?.confirmedMetrics).toEqual([]);
  });

  it("recovers a lost response from the durable record without resolving staged data again", async () => {
    const { root, file, library } = await createRoot();
    const review = makeReview(library.projects[0].id);
    const fixture = makeWriter(review);
    const input = {
      importId: review.record.id,
      expectedVersion: review.record.version,
      selectedDraftIds: review.selectedDraftIds,
      idempotencyKey: "approval-recover-lost-response",
    };

    const first = await fixture.writer.approveGithubImport(
      input,
      makeContext(root),
    );
    const bytesAfterFirst = await readFile(file, "utf8");
    const retry = await fixture.writer.approveGithubImport(
      input,
      makeContext(root),
    );

    expect(first).toEqual(retry);
    expect(fixture.resolutionCount).toBe(1);
    expect(await readFile(file, "utf8")).toBe(bytesAfterFirst);
    const saved = await readLibrary(file);
    expect(
      saved.projects[0].points.filter(
        (point) => point.source.type === "github-repository",
      ),
    ).toHaveLength(2);
  });

  it("conflicts when an idempotency key is reused for another payload", async () => {
    const { root, library } = await createRoot();
    const review = makeReview(library.projects[0].id);
    const fixture = makeWriter(review);
    const input = {
      importId: review.record.id,
      expectedVersion: review.record.version,
      selectedDraftIds: review.selectedDraftIds,
      idempotencyKey: "approval-key-conflict",
    };
    await fixture.writer.approveGithubImport(input, makeContext(root));

    const conflict = await fixture.writer.approveGithubImport(
      { ...input, expectedVersion: input.expectedVersion + 1 },
      makeContext(root),
    );
    expect(conflict).toMatchObject({
      ok: false,
      error: { code: "version-conflict" },
    });
  });

  it("detects destination deletion after review and leaves the concurrent bytes intact", async () => {
    const { root, file, library } = await createRoot();
    const projectId = library.projects[0].id;
    const review = makeReview(projectId, { selectedDraftIds: ["draft-one"] });
    const fixture = makeWriter(review, {
      onResolve: async () => {
        const current = await readLibrary(file);
        const removedIds = new Set(
          current.projects
            .find((item) => item.id === projectId)!
            .points.map((point) => point.id),
        );
        const concurrent = ResumeLibraryV2Schema.parse({
          ...current,
          projects: current.projects.filter((item) => item.id !== projectId),
          skills: current.skills.map((skill) => ({
            ...skill,
            evidenceAchievementIds: skill.evidenceAchievementIds.filter(
              (id) => !removedIds.has(id),
            ),
          })),
        });
        await writeFile(
          file,
          `${JSON.stringify(concurrent, null, 2)}\n`,
          "utf8",
        );
      },
    });

    const result = await fixture.writer.approveGithubImport(
      {
        importId: review.record.id,
        expectedVersion: review.record.version,
        selectedDraftIds: ["draft-one"],
        idempotencyKey: "approval-project-deleted",
      },
      makeContext(root),
    );
    const bytesAfterConcurrentEdit = await readFile(file, "utf8");

    expect(result, JSON.stringify(result)).toMatchObject({
      ok: false,
      error: { code: "version-conflict" },
    });
    expect(await readFile(file, "utf8")).toBe(bytesAfterConcurrentEdit);
    expect((await readLibrary(file)).githubImportApprovals).toHaveLength(0);
  });

  it("does not write while another library transaction owns the lock", async () => {
    const { root, file, original, library } = await createRoot();
    await writeFile(`${file}.lock`, "synthetic lock", "utf8");
    const review = makeReview(library.projects[0].id, {
      selectedDraftIds: ["draft-one"],
    });
    const { writer } = makeWriter(review);

    const result = await writer.approveGithubImport(
      {
        importId: review.record.id,
        expectedVersion: review.record.version,
        selectedDraftIds: ["draft-one"],
        idempotencyKey: "approval-lock-contention",
      },
      makeContext(root),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "version-conflict", retryable: true },
    });
    expect(await readFile(file, "utf8")).toBe(original);
  });

  it("preserves the library file when the atomic target rename fails", async () => {
    const { root, file, original, library } = await createRoot();
    const review = makeReview(library.projects[0].id, {
      selectedDraftIds: ["draft-one"],
    });
    const { writer } = makeWriter(review, {
      renameFile: async (source, destination) => {
        if (destination === file)
          throw new Error("synthetic target rename failure");
        await rename(source, destination);
      },
    });

    const result = await writer.approveGithubImport(
      {
        importId: review.record.id,
        expectedVersion: review.record.version,
        selectedDraftIds: ["draft-one"],
        idempotencyKey: "approval-rename-failure",
      },
      makeContext(root),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "io-error", retryable: true },
    });
    expect(await readFile(file, "utf8")).toBe(original);
    expect(await readFile(`${file}.bak`, "utf8")).toBe(original);
  });

  it("performs reviewed enrichment with an optimistic version and preserves provenance", async () => {
    const { root, file, library } = await createRoot();
    const review = makeReview(library.projects[0].id, {
      selectedDraftIds: ["draft-one"],
    });
    const { writer } = makeWriter(review);
    const saved = await writer.approveGithubImport(
      {
        importId: review.record.id,
        expectedVersion: review.record.version,
        selectedDraftIds: ["draft-one"],
        idempotencyKey: "approval-reviewed-update",
      },
      makeContext(root),
    );
    expect(saved.ok, JSON.stringify(saved)).toBe(true);
    if (!saved.ok) return;
    const before = await readLibrary(file);
    const oldPoint = before.projects[0].points.find(
      (point) => point.id === saved.value.savedIds[0],
    )!;
    const newText = `${oldPoint.text} The change is scoped to the publishing flow.`;

    const update = await writer.updateImportedAchievement(
      {
        achievementId: oldPoint.id,
        expectedVersion: 2,
        text: newText,
      },
      makeContext(root),
    );

    expect(update).toEqual({
      ok: true,
      value: { achievementId: oldPoint.id, version: 3 },
    });
    const after = await readLibrary(file);
    const updated = after.projects[0].points.find(
      (point) => point.id === oldPoint.id,
    )!;
    expect(updated.text).toBe(newText);
    expect(updated.githubEvidence).toEqual(oldPoint.githubEvidence);
    expect(after.githubImportApprovals[0].approvedAchievements[0].text).toBe(
      newText,
    );
    expect(after.githubImportApprovals[0].draftVersion).toBe(3);

    const stale = await writer.updateImportedAchievement(
      { achievementId: oldPoint.id, expectedVersion: 2, text: newText },
      makeContext(root),
    );
    expect(stale).toMatchObject({
      ok: false,
      error: { code: "version-conflict" },
    });
  });
});
