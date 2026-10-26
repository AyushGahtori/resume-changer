import { describe, expect, it } from "vitest";
import {
  BudgetSummarySchema,
  DomainErrorSchema,
  FileCandidateSchema,
  GITHUB_IMPORT_POLICY,
  ImportRecordSchema,
  JobRecordSchema,
  MeasurementAnswerSchema,
  NotificationSchema,
  RepositoryPathSchema,
  RepositoryScopeSchema,
} from "../../../src/lib/github/contracts";
import { createUnavailableGithubPorts } from "../../../src/lib/github/server/unavailable";
import {
  blockedFileCandidate,
  exactBudget,
  failedJob,
  githubImportFixtureScope,
  hybridPullRequestContext,
  interruptedJob,
  manualFileCandidate,
  measuredAnswer,
  noMetricAnswer,
  overLimitBudget,
  privateRepositoryDenied,
  prFreeContext,
  queuedJob,
  readNotification,
  readyJob,
  readyRepository,
  runningJob,
  safeFileCandidate,
  supportedDraft,
  targetMeasurementAnswer,
  unreadNotification,
} from "../../fixtures/github/gate0";
import { isGithubImportHarnessEnabled } from "../../../src/lib/github/test-harness";

describe("GitHub import Gate 0 contracts", () => {
  it("freezes proposed shared request, storage, and generation ceilings", () => {
    expect(GITHUB_IMPORT_POLICY).toMatchObject({
      filesPerRequest: 12,
      linesPerRequest: 1_500,
      linesPerFilePerRequest: 200,
      distinctFilesPerImport: 16,
      uniqueLinesPerImport: 2_000,
      uniqueLinesPerFile: 300,
      transmittedLineOccurrences: 3_000,
      fetchedBodies: 20,
      httpAttempts: 32,
      pullRequestHttpAttempts: 8,
      totalUpstreamBytes: 12 * 1024 * 1024,
      fetchedFileBytes: 64 * 1024,
      selectedCharactersPerFile: 12_000,
      selectedCharactersTotal: 80_000,
      inputTokensPerRequest: 24_000,
      inputTokensPerImport: 36_000,
      generationAttempts: 2,
      extractionDeadlineMs: 120_000,
      stageRetentionMs: 24 * 60 * 60 * 1_000,
      cacheCapacityBytes: 50 * 1024 * 1024,
    });
  });

  it("rejects unsafe repository paths before any storage boundary receives them", () => {
    for (const path of [
      "../secret.txt",
      "%2e%2e/secrets.txt",
      "src/%252e%252e/secrets.txt",
      "/etc/passwd",
      "C:/private/key",
      "src\\..\\private",
      "src/%2fprivate",
    ]) {
      expect(RepositoryPathSchema.safeParse(path).success, path).toBe(false);
    }
    expect(RepositoryPathSchema.safeParse("src/summary.ts").success).toBe(true);
  });

  it("validates shared DTO fixtures for scope, evidence eligibility, budgets, jobs, and inbox state", () => {
    expect(RepositoryScopeSchema.parse(githubImportFixtureScope)).toEqual(
      githubImportFixtureScope,
    );
    expect(FileCandidateSchema.safeParse(safeFileCandidate()).success).toBe(
      true,
    );
    expect(FileCandidateSchema.safeParse(blockedFileCandidate()).success).toBe(
      true,
    );
    expect(FileCandidateSchema.safeParse(manualFileCandidate()).success).toBe(
      true,
    );
    expect(
      FileCandidateSchema.safeParse({
        ...safeFileCandidate(),
        content: "source",
      }).success,
    ).toBe(false);
    expect(BudgetSummarySchema.safeParse(exactBudget()).success).toBe(true);
    expect(BudgetSummarySchema.safeParse(overLimitBudget()).success).toBe(true);
    expect(JobRecordSchema.safeParse(queuedJob()).success).toBe(true);
    expect(JobRecordSchema.safeParse(runningJob()).success).toBe(true);
    expect(JobRecordSchema.safeParse(readyJob()).success).toBe(true);
    expect(JobRecordSchema.safeParse(failedJob()).success).toBe(true);
    expect(JobRecordSchema.safeParse(interruptedJob()).success).toBe(true);
    expect(NotificationSchema.safeParse(readNotification()).success).toBe(true);
    expect(NotificationSchema.safeParse(unreadNotification()).success).toBe(
      true,
    );
  });

  it("keeps team ownership ambiguous and separates measurements from targets or skips", () => {
    expect(prFreeContext()).toHaveLength(0);
    expect(hybridPullRequestContext()).toHaveLength(2);
    expect(readyRepository().visibility).toBe("public");
    expect(privateRepositoryDenied().error.code).toBe("forbidden");
    expect(supportedDraft().contributionConfirmed).toBe(true);
    expect(MeasurementAnswerSchema.parse(measuredAnswer()).attestation).toBe(
      "measured",
    );
    expect(MeasurementAnswerSchema.parse(noMetricAnswer()).mode).toBe("skip");
    const target = MeasurementAnswerSchema.parse(targetMeasurementAnswer());
    expect(target.mode).toBe("target");
    expect(target.attestation).toBe("target");
  });

  it("keeps consent bound to the exact selection version and hash", () => {
    const base = {
      id: "summary-import",
      version: 1,
      source: "personal" as const,
      destinationProjectId: "fictional-dashboard-project",
      authorizationNamespaceHash: "a".repeat(64),
      scope: githubImportFixtureScope,
      selectionVersion: 2,
      selectionHash: "b".repeat(64),
      lifecycle: "ready-to-analyze" as const,
      activeRunId: null,
      consent: {
        reference: "selection-consent",
        selectionVersion: 2,
        selectionHash: "b".repeat(64),
        consentedAt: "2026-10-26T12:00:00.000Z",
      },
      preparedSelectionRef: null,
      resultRef: null,
      draftRefs: [],
      draftEdits: [],
      savedIds: [],
      retentionDeadline: "2026-10-27T12:00:00.000Z",
      createdAt: "2026-10-26T12:00:00.000Z",
      updatedAt: "2026-10-26T12:00:00.000Z",
    };
    expect(ImportRecordSchema.safeParse(base).success).toBe(true);
    expect(
      ImportRecordSchema.safeParse({
        ...base,
        consent: { ...base.consent, selectionHash: "c".repeat(64) },
      }).success,
    ).toBe(false);
  });

  it("accepts only the explicit local E2E flag for the component harness", () => {
    expect(isGithubImportHarnessEnabled({})).toBe(false);
    expect(
      isGithubImportHarnessEnabled({
        GITHUB_IMPORT_E2E_HARNESS: "1",
        RESUME_APP_MODE: "firebase",
      }),
    ).toBe(false);
    expect(
      isGithubImportHarnessEnabled({
        GITHUB_IMPORT_E2E_HARNESS: "1",
        RESUME_APP_MODE: "local",
      }),
    ).toBe(true);
  });

  it("returns unavailable errors from placeholders instead of fake successful data", () => {
    const ports = createUnavailableGithubPorts();
    expect(ports.budget.snapshot()).toMatchObject({
      ok: false,
      error: { code: "unavailable" },
    });
    expect(
      ports.measurements.getApplicableDefinitions({ capability: "web" }),
    ).toMatchObject({
      ok: false,
      error: { code: "unavailable" },
    });
    expect(
      ports.selectionPolicy.requiredDimensions({
        scope: githubImportFixtureScope,
      }),
    ).toMatchObject({ ok: false, error: { code: "unavailable" } });
    expect(
      DomainErrorSchema.safeParse({
        code: "upstream-error",
        message: "Safe error only.",
        retryable: false,
        rawBody: "must not escape",
      }).success,
    ).toBe(false);
  });
});
