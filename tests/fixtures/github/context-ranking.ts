import type {
  EvidenceRole,
  ProjectMap,
  ScreenedSection,
} from "@/lib/github/context-ranking";

export const DEMO_REPOSITORY = {
  repositoryId: "fixture:resume-changer",
  commitSha: "a".repeat(40),
} as const;

export function projectMap(
  paths: readonly string[],
  overrides: Partial<ProjectMap> = {},
): ProjectMap {
  return {
    repository: DEMO_REPOSITORY,
    featureAreas: [
      { id: "resume-generation", status: "confirmed" },
      { id: "web-interface", status: "confirmed" },
      { id: "model-training", status: "suggested" },
    ],
    packageBoundaries: [{ root: "", entrypoints: [] }],
    aliases: [],
    knownPaths: paths,
    ...overrides,
  };
}

export function section(
  id: string,
  path: string,
  excerpt: string,
  options: Partial<ScreenedSection> & { role?: EvidenceRole } = {},
): ScreenedSection {
  return {
    id,
    path,
    lineStart: 1,
    lineEnd: excerpt.split(/\r?\n/).length,
    excerpt,
    role: options.role ?? "implementation",
    featureTargets: [],
    provenance: {
      ...DEMO_REPOSITORY,
      blobSha: `blob-${id}`,
      status: "observed",
    },
    safety: { eligible: true, screening: "safe" },
    ...options,
  };
}

export function substantialSource(label: string): string {
  return [
    `export function ${label}Pipeline(input: unknown) {`,
    "  const parsed = parseInput(input);",
    "  if (!parsed) throw new Error('invalid input');",
    "  const records = parsed.records.map((record) => transformRecord(record));",
    "  const validated = records.filter((record) => validateRecord(record));",
    "  for (const record of validated) {",
    "    await processRecord(record);",
    "  }",
    "  return generateOutput(validated);",
    "}",
    ...Array.from(
      { length: 48 },
      (_, index) => `// bounded synthetic detail ${index + 1}`,
    ),
  ].join("\n");
}
