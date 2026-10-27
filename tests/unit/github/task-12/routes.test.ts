import { afterEach, describe, expect, it, vi } from "vitest";
import { createGithubImportHandlers } from "@/app/api/github/imports/handler";
import type {
  AcceptedJob,
  GithubImportHttpFacade,
  ServiceResult,
} from "@/app/api/github/imports/facade";
import {
  ImportRecordSchema,
  type ImportReviewState,
} from "@/lib/github/contracts";
import type {
  ApproveInput,
  CreateImportInput,
  ExtractInput,
  SelectionInput,
} from "@/app/api/github/imports/http-contracts";
import {
  githubImportFixtureScope,
  measurementQuestion,
  supportedDraft,
} from "../../../fixtures/github/gate0";

const IMPORT_ID = "import-example";
const DRAFT_ID = "draft-example";
const QUESTION_ID = "question-example";
const HASH = "a".repeat(64);
const NOW = "2026-10-26T12:00:00.000Z";

function importRecord(source: "personal" | "demo" = "personal", version = 1) {
  return ImportRecordSchema.parse({
    id: IMPORT_ID,
    version,
    source,
    destinationProjectId: "project-example",
    authorizationNamespaceHash: HASH,
    scope: githubImportFixtureScope,
    selectionVersion: version,
    selectionHash: null,
    lifecycle: "created" as const,
    activeRunId: null,
    consent: null,
    preparedSelectionRef: null,
    resultRef: null,
    draftRefs: [],
    draftEdits: [],
    savedIds: [],
    retentionDeadline: "2026-10-27T12:00:00.000Z",
    createdAt: NOW,
    updatedAt: NOW,
  });
}

function importReviewState() {
  return {
    import: importRecord(),
    candidates: [],
    priorReviews: [],
    prepared: null,
    result: null,
    questions: [],
    measurementResults: [],
    canSaveDraftIds: [],
    expired: false,
  };
}

function ok<T>(value: T): ServiceResult<T> {
  return { ok: true, value };
}

function failed<T>(code: string, message = "private provider detail") {
  return {
    ok: false,
    error: {
      code,
      message,
      retryable: false,
    },
  } as ServiceResult<T>;
}

function createFacade(
  overrides: Partial<GithubImportHttpFacade> = {},
): GithubImportHttpFacade {
  const defaults: GithubImportHttpFacade = {
    create: vi.fn(async ({ input }) => ok(importRecord(input.dataSource))),
    inspect: vi.fn(async () => ok({ jobId: "job-prepare" })),
    changeSelection: vi.fn(async ({ input }) =>
      ok({
        ...importRecord("personal", input.expectedVersion + 1),
        selectionVersion: input.expectedVersion + 1,
        selectionHash: HASH,
      }),
    ),
    enqueueAnalysis: vi.fn(async () =>
      ok({ jobId: "job-analysis", runId: "run-analysis" }),
    ),
    get: vi.fn(async () => ok(importReviewState())),
    updateDraft: vi.fn(async () => ok(supportedDraft())),
    questions: vi.fn(async () => ok([measurementQuestion()])),
    answer: vi.fn(async ({ input }) =>
      ok({ version: input.expectedVersion + 1, result: null }),
    ),
    saveMeasurementTask: vi.fn(async () =>
      ok({
        id: "metric-task",
        version: 1,
        projectId: "project-example",
        draftId: DRAFT_ID,
        claimContext: "A synthetic measurement context.",
        questionId: QUESTION_ID,
        questionVersion: 1,
        definitionIds: [],
        createdAt: NOW,
        retentionDeadline: "2026-11-25T12:00:00.000Z",
      }),
    ),
    approve: vi.fn(async () =>
      ok({ savedIds: ["achievement-saved"], alreadyApplied: false }),
    ),
    cancel: vi.fn(async () => ok(importRecord("personal", 4))),
    discard: vi.fn(async () => ok({ discarded: true as const })),
  };
  return { ...defaults, ...overrides };
}

function context(id = IMPORT_ID) {
  return { params: Promise.resolve({ id }) };
}

function draftContext() {
  return { params: Promise.resolve({ id: IMPORT_ID, draftId: DRAFT_ID }) };
}

function questionContext() {
  return {
    params: Promise.resolve({ id: IMPORT_ID, questionId: QUESTION_ID }),
  };
}

function request(
  path: string,
  method: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    ...(body === undefined
      ? {}
      : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}

const sameOrigin = { Origin: "http://localhost" };

function createInput(dataSource: "personal" | "demo" = "personal") {
  return {
    projectId: "project-example",
    repositoryUrl: "https://github.com/example/project",
    dataSource,
    contribution: {
      role: "Backend contributor",
      statement: "I implemented the import validation flow.",
      paths: ["src/imports"],
      commitIds: [],
      pullRequestNumbers: [],
    },
  };
}

function extractInput(overrides: Partial<ExtractInput> = {}): ExtractInput {
  return {
    expectedVersion: 2,
    selectionVersion: 2,
    selectionHash: HASH,
    providerConsent: true,
    idempotencyKey: "analyze-key-001",
    consentReference: undefined,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("GitHub import HTTP handlers", () => {
  it("creates a scoped personal import without invoking analysis", async () => {
    vi.stubEnv("RESUME_APP_MODE", "local");
    const facade = createFacade();
    const handlers = createGithubImportHandlers(() => facade);
    const response = await handlers.create(
      request("/api/github/imports", "POST", createInput(), sameOrigin),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(facade.create).toHaveBeenCalledWith({
      authority: { kind: "local" },
      input: createInput(),
    });
    expect(facade.enqueueAnalysis).not.toHaveBeenCalled();
  });

  it("accepts demo imports explicitly and rejects malformed JSON", async () => {
    vi.stubEnv("RESUME_APP_MODE", "local");
    const facade = createFacade();
    const handlers = createGithubImportHandlers(() => facade);
    const demo = await handlers.create(
      request("/api/github/imports", "POST", createInput("demo"), sameOrigin),
    );
    const malformed = await handlers.create(
      request("/api/github/imports", "POST", "{not-json", sameOrigin),
    );

    expect(demo.status).toBe(201);
    expect(facade.create).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ dataSource: "demo" }),
      }),
    );
    expect(malformed.status).toBe(400);
    expect(facade.create).toHaveBeenCalledTimes(1);
  });

  it("rejects lookalike JSON media types", async () => {
    vi.stubEnv("RESUME_APP_MODE", "local");
    const facade = createFacade();
    const handlers = createGithubImportHandlers(() => facade);
    const response = await handlers.create(
      request("/api/github/imports", "POST", JSON.stringify(createInput()), {
        ...sameOrigin,
        "Content-Type": "application/jsonp",
      }),
    );

    expect(response.status).toBe(400);
    expect(facade.create).not.toHaveBeenCalled();
  });

  it("bounds body reads before parsing and rejects unsafe repository URLs", async () => {
    vi.stubEnv("RESUME_APP_MODE", "local");
    const facade = createFacade();
    const handlers = createGithubImportHandlers(() => facade);
    const oversized = await handlers.create(
      request("/api/github/imports", "POST", " ".repeat(64 * 1024 + 1), {
        ...sameOrigin,
        "Content-Type": "application/json",
        "Content-Length": String(64 * 1024 + 1),
      }),
    );
    const unsafeUrl = await handlers.create(
      request(
        "/api/github/imports",
        "POST",
        {
          ...createInput(),
          repositoryUrl: "https://github.com/owner/repo/issues",
        },
        sameOrigin,
      ),
    );

    expect(oversized.status).toBe(413);
    expect(unsafeUrl.status).toBe(400);
    expect(facade.create).not.toHaveBeenCalled();
  });

  it("requires same-origin authority for mutations and a session in hosted mode", async () => {
    vi.stubEnv("RESUME_APP_MODE", "local");
    const handlers = createGithubImportHandlers(() => createFacade());
    const forbiddenOrigin = await handlers.create(
      request("/api/github/imports", "POST", createInput()),
    );

    vi.stubEnv("RESUME_APP_MODE", "firebase");
    const missingSession = await handlers.get(
      request(`/api/github/imports/${IMPORT_ID}`, "GET"),
      context(),
    );

    expect(forbiddenOrigin.status).toBe(403);
    expect(missingSession.status).toBe(403);
    expect((await missingSession.json()).error.code).toBe("forbidden");
  });

  it("returns 202 only for accepted durable work and reuses duplicate Analyze intent", async () => {
    vi.stubEnv("RESUME_APP_MODE", "local");
    const enqueueAnalysis = vi
      .fn()
      .mockResolvedValueOnce(
        ok({ jobId: "job-analysis", runId: "run-analysis" }),
      )
      .mockResolvedValueOnce(
        ok({ jobId: "job-analysis", runId: "run-analysis", duplicate: true }),
      );
    const facade = createFacade({ enqueueAnalysis });
    const handlers = createGithubImportHandlers(() => facade);
    const payload = extractInput();
    const firstResponse = await handlers.extract(
      request(
        `/api/github/imports/${IMPORT_ID}/extract`,
        "POST",
        payload,
        sameOrigin,
      ),
      context(),
    );
    const secondResponse = await handlers.extract(
      request(
        `/api/github/imports/${IMPORT_ID}/extract`,
        "POST",
        payload,
        sameOrigin,
      ),
      context(),
    );
    const firstBody = await firstResponse.json();
    const secondBody = await secondResponse.json();

    expect(firstResponse.status).toBe(202);
    expect(secondResponse.status).toBe(202);
    expect(firstBody.data).toEqual({
      jobId: "job-analysis",
      runId: "run-analysis",
      statusUrl: "/api/github/jobs/job-analysis",
    });
    expect(secondBody.data).toEqual({
      jobId: "job-analysis",
      runId: "run-analysis",
      statusUrl: "/api/github/jobs/job-analysis",
      duplicate: true,
    });
    expect(enqueueAnalysis).toHaveBeenNthCalledWith(1, {
      authority: { kind: "local" },
      importId: IMPORT_ID,
      input: payload,
    });
    expect(enqueueAnalysis).toHaveBeenNthCalledWith(2, {
      authority: { kind: "local" },
      importId: IMPORT_ID,
      input: payload,
    });
  });

  it("rejects stale selection versions before the facade can enqueue", async () => {
    vi.stubEnv("RESUME_APP_MODE", "local");
    const facade = createFacade({
      enqueueAnalysis: vi.fn(async () =>
        failed<AcceptedJob>("version-conflict"),
      ),
    });
    const handlers = createGithubImportHandlers(() => facade);
    const response = await handlers.extract(
      request(
        `/api/github/imports/${IMPORT_ID}/extract`,
        "POST",
        extractInput({ selectionVersion: 1 }),
        sameOrigin,
      ),
      context(),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("version-conflict");
    expect(body.error.message).not.toContain("private");
  });

  it("returns worker unavailability before reporting accepted inspect work", async () => {
    vi.stubEnv("RESUME_APP_MODE", "local");
    const facade = createFacade({
      inspect: vi.fn(async () =>
        failed<AcceptedJob>("unavailable", "worker missing"),
      ),
    });
    const handlers = createGithubImportHandlers(() => facade);
    const response = await handlers.inspect(
      request(
        `/api/github/imports/${IMPORT_ID}/inspect`,
        "POST",
        { expectedVersion: 1, selectedPrNumbers: [] },
        sameOrigin,
      ),
      context(),
    );

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("unavailable");
    expect(facade.inspect).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["invalid-input", 400],
    ["forbidden", 403],
    ["not-found", 404],
    ["version-conflict", 409],
    ["limit-exceeded", 413],
    ["needs-context", 422],
    ["invalid-evidence", 422],
    ["rate-limited", 429],
    ["unavailable", 503],
    ["io-error", 503],
    ["cancelled", 409],
    ["interrupted", 409],
    ["upstream-error", 502],
  ])("maps %s service errors to HTTP %i", async (code, status) => {
    vi.stubEnv("RESUME_APP_MODE", "local");
    const facade = createFacade({
      get: vi.fn(async () => failed<ImportReviewState>(code)),
    });
    const handlers = createGithubImportHandlers(() => facade);
    const response = await handlers.get(
      request(`/api/github/imports/${IMPORT_ID}`, "GET"),
      context(),
    );

    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect((await response.json()).error.message).not.toContain(
      "private provider",
    );
  });

  it("maps thrown upstream timeouts to 504 with a sanitized typed error", async () => {
    vi.stubEnv("RESUME_APP_MODE", "local");
    const timeout = Object.assign(new Error("private timeout details"), {
      name: "TimeoutError",
    });
    const facade = createFacade({
      get: vi.fn(async () => {
        throw timeout;
      }),
    });
    const handlers = createGithubImportHandlers(() => facade);
    const response = await handlers.get(
      request(`/api/github/imports/${IMPORT_ID}`, "GET"),
      context(),
    );
    const body = await response.json();

    expect(response.status).toBe(504);
    expect(body.error.code).toBe("upstream-error");
    expect(body.error.message).not.toContain("private timeout");
  });

  it("hides private-resource existence behind the same unavailable response", async () => {
    vi.stubEnv("RESUME_APP_MODE", "local");
    const facade = createFacade({
      get: vi.fn(async () =>
        failed<ImportReviewState>(
          "not-found",
          "Repository secret-private is absent",
        ),
      ),
    });
    const handlers = createGithubImportHandlers(() => facade);
    const response = await handlers.get(
      request(`/api/github/imports/${IMPORT_ID}`, "GET"),
      context(),
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.message).toBe("The import is unavailable.");
    expect(JSON.stringify(body)).not.toContain("secret-private");
  });

  it("hides cross-import IDs and forwards the account authority for scope checks", async () => {
    vi.stubEnv("RESUME_APP_MODE", "local");
    const authority = { kind: "account" as const, accountId: "account-one" };
    const foreignImportId = "another-users-import";
    const facade = createFacade({
      get: vi.fn(async () => failed<ImportReviewState>("not-found")),
    });
    const authorityProvider = vi.fn(async () => ({ authority }));
    const handlers = createGithubImportHandlers(
      () => facade,
      authorityProvider,
    );
    const response = await handlers.get(
      request(`/api/github/imports/${foreignImportId}`, "GET"),
      context(foreignImportId),
    );

    expect(response.status).toBe(404);
    expect((await response.json()).error.message).toBe(
      "The import is unavailable.",
    );
    expect(facade.get).toHaveBeenCalledWith({
      authority,
      importId: foreignImportId,
    });
  });

  it("passes selection edits as edits only and preserves version/hash response", async () => {
    vi.stubEnv("RESUME_APP_MODE", "local");
    const selection = {
      expectedVersion: 1,
      fileIds: ["file-one"],
      pinnedFileIds: ["file-one"],
      context: {
        statement: "I authored the parser.",
        paths: [],
        commitIds: [],
        pullRequestNumbers: [],
      },
    };
    const facade = createFacade();
    const handlers = createGithubImportHandlers(() => facade);
    const response = await handlers.selection(
      request(
        `/api/github/imports/${IMPORT_ID}/selection`,
        "PUT",
        selection,
        sameOrigin,
      ),
      context(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.version).toBe(2);
    expect(body.data.selectionVersion).toBe(2);
    expect(body.data.selectionHash).toBe(HASH);
    expect(facade.changeSelection).toHaveBeenCalledWith({
      authority: { kind: "local" },
      importId: IMPORT_ID,
      input: selection,
    });
    expect(facade.enqueueAnalysis).not.toHaveBeenCalled();
  });

  it("keeps reads and local measurement answers away from analysis services", async () => {
    vi.stubEnv("RESUME_APP_MODE", "local");
    const facade = createFacade();
    const handlers = createGithubImportHandlers(() => facade);
    const read = await handlers.get(
      request(`/api/github/imports/${IMPORT_ID}`, "GET"),
      context(),
    );
    const questions = await handlers.questions(
      request(`/api/github/imports/${IMPORT_ID}/measurement-questions`, "GET"),
      context(),
    );
    const answer = await handlers.answer(
      request(
        `/api/github/imports/${IMPORT_ID}/measurement-answers/${QUESTION_ID}`,
        "PUT",
        { expectedVersion: 1, answer: { mode: "skip" } },
        sameOrigin,
      ),
      questionContext(),
    );

    expect(read.status).toBe(200);
    expect(questions.status).toBe(200);
    expect(answer.status).toBe(200);
    expect(facade.get).toHaveBeenCalledTimes(1);
    expect(facade.questions).toHaveBeenCalledTimes(1);
    expect(facade.answer).toHaveBeenCalledTimes(1);
    expect(facade.enqueueAnalysis).not.toHaveBeenCalled();
  });

  it("forwards the exact approval versions, hashes, confirmations, and key", async () => {
    vi.stubEnv("RESUME_APP_MODE", "local");
    const input = {
      drafts: [{ draftId: DRAFT_ID, expectedVersion: 4, contentHash: HASH }],
      metrics: [
        {
          resultId: "metric-result",
          expectedVersion: 2,
          confirmationHash: HASH,
        },
      ],
      idempotencyKey: "approval-key-001",
    };
    const facade = createFacade();
    const handlers = createGithubImportHandlers(() => facade);
    const response = await handlers.approve(
      request(
        `/api/github/imports/${IMPORT_ID}/approve`,
        "POST",
        input,
        sameOrigin,
      ),
      context(),
    );

    expect(response.status).toBe(201);
    expect(facade.approve).toHaveBeenCalledWith({
      authority: { kind: "local" },
      importId: IMPORT_ID,
      input,
    });
  });

  it("returns 200 for an idempotent approval retry and keeps cancel separate from discard", async () => {
    vi.stubEnv("RESUME_APP_MODE", "local");
    const facade = createFacade({
      approve: vi.fn(async () =>
        ok({ savedIds: ["achievement-saved"], alreadyApplied: true }),
      ),
    });
    const handlers = createGithubImportHandlers(() => facade);
    const retry = await handlers.approve(
      request(
        `/api/github/imports/${IMPORT_ID}/approve`,
        "POST",
        {
          drafts: [
            { draftId: DRAFT_ID, expectedVersion: 4, contentHash: HASH },
          ],
          metrics: [],
          idempotencyKey: "approval-key-001",
        },
        sameOrigin,
      ),
      context(),
    );
    const cancel = await handlers.cancel(
      request(
        `/api/github/imports/${IMPORT_ID}/cancel`,
        "POST",
        { expectedVersion: 3, expectedRunId: "run-analysis" },
        sameOrigin,
      ),
      context(),
    );
    const discard = await handlers.discard(
      request(
        `/api/github/imports/${IMPORT_ID}`,
        "DELETE",
        { expectedVersion: 3, confirmDiscard: true },
        sameOrigin,
      ),
      context(),
    );

    expect(retry.status).toBe(200);
    expect(cancel.status).toBe(200);
    expect(discard.status).toBe(200);
    expect(facade.cancel).toHaveBeenCalledTimes(1);
    expect(facade.discard).toHaveBeenCalledTimes(1);
    expect(facade.cancel).not.toBe(facade.discard);
  });
});
