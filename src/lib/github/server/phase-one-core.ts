import { createHash } from "node:crypto";
import {
  createBudgetLedger,
  type BudgetLedger,
  type BudgetMeasuredUsage,
} from "./budget";
import {
  createGithubClient,
  type GithubBudgetLedger,
  type GithubClientDependencies,
  type GithubRequestContext,
} from "./client-core";
import { createRepositoryInspector } from "./repository";
import { createPrContextReader, type PrGithubClient } from "./pr-context-core";
import {
  createEvidenceSelector,
  type EvidenceExecutionContext,
  type RepositoryScope,
  type SelectorBudgetLedger,
  type PreparedEvidence,
} from "./selector-core";
import type { EvidenceCategory, FileCandidate } from "./file-policy-core";
import type { RepositoryInventory } from "./inventory";
import {
  PreparedSelectionSchema,
  type RepositoryScope as SharedRepositoryScope,
} from "../contracts";

/** Explicit lossless source-pointer projection into the persisted Gate 0 selection DTO. */
export function preparedSelectionForStore(input: {
  importId: string;
  version: number;
  scope: SharedRepositoryScope;
  prepared: PreparedEvidence;
  ledger: BudgetLedger;
}) {
  const { prepared, scope } = input;
  if (
    scope.repositoryId !== prepared.repositoryId ||
    scope.commitSha !== prepared.fullSha
  )
    throw new Error(
      "Prepared evidence belongs to a different repository revision.",
    );
  const categories: Record<
    EvidenceCategory,
    | "purpose"
    | "manifest"
    | "implementation"
    | "test"
    | "report"
    | "documentation"
    | "other"
  > = {
    purpose: "purpose",
    stack: "manifest",
    "core-method": "implementation",
    "product-surface": "implementation",
    corroboration: "test",
    measurement: "report",
    "ui-style": "implementation",
    helper: "implementation",
    unknown: "other",
  };
  return PreparedSelectionSchema.parse({
    importId: input.importId,
    runId: prepared.runId,
    version: input.version,
    selectionHash: prepared.selectionHash,
    scope,
    selectedFileIds: prepared.selectedFileIds,
    evidence: prepared.evidence.map((e) => ({
      id: e.id,
      snapshotId: e.snapshotId,
      commitSha: e.fullSha,
      path: e.path,
      blobSha: e.blobSha,
      pointer: { kind: "lines", startLine: e.lineStart, endLine: e.lineEnd },
      excerpt: e.excerpt,
      excerptSha256: e.excerptHash,
      category: categories[e.category],
      classification: e.sourceClassification,
    })),
    limitations: prepared.limitations,
    completeness: prepared.completeness,
    budget: {
      fetchedFiles: prepared.fetchedFileCount,
      fetchedBytes: prepared.fetchedBytes,
      httpAttempts: input.ledger.remaining().httpAttempts.used,
      selectedUniqueFiles: prepared.selectedFileIds.length,
      selectedUniqueLines: prepared.uniqueLineCount,
      selectedCharacters: prepared.totalCharacters,
      transmittedLinesByRequest: [],
      cumulativeTransmittedLines: 0,
      estimatedInputTokens: Math.ceil(prepared.totalCharacters / 2),
      reportedInputTokens: null,
      limitReason: null,
    },
    providerDisclosure:
      "No source has been sent to an AI provider. Consent is required for this exact selection.",
    consentedAt: null,
  });
}

const emptyUsage = (): BudgetMeasuredUsage => ({
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
});

/** Bridges stream-level transport accounting to the one authoritative run ledger. */
export function createTransportBudget(ledger: BudgetLedger) {
  const attempts = new Map<
    string,
    {
      bytes: number;
      limit: number;
      body?: { fileId: string; decodedBytes: number };
    }
  >();
  const charged = new Set<string>();
  const transport: GithubBudgetLedger = {
    async reserve(input) {
      const attemptId = input.reservationKey.replace(
        /:(?:attempt|wire:\d+|decoded:\d+)$/,
        "",
      );
      if (input.resource === "github-http-attempts") {
        const limit = Math.min(
          8 * 1024 * 1024,
          ledger.remaining().upstreamBytes.remaining,
        );
        const reserved = ledger.reserve({
          attemptId,
          kind: input.kind ?? "github-http",
          upstreamBytes: limit,
          ...(input.fetchedBody ? { fetchedBodies: [input.fetchedBody] } : {}),
        });
        if (!reserved.ok) return null;
        attempts.set(attemptId, { bytes: 0, limit, body: input.fetchedBody });
      } else {
        const attempt = attempts.get(attemptId);
        if (!attempt) return null;
        if (
          input.resource === "github-wire-bytes" &&
          !charged.has(input.reservationKey)
        ) {
          if (attempt.bytes + input.amount > attempt.limit) return null;
          attempt.bytes += input.amount;
        }
      }
      charged.add(input.reservationKey);
      return input.reservationKey;
    },
    async commitUsage() {
      /* Stream chunks are committed together at the attempt boundary. */
    },
  };
  return {
    transport,
    async settled(_context: GithubRequestContext, id: string) {
      const attempt = attempts.get(id);
      if (!attempt) return;
      const usage = emptyUsage();
      usage.upstreamBytes = attempt.bytes;
      if (attempt.body)
        usage.fetchedBodies = [
          { fileId: attempt.body.fileId, decodedBytes: attempt.bytes },
        ];
      const result = ledger.commitUsage(id, usage);
      attempts.delete(id);
      for (const key of charged)
        if (key.startsWith(`${id}:`)) charged.delete(key);
      if (!result.ok)
        return {
          code: "limit-exceeded" as const,
          message: "GitHub usage exceeded its shared reservation.",
          retryable: false,
        };
    },
  };
}

/** Admission checks never consume source/token budgets; only consented generation reserves them. */
export function createSelectorBudget(
  ledger: BudgetLedger,
): SelectorBudgetLedger {
  return {
    async checkSelection(request) {
      const result = ledger.checkSelection({
        files: request.files.map((f) => ({
          fileId: f.fileId,
          ranges: f.ranges.map((r) => ({
            startLine: r.lineStart,
            endLine: r.lineEnd,
          })),
          characters: f.characters,
        })),
        estimatedInputTokens: request.estimatedInputTokens,
      });
      if (!result.ok) return result;
      return { ok: true, value: { allowed: true } };
    },
  };
}

export function inventoryForSelector(
  inventory: RepositoryInventory,
): FileCandidate[] {
  const categories: Record<string, EvidenceCategory> = {
    "stack-build": "stack",
    contribution: "core-method",
  };
  return inventory.files
    .filter((f) => f.blobSha !== null)
    .map((f) => ({
      id: f.id,
      path: f.path,
      blobSha: f.blobSha!,
      mode: f.mode,
      byteSize: f.sizeBytes ?? 0,
      category:
        categories[f.evidenceRole] ?? (f.evidenceRole as EvidenceCategory),
      reasonCodes: f.reasonCodes,
      eligibility:
        f.eligibility === "excluded"
          ? "excluded"
          : f.eligibility === "manual-only"
            ? "unknown"
            : "eligible",
    }));
}

export interface InspectionRunDependencies {
  runId: string;
  now: () => number;
  transport: Omit<
    GithubClientDependencies,
    "ledger" | "onAttemptSettled" | "now"
  >;
  /** Must recheck the current GitHub grant before any repository request. */
  authorizeRepository: (repositoryId: string) => Promise<boolean>;
}

/** Integration boundary for Gate A. It is deliberately not exposed through production HTTP. */
export function createInspectionRun(deps: InspectionRunDependencies) {
  const ledger = createBudgetLedger({ now: deps.now });
  const bridge = createTransportBudget(ledger);
  const github = createGithubClient({
    ...deps.transport,
    now: deps.now,
    ledger: bridge.transport,
    onAttemptSettled: bridge.settled,
  });
  const inspector = createRepositoryInspector<GithubRequestContext>({
    client: {
      async getJson<T>(input: Parameters<typeof github.getJson>[0]) {
        const result = await github.getJson<T>(input);
        if (!result.ok) return result;
        if (result.value.data === null)
          return {
            ok: false,
            error: {
              code: "upstream-error",
              message: "GitHub returned no repository data.",
              retryable: false,
            },
          };
        return {
          ok: true,
          value: { ...result.value, data: result.value.data },
        };
      },
    },
  });
  const pr = createPrContextReader({
    github: {
      async getJson<T>(input: Parameters<PrGithubClient["getJson"]>[0]) {
        const before = ledger.remaining().prHttpAttempts.used;
        const result = await github.getJson<T>({
          ...input,
          context: { ...context, budgetKind: "pr-http" },
        });
        const attempts = ledger.remaining().prHttpAttempts.used - before;
        if (!result.ok)
          return { ...result, error: { ...result.error, attempts } };
        if (result.value.data === null)
          return {
            ok: false,
            error: {
              code: "upstream-error" as const,
              message: "GitHub returned no PR data.",
              retryable: false,
            },
          };
        return {
          ok: true,
          value: {
            ...result.value,
            data: result.value.data,
            hasNextPage: Boolean(result.value.nextPage),
            attempts,
          },
        };
      },
    },
  });
  const controller = new AbortController();
  const context: GithubRequestContext = {
    runId: deps.runId,
    deadline: deps.now() + 60_000,
    signal: controller.signal,
  };
  const selectorBudget = createSelectorBudget(ledger);
  const selector = createEvidenceSelector({
    async fetchFile({ scope, candidate, maxBytes, context: selectorContext }) {
      const body = { fileId: candidate.id, decodedBytes: maxBytes };
      const result = await github.getText({
        path: `/repos/${encodeURIComponent(scope.owner)}/${encodeURIComponent(scope.name)}/git/blobs/${candidate.blobSha}`,
        responseByteLimit: maxBytes,
        context: {
          ...context,
          signal: selectorContext.signal ?? context.signal,
          fetchedBody: body,
        },
      });
      if (!result.ok) return result;
      const text = result.value.data;
      if (text === null)
        return {
          ok: false,
          error: {
            code: "invalid-evidence",
            message: "GitHub returned no source body.",
            retryable: false,
          },
        };
      const bytes = Buffer.from(text, "utf8");
      const blobHash = createHash(
        candidate.blobSha.length === 64 ? "sha256" : "sha1",
      )
        .update(`blob ${bytes.length}\0`)
        .update(bytes)
        .digest("hex");
      if (blobHash !== candidate.blobSha.toLowerCase())
        return {
          ok: false,
          error: {
            code: "invalid-evidence",
            message: "The fetched source does not match its pinned blob.",
            retryable: false,
          },
        };
      return {
        ok: true,
        value: { text, blobSha: candidate.blobSha, byteSize: bytes.length },
      };
    },
  });
  return {
    ledger,
    github,
    selectorBudget,
    cancel: () => controller.abort(),
    async prepare(input: { scope: RepositoryScope; pinnedFileIds?: string[] }) {
      if (!(await deps.authorizeRepository(input.scope.repositoryId)))
        return {
          ok: false as const,
          error: {
            code: "forbidden" as const,
            message: "Repository access is not authorized.",
            retryable: false,
          },
        };
      const snapshot = await inspector.resolveSnapshot({
        scope: {
          repositoryUrl:
            input.scope.canonicalUrl ??
            `https://github.com/${input.scope.owner}/${input.scope.name}`,
          ref: input.scope.fullSha,
          packagePath: input.scope.packagePath,
        },
        context,
      });
      if (!snapshot.ok) return snapshot;
      if (
        String(snapshot.value.repositoryId) !== input.scope.repositoryId ||
        snapshot.value.commitSha !== input.scope.fullSha
      )
        return {
          ok: false as const,
          error: {
            code: "invalid-evidence" as const,
            message: "Repository identity or revision changed.",
            retryable: false,
          },
        };
      const inventory = await inspector.inventory({
        snapshot: snapshot.value,
        context,
      });
      if (!inventory.ok) return inventory;
      const selectedPrs = await pr.readSelected({
        scope: {
          repositoryId: snapshot.value.repositoryId,
          owner: snapshot.value.owner,
          name: snapshot.value.name,
          ref: snapshot.value.ref,
          commitSha: snapshot.value.commitSha,
        },
        selectedNumbers: [...(input.scope.selectedPrNumbers ?? [])],
        context: {
          runId: deps.runId,
          signal: context.signal,
          budgetLedger: ledger,
        },
      });
      if (!selectedPrs.ok) return selectedPrs;
      const evidenceContext: EvidenceExecutionContext = {
        runId: deps.runId,
        snapshotId: snapshot.value.snapshotId,
        signal: context.signal,
        deadlineAt: new Date(context.deadline).toISOString(),
        clock: () => new Date(deps.now()),
        budgetLedger: selectorBudget,
      };
      const plan = selector.select({
        inventory: inventoryForSelector(inventory.value),
        scope: {
          ...input.scope,
          owner: snapshot.value.owner,
          name: snapshot.value.name,
        },
        prContext: {
          selectedPullRequests: selectedPrs.value.items.map((p) => ({
            number: p.number,
            title: p.titleForPrompt,
            changedPaths: p.changedPaths.map((f) => f.filename),
          })),
          partial: selectedPrs.value.partial,
        },
        pinnedFileIds: input.pinnedFileIds ?? [],
        context: evidenceContext,
      });
      if (!plan.ok) return plan;
      const prepared = await selector.pack({
        selected: plan.value,
        context: evidenceContext,
      });
      if (!prepared.ok) return prepared;
      return {
        ok: true as const,
        value: {
          snapshot: snapshot.value,
          inventory: inventory.value,
          prContext: selectedPrs.value,
          prepared: prepared.value,
          budget: ledger.snapshot(),
        },
      };
    },
  };
}
