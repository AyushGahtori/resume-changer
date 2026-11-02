import type {
  GithubJsonResponse,
  Result,
} from "../../../../src/lib/github/server/repository";

export const ROOT_TREE_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const COMMIT_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
export const DIRECTORY_SHA = "cccccccccccccccccccccccccccccccccccccccc";
export const API_PACKAGE_SHA = "dddddddddddddddddddddddddddddddddddddddd";
export const MOBILE_PACKAGE_SHA = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
export const FILE_SHA = "ffffffffffffffffffffffffffffffffffffffff";

export interface SyntheticTreeEntry {
  path: string;
  mode: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
}

export function treePage(
  sha: string,
  tree: SyntheticTreeEntry[],
  truncated = false,
) {
  return { sha, tree, truncated };
}

export function treeDirectory(path: string, sha: string): SyntheticTreeEntry {
  return { path, mode: "040000", type: "tree", sha };
}

export function treeFile(
  path: string,
  sha = FILE_SHA,
  size = 128,
  mode = "100644",
): SyntheticTreeEntry {
  return { path, mode, type: "blob", sha, size };
}

export function repositoryMetadata(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    name: "resume-changer",
    full_name: "AyushGahtori/resume-changer",
    owner: { login: "AyushGahtori" },
    default_branch: "main",
    private: false,
    visibility: "public",
    ...overrides,
  };
}

export function commitMetadata(sha = COMMIT_SHA, treeSha = ROOT_TREE_SHA) {
  return { sha, commit: { tree: { sha: treeSha } } };
}

export function githubResponse<T>(
  data: T,
  options: { status?: number; wireBytes?: number } = {},
): Result<GithubJsonResponse<T>> {
  return {
    ok: true,
    value: {
      data,
      status: options.status ?? 200,
      wireBytes: options.wireBytes ?? 128,
    },
  };
}

export function githubFailure(
  code: "not-found" | "limit-exceeded" | "rate-limited" | "forbidden",
): Result<never> {
  return {
    ok: false,
    error: {
      code,
      message: "Synthetic transport error",
      retryable: code === "rate-limited",
    },
  };
}
