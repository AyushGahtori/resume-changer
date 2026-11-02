import { vi } from "vitest";
import {
  sha256,
  type FileCandidate,
  type Result,
} from "@/lib/github/server/file-policy";
import type {
  BudgetSelectionRequest,
  EvidenceExecutionContext,
  FetchedFile,
  RepositoryScope,
  SelectorBudgetLedger,
} from "@/lib/github/server/selector";

export function makeScope(
  overrides: Partial<RepositoryScope> = {},
): RepositoryScope {
  return {
    repositoryId: "repo-42",
    owner: "acme",
    name: "resume-changer",
    fullSha: "a".repeat(40),
    role: "backend engineer",
    contributionStatement: "I implemented cache invalidation and its tests.",
    ...overrides,
  };
}

export function makeCandidate(
  id: string,
  path: string,
  body: string,
  overrides: Partial<FileCandidate> = {},
): FileCandidate {
  return {
    id,
    path,
    blobSha: sha256(body).slice(0, 40),
    mode: "100644",
    byteSize: Buffer.byteLength(body, "utf8"),
    ...overrides,
  };
}

export function makeContext(
  ledger: SelectorBudgetLedger = createFakeLedger(),
  overrides: Partial<EvidenceExecutionContext> = {},
): EvidenceExecutionContext {
  return {
    runId: "run-1",
    snapshotId: "snapshot-1",
    clock: () => new Date("2026-10-26T10:00:00.000Z"),
    budgetLedger: ledger,
    ...overrides,
  };
}

export function createFakeLedger(
  options: {
    allow?: boolean;
    maxFiles?: number;
    maxLines?: number;
    maxCharacters?: number;
  } = {},
): SelectorBudgetLedger & { checkSelection: ReturnType<typeof vi.fn> } {
  return {
    checkSelection: vi.fn(
      async (
        request: BudgetSelectionRequest,
      ): Promise<
        Result<{ allowed: boolean; exhaustedDimensions?: string[] }>
      > => {
        const exceeded: string[] = [];
        if (request.files.length > (options.maxFiles ?? 12))
          exceeded.push("files");
        if (request.uniqueLineCount > (options.maxLines ?? 1_500))
          exceeded.push("lines");
        if (request.totalCharacters > (options.maxCharacters ?? 80_000))
          exceeded.push("characters");
        return {
          ok: true,
          value: {
            allowed: options.allow !== false && exceeded.length === 0,
            ...(exceeded.length ? { exhaustedDimensions: exceeded } : {}),
          },
        };
      },
    ),
  };
}

export function createFetcher(bodies: Map<string, string>) {
  const fetchFile = vi.fn(
    async ({
      candidate,
    }: {
      candidate: FileCandidate;
    }): Promise<Result<FetchedFile>> => {
      const text = bodies.get(candidate.id);
      if (text === undefined) {
        return {
          ok: false,
          error: {
            code: "unavailable",
            message: "The file is unavailable.",
            retryable: false,
          },
        };
      }
      return {
        ok: true,
        value: {
          text,
          blobSha: candidate.blobSha,
          byteSize: Buffer.byteLength(text, "utf8"),
        },
      };
    },
  );
  return fetchFile;
}
