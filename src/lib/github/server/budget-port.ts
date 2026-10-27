import { randomUUID } from "node:crypto";
import {
  err,
  ok,
  type BudgetLedgerRef,
  type BudgetSnapshot as PublicSnapshot,
  type BudgetSummary as PublicSummary,
  type PreparedSelection,
} from "../contracts";
import {
  createBudgetLedger,
  type BudgetLedger,
  type BudgetMeasuredUsage,
  type BudgetSnapshot,
} from "./budget";

export const runLedger = Symbol("GitHub run ledger");
const saveLedger = Symbol("Persist GitHub run budget");
export async function persistRunBudget(budget: BudgetLedgerRef) {
  await (budget as RunBudgetPort)[saveLedger]?.();
}
export type RunBudgetPort = BudgetLedgerRef & {
  [runLedger]: BudgetLedger;
  [saveLedger]: () => Promise<void>;
};
export function ledgerFor(budget: BudgetLedgerRef): BudgetLedger {
  const ledger = (budget as RunBudgetPort)[runLedger];
  if (!ledger) throw new Error("The shared GitHub run ledger is missing.");
  return ledger;
}
export function budgetSummary(ledger: BudgetLedger): PublicSummary {
  const s = ledger.remaining();
  const requests = ledger
    .snapshot()
    .attempts.filter((a) => a.kind === "generation" || a.kind === "recovery");
  return {
    fetchedFiles: s.fetchedBodies.used,
    fetchedBytes: s.decodedBytes.used,
    httpAttempts: s.httpAttempts.used,
    selectedUniqueFiles: s.selection.filesUsed,
    selectedUniqueLines: s.selection.uniqueSourceLinesUsed,
    selectedCharacters: s.selection.charactersUsed,
    transmittedLinesByRequest: requests.map((a) =>
      a.evidence.reduce((n, e) => n + e.requestLines, 0),
    ),
    cumulativeTransmittedLines: s.selection.transmittedLineOccurrencesUsed,
    estimatedInputTokens: s.inputTokens.estimated,
    reportedInputTokens: s.inputTokens.unknown ? null : s.inputTokens.actual,
    limitReason: null,
  };
}
export function publicBudgetSnapshot(ledger: BudgetLedger): PublicSnapshot {
  const s = ledger.remaining();
  return {
    requests: s.httpAttempts.used,
    pullRequestRequests: s.prHttpAttempts.used,
    fetchedBodies: s.fetchedBodies.used,
    fetchedBytes: s.decodedBytes.used,
    uniqueFiles: s.selection.filesUsed,
    uniqueLines: s.selection.uniqueSourceLinesUsed,
    transmittedLines: s.selection.transmittedLineOccurrencesUsed,
    inputTokens:
      s.inputTokens.actual + s.inputTokens.estimated + s.inputTokens.unknown,
    generationAttempts: s.generationAttempts.used,
  };
}
export function createRunBudget(input: {
  now: () => Date;
  deadline: string;
  snapshot?: BudgetSnapshot;
  persist?: (snapshot: BudgetSnapshot) => Promise<void>;
}): RunBudgetPort {
  const ledger = createBudgetLedger({
    now: () => input.now().getTime(),
    operationDeadlineAt: input.deadline,
    snapshot: input.snapshot,
  });
  const persist = () => input.persist?.(ledger.snapshot());
  const empty: BudgetMeasuredUsage = {
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
  };
  return {
    [runLedger]: ledger,
    [saveLedger]: async () => {
      await persist();
    },
    async reserve(request) {
      const selected = request.selection;
      if (!selected?.consentedAt)
        return err({
          code: "forbidden",
          message: "Consent for the exact selected evidence is required.",
          retryable: false,
        });
      const groups = new Map<
        string,
        {
          fileId: string;
          ranges: { startLine: number; endLine: number }[];
          characters: number;
        }
      >();
      for (const e of selected.evidence) {
        const key = e.path;
        const file = groups.get(key) ?? {
          fileId: key,
          ranges: [],
          characters: 0,
        };
        if (e.pointer.kind === "lines")
          file.ranges.push({
            startLine: e.pointer.startLine,
            endLine: e.pointer.endLine,
          });
        else {
          const rows = e.excerpt.split("\n").length;
          file.ranges.push({ startLine: 1, endLine: rows });
        }
        file.characters += e.excerpt.length;
        groups.set(key, file);
      }
      const attemptId = "provider-" + randomUUID();
      const r = ledger.reserve({
        attemptId,
        kind: request.operation.endsWith("recovery")
          ? "recovery"
          : "generation",
        consent: {
          selectionHash: selected.selectionHash,
          selectionVersion: selected.version,
          confirmedAt: selected.consentedAt,
        },
        files: [...groups.values()],
        estimatedInputTokens: request.amount,
        estimatedOutputTokens: 4096,
        estimatedReasoningTokens: 2048,
      });
      if (!r.ok) return r;
      await persist();
      return ok({ reservationId: attemptId });
    },
    async commitUsage(request) {
      const u = request.providerUsage;
      const result = ledger.commitUsage(
        request.reservationId,
        u?.promptTokens !== null &&
          u?.promptTokens !== undefined &&
          u.outputTokens !== null &&
          u.reasoningTokens !== null
          ? {
              ...empty,
              inputTokens: u.promptTokens,
              cachedInputTokens: u.cachedTokens ?? 0,
              outputTokens: u.outputTokens,
              reasoningTokens: u.reasoningTokens,
            }
          : { known: false },
      );
      await persist();
      return result.ok ? ok(publicBudgetSnapshot(ledger)) : result;
    },
    checkSelection({ files, lines }) {
      return ok({
        allowed:
          Number.isSafeInteger(files) &&
          Number.isSafeInteger(lines) &&
          files >= 0 &&
          lines >= 0 &&
          files <= 12 &&
          lines <= 1500,
        reason:
          files > 12 || lines > 1500
            ? "Narrow the selected files or source lines."
            : null,
      });
    },
    remaining: () => ok(publicBudgetSnapshot(ledger)),
    snapshot: () => ok(publicBudgetSnapshot(ledger)),
  };
}

export function preparedBudget(
  prepared: PreparedSelection,
  ledger: BudgetLedger,
): PublicSummary {
  return {
    ...budgetSummary(ledger),
    selectedUniqueFiles: prepared.selectedFileIds.length,
    selectedUniqueLines: prepared.budget.selectedUniqueLines,
    selectedCharacters: prepared.budget.selectedCharacters,
  };
}
