import { createHash } from "node:crypto";
import {
  err,
  ok,
  FileCandidateSchema,
  type ExecutionContext,
  type FileCandidate,
  type PullRequestSummary,
  type RepositoryScope,
  type Result,
} from "../contracts";
import type {
  EvidenceSelectorPort,
  PrContextReaderPort,
  RepositoryInspectorPort,
  RepositorySnapshot,
  SelectionPolicyPort,
} from "../ports";
import {
  createGithubClient,
  type GithubClientDependencies,
  type GithubRequestContext,
} from "./client-core";
import {
  createRepositoryInspector,
  type GithubJsonClient,
  type RepositorySnapshot as NativeSnapshot,
} from "./repository";
import { createPrContextReader, type PrGithubClient } from "./pr-context-core";
import {
  createEvidenceSelector,
  type EvidenceDimension,
  type SelectionPlan,
} from "./selector-core";
import {
  classifyPath,
  inspectFileContent,
  getPathExclusionReason,
  type FileCandidate as NativeCandidate,
} from "./file-policy-core";
import {
  createSelectorBudget,
  createTransportBudget,
  inventoryForSelector,
  preparedSelectionForStore,
} from "./phase-one-core";
import { ledgerFor, persistRunBudget } from "./budget-port";
import { readerOperation, reportReaderFailure } from "./reader-diagnostics";

type Transport = Omit<
  GithubClientDependencies,
  "ledger" | "onAttemptSettled" | "now"
>;
export type InspectionDependencies = {
  transport(context: ExecutionContext): Transport;
  authorize(context: ExecutionContext, repositoryId: string): Promise<boolean>;
  policy: SelectionPolicyPort;
};
const categories = {
  purpose: "purpose",
  stack: "manifest",
  "core-method": "implementation",
  "product-surface": "implementation",
  corroboration: "test",
  measurement: "report",
  "ui-style": "implementation",
  helper: "implementation",
  unknown: "other",
} as const;
const nativeScope = (scope: RepositoryScope) => ({
  ...scope,
  fullSha: scope.commitSha,
  selectedPrNumbers: scope.selectedPullRequestNumbers,
  identitySource:
    scope.identitySource === "github-account"
      ? ("authenticated" as const)
      : scope.identitySource === "user-provided"
        ? ("self-declared" as const)
        : ("unknown" as const),
});
const nativeCandidate = (candidate: FileCandidate): NativeCandidate => ({
  id: candidate.id,
  path: candidate.path,
  blobSha: candidate.blobSha,
  mode: candidate.mode,
  byteSize: candidate.byteSize,
  category: classifyPath(candidate.path),
  eligibility:
    candidate.eligible && candidate.safety === "safe" ? "eligible" : "excluded",
  reasonCodes: candidate.reasonCodes,
});
const denied = () => ({
  ok: false as const,
  error: {
    code: "forbidden" as const,
    message: "Repository access is no longer authorized.",
    retryable: false,
  },
});
const invalid = (message: string) => ({
  ok: false as const,
  error: { code: "invalid-evidence" as const, message, retryable: false },
});

/** Adapt the reviewed transport, inventory, PR and selector implementations to the shared service ports. */
export function createInspectionPorts(deps: InspectionDependencies) {
  type State = {
    snapshot?: NativeSnapshot;
    scope?: RepositoryScope;
    plan?: SelectionPlan;
    candidates: Map<string, FileCandidate>;
    context: ExecutionContext;
    github: ReturnType<typeof createGithubClient>;
    checkpointStats: { calls: number; ms: number };
  };
  const states = new WeakMap<object, State>();
  function state(context: ExecutionContext): State {
    const ledger = ledgerFor(context.budget);
    let s = states.get(ledger);
    if (s) {
      s.context = context;
      return s;
    }
    const bridge = createTransportBudget(ledger);
    const checkpointStats = { calls: 0, ms: 0 };
    async function persist() {
      const started = Date.now();
      try {
        await persistRunBudget(context.budget);
      } finally {
        checkpointStats.calls++;
        checkpointStats.ms += Date.now() - started;
      }
    }
    const github = createGithubClient({
      ...deps.transport(context),
      now: () => context.now().getTime(),
      ledger: {
        async reserve(input) {
          const result = await bridge.transport.reserve(input);
          await persist();
          return result;
        },
        async commitUsage(input) {
          await bridge.transport.commitUsage(input);
          await persist();
        },
      },
      async onAttemptSettled(...input) {
        const result = await bridge.settled(...input);
        await persist();
        return result;
      },
    });
    s = { context, github, checkpointStats, candidates: new Map() };
    states.set(ledger, s);
    return s;
  }
  function requestContext(context: ExecutionContext): GithubRequestContext {
    return {
      runId: context.runId,
      signal: context.signal,
      deadline: Date.parse(context.deadline),
    };
  }
  async function allowed(context: ExecutionContext, repositoryId: string) {
    return (
      !context.signal.aborted &&
      context.access.grantedRepositoryIds.includes(repositoryId) &&
      (await deps.authorize(context, repositoryId))
    );
  }
  function inspector(context: ExecutionContext) {
    const s = state(context);
    return createRepositoryInspector<ExecutionContext>({
      client: {
        async getJson<T>(
          input: Parameters<GithubJsonClient<ExecutionContext>["getJson"]>[0],
        ) {
          if (!s.scope || !(await allowed(input.context, s.scope.repositoryId)))
            return denied();
          const before = { ...s.checkpointStats };
          const r = await s.github.getJson<T>({
            ...input,
            context: requestContext(input.context),
          });
          if (!r.ok)
            reportReaderFailure({
              runId: input.context.runId,
              operation: readerOperation(input.path),
              stage: "checkpoint-summary",
              checkpointCalls: s.checkpointStats.calls - before.calls,
              checkpointMs: s.checkpointStats.ms - before.ms,
            });
          return r.ok
            ? r.value.data === null
              ? invalid("Repository metadata was unavailable.")
              : { ok: true as const, value: { ...r.value, data: r.value.data } }
            : r;
        },
      },
    });
  }
  async function readFile(
    candidate: NativeCandidate,
    context: ExecutionContext,
  ): Promise<Result<{ text: string; blobSha: string; byteSize: number }>> {
    const s = state(context);
    if (!s.snapshot || !s.scope)
      return invalid("A pinned repository snapshot is required.");
    if (!(await allowed(context, s.scope.repositoryId))) return denied();
    const screened = getPathExclusionReason({ ...candidate });
    if (screened)
      return invalid(
        "The requested source file is excluded by the safety policy.",
      );
    const maxBytes = 65_536;
    const r = await s.github.getText({
      path: `/repos/${encodeURIComponent(s.snapshot.owner)}/${encodeURIComponent(s.snapshot.name)}/git/blobs/${candidate.blobSha}`,
      responseByteLimit: maxBytes,
      context: {
        ...requestContext(context),
        fetchedBody: { fileId: candidate.id, decodedBytes: maxBytes },
      },
    });
    if (!r.ok)
      return err({
        code: r.error.code,
        message: r.error.message,
        retryable: r.error.retryable,
      });
    if (r.value.data === null)
      return invalid("The source body was unavailable.");
    const text = r.value.data,
      bytes = Buffer.from(text, "utf8");
    const hash = createHash(candidate.blobSha.length === 64 ? "sha256" : "sha1")
      .update(`blob ${bytes.length}\0`)
      .update(bytes)
      .digest("hex");
    if (
      hash !== candidate.blobSha.toLowerCase() ||
      bytes.length > maxBytes ||
      !inspectFileContent(text, candidate.path).safe
    )
      return invalid("The source does not match its pinned safe blob.");
    return ok({ text, blobSha: candidate.blobSha, byteSize: bytes.length });
  }
  const repository: RepositoryInspectorPort = {
    async resolveSnapshot({ scope, context }) {
      const s = state(context);
      s.scope = scope;
      if (!(await allowed(context, scope.repositoryId))) return denied();
      const r = await inspector(context).resolveSnapshot({
        scope: {
          repositoryUrl: scope.canonicalUrl,
          ref: scope.commitSha,
          packagePath: scope.packagePath,
        },
        context,
      });
      if (!r.ok)
        return err({
          code: r.error.code,
          message: r.error.message,
          retryable: r.error.retryable,
        });
      if (
        String(r.value.repositoryId) !== scope.repositoryId ||
        r.value.commitSha !== scope.commitSha
      )
        return invalid("The pinned repository identity changed.");
      s.snapshot = r.value;
      return ok({
        snapshotId: r.value.snapshotId,
        repositoryId: String(r.value.repositoryId),
        commitSha: r.value.commitSha,
        treeSha: r.value.treeSha,
        observedAt: context.now().toISOString(),
        completeness: "complete",
        limitations: [],
      });
    },
    async inventory({ snapshot, context }) {
      const s = state(context);
      if (!s.snapshot || s.snapshot.snapshotId !== snapshot.snapshotId)
        return invalid("The inventory belongs to another snapshot.");
      const r = await inspector(context).inventory({
        snapshot: s.snapshot,
        context,
      });
      if (!r.ok)
        return err({
          code: r.error.code,
          message: r.error.message,
          retryable: r.error.retryable,
        });
      const candidates = inventoryForSelector(r.value).map((f) =>
        FileCandidateSchema.parse({
          id: f.id,
          path: f.path,
          blobSha: f.blobSha,
          mode: f.mode,
          byteSize: f.byteSize,
          category: categories[f.category ?? "unknown"],
          reasonCodes: f.reasonCodes ?? [],
          eligible: f.eligibility !== "excluded",
          safety: f.eligibility === "excluded" ? "blocked" : "safe",
          selected: false,
          pinned: false,
        }),
      );
      s.candidates = new Map(candidates.map((c) => [c.id, c]));
      return ok({
        candidates,
        completeness: r.value.partial ? "partial" : "complete",
        limitations: r.value.limitReasons.map(
          (reason) => `Repository inventory is partial: ${reason}.`,
        ),
      });
    },
    async readSelectedFiles({ snapshot, candidates, context }) {
      const s = state(context);
      if (!s.snapshot || s.snapshot.snapshotId !== snapshot.snapshotId)
        return invalid("A matching pinned snapshot is required.");
      const files = [];
      for (const c of candidates) {
        const r = await readFile(nativeCandidate(c), context);
        if (!r.ok)
          return err({
            code: r.error.code,
            message: r.error.message,
            retryable: r.error.retryable,
          });
        files.push({
          fileId: c.id,
          path: c.path,
          blobSha: c.blobSha,
          content: r.value.text,
        });
      }
      return ok({ files });
    },
  };
  function prs(context: ExecutionContext) {
    const s = state(context);
    const ledger = ledgerFor(context.budget);
    return createPrContextReader({
      github: {
        async getJson<T>(input: Parameters<PrGithubClient["getJson"]>[0]) {
          if (!s.scope || !(await allowed(context, s.scope.repositoryId)))
            return denied();
          const before = ledger.remaining().prHttpAttempts.used;
          const r = await s.github.getJson<T>({
            ...input,
            context: { ...requestContext(context), budgetKind: "pr-http" },
          });
          const attempts = ledger.remaining().prHttpAttempts.used - before;
          if (!r.ok) return { ...r, error: { ...r.error, attempts } };
          return r.value.data === null
            ? {
                ok: false as const,
                error: {
                  code: "upstream-error" as const,
                  message: "PR context is unavailable.",
                  retryable: false,
                },
              }
            : {
                ok: true as const,
                value: {
                  ...r.value,
                  data: r.value.data,
                  hasNextPage: Boolean(r.value.nextPage),
                  attempts,
                },
              };
        },
      },
    });
  }
  const prScope = (scope: RepositoryScope) => ({
    repositoryId: Number(scope.repositoryId),
    owner: scope.owner,
    name: scope.name,
    ref: scope.ref,
    commitSha: scope.commitSha,
  });
  const pullRequests: PrContextReaderPort = {
    async listCandidates({ scope, context }) {
      state(context).scope = scope;
      const r = await prs(context).listCandidates({
        scope: prScope(scope),
        context: {
          runId: context.runId,
          signal: context.signal,
          budgetLedger: ledgerFor(context.budget),
        },
      });
      if (!r.ok)
        return err({
          code: r.error.code,
          message: r.error.message,
          retryable: r.error.retryable,
        });
      return ok({
        candidates: r.value.items.map((p) => ({
          number: p.number,
          title: p.titleForPrompt,
          state: p.mergeState === "merged" ? "merged" : p.state,
          authorLogin: p.author.login,
          updatedAt: p.updatedAt,
          changedPaths: [],
          headSha: p.head.sha,
          baseSha: p.base.sha,
          selected: false,
        })),
        completeness: r.value.partial ? "partial" : "complete",
        limitations: r.value.limitations,
      });
    },
    async readSelected({ scope, selectedNumbers, context }) {
      state(context).scope = scope;
      const r = await prs(context).readSelected({
        scope: prScope(scope),
        selectedNumbers,
        context: {
          runId: context.runId,
          signal: context.signal,
          budgetLedger: ledgerFor(context.budget),
        },
      });
      if (!r.ok)
        return err({
          code: r.error.code,
          message: r.error.message,
          retryable: r.error.retryable,
        });
      return ok({
        selected: r.value.items.map((p) => ({
          number: p.number,
          title: p.titleForPrompt,
          state: p.mergeState === "merged" ? "merged" : p.state,
          authorLogin: p.author.login,
          updatedAt: null,
          changedPaths: p.changedPaths.map((f) => f.filename),
          headSha: p.head.sha,
          baseSha: p.base.sha,
          selected: true,
        })),
        completeness: r.value.partial ? "partial" : "complete",
        limitations: r.value.limitations,
      });
    },
  };
  function selectorFor(
    context: ExecutionContext,
    scope: RepositoryScope,
    pullRequests: PullRequestSummary[],
    contentByFileId: Record<string, string> = {},
  ) {
    const s = state(context);
    return createEvidenceSelector({
      async fetchFile({ candidate }) {
        const text = contentByFileId[candidate.id];
        return text === undefined
          ? readFile(candidate, context)
          : ok({
              text,
              blobSha: candidate.blobSha,
              byteSize: Buffer.byteLength(text),
            });
      },
      scoreCandidate(ranked) {
        const original = s.candidates.get(ranked.candidate.id);
        if (!original)
          return invalid("A ranked file is outside the inspected inventory.");
        return deps.policy.scoreCandidate({
          candidate: {
            ...original,
            selected: ranked.selectedPath,
            pinned: ranked.pinned,
          },
          scope,
          pullRequests,
        });
      },
      requiredDimensions() {
        const r = deps.policy.requiredDimensions({ scope });
        return r.ok ? ok(r.value as EvidenceDimension[]) : r;
      },
    });
  }
  function evidenceContext(context: ExecutionContext, snapshotId: string) {
    return {
      runId: context.runId,
      snapshotId,
      signal: context.signal,
      deadlineAt: context.deadline,
      clock: context.now,
      budgetLedger: createSelectorBudget(ledgerFor(context.budget)),
    };
  }
  const selector: EvidenceSelectorPort = {
    async select({
      inventory,
      scope,
      prContext,
      pinnedFileIds,
      removedFileIds,
      context,
    }) {
      const s = state(context);
      if (!s.snapshot)
        return invalid("A pinned snapshot is required before selection.");
      s.candidates = new Map(inventory.map((c) => [c.id, c]));
      const r = selectorFor(context, scope, prContext).select({
        inventory: inventory.map(nativeCandidate),
        scope: nativeScope(scope),
        prContext: {
          selectedPullRequests: prContext.map((p) => ({
            number: p.number,
            title: p.title,
            changedPaths: p.changedPaths,
          })),
        },
        pinnedFileIds,
        removedFileIds,
        context: evidenceContext(context, s.snapshot.snapshotId),
      });
      if (!r.ok)
        return err({
          code: r.error.code,
          message: r.error.message,
          retryable: r.error.retryable,
        });
      s.plan = r.value;
      return ok({
        selected: r.value.selectedFiles.map((f) => ({
          ...s.candidates.get(f.candidate.id)!,
          selected: true,
          pinned: pinnedFileIds.includes(f.candidate.id),
        })),
        limitations: r.value.limitations,
        missingDimensions: r.value.missingDimensions,
      });
    },
    async pack({
      importId,
      selectionVersion,
      scope,
      contentByFileId,
      limitations,
      context,
    }) {
      const s = state(context);
      if (!s.plan || !s.snapshot)
        return invalid("The safe selection plan is missing.");
      const r = await selectorFor(context, scope, [], contentByFileId).pack({
        selected: s.plan,
        context: evidenceContext(context, s.snapshot.snapshotId),
      });
      if (!r.ok)
        return err({
          code: r.error.code,
          message: r.error.message,
          retryable: r.error.retryable,
        });
      const prepared = preparedSelectionForStore({
        importId,
        version: selectionVersion,
        scope,
        prepared: r.value,
        ledger: ledgerFor(context.budget),
      });
      prepared.snapshot = {
        treeSha: s.snapshot.treeSha,
        observedAt: context.now().toISOString(),
        upstreamBytes: ledgerFor(context.budget).remaining().upstreamBytes.used,
        maxFetchedFileBytes: Math.max(
          0,
          ...ledgerFor(context.budget)
            .snapshot()
            .attempts.flatMap((a) =>
              (a.actual?.fetchedBodies ?? []).map((f) => f.decodedBytes),
            ),
        ),
      };
      // Destination and version bind consent even when source excerpts are identical.
      prepared.selectionHash = createHash("sha256")
        .update(
          JSON.stringify({
            hash: prepared.selectionHash,
            importId,
            selectionVersion,
            scope,
          }),
        )
        .digest("hex");
      prepared.limitations = [
        ...new Set([...prepared.limitations, ...limitations]),
      ].slice(0, 100);
      return ok(prepared);
    },
  };
  return { repository, pullRequests, selector };
}
