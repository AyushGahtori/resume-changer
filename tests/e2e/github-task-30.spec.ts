import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import type {
  Draft,
  ImportRecord,
  ImportReviewState,
  JobRecord,
  ImportQuestion,
  PreparedSelection,
  RepositoryScope,
  RepositorySummary,
} from "../../src/lib/github/contracts";

const NOW = "2026-10-27T08:00:00.000Z";
const HASH_ONE = "a".repeat(64);
const HASH_TWO = "b".repeat(64);
const SHA = "a".repeat(40);
const IMPORT_ID = "import-task-30";

const budget = {
  fetchedFiles: 1,
  fetchedBytes: 256,
  httpAttempts: 1,
  selectedUniqueFiles: 1,
  selectedUniqueLines: 5,
  selectedCharacters: 64,
  transmittedLinesByRequest: [5],
  cumulativeTransmittedLines: 5,
  estimatedInputTokens: 32,
  reportedInputTokens: null,
  limitReason: null,
};

const repository: RepositorySummary = {
  repositoryId: "700001",
  owner: "example-labs",
  name: "fictional-dashboard",
  canonicalUrl: "https://github.com/example-labs/fictional-dashboard",
  visibility: "public",
  defaultBranch: "main",
  permission: "read",
};

const baseScope: RepositoryScope = {
  repositoryId: repository.repositoryId,
  owner: repository.owner,
  name: repository.name,
  canonicalUrl: repository.canonicalUrl,
  visibility: repository.visibility,
  ref: "main",
  commitSha: SHA,
  selectedPullRequestNumbers: [],
  selectedPaths: [],
  contributionStatement: "I contributed to this repository.",
  identitySource: "user-provided",
};

function record(input: {
  projectId: string;
  scope: RepositoryScope;
  lifecycle?: ImportRecord["lifecycle"];
  version?: number;
  selectionVersion?: number;
  selectionHash?: string | null;
  activeRunId?: string | null;
  consent?: ImportRecord["consent"];
  savedIds?: string[];
  draft?: Draft | null;
}): ImportRecord {
  const selectedHash = input.selectionHash ?? null;
  const draft = input.draft ?? null;
  return {
    id: IMPORT_ID,
    version: input.version ?? 1,
    source: "personal",
    destinationProjectId: input.projectId,
    authorizationNamespaceHash: HASH_ONE,
    scope: input.scope,
    selectionVersion: input.selectionVersion ?? 1,
    selectionHash: selectedHash,
    lifecycle: input.lifecycle ?? "created",
    activeRunId: input.activeRunId ?? null,
    pinnedFileIds: [],
    removedFileIds: [],
    candidateInventoryRef: null,
    consent: input.consent ?? null,
    preparedSelectionRef: selectedHash,
    resultRef: draft ? HASH_ONE : null,
    resultRunId: draft ? "run-30" : null,
    approvalKeyHash: null,
    draftRefs: draft ? [draft.id] : [],
    draftEdits: [],
    reviewHistory: [],
    savedIds: input.savedIds ?? [],
    retentionDeadline: "2026-10-28T08:00:00.000Z",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function preparedSelection(
  importRecord: ImportRecord,
  selectionHash = importRecord.selectionHash ?? HASH_ONE,
): PreparedSelection {
  return {
    importId: importRecord.id,
    runId: "run-30",
    version: importRecord.selectionVersion,
    selectionHash,
    scope: importRecord.scope,
    selectedFileIds: ["file-1"],
    evidence: [
      {
        id: "evidence-1",
        snapshotId: "snapshot-1",
        commitSha: SHA,
        path: importRecord.scope.selectedPaths[0] ?? "src/summary.ts",
        blobSha: SHA,
        pointer: { kind: "lines", startLine: 1, endLine: 5 },
        excerpt: "A synthetic excerpt used only by this browser test.",
        excerptSha256: HASH_ONE,
        category: "implementation",
        classification: "observed",
      },
    ],
    limitations: [],
    completeness: "complete",
    budget,
    providerDisclosure:
      "The selected excerpts will be sent to the configured analysis provider.",
    consentedAt: importRecord.consent?.consentedAt ?? null,
  };
}

function draftFor(projectId: string, overrides: Partial<Draft> = {}): Draft {
  return {
    id: "draft-1",
    version: 1,
    projectId,
    text: "Improved the dashboard summary pipeline.",
    reviewedBaseText: "Improved the dashboard summary pipeline.",
    claimIds: ["claim-1"],
    supportStatus: "supported",
    selectedForSave: true,
    contributionConfirmed: true,
    metricResultIds: [],
    approvalEligible: true,
    approvalErrors: [],
    ...overrides,
  };
}

function question(): ImportQuestion {
  return {
    id: "question-1",
    version: 1,
    draftId: "draft-1",
    kind: "measurement",
    prompt: "Do you have a measured result to add?",
    required: false,
    definitionId: null,
    choices: [],
    answered: false,
  };
}

function reviewState(input: {
  projectId: string;
  scope: RepositoryScope;
  lifecycle: ImportRecord["lifecycle"];
  version: number;
  selectionVersion: number;
  selectionHash: string | null;
  activeRunId?: string | null;
  consent?: ImportRecord["consent"];
  draft?: Draft | null;
  savedIds?: string[];
  questions?: ImportQuestion[];
  priorReviews?: ImportReviewState["priorReviews"];
}): ImportReviewState {
  const selectedHash = input.selectionHash;
  const draft = input.draft ?? null;
  const currentRecord = record({
    projectId: input.projectId,
    scope: input.scope,
    lifecycle: input.lifecycle,
    version: input.version,
    selectionVersion: input.selectionVersion,
    selectionHash: selectedHash,
    activeRunId: input.activeRunId,
    consent: input.consent,
    draft,
    savedIds: input.savedIds,
  });
  const hasPrepared = selectedHash !== null && input.lifecycle !== "created";
  const hasResult = Boolean(draft);
  return {
    import: currentRecord,
    prepared: hasPrepared
      ? preparedSelection(currentRecord, selectedHash!)
      : null,
    result: hasResult
      ? {
          summary: "A synthetic result for controller coverage.",
          claims: [
            {
              id: "claim-1",
              text: "The contribution is supported by the selected excerpt.",
              evidenceIds: ["evidence-1"],
              userStatementIds: [],
              classification: "observed",
              confirmedByUser: true,
              confirmationVersion: 1,
              limitations: [],
            },
          ],
          drafts: [draft!],
          questionSuggestions: [],
          limitations: [],
          model: "mock-provider",
          finishReason: "stop",
          usage: {
            promptTokens: null,
            cachedTokens: null,
            outputTokens: null,
            reasoningTokens: null,
            totalTokens: null,
          },
          selectionHash: selectedHash!,
        }
      : null,
    candidates: [],
    priorReviews: input.priorReviews ?? [],
    questions: input.questions ?? (hasResult ? [question()] : []),
    measurementResults: [],
    canSaveDraftIds: hasResult && draft!.approvalEligible ? [draft!.id] : [],
    expired: input.lifecycle === "expired",
  };
}

function jobRecord(input: {
  projectId: string;
  kind: JobRecord["kind"];
  importVersion: number;
  selectionVersion: number;
  inputHash: string;
  consentHash?: string | null;
}): JobRecord {
  return {
    id: input.kind === "prepare" ? "prepare-job" : "analysis-job",
    runId: "run-30",
    importId: IMPORT_ID,
    projectId: input.projectId,
    importVersion: input.importVersion,
    selectionVersion: input.selectionVersion,
    idempotencyKeyHash: HASH_ONE,
    kind: input.kind,
    state: "queued",
    stage: "queued",
    inputHash: input.inputHash,
    consentHash: input.consentHash ?? null,
    executionFence: 0,
    lease: null,
    checkpoint: null,
    cancellationRequestedAt: null,
    deadline: "2026-10-27T08:05:00.000Z",
    usage: budget,
    error: null,
    resultRef: null,
    outboxEvents: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function response(route: Route, data: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify({ data }),
  });
}

function createMockApi(page: Page) {
  let current: ImportReviewState | null = null;
  let projectId = "project-1";
  let selectionHash = HASH_ONE;
  let priorReviews: ImportReviewState["priorReviews"] = [];
  let conflictOnDraftUpdate = false;
  let extractCount = 0;
  let prepareCount = 0;
  let cancelCount = 0;
  let measurementAnswerCount = 0;
  let approveCount = 0;
  const analyzeBodies: Array<Record<string, unknown>> = [];
  let approveBody: Record<string, unknown> | null = null;
  let changedScopes: RepositoryScope[] = [];

  const handler = async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (/^\/api\/github\/repositories\/[^/]+\/pull-requests$/.test(path)) {
      return response(route, {
        candidates: [],
        completeness: "complete",
        limitations: [],
      });
    }
    if (path === "/api/github/jobs/events") {
      return response(route, { events: [], nextCursor: null, hasMore: false });
    }
    if (path === "/api/github/connection/repositories" && method === "GET") {
      return response(route, {
        state: "connected",
        repositories: [repository],
        nextCursor: null,
      });
    }
    if (path === "/api/github/connection/repositories" && method === "POST") {
      return response(route, { state: "connected", scope: baseScope });
    }
    if (path === "/api/github/imports" && method === "POST") {
      const input = request.postDataJSON() as {
        destinationProjectId: string;
        scope: RepositoryScope;
      };
      projectId = input.destinationProjectId;
      current = reviewState({
        projectId,
        scope: input.scope,
        lifecycle: "created",
        version: 1,
        selectionVersion: 1,
        selectionHash: null,
      });
      return response(route, current.import);
    }
    if (path.endsWith("/inspect") && method === "POST" && current) {
      prepareCount += 1;
      selectionHash = prepareCount === 1 ? HASH_ONE : HASH_TWO;
      current = reviewState({
        projectId,
        scope: current.import.scope,
        lifecycle: "ready-to-analyze",
        version: current.import.version + 1,
        selectionVersion: current.import.selectionVersion,
        selectionHash,
        priorReviews,
      });
      return response(
        route,
        jobRecord({
          projectId,
          kind: "prepare",
          importVersion: current.import.version,
          selectionVersion: current.import.selectionVersion,
          inputHash: selectionHash,
        }),
      );
    }
    if (
      path === "/api/github/imports/" + IMPORT_ID &&
      method === "GET" &&
      current
    ) {
      return response(route, current);
    }
    if (path.endsWith("/selection") && method === "PUT" && current) {
      const body = request.postDataJSON() as { scope: RepositoryScope };
      const old = current;
      changedScopes.push(body.scope);
      if (old.prepared) {
        priorReviews = [
          ...priorReviews,
          {
            runId: old.prepared.runId,
            selectionVersion: old.import.selectionVersion,
            selectionHash: old.prepared.selectionHash,
            destinationProjectId: old.import.destinationProjectId,
            prepared: old.prepared,
            result: old.result,
            draftEdits: old.import.draftEdits,
            savedIds: old.import.savedIds,
            createdAt: NOW,
          },
        ];
      }
      current = reviewState({
        projectId,
        scope: body.scope,
        lifecycle: "created",
        version: old.import.version + 1,
        selectionVersion: old.import.selectionVersion + 1,
        selectionHash: null,
        priorReviews,
      });
      return response(route, current.import);
    }
    if (path.endsWith("/extract") && method === "POST" && current) {
      extractCount += 1;
      analyzeBodies.push(request.postDataJSON() as Record<string, unknown>);
      const body = analyzeBodies[analyzeBodies.length - 1];
      const consent = {
        reference: String(body.consentReference),
        selectionVersion: current.import.selectionVersion,
        selectionHash: String(body.selectionHash),
        consentedAt: NOW,
      };
      const lifecycle = extractCount === 1 ? "ready-to-review" : "queued";
      current = reviewState({
        projectId,
        scope: current.import.scope,
        lifecycle,
        version: current.import.version + 1,
        selectionVersion: current.import.selectionVersion,
        selectionHash: String(body.selectionHash),
        activeRunId: lifecycle === "queued" ? "run-30" : null,
        consent,
        draft: lifecycle === "ready-to-review" ? draftFor(projectId) : null,
        priorReviews,
      });
      return response(
        route,
        jobRecord({
          projectId,
          kind: "analyze",
          importVersion: current.import.version,
          selectionVersion: current.import.selectionVersion,
          inputHash: String(body.selectionHash),
          consentHash: String(body.selectionHash),
        }),
      );
    }
    if (
      path.endsWith("/measurement-answers/question-1") &&
      method === "PUT" &&
      current
    ) {
      measurementAnswerCount += 1;
      const questions = current.questions.map((entry) => ({
        ...entry,
        answered: true,
      }));
      current = { ...current, questions };
      return response(route, { version: 2, result: null });
    }
    if (path.endsWith("/drafts/draft-1") && method === "PUT" && current) {
      if (conflictOnDraftUpdate) {
        return route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "version-conflict",
              message: "A newer draft version is available.",
              retryable: false,
            },
          }),
        });
      }
      const body = request.postDataJSON() as {
        text: string;
        selectedForSave?: boolean;
        contributionConfirmed?: boolean;
      };
      const draft = draftFor(projectId, {
        ...current.result?.drafts[0],
        version: (current.result?.drafts[0].version ?? 1) + 1,
        text: body.text,
        selectedForSave: body.selectedForSave ?? true,
        contributionConfirmed: body.contributionConfirmed ?? true,
      });
      const draftEdit = {
        draftId: draft.id,
        version: draft.version,
        baseResultHash: HASH_ONE,
        text: draft.text,
        selectedForSave: draft.selectedForSave,
        contributionConfirmed: draft.contributionConfirmed,
        confirmedMetricResultIds: [],
        updatedAt: NOW,
      };
      current = {
        ...current,
        import: {
          ...current.import,
          version: current.import.version + 1,
          draftEdits: [draftEdit],
        },
        result: current.result ? { ...current.result, drafts: [draft] } : null,
        canSaveDraftIds:
          draft.approvalEligible &&
          draft.selectedForSave &&
          draft.contributionConfirmed
            ? [draft.id]
            : [],
      };
      return response(route, draft);
    }
    if (path.endsWith("/approve") && method === "POST" && current) {
      approveCount += 1;
      approveBody = request.postDataJSON() as Record<string, unknown>;
      current = {
        ...current,
        import: {
          ...current.import,
          version: current.import.version + 1,
          lifecycle: "approved",
          savedIds: ["achievement-saved-30"],
        },
      };
      return response(route, {
        savedIds: ["achievement-saved-30"],
        alreadyApplied: false,
      });
    }
    if (path.endsWith("/cancel") && method === "POST") {
      cancelCount += 1;
      current = {
        ...current!,
        import: {
          ...current!.import,
          activeRunId: null,
          lifecycle: "cancelled",
          version: current!.import.version + 1,
        },
      };
      return response(route, current.import);
    }

    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "not-found",
          message: "No mock route",
          retryable: false,
        },
      }),
    });
  };

  return {
    install: () => page.route("**/api/github/**", handler),
    get current() {
      return current;
    },
    set current(value: ImportReviewState | null) {
      current = value;
    },
    set conflict(value: boolean) {
      conflictOnDraftUpdate = value;
    },
    get extractCount() {
      return extractCount;
    },
    get prepareCount() {
      return prepareCount;
    },
    get cancelCount() {
      return cancelCount;
    },
    get measurementAnswerCount() {
      return measurementAnswerCount;
    },
    get approveCount() {
      return approveCount;
    },
    get analyzeBodies() {
      return analyzeBodies;
    },
    get approveBody() {
      return approveBody;
    },
    get changedScopes() {
      return changedScopes;
    },
    promoteToReview() {
      if (!current) return;
      const consent = current.import.consent ?? {
        reference: "consent-1",
        selectionVersion: current.import.selectionVersion,
        selectionHash: current.import.selectionHash ?? HASH_ONE,
        consentedAt: NOW,
      };
      current = reviewState({
        projectId,
        scope: current.import.scope,
        lifecycle: "ready-to-review",
        version: current.import.version,
        selectionVersion: current.import.selectionVersion,
        selectionHash: current.import.selectionHash ?? HASH_ONE,
        consent,
        draft: draftFor(projectId),
        priorReviews,
      });
    },
  };
}

async function prepareAndAnalyze(
  page: Page,
  mock: ReturnType<typeof createMockApi>,
) {
  await page.addInitScript(() => {
    Object.defineProperty(window, "EventSource", {
      configurable: true,
      value: undefined,
    });
  });
  await page.goto("/library/github/new");
  await page
    .getByRole("combobox", { name: "Repository" })
    .selectOption(repository.repositoryId);
  await page
    .getByLabel("Your role on this project", { exact: true })
    .fill("I built the summary pipeline and tests.");
  await page.getByText("Optional pull requests and file paths").click();
  await page.getByLabel("Pull request numbers").fill("17");
  await page.getByLabel("Manual repository paths").fill("src/summary.ts");
  await page.getByRole("button", { name: "Prepare selected evidence" }).click();
  await page.waitForURL("**/library/github/" + IMPORT_ID);
  await expect(
    page.getByText(
      "The selected excerpts will be sent to the configured analysis provider.",
    ),
  ).toBeVisible();
  const consent = page.getByRole("checkbox", {
    name: "I reviewed this selection and explicitly approve one analysis run.",
  });
  await consent.check();
  await page.getByRole("button", { name: "Analyze this selection" }).click();
  await expect.poll(() => mock.extractCount).toBe(1);
}

test.describe("Task 30 full-page GitHub import controller", () => {
  test("uses explicit consent, preserves durable work on Back, and saves returned IDs", async ({
    page,
  }) => {
    const mock = createMockApi(page);
    await mock.install();
    await prepareAndAnalyze(page, mock);

    await expect(page.getByTestId("github-import-workspace")).toHaveAttribute(
      "data-step",
      "review",
    );
    expect(mock.analyzeBodies[0]?.selectionHash).toBe(HASH_ONE);
    await page
      .getByText("Change repository selection", { exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Repository paths, one per line" })
      .fill("src/summary.ts\nsrc/format.ts");
    await page
      .getByRole("button", { name: "Update selection and prepare a new run" })
      .click();
    await expect(page.getByTestId("github-import-workspace")).toHaveAttribute(
      "data-step",
      "analysis",
    );
    await expect.poll(() => mock.prepareCount).toBe(2);
    expect(mock.changedScopes.at(-1)?.selectedPaths).toEqual([
      "src/summary.ts",
      "src/format.ts",
    ]);
    expect(mock.extractCount).toBe(1);
    const secondConsent = page.getByRole("checkbox", {
      name: "I reviewed this selection and explicitly approve one analysis run.",
    });
    await expect(secondConsent).not.toBeChecked();
    const analyze = page.getByRole("button", {
      name: "Analyze this selection",
    });
    await expect(analyze).toBeDisabled();
    await secondConsent.check();
    await analyze.click();
    await expect.poll(() => mock.extractCount).toBe(2);
    await expect(page.getByTestId("github-import-workspace")).toHaveAttribute(
      "data-step",
      "analysis",
    );

    await page
      .getByRole("button", { name: "Back to Achievement Library" })
      .click();
    await expect(page).toHaveURL(/\/library$/u);
    expect(mock.cancelCount).toBe(0);
    mock.promoteToReview();
    await page.goto("/library/github/" + IMPORT_ID);
    await expect(page.getByTestId("github-import-workspace")).toHaveAttribute(
      "data-step",
      "review",
    );
    expect(mock.extractCount).toBe(2);

    await page
      .getByRole("button", { name: "Add a measurement", exact: true })
      .click();
    await page
      .getByRole("button", { name: /^Continue without a number/ })
      .click();
    await expect.poll(() => mock.measurementAnswerCount).toBe(1);
    expect(mock.extractCount).toBe(2);
    await page
      .getByLabel("Achievement text for draft 1")
      .fill("Improved the summary pipeline and its regression coverage.");
    await page
      .getByRole("button", { name: "Confirm my contribution", exact: true })
      .click();
    await page
      .getByRole("button", { name: /Save selected achievements/ })
      .click();
    await expect(
      page.getByText(/Returned IDs: achievement-saved-30/u),
    ).toBeVisible();
    expect(mock.approveCount).toBe(1);
    expect(mock.approveBody?.selectedDraftIds).toEqual(["draft-1"]);
    expect(mock.analyzeBodies).toHaveLength(2);
    expect(mock.analyzeBodies.map((body) => body.selectionHash)).toEqual([
      HASH_ONE,
      HASH_TWO,
    ]);
    expect(
      mock.analyzeBodies.every(
        (body) =>
          body.providerConsent === true &&
          body.consentReference === body.idempotencyKey,
      ),
    ).toBe(true);
  });

  test("does not approve a draft when its version conflicts", async ({
    page,
  }) => {
    const mock = createMockApi(page);
    mock.conflict = true;
    await mock.install();
    await prepareAndAnalyze(page, mock);
    await expect(page.getByTestId("github-import-workspace")).toHaveAttribute(
      "data-step",
      "review",
    );
    await page
      .getByLabel("Achievement text for draft 1")
      .fill("An edited draft that conflicts with a newer server version.");
    await page
      .getByRole("button", { name: "Confirm my contribution", exact: true })
      .click();
    await page
      .getByRole("button", { name: /Save selected achievements/ })
      .click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "A newer draft version is available." }),
    ).toBeVisible();
    expect(mock.approveCount).toBe(0);
  });

  test("keeps Back and explicit cancellation as different actions", async ({
    page,
  }) => {
    const mock = createMockApi(page);
    await mock.install();
    await prepareAndAnalyze(page, mock);

    await page
      .getByText("Change repository selection", { exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Repository paths, one per line" })
      .fill("src/summary.ts\nsrc/format.ts");
    await page
      .getByRole("button", { name: "Update selection and prepare a new run" })
      .click();
    await page
      .getByRole("checkbox", {
        name: "I reviewed this selection and explicitly approve one analysis run.",
      })
      .check();
    await page.getByRole("button", { name: "Analyze this selection" }).click();
    await expect.poll(() => mock.extractCount).toBe(2);
    await expect(
      page.getByRole("button", { name: "Cancel analysis" }),
    ).toBeVisible();

    await page
      .getByRole("button", { name: "Back to Achievement Library" })
      .click();
    await expect(page).toHaveURL(/\/library$/u);
    expect(mock.cancelCount).toBe(0);

    await page.goto("/library/github/" + IMPORT_ID);
    await expect(
      page.getByRole("button", { name: "Cancel analysis" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancel analysis" }).click();
    await expect.poll(() => mock.cancelCount).toBe(1);
    await expect(page.getByTestId("github-import-workspace")).toHaveAttribute(
      "data-step",
      "analysis",
    );
    expect(mock.extractCount).toBe(2);
  });
});

test("connection recovery explains the next step and keeps abandoned sign-in retryable", async ({
  page,
}) => {
  const mock = createMockApi(page);
  await mock.install();
  for (const state of ["expired", "connecting"]) {
    await page.route("**/api/github/connection/repositories", async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            state,
            repositories: [],
            nextCursor: null,
            message:
              "GitHub sign-in expired. Reconnect to choose a repository.",
          },
        }),
      });
    });
    await page.goto("/library/github/new");
    const button = page.getByRole("button", {
      name: state === "expired" ? "Reconnect GitHub" : "Connect GitHub",
      exact: true,
    });
    await expect(button).toHaveCount(1);
    await expect(button).toBeEnabled();
    await expect(
      page
        .getByText(
          state === "expired"
            ? "GitHub sign-in expired. Reconnect to choose a repository."
            : "GitHub sign-in was not completed. Connect again, then choose your repository here.",
          { exact: true },
        )
        .first(),
    ).toBeVisible();
    await expect(
      page.getByText("Connection needs attention", { exact: true }),
    ).toHaveCount(0);
    if (state === "expired") await captureSetup(page, "expired");
    await page.unroute("**/api/github/connection/repositories");
  }
});

test("repository access refresh updates the picker without reconnecting and clears revoked selection", async ({
  page,
}) => {
  const mock = createMockApi(page);
  await mock.install();
  let allowed = false,
    oauthStarts = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/github/connection/start")) oauthStarts++;
  });
  await page.route("**/api/github/connection/repositories", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          state: "connected",
          repositories: allowed ? [repository] : [],
          nextCursor: null,
        },
      }),
    });
  });
  await page.goto("/library/github/new");
  await expect(
    page.getByRole("combobox", { name: "Repository", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Refresh repository list", exact: true }),
  ).toBeVisible();
  await captureSetup(page, "empty");
  allowed = true;
  await page
    .getByRole("button", { name: "Refresh repository list", exact: true })
    .click();
  const picker = page.getByRole("combobox", {
    name: "Repository",
    exact: true,
  });
  await expect(picker).toBeEnabled();
  await picker.selectOption(repository.repositoryId);
  await page
    .getByLabel("Your role on this project", { exact: true })
    .fill("I built the summary pipeline.");
  await expect(
    page.getByRole("button", {
      name: "Prepare selected evidence",
      exact: true,
    }),
  ).toBeEnabled();
  await captureSetup(page, "ready");
  await page.getByText("Repository missing?", { exact: true }).click();
  allowed = false;
  await page
    .getByRole("button", { name: "Refresh repository list", exact: true })
    .click();
  await expect(picker).toBeDisabled();
  await expect(
    page.getByRole("button", {
      name: "Prepare selected evidence",
      exact: true,
    }),
  ).toBeDisabled();
  expect(oauthStarts).toBe(0);
});

async function captureSetup(page: Page, state: string) {
  const root = join(process.cwd(), ".runtime", "github-setup", "controller");
  await mkdir(root, { recursive: true });
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1050 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.evaluate(() => {
        (document.activeElement as HTMLElement | null)?.blur();
        window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      });
      await page.screenshot({
        path: join(root, state + "-" + theme + "-" + width + ".png"),
        fullPage: true,
      });
    }
  }
}
