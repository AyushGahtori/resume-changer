import type {
  BoundedReadResult,
  DiscoveryFile,
  DiscoveryInventory,
  ProjectDiscoveryInput,
} from "@/lib/github/context-discovery/contracts";

export const FIXTURE_COMMIT = "a".repeat(40);
export const FIXTURE_BLOB = "b".repeat(40);

export function makeInventory(
  paths: readonly string[],
  options: {
    packagePath?: string;
    projectTypes?: string[];
    packages?: DiscoveryInventory["packages"];
    partial?: boolean;
    unvisitedScope?: string[];
  } = {},
): DiscoveryInventory {
  const files: DiscoveryFile[] = paths.map((path) => ({
    path,
    blobSha: FIXTURE_BLOB,
    mode: "100644",
    sizeBytes: 128,
    eligibility: "automatic",
    safetyFlags: [],
    selected: false,
  }));
  return {
    snapshotId: "fixture-snapshot",
    repositoryId: 42,
    commitSha: FIXTURE_COMMIT,
    ...(options.packagePath ? { packagePath: options.packagePath } : {}),
    files,
    packages: options.packages ?? [],
    projectTypes: options.projectTypes ?? [],
    partial: options.partial,
    unvisitedScope: options.unvisitedScope,
  };
}

export function makeDiscoveryInput(
  paths: readonly string[],
  content: Record<string, string>,
  options: {
    packagePath?: string;
    projectTypes?: string[];
    packages?: DiscoveryInventory["packages"];
    partial?: boolean;
    unvisitedScope?: string[];
  } = {},
): {
  input: ProjectDiscoveryInput;
  calls: string[];
  failures: Map<string, BoundedReadResult>;
} {
  const files = new Map(
    makeInventory(paths, options).files.map((file) => [file.path, file]),
  );
  const calls: string[] = [];
  const failures = new Map<string, BoundedReadResult>();
  return {
    input: {
      repository: {
        repositoryId: 42,
        owner: "fixture-owner",
        name: "fixture-project",
        commitSha: FIXTURE_COMMIT,
      },
      inventory: makeInventory(paths, options),
      reader: {
        async read(request) {
          calls.push(request.path);
          const failure = failures.get(request.path);
          if (failure) return failure;
          const text = content[request.path];
          const file = files.get(request.path);
          if (text === undefined || !file)
            return { ok: false, reason: "not-found" };
          const bytesRead = new TextEncoder().encode(text).byteLength;
          if (bytesRead > request.maxBytes)
            return { ok: false, reason: "over-budget" };
          return {
            ok: true,
            text,
            bytesRead,
            blobSha: request.blobSha,
            truncated: false,
          };
        },
      },
    },
    calls,
    failures,
  };
}
