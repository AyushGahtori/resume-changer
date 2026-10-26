import { describe, expect, it } from "vitest";
import {
  countPhysicalLines,
  createBudgetLedger,
  GITHUB_BUDGET_LIMITS,
  type BudgetEvidenceInput,
  type BudgetMeasuredUsage,
} from "../../../../src/lib/github/server/budget";

const consent = {
  selectionHash: "sha256:selection-0001",
  selectionVersion: 1,
  confirmedAt: "2026-10-26T12:00:00.000Z",
};

function measured(
  overrides: Partial<BudgetMeasuredUsage> = {},
): BudgetMeasuredUsage {
  return {
    upstreamBytes: 0,
    fetchedBodies: [],
    inventoryEntries: 0,
    inventoryDepth: 0,
    inventoryWireBytes: 0,
    historyCommitSummaries: 0,
    historyCommitDetails: 0,
    inputTokens: 0,
    preflightInputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    ...overrides,
  };
}

function lines(
  fileId: string,
  startLine: number,
  lineCount: number,
): BudgetEvidenceInput {
  return {
    fileId,
    ranges:
      lineCount === 0
        ? []
        : [{ startLine, endLine: startLine + lineCount - 1 }],
  };
}

function balancedSelection(total: number, files = 8): BudgetEvidenceInput[] {
  const result: BudgetEvidenceInput[] = [];
  let remaining = total;
  let nextLine = 1;
  for (let index = 0; index < files && remaining > 0; index += 1) {
    const count = Math.min(200, Math.ceil(remaining / (files - index)));
    result.push(lines(`repo@sha:file-${index}.ts`, nextLine, count));
    nextLine += count + 10;
    remaining -= count;
  }
  if (remaining > 0)
    throw new Error("Test selection exceeds the per-file line ceiling");
  return result;
}

function reserveHttp(
  ledger: ReturnType<typeof createBudgetLedger>,
  attemptId: string,
  kind: "github-http" | "pr-http" = "github-http",
  upstreamBytes = 0,
  extra: Record<string, unknown> = {},
) {
  return ledger.reserve({ attemptId, kind, upstreamBytes, ...extra });
}

function commitHttp(
  ledger: ReturnType<typeof createBudgetLedger>,
  attemptId: string,
  overrides: Partial<BudgetMeasuredUsage> = {},
) {
  return ledger.commitUsage(attemptId, measured(overrides));
}

describe("GitHub shared budget ledger", () => {
  it("counts physical lines after CRLF normalization without inventing a trailing line", () => {
    expect(countPhysicalLines("")).toBe(0);
    expect(countPhysicalLines("one")).toBe(1);
    expect(countPhysicalLines("one\n")).toBe(1);
    expect(countPhysicalLines("one\r\ntwo\r\n")).toBe(2);
    expect(countPhysicalLines("\r")).toBe(1);
    expect(countPhysicalLines("\n\n")).toBe(2);
  });

  it("merges overlapping ranges within one request and charges replayed context again", () => {
    const ledger = createBudgetLedger();
    const initial = ledger.checkSelection({
      files: [
        lines("repo@sha:src/core.ts", 1, 100),
        lines("repo@sha:src/core.ts", 51, 100),
      ],
    });
    expect(initial.ok && initial.value.sourceLinesThisRequest).toBe(150);
    expect(initial.ok && initial.value.uniqueSourceLinesAfter).toBe(150);

    const recovery = ledger.reserve({
      attemptId: "normal-1",
      kind: "generation",
      consent,
      files: [lines("repo@sha:src/core.ts", 1, 150)],
      estimatedInputTokens: 8_000,
      estimatedOutputTokens: 2_000,
      estimatedReasoningTokens: 1_000,
    });
    expect(recovery.ok).toBe(true);
    expect(
      ledger.commitUsage(
        "normal-1",
        measured({
          inputTokens: 7_000,
          outputTokens: 1_500,
          reasoningTokens: 500,
        }),
      ).ok,
    ).toBe(true);

    const second = ledger.reserve({
      attemptId: "recovery-1",
      kind: "recovery",
      consent: { ...consent, selectionVersion: 2 },
      files: [lines("repo@sha:src/core.ts", 1, 150)],
      estimatedInputTokens: 4_000,
      estimatedOutputTokens: 1_000,
      estimatedReasoningTokens: 500,
    });
    expect(second.ok).toBe(true);
    const summary = ledger.remaining();
    expect(summary.selection.uniqueSourceLinesUsed).toBe(150);
    expect(summary.selection.transmittedLineOccurrencesUsed).toBe(300);
  });

  it("rejects a file split into ten individually small excerpts when their total exceeds 200 lines", () => {
    const excerpts = Array.from({ length: 10 }, (_, index) =>
      lines("repo@sha:src/large.ts", index * 30 + 1, 30),
    );
    const result = createBudgetLedger().checkSelection({ files: excerpts });
    expect(result).toMatchObject({
      ok: false,
      error: { reason: "source-lines-per-file-request-limit" },
    });
  });

  it("counts source rows behind compact JSON projections and historical patches", () => {
    const projection = createBudgetLedger().checkSelection({
      files: [
        {
          fileId: "repo@sha:reports/summary.json",
          ranges: [{ startLine: 1, endLine: 201 }],
          text: '{"rows":["compact projection"]}',
        },
      ],
    });
    expect(projection).toMatchObject({
      ok: false,
      error: { reason: "source-lines-per-file-request-limit" },
    });

    const patch = createBudgetLedger().checkSelection({
      files: [
        lines("repo@sha:src/service.ts", 1, 140),
        lines("repo@pr-42:patch/src/service.ts", 1, 70),
      ],
    });
    expect(patch.ok && patch.value.filesThisRequest).toBe(2);
    expect(patch.ok && patch.value.sourceLinesThisRequest).toBe(210);
  });

  it("enforces exact request and import line, file, and character boundaries", () => {
    const exactRequest = createBudgetLedger().checkSelection({
      files: balancedSelection(1_500),
    });
    expect(exactRequest.ok && exactRequest.value.sourceLinesThisRequest).toBe(
      1_500,
    );
    expect(
      createBudgetLedger().checkSelection({ files: balancedSelection(1_501) }),
    ).toMatchObject({
      ok: false,
      error: { reason: "source-lines-request-limit" },
    });
    expect(
      createBudgetLedger().checkSelection({
        files: [lines("repo@sha:one.ts", 1, 200)],
      }).ok,
    ).toBe(true);
    expect(
      createBudgetLedger().checkSelection({
        files: [lines("repo@sha:one.ts", 1, 201)],
      }),
    ).toMatchObject({
      ok: false,
      error: { reason: "source-lines-per-file-request-limit" },
    });
    expect(
      createBudgetLedger().checkSelection({
        files: Array.from({ length: 12 }, (_, i) =>
          lines(`repo@sha:${i}`, 1, 1),
        ),
      }).ok,
    ).toBe(true);
    expect(
      createBudgetLedger().checkSelection({
        files: Array.from({ length: 13 }, (_, i) =>
          lines(`repo@sha:${i}`, 1, 1),
        ),
      }),
    ).toMatchObject({
      ok: false,
      error: { reason: "selected-file-request-limit" },
    });

    const atCharacterLimit = createBudgetLedger().checkSelection({
      files: [
        {
          fileId: "repo@sha:long.ts",
          characters: 12_000,
          ranges: [{ startLine: 1, endLine: 1 }],
        },
      ],
    });
    expect(atCharacterLimit.ok).toBe(true);
    expect(
      createBudgetLedger().checkSelection({
        files: [
          {
            fileId: "repo@sha:long.ts",
            characters: 12_001,
            ranges: [{ startLine: 1, endLine: 1 }],
          },
        ],
      }),
    ).toMatchObject({
      ok: false,
      error: { reason: "selected-characters-per-file-limit" },
    });
    expect(
      createBudgetLedger().checkSelection({
        files: [
          ...Array.from({ length: 10 }, (_, index) => ({
            fileId: `repo@sha:char-${index}.ts`,
            characters: index === 9 ? 8_001 : 8_000,
            ranges: [{ startLine: 1, endLine: 1 }],
          })),
        ],
      }),
    ).toMatchObject({
      ok: false,
      error: { reason: "selected-characters-total-limit" },
    });
  });

  it("charges repeated selected characters against the cumulative per-file ceiling", () => {
    const ledger = createBudgetLedger();
    expect(
      ledger.reserve({
        attemptId: "normal",
        kind: "generation",
        consent,
        files: [
          {
            fileId: "repo@sha:large.ts",
            ranges: [{ startLine: 1, endLine: 1 }],
            characters: 6_000,
          },
        ],
        estimatedInputTokens: 1_000,
        estimatedOutputTokens: 1,
        estimatedReasoningTokens: 0,
      }).ok,
    ).toBe(true);
    expect(
      ledger.commitUsage(
        "normal",
        measured({ inputTokens: 900, outputTokens: 1 }),
      ).ok,
    ).toBe(true);
    expect(
      ledger.reserve({
        attemptId: "recovery",
        kind: "recovery",
        consent: { ...consent, selectionVersion: 2 },
        files: [
          {
            fileId: "repo@sha:large.ts",
            ranges: [{ startLine: 2, endLine: 2 }],
            characters: 6_001,
          },
        ],
        estimatedInputTokens: 1_000,
        estimatedOutputTokens: 1,
        estimatedReasoningTokens: 0,
      }),
    ).toMatchObject({
      ok: false,
      error: { reason: "selected-characters-per-file-limit" },
    });
  });

  it("keeps unique import lines and distinct file counts across both calls", () => {
    const ledger = createBudgetLedger();
    const normalFiles = balancedSelection(1_500, 10);
    const normal = ledger.reserve({
      attemptId: "normal",
      kind: "generation",
      consent,
      files: normalFiles,
      estimatedInputTokens: 9_000,
      estimatedOutputTokens: 2_000,
      estimatedReasoningTokens: 1_000,
    });
    expect(normal.ok).toBe(true);
    expect(
      ledger.commitUsage(
        "normal",
        measured({
          inputTokens: 8_000,
          outputTokens: 1_500,
          reasoningTokens: 500,
        }),
      ).ok,
    ).toBe(true);
    const recovery = ledger.reserve({
      attemptId: "recovery",
      kind: "recovery",
      consent: { ...consent, selectionVersion: 2 },
      files: normalFiles,
      estimatedInputTokens: 8_000,
      estimatedOutputTokens: 2_000,
      estimatedReasoningTokens: 1_000,
    });
    expect(recovery.ok).toBe(true);
    expect(ledger.remaining().selection).toMatchObject({
      uniqueSourceLinesUsed: 1_500,
      transmittedLineOccurrencesUsed: 3_000,
    });

    const tooManyFiles = createBudgetLedger();
    const first = tooManyFiles.reserve({
      attemptId: "normal",
      kind: "generation",
      consent,
      files: Array.from({ length: 12 }, (_, index) =>
        lines(`repo@sha:file-${index}`, 1, 1),
      ),
      estimatedInputTokens: 1_000,
      estimatedOutputTokens: 1,
      estimatedReasoningTokens: 0,
    });
    expect(first.ok).toBe(true);
    expect(
      tooManyFiles.commitUsage(
        "normal",
        measured({ inputTokens: 900, outputTokens: 1 }),
      ).ok,
    ).toBe(true);
    expect(
      tooManyFiles.reserve({
        attemptId: "recovery",
        kind: "recovery",
        consent: { ...consent, selectionVersion: 2 },
        files: [
          ...Array.from({ length: 4 }, (_, index) =>
            lines(`repo@sha:file-${index}`, 1, 1),
          ),
          ...Array.from({ length: 5 }, (_, index) =>
            lines(`repo@sha:new-${index}`, 1, 1),
          ),
        ],
        estimatedInputTokens: 1_000,
        estimatedOutputTokens: 1,
        estimatedReasoningTokens: 0,
      }),
    ).toMatchObject({
      ok: false,
      error: { reason: "selected-file-import-limit" },
    });

    const exactFileCount = createBudgetLedger();
    expect(
      exactFileCount.reserve({
        attemptId: "normal",
        kind: "generation",
        consent,
        files: Array.from({ length: 12 }, (_, index) =>
          lines(`repo@sha:file-${index}`, 1, 1),
        ),
        estimatedInputTokens: 1_000,
        estimatedOutputTokens: 1,
        estimatedReasoningTokens: 0,
      }).ok,
    ).toBe(true);
    expect(
      exactFileCount.commitUsage(
        "normal",
        measured({ inputTokens: 900, outputTokens: 1 }),
      ).ok,
    ).toBe(true);
    expect(
      exactFileCount.reserve({
        attemptId: "recovery",
        kind: "recovery",
        consent: { ...consent, selectionVersion: 2 },
        files: [
          ...Array.from({ length: 4 }, (_, index) =>
            lines(`repo@sha:new-${index}`, 1, 1),
          ),
        ],
        estimatedInputTokens: 1_000,
        estimatedOutputTokens: 1,
        estimatedReasoningTokens: 0,
      }).ok,
    ).toBe(true);
    expect(exactFileCount.remaining().selection.filesUsed).toBe(16);
  });

  it("enforces the 2,000 unique-line and 300-per-file import ceilings across recovery", () => {
    const exact = createBudgetLedger();
    const initialFiles = Array.from({ length: 10 }, (_, index) =>
      lines(`repo@sha:file-${index}`, 1, 150),
    );
    expect(
      exact.reserve({
        attemptId: "normal",
        kind: "generation",
        consent,
        files: initialFiles,
        estimatedInputTokens: 8_000,
        estimatedOutputTokens: 1_000,
        estimatedReasoningTokens: 500,
      }).ok,
    ).toBe(true);
    expect(
      exact.commitUsage(
        "normal",
        measured({
          inputTokens: 7_000,
          outputTokens: 800,
          reasoningTokens: 200,
        }),
      ).ok,
    ).toBe(true);
    const exactRecovery = Array.from({ length: 10 }, (_, index) =>
      lines(`repo@sha:file-${index}`, 151, 50),
    );
    expect(
      exact.reserve({
        attemptId: "recovery",
        kind: "recovery",
        consent: { ...consent, selectionVersion: 2 },
        files: exactRecovery,
        estimatedInputTokens: 8_000,
        estimatedOutputTokens: 1_000,
        estimatedReasoningTokens: 500,
      }).ok,
    ).toBe(true);
    expect(exact.remaining().selection.uniqueSourceLinesUsed).toBe(2_000);

    const oneOver = createBudgetLedger();
    expect(
      oneOver.reserve({
        attemptId: "normal",
        kind: "generation",
        consent,
        files: initialFiles,
        estimatedInputTokens: 8_000,
        estimatedOutputTokens: 1_000,
        estimatedReasoningTokens: 500,
      }).ok,
    ).toBe(true);
    expect(
      oneOver.commitUsage(
        "normal",
        measured({
          inputTokens: 7_000,
          outputTokens: 800,
          reasoningTokens: 200,
        }),
      ).ok,
    ).toBe(true);
    const overRecovery = [
      ...Array.from({ length: 9 }, (_, index) =>
        lines(`repo@sha:file-${index}`, 151, 50),
      ),
      lines("repo@sha:file-9", 151, 51),
    ];
    expect(
      oneOver.reserve({
        attemptId: "recovery",
        kind: "recovery",
        consent: { ...consent, selectionVersion: 2 },
        files: overRecovery,
        estimatedInputTokens: 8_000,
        estimatedOutputTokens: 1_000,
        estimatedReasoningTokens: 500,
      }),
    ).toMatchObject({
      ok: false,
      error: { reason: "source-lines-import-limit" },
    });

    const perFile = createBudgetLedger();
    expect(
      perFile.reserve({
        attemptId: "normal",
        kind: "generation",
        consent,
        files: [lines("repo@sha:single.ts", 1, 150)],
        estimatedInputTokens: 1_000,
        estimatedOutputTokens: 1,
        estimatedReasoningTokens: 0,
      }).ok,
    ).toBe(true);
    expect(
      perFile.commitUsage(
        "normal",
        measured({ inputTokens: 900, outputTokens: 1 }),
      ).ok,
    ).toBe(true);
    expect(
      perFile.reserve({
        attemptId: "recovery",
        kind: "recovery",
        consent: { ...consent, selectionVersion: 2 },
        files: [lines("repo@sha:single.ts", 151, 151)],
        estimatedInputTokens: 1_000,
        estimatedOutputTokens: 1,
        estimatedReasoningTokens: 0,
      }),
    ).toMatchObject({
      ok: false,
      error: { reason: "source-lines-per-file-import-limit" },
    });
  });

  it("reserves before submission, commits once, rejects conflicting double commits, and does not double-count cached input", () => {
    const ledger = createBudgetLedger();
    expect(
      ledger.reserve({
        attemptId: "generation-1",
        kind: "generation",
        consent,
        files: [lines("repo@sha:src/a.ts", 1, 10)],
        estimatedInputTokens: 10_000,
        estimatedOutputTokens: 3_000,
        estimatedReasoningTokens: 1_000,
      }).ok,
    ).toBe(true);
    expect(ledger.remaining().inputTokens).toMatchObject({
      estimated: 10_000,
      actual: 0,
      remaining: 26_000,
    });
    const actual = measured({
      inputTokens: 9_000,
      cachedInputTokens: 3_000,
      outputTokens: 2_000,
      reasoningTokens: 500,
    });
    expect(ledger.commitUsage("generation-1", actual)).toMatchObject({
      ok: true,
      value: { idempotent: false },
    });
    expect(ledger.commitUsage("generation-1", actual)).toMatchObject({
      ok: true,
      value: { idempotent: true },
    });
    expect(
      ledger.commitUsage(
        "generation-1",
        measured({
          inputTokens: 8_999,
          cachedInputTokens: 0,
          outputTokens: 2_000,
          reasoningTokens: 500,
        }),
      ),
    ).toMatchObject({
      ok: false,
      error: { reason: "reservation-conflict" },
    });
    expect(ledger.remaining().inputTokens).toMatchObject({
      actual: 9_000,
      estimated: 0,
      unknown: 0,
      remaining: 27_000,
    });
  });

  it("records a post-call reservation overrun once and returns the same outcome on replay", () => {
    const ledger = createBudgetLedger();
    expect(
      ledger.reserve({
        attemptId: "underestimated-generation",
        kind: "generation",
        consent,
        files: [lines("repo@sha:src/a.ts", 1, 1)],
        estimatedInputTokens: 100,
        estimatedOutputTokens: 20,
        estimatedReasoningTokens: 10,
      }).ok,
    ).toBe(true);
    const actual = measured({
      inputTokens: 150,
      outputTokens: 20,
      reasoningTokens: 10,
    });
    expect(
      ledger.commitUsage("underestimated-generation", actual),
    ).toMatchObject({
      ok: false,
      error: { reason: "reservation-overrun" },
    });
    expect(
      ledger.commitUsage("underestimated-generation", actual),
    ).toMatchObject({
      ok: false,
      error: { reason: "reservation-overrun" },
    });
    expect(ledger.remaining().inputTokens).toMatchObject({
      actual: 150,
      estimated: 0,
      unknown: 0,
    });
  });

  it("retains conservative reservations when completion or token usage is unknown", () => {
    const ledger = createBudgetLedger();
    expect(
      ledger.reserve({
        attemptId: "uncertain-generation",
        kind: "generation",
        consent,
        files: [lines("repo@sha:src/a.ts", 1, 20)],
        estimatedInputTokens: 11_000,
        estimatedOutputTokens: 4_000,
        estimatedReasoningTokens: 2_000,
      }).ok,
    ).toBe(true);
    expect(
      ledger.commitUsage("uncertain-generation", { known: false }),
    ).toMatchObject({
      ok: true,
      value: { usageKnown: false },
    });
    expect(ledger.remaining().inputTokens).toMatchObject({
      actual: 0,
      estimated: 0,
      unknown: 11_000,
      remaining: 25_000,
    });
    expect(
      ledger.commitUsage("uncertain-generation", { known: false }),
    ).toMatchObject({
      ok: true,
      value: { idempotent: true, usageKnown: false },
    });
    expect(
      ledger.reserve({
        attemptId: "uncertain-generation",
        kind: "generation",
        consent,
        files: [lines("repo@sha:src/a.ts", 1, 20)],
        estimatedInputTokens: 11_000,
        estimatedOutputTokens: 4_000,
        estimatedReasoningTokens: 2_000,
      }),
    ).toMatchObject({ ok: true, value: { created: false, status: "unknown" } });
    expect(
      ledger.commitUsage(
        "uncertain-generation",
        measured({
          inputTokens: 9_000,
          cachedInputTokens: 2_000,
          outputTokens: 2_000,
          reasoningTokens: 1_000,
        }),
      ).ok,
    ).toBe(true);
    expect(ledger.remaining().inputTokens).toMatchObject({
      actual: 9_000,
      estimated: 0,
      unknown: 0,
      remaining: 27_000,
    });
    expect(ledger.release("uncertain-generation", true)).toMatchObject({
      ok: false,
      error: { reason: "release-must-be-unsent" },
    });
  });

  it("releases only confirmed-unsent reservations and lets a caller safely retry them", () => {
    const ledger = createBudgetLedger();
    expect(reserveHttp(ledger, "unsent", "github-http", 4_000).ok).toBe(true);
    expect(ledger.release("unsent", true)).toMatchObject({
      ok: true,
      value: { released: true },
    });
    expect(ledger.release("unsent", true)).toMatchObject({
      ok: true,
      value: { released: false },
    });
    expect(reserveHttp(ledger, "retry", "github-http", 4_000).ok).toBe(true);
  });

  it("shares HTTP attempts with the PR sub-budget and rejects the 33rd request", () => {
    const ledger = createBudgetLedger();
    for (let index = 0; index < 8; index += 1) {
      const id = `pr-${index}`;
      expect(reserveHttp(ledger, id, "pr-http", 0).ok).toBe(true);
      expect(commitHttp(ledger, id).ok).toBe(true);
    }
    expect(reserveHttp(ledger, "pr-over", "pr-http", 0)).toMatchObject({
      ok: false,
      error: { reason: "pr-http-attempt-limit" },
    });
    for (let index = 0; index < 24; index += 1) {
      const id = `http-${index}`;
      expect(reserveHttp(ledger, id, "github-http", 0).ok).toBe(true);
      expect(commitHttp(ledger, id).ok).toBe(true);
    }
    expect(ledger.remaining().httpAttempts).toMatchObject({
      used: 32,
      remaining: 0,
    });
    expect(reserveHttp(ledger, "http-over", "github-http", 0)).toMatchObject({
      ok: false,
      error: { reason: "http-attempt-limit" },
    });
  });

  it("enforces one active GitHub request and serializes competing reservations", () => {
    const ledger = createBudgetLedger();
    expect(reserveHttp(ledger, "first", "github-http", 10).ok).toBe(true);
    expect(
      reserveHttp(ledger, "racing-second", "github-http", 10),
    ).toMatchObject({
      ok: false,
      error: { reason: "http-request-in-flight" },
    });
    expect(ledger.release("first", true).ok).toBe(true);
    expect(reserveHttp(ledger, "second", "github-http", 10).ok).toBe(true);
  });

  it("serializes provider count and generation reservations", () => {
    const ledger = createBudgetLedger();
    expect(
      ledger.reserve({
        attemptId: "count",
        kind: "token-count",
        consent,
        files: [lines("repo@sha:src/a.ts", 1, 10)],
      }).ok,
    ).toBe(true);
    expect(
      ledger.reserve({
        attemptId: "generation-race",
        kind: "generation",
        consent,
        files: [lines("repo@sha:src/a.ts", 1, 10)],
        estimatedInputTokens: 1_000,
        estimatedOutputTokens: 1,
        estimatedReasoningTokens: 0,
      }),
    ).toMatchObject({
      ok: false,
      error: { reason: "provider-request-in-flight" },
    });
    expect(
      ledger.commitUsage("count", measured({ preflightInputTokens: 1 })).ok,
    ).toBe(true);
    expect(
      ledger.reserve({
        attemptId: "generation-after-count",
        kind: "generation",
        consent,
        files: [lines("repo@sha:src/a.ts", 1, 10)],
        estimatedInputTokens: 1_000,
        estimatedOutputTokens: 1,
        estimatedReasoningTokens: 0,
      }).ok,
    ).toBe(true);
  });

  it("returns reservation status for duplicate attempt IDs so callers cannot resend", () => {
    const ledger = createBudgetLedger();
    const request = {
      attemptId: "one-request",
      kind: "github-http" as const,
      upstreamBytes: 20,
    };
    expect(ledger.reserve(request)).toMatchObject({
      ok: true,
      value: { created: true, status: "reserved" },
    });
    expect(ledger.reserve(request)).toMatchObject({
      ok: true,
      value: { created: false, status: "reserved" },
    });
    expect(ledger.reserve({ ...request, upstreamBytes: 21 })).toMatchObject({
      ok: false,
      error: { reason: "reservation-conflict" },
    });
  });

  it("enforces body count, per-body and aggregate decoded bytes", () => {
    const bodyLedger = createBudgetLedger();
    expect(
      reserveHttp(bodyLedger, "too-large", "github-http", 65_537, {
        fetchedBodies: [{ fileId: "repo@sha:large.txt", decodedBytes: 65_537 }],
      }),
    ).toMatchObject({ ok: false, error: { reason: "decoded-body-limit" } });
    expect(
      reserveHttp(bodyLedger, "max-body", "github-http", 65_536, {
        fetchedBodies: [{ fileId: "repo@sha:max.txt", decodedBytes: 65_536 }],
      }).ok,
    ).toBe(true);
    expect(
      commitHttp(bodyLedger, "max-body", {
        upstreamBytes: 65_536,
        fetchedBodies: [{ fileId: "repo@sha:max.txt", decodedBytes: 65_536 }],
      }).ok,
    ).toBe(true);

    const totalLedger = createBudgetLedger();
    for (let index = 0; index < 8; index += 1) {
      const id = `body-${index}`;
      const fileId = `repo@sha:file-${index}`;
      expect(
        reserveHttp(totalLedger, id, "github-http", 0, {
          fetchedBodies: [{ fileId, decodedBytes: 65_536 }],
        }).ok,
      ).toBe(true);
      expect(
        commitHttp(totalLedger, id, {
          fetchedBodies: [{ fileId, decodedBytes: 65_536 }],
        }).ok,
      ).toBe(true);
    }
    expect(totalLedger.remaining().decodedBytes).toMatchObject({
      used: 524_288,
      remaining: 0,
    });
    expect(
      reserveHttp(totalLedger, "ninth-body", "github-http", 0, {
        fetchedBodies: [{ fileId: "repo@sha:file-9", decodedBytes: 1 }],
      }),
    ).toMatchObject({ ok: false, error: { reason: "decoded-total-limit" } });

    const countLedger = createBudgetLedger();
    for (let index = 0; index < 20; index += 1) {
      const id = `empty-body-${index}`;
      const fileId = `repo@sha:empty-${index}`;
      expect(
        reserveHttp(countLedger, id, "github-http", 0, {
          fetchedBodies: [{ fileId, decodedBytes: 0 }],
        }).ok,
      ).toBe(true);
      expect(
        commitHttp(countLedger, id, {
          fetchedBodies: [{ fileId, decodedBytes: 0 }],
        }).ok,
      ).toBe(true);
    }
    expect(countLedger.remaining().fetchedBodies).toMatchObject({
      used: 20,
      remaining: 0,
    });
    expect(
      reserveHttp(countLedger, "body-21", "github-http", 0, {
        fetchedBodies: [{ fileId: "repo@sha:twenty-first", decodedBytes: 0 }],
      }),
    ).toMatchObject({ ok: false, error: { reason: "fetched-body-limit" } });
  });

  it("enforces upstream and inventory byte, entry, and depth ceilings", () => {
    const upstream = createBudgetLedger();
    expect(
      reserveHttp(
        upstream,
        "all-wire",
        "github-http",
        GITHUB_BUDGET_LIMITS.upstreamBytes,
      ).ok,
    ).toBe(true);
    expect(
      commitHttp(upstream, "all-wire", {
        upstreamBytes: GITHUB_BUDGET_LIMITS.upstreamBytes,
      }).ok,
    ).toBe(true);
    expect(reserveHttp(upstream, "wire-over", "github-http", 1)).toMatchObject({
      ok: false,
      error: { reason: "upstream-byte-limit" },
    });

    const inventory = createBudgetLedger();
    expect(
      reserveHttp(inventory, "tree", "github-http", 8 * 1024 * 1024, {
        inventoryEntries: 10_000,
        inventoryDepth: 8,
        inventoryWireBytes: 8 * 1024 * 1024,
      }).ok,
    ).toBe(true);
    expect(
      commitHttp(inventory, "tree", {
        upstreamBytes: 8 * 1024 * 1024,
        inventoryEntries: 10_000,
        inventoryDepth: 8,
        inventoryWireBytes: 8 * 1024 * 1024,
      }).ok,
    ).toBe(true);
    expect(
      reserveHttp(inventory, "tree-over", "github-http", 1, {
        inventoryEntries: 0,
        inventoryDepth: 9,
        inventoryWireBytes: 0,
      }),
    ).toMatchObject({ ok: false, error: { reason: "inventory-depth-limit" } });
    const inventoryBytes = createBudgetLedger();
    expect(
      reserveHttp(inventoryBytes, "tree-max", "github-http", 8 * 1024 * 1024, {
        inventoryWireBytes: 8 * 1024 * 1024,
      }).ok,
    ).toBe(true);
    expect(
      commitHttp(inventoryBytes, "tree-max", {
        upstreamBytes: 8 * 1024 * 1024,
        inventoryWireBytes: 8 * 1024 * 1024,
      }).ok,
    ).toBe(true);
    expect(
      reserveHttp(inventoryBytes, "tree-wire-over", "github-http", 1, {
        inventoryWireBytes: 1,
      }),
    ).toMatchObject({ ok: false, error: { reason: "inventory-byte-limit" } });
    expect(
      reserveHttp(createBudgetLedger(), "entries-over", "github-http", 10_001, {
        inventoryEntries: 10_001,
        inventoryDepth: 8,
        inventoryWireBytes: 10_001,
      }),
    ).toMatchObject({ ok: false, error: { reason: "inventory-entry-limit" } });
  });

  it("requires consent for remote token counting and charges the same evidence to its budget", () => {
    const ledger = createBudgetLedger();
    expect(
      ledger.reserve({
        attemptId: "count-without-consent",
        kind: "token-count",
        files: [lines("repo@sha:src/a.ts", 1, 10)],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "forbidden", reason: "external-consent-required" },
    });
    expect(
      ledger.reserve({
        attemptId: "count",
        kind: "token-count",
        consent,
        files: [lines("repo@sha:src/a.ts", 1, 10)],
      }).ok,
    ).toBe(true);
    expect(
      ledger.commitUsage("count", measured({ preflightInputTokens: 1_024 })).ok,
    ).toBe(true);
    expect(ledger.remaining().selection).toMatchObject({
      uniqueSourceLinesUsed: 10,
      transmittedLineOccurrencesUsed: 10,
    });
    expect(ledger.remaining().inputTokens.actual).toBe(0);
    expect(ledger.remaining().providerTokenCount).toMatchObject({
      attempts: 1,
      knownAttempts: 1,
      measuredInputTokens: 1_024,
    });

    const oversized = createBudgetLedger();
    expect(
      oversized.reserve({
        attemptId: "count-too-large",
        kind: "token-count",
        consent,
        files: [lines("repo@sha:src/a.ts", 1, 10)],
      }).ok,
    ).toBe(true);
    expect(
      oversized.commitUsage(
        "count-too-large",
        measured({ preflightInputTokens: 24_001 }),
      ),
    ).toMatchObject({
      ok: false,
      error: { reason: "input-tokens-request-limit" },
    });
  });

  it("allows one normal call and one bounded recovery, with shared token and output allowances", () => {
    const ledger = createBudgetLedger();
    expect(
      ledger.reserve({
        attemptId: "normal",
        kind: "generation",
        consent,
        files: [lines("repo@sha:src/a.ts", 1, 1)],
        estimatedInputTokens: 24_000,
        estimatedOutputTokens: 5_000,
        estimatedReasoningTokens: 1_144,
      }).ok,
    ).toBe(true);
    expect(
      ledger.commitUsage(
        "normal",
        measured({
          inputTokens: 20_000,
          cachedInputTokens: 2_000,
          outputTokens: 4_000,
          reasoningTokens: 1_000,
        }),
      ).ok,
    ).toBe(true);
    expect(
      ledger.reserve({
        attemptId: "recovery",
        kind: "recovery",
        consent: { ...consent, selectionVersion: 2 },
        files: [lines("repo@sha:src/a.ts", 2, 1)],
        estimatedInputTokens: 16_000,
        estimatedOutputTokens: 5_000,
        estimatedReasoningTokens: 1_144,
      }).ok,
    ).toBe(true);
    expect(ledger.remaining().inputTokens.remaining).toBe(0);
    expect(ledger.remaining().generatedTokens.remaining).toBe(1_144);
    expect(
      ledger.commitUsage(
        "recovery",
        measured({
          inputTokens: 16_000,
          cachedInputTokens: 1_000,
          outputTokens: 5_000,
          reasoningTokens: 1_144,
        }),
      ).ok,
    ).toBe(true);
    expect(
      ledger.reserve({
        attemptId: "third-call",
        kind: "recovery",
        consent: { ...consent, selectionVersion: 3 },
        files: [lines("repo@sha:src/a.ts", 3, 1)],
        estimatedInputTokens: 1,
        estimatedOutputTokens: 1,
        estimatedReasoningTokens: 0,
      }),
    ).toMatchObject({
      ok: false,
      error: { reason: "generation-attempt-limit" },
    });
    expect(
      createBudgetLedger().reserve({
        attemptId: "too-much-input",
        kind: "generation",
        consent,
        files: [lines("repo@sha:src/a.ts", 1, 1)],
        estimatedInputTokens: 24_001,
        estimatedOutputTokens: 1,
        estimatedReasoningTokens: 0,
      }),
    ).toMatchObject({
      ok: false,
      error: { reason: "input-tokens-request-limit" },
    });
    expect(
      createBudgetLedger().reserve({
        attemptId: "too-much-output",
        kind: "generation",
        consent,
        files: [lines("repo@sha:src/a.ts", 1, 1)],
        estimatedInputTokens: 1,
        estimatedOutputTokens: 6_145,
        estimatedReasoningTokens: 0,
      }),
    ).toMatchObject({
      ok: false,
      error: { reason: "generated-tokens-request-limit" },
    });

    const inputTotal = createBudgetLedger();
    expect(
      inputTotal.reserve({
        attemptId: "normal",
        kind: "generation",
        consent,
        files: [lines("repo@sha:src/a.ts", 1, 1)],
        estimatedInputTokens: 24_000,
        estimatedOutputTokens: 1,
        estimatedReasoningTokens: 0,
      }).ok,
    ).toBe(true);
    expect(
      inputTotal.commitUsage(
        "normal",
        measured({ inputTokens: 24_000, outputTokens: 1 }),
      ).ok,
    ).toBe(true);
    expect(
      inputTotal.reserve({
        attemptId: "recovery",
        kind: "recovery",
        consent: { ...consent, selectionVersion: 2 },
        files: [lines("repo@sha:src/a.ts", 2, 1)],
        estimatedInputTokens: 12_000,
        estimatedOutputTokens: 1,
        estimatedReasoningTokens: 0,
      }).ok,
    ).toBe(true);
    const inputOver = createBudgetLedger();
    expect(
      inputOver.reserve({
        attemptId: "normal",
        kind: "generation",
        consent,
        files: [lines("repo@sha:src/a.ts", 1, 1)],
        estimatedInputTokens: 24_000,
        estimatedOutputTokens: 1,
        estimatedReasoningTokens: 0,
      }).ok,
    ).toBe(true);
    expect(
      inputOver.commitUsage(
        "normal",
        measured({ inputTokens: 24_000, outputTokens: 1 }),
      ).ok,
    ).toBe(true);
    expect(
      inputOver.reserve({
        attemptId: "recovery",
        kind: "recovery",
        consent: { ...consent, selectionVersion: 2 },
        files: [lines("repo@sha:src/a.ts", 2, 1)],
        estimatedInputTokens: 12_001,
        estimatedOutputTokens: 1,
        estimatedReasoningTokens: 0,
      }),
    ).toMatchObject({
      ok: false,
      error: { reason: "input-tokens-import-limit" },
    });
  });

  it("applies the shared HTTP request cap to history and rejects its per-category overflow", () => {
    const ledger = createBudgetLedger();
    expect(
      reserveHttp(ledger, "history", "pr-http", 1, {
        historyCommitSummaries: 20,
        historyCommitDetails: 3,
      }).ok,
    ).toBe(true);
    expect(
      commitHttp(ledger, "history", {
        upstreamBytes: 1,
        historyCommitSummaries: 20,
        historyCommitDetails: 3,
      }).ok,
    ).toBe(true);
    expect(
      reserveHttp(ledger, "history-over", "pr-http", 1, {
        historyCommitSummaries: 1,
      }),
    ).toMatchObject({ ok: false, error: { reason: "history-summary-limit" } });
    expect(
      reserveHttp(createBudgetLedger(), "detail-over", "pr-http", 1, {
        historyCommitDetails: 4,
      }),
    ).toMatchObject({ ok: false, error: { reason: "history-detail-limit" } });
  });

  it("expires inspection and extraction reservations at their separate deadlines", () => {
    let now = 1_000;
    const ledger = createBudgetLedger({ now: () => now });
    now += GITHUB_BUDGET_LIMITS.inspectionDeadlineMs;
    expect(reserveHttp(ledger, "late-http", "github-http", 0)).toMatchObject({
      ok: false,
      error: { reason: "deadline-exceeded" },
    });
    expect(ledger.remaining().deadlines).toMatchObject({
      inspectionExpired: true,
      extractionExpired: false,
      extractionStarted: false,
      expired: false,
    });
    expect(
      ledger.reserve({
        attemptId: "still-in-extraction-window",
        kind: "generation",
        consent,
        files: [lines("repo@sha:src/a.ts", 1, 1)],
        estimatedInputTokens: 1,
        estimatedOutputTokens: 1,
        estimatedReasoningTokens: 0,
      }).ok,
    ).toBe(true);
    expect(ledger.remaining().deadlines.extractionStarted).toBe(true);
    now =
      1_000 +
      GITHUB_BUDGET_LIMITS.inspectionDeadlineMs +
      GITHUB_BUDGET_LIMITS.extractionDeadlineMs;
    expect(
      ledger.reserve({
        attemptId: "late-generation",
        kind: "recovery",
        consent: { ...consent, selectionVersion: 2 },
        files: [lines("repo@sha:src/a.ts", 2, 1)],
        estimatedInputTokens: 1,
        estimatedOutputTokens: 1,
        estimatedReasoningTokens: 0,
      }),
    ).toMatchObject({ ok: false, error: { reason: "deadline-exceeded" } });
    expect(ledger.remaining().deadlines).toMatchObject({
      inspectionExpired: true,
      extractionExpired: true,
      expired: true,
    });
  });

  it("round-trips a content-free snapshot without losing known, estimated, or unknown usage", () => {
    const first = createBudgetLedger({ now: () => 100 });
    expect(
      first.reserve({
        attemptId: "http",
        kind: "github-http",
        upstreamBytes: 12,
        fetchedBodies: [
          { fileId: "repo@sha:src/secret-name.ts", decodedBytes: 5 },
        ],
      }).ok,
    ).toBe(true);
    expect(
      commitHttp(first, "http", {
        upstreamBytes: 9,
        fetchedBodies: [
          { fileId: "repo@sha:src/secret-name.ts", decodedBytes: 4 },
        ],
      }).ok,
    ).toBe(true);
    expect(
      first.reserve({
        attemptId: "uncertain",
        kind: "generation",
        consent,
        files: [
          {
            fileId: "repo@sha:src/secret-name.ts",
            ranges: [{ startLine: 1, endLine: 1 }],
            text: "synthetic source text",
          },
        ],
        estimatedInputTokens: 500,
        estimatedOutputTokens: 100,
        estimatedReasoningTokens: 50,
      }).ok,
    ).toBe(true);
    expect(first.commitUsage("uncertain", { known: false }).ok).toBe(true);
    const snapshot = first.snapshot();
    expect(JSON.stringify(snapshot)).not.toContain("synthetic source text");
    const restored = createBudgetLedger({ snapshot, now: () => 100 });
    expect(restored.remaining()).toEqual(first.remaining());
    expect(restored.commitUsage("uncertain", { known: false })).toMatchObject({
      ok: true,
      value: { idempotent: true, usageKnown: false },
    });
  });

  it("keeps summary output free of paths, excerpts, and repository content", () => {
    const ledger = createBudgetLedger();
    expect(
      ledger.checkSelection({
        files: [
          {
            fileId: "private/repository/path.ts",
            ranges: [{ startLine: 1, endLine: 1 }],
            text: "do not expose this source",
          },
        ],
      }).ok,
    ).toBe(true);
    const serialized = JSON.stringify(ledger.remaining());
    expect(serialized).not.toContain("private/repository");
    expect(serialized).not.toContain("do not expose");
  });
});
