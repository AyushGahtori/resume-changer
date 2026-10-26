import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DataLoadError,
  loadResumeLibrary,
} from "../../../../src/lib/data/loaders";
import {
  ResumeLibraryV1Schema,
  ResumeLibraryV2Schema,
  type NormalizedResumeLibrary,
} from "../../../../src/lib/schemas/resume-data";
import {
  migrateResumeLibraryV1ToV2,
  normalizeResumeLibrary,
} from "../../../../src/lib/github/server/library-migration";

const v1FixturePath = join(
  process.cwd(),
  "tests",
  "fixtures",
  "github",
  "task-01",
  "library-v1.json",
);
const temporaryRoots: string[] = [];

async function readV1Fixture() {
  return ResumeLibraryV1Schema.parse(
    JSON.parse(await readFile(v1FixturePath, "utf8")),
  );
}

async function makeValidV2Library(): Promise<NormalizedResumeLibrary> {
  const library = migrateResumeLibraryV1ToV2(await readV1Fixture());
  const project = library.projects[0];
  const point = project.points[0];
  const commitSha = "a".repeat(40);
  const snapshotId = "snapshot-synthetic-1";
  const evidenceId = "evidence-synthetic-1";
  const contributionId = "contribution-synthetic-1";

  project.repositoryAttachments = [
    {
      id: "repository-attachment-synthetic",
      projectId: project.id,
      repositoryId: 1_234_567,
      owner: "synthetic-owner",
      name: "synthetic-repository",
      url: "https://github.com/synthetic-owner/synthetic-repository",
      visibility: "public",
      selectedRef: "main",
      latestSnapshotId: snapshotId,
      snapshots: [
        {
          id: snapshotId,
          repositoryId: 1_234_567,
          commitSha,
          treeSha: "b".repeat(40),
          inspectedAt: "2026-10-26T12:00:00.000Z",
          scopePaths: ["src/service.ts"],
          pullRequestNumbers: [12],
          selectorVersion: "selector-v1",
          schemaVersion: 1,
          budgetsUsed: {
            filesFetched: 1,
            maxFetchedFileBytes: 300,
            decodedBytes: 300,
            upstreamBytes: 600,
            httpAttempts: 2,
            selectedFiles: 1,
            selectedCharacters: 40,
            maxSelectedFileCharacters: 40,
            maxRequestLines: 20,
            maxRequestFileLines: 20,
            uniqueLines: 20,
            transmittedLines: 20,
            maxRequestInputTokens: 100,
            reportedInputTokens: null,
            estimatedInputTokens: null,
          },
          complete: true,
          limitations: [],
        },
      ],
    },
  ];
  point.source = { type: "github-repository", label: "GitHub repository" };
  point.githubEvidence = {
    repositoryAttachmentId: "repository-attachment-synthetic",
    snapshotId,
    contribution: {
      id: contributionId,
      role: "Backend developer",
      statement: "I implemented the response-time optimization.",
      selectedPaths: ["src/service.ts"],
      selectedCommitShas: [commitSha],
      identitySource: "self-declared",
      confirmed: true,
      confirmedAt: "2026-10-26T12:10:00.000Z",
      version: 1,
    },
    claims: [
      {
        id: "claim-synthetic-1",
        text: point.text,
        evidenceIds: [evidenceId],
        contributionId,
        classification: "observed",
        limitations: [],
      },
    ],
    evidence: [
      {
        id: evidenceId,
        snapshotId,
        commitSha,
        path: "src/service.ts",
        blobSha: "c".repeat(40),
        kind: "file-excerpt",
        lineStart: 10,
        lineEnd: 20,
        excerpt: "export function optimizeResponse() {}",
        excerptHash: "d".repeat(64),
        category: "implementation",
        classification: "observed",
      },
    ],
    confirmedMetrics: [
      {
        metricId: point.metrics[0].id,
        evidenceIds: [evidenceId],
        status: "measured",
        context: "Synthetic benchmark run",
        confirmed: true,
        confirmedAt: "2026-10-26T12:11:00.000Z",
        confirmationVersion: 1,
      },
    ],
  };
  library.githubImportApprovals = [
    {
      id: "approval-synthetic-1",
      importId: "import-synthetic-1",
      projectId: project.id,
      draftId: "draft-synthetic-1",
      draftVersion: 1,
      draftTextHash: "e".repeat(64),
      payloadHash: "f".repeat(64),
      idempotencyKey: "synthetic-idempotency-key-1",
      approvedAt: "2026-10-26T12:12:00.000Z",
      approvedAchievements: [
        {
          achievementId: point.id,
          text: point.text,
          metricIds: point.metrics.map((metric) => metric.id),
        },
      ],
    },
  ];
  return library;
}

async function createTemporaryRoot() {
  const rootDir = await mkdtemp(join(tmpdir(), "github-task-01-"));
  temporaryRoots.push(rootDir);
  return rootDir;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((rootDir) => rm(rootDir, { recursive: true, force: true })),
  );
});

describe("GitHub library schema migration", () => {
  it("normalizes v1 without changing existing facts or adding inferred values", async () => {
    const original = await readV1Fixture();
    const originalBytes = JSON.stringify(original);
    const migrated = migrateResumeLibraryV1ToV2(original);
    const project = migrated.projects[0];
    const point = project.points[0];

    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.profile).toEqual(original.profile);
    expect(migrated.skills).toEqual(original.skills);
    expect(migrated.credentials).toEqual(original.credentials);
    expect(migrated.preferences).toEqual(original.preferences);
    expect(migrated.jobs).toEqual(
      original.jobs.map((job) => ({
        ...job,
        points: job.points.map((item) => ({ ...item, githubEvidence: null })),
      })),
    );
    expect(project.url).toBe("https://demo.example/project-home");
    expect(project).toMatchObject({
      name: "Synthetic Project",
      role: "Project maintainer",
      description: "Historical synthetic project description.",
      startDate: "2021-05",
      endDate: "2021-11",
    });
    expect(project.repositoryAttachments).toEqual([]);
    expect(point).toMatchObject({
      id: "achievement-synthetic",
      enabled: false,
      context: "Historical synthetic context",
      skillIds: ["skill-typescript"],
      metrics: [
        {
          id: "metric-synthetic-response-time",
          value: "120",
          unit: "ms",
          evidence:
            "The synthetic benchmark records 120 ms lower response time.",
        },
      ],
      githubEvidence: null,
    });
    expect(migrated.githubImportApprovals).toEqual([]);
    expect(JSON.stringify(original)).toBe(originalBytes);
  });

  it("is idempotent when a normalized v2 value is normalized again", async () => {
    const once = migrateResumeLibraryV1ToV2(await readV1Fixture());
    const twice = normalizeResumeLibrary(once);

    expect(twice).toEqual(once);
  });

  it("accepts and round-trips a source-backed v2 achievement", async () => {
    const library = await makeValidV2Library();
    const parsed = ResumeLibraryV2Schema.parse(
      JSON.parse(JSON.stringify(library)),
    );

    expect(parsed).toEqual(library);
    expect(parsed.projects[0].url).toBe("https://demo.example/project-home");
    expect(
      parsed.githubImportApprovals[0].approvedAchievements[0],
    ).toMatchObject({
      achievementId: "achievement-synthetic",
      text: library.projects[0].points[0].text,
      metricIds: ["metric-synthetic-response-time"],
    });
  });

  it("defaults omitted optional GitHub fields and permits an empty metric list", async () => {
    const v1 = await readV1Fixture();
    const v2Input = migrateResumeLibraryV1ToV2(v1);
    const point = v2Input.projects[0].points[0];
    point.metrics = [];
    const input = structuredClone(v2Input) as Record<string, unknown>;
    const projects = input.projects as Array<Record<string, unknown>>;
    const project = projects[0];
    delete project.repositoryAttachments;
    delete (project.points as Array<Record<string, unknown>>)[0].githubEvidence;
    delete input.githubImportApprovals;

    const parsed = ResumeLibraryV2Schema.parse(input);

    expect(parsed.projects[0].repositoryAttachments).toEqual([]);
    expect(parsed.projects[0].points[0].githubEvidence).toBeNull();
    expect(parsed.projects[0].points[0].metrics).toEqual([]);
    expect(parsed.githubImportApprovals).toEqual([]);
  });

  it("rejects duplicate entity and metric IDs", async () => {
    const library = await makeValidV2Library();
    library.projects[0].points[0].githubEvidence!.evidence[0].id =
      library.projects[0].points[0].metrics[0].id;

    expect(ResumeLibraryV2Schema.safeParse(library).success).toBe(false);

    const duplicateMetricLibrary = await makeValidV2Library();
    duplicateMetricLibrary.projects[0].points[0].metrics.push({
      ...duplicateMetricLibrary.projects[0].points[0].metrics[0],
    });
    expect(
      ResumeLibraryV2Schema.safeParse(duplicateMetricLibrary).success,
    ).toBe(false);
  });

  it("rejects unknown skills, evidence references, and unsafe paths", async () => {
    const unknownSkill = await makeValidV2Library();
    unknownSkill.projects[0].points[0].skillIds = ["skill-not-in-library"];
    const unknownSkillResult = ResumeLibraryV2Schema.safeParse(unknownSkill);
    expect(unknownSkillResult.success).toBe(false);
    if (!unknownSkillResult.success) {
      expect(
        unknownSkillResult.error.issues.some((issue) =>
          issue.message.includes("Unknown skill ID"),
        ),
      ).toBe(true);
    }

    const unknownEvidence = await makeValidV2Library();
    unknownEvidence.projects[0].points[0].githubEvidence!.confirmedMetrics[0].evidenceIds =
      ["evidence-missing"];
    const unknownEvidenceResult =
      ResumeLibraryV2Schema.safeParse(unknownEvidence);
    expect(unknownEvidenceResult.success).toBe(false);
    if (!unknownEvidenceResult.success) {
      expect(
        unknownEvidenceResult.error.issues.some((issue) =>
          issue.message.includes("Unknown metric evidence ID"),
        ),
      ).toBe(true);
    }

    const unsafePath = await makeValidV2Library();
    unsafePath.projects[0].points[0].githubEvidence!.evidence[0].path =
      "../../outside.txt";
    expect(ResumeLibraryV2Schema.safeParse(unsafePath).success).toBe(false);
  });

  it("rejects provenance that does not belong to its project attachment and snapshot", async () => {
    const library = await makeValidV2Library();
    library.projects[0].points[0].githubEvidence!.snapshotId =
      "snapshot-not-on-attachment";

    const result = ResumeLibraryV2Schema.safeParse(library);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) =>
          issue.message.includes("snapshot on its attachment"),
        ),
      ).toBe(true);
    }
  });

  it("rejects credential-bearing repository URLs", async () => {
    const library = await makeValidV2Library();
    library.projects[0].repositoryAttachments[0].url =
      "https://user:token@github.com/synthetic-owner/synthetic-repository";

    expect(ResumeLibraryV2Schema.safeParse(library).success).toBe(false);
  });

  it("rejects GitHub achievements whose metrics lack confirmed evidence", async () => {
    const library = await makeValidV2Library();
    library.projects[0].points[0].githubEvidence!.confirmedMetrics = [];

    const result = ResumeLibraryV2Schema.safeParse(library);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) =>
          issue.message.includes("requires confirmed GitHub evidence"),
        ),
      ).toBe(true);
    }
  });
});

describe("resume library loader compatibility", () => {
  it("reads v1 without rewriting its bytes", async () => {
    const rootDir = await createTemporaryRoot();
    const filePath = join(rootDir, "data", "resume-library.json");
    await mkdir(dirname(filePath), { recursive: true });
    const originalBytes = await readFile(v1FixturePath, "utf8");
    await writeFile(filePath, originalBytes, "utf8");

    const library = await loadResumeLibrary({ rootDir });

    expect(library.schemaVersion).toBe(2);
    expect(await readFile(filePath, "utf8")).toBe(originalBytes);
  });

  it("returns an actionable error for unsupported versions without demo fallback", async () => {
    const rootDir = await createTemporaryRoot();
    const filePath = join(rootDir, "data", "resume-library.json");
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify({ schemaVersion: 99 }), "utf8");

    await expect(loadResumeLibrary({ rootDir })).rejects.toMatchObject({
      code: "unsupported-version",
      dataPath: "data/resume-library.json",
      message: expect.stringContaining("Supported versions are 1 and 2"),
    });
  });

  it("reports malformed supported data through schema paths", async () => {
    const rootDir = await createTemporaryRoot();
    const filePath = join(rootDir, "data", "resume-library.json");
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      JSON.stringify({ ...(await readV1Fixture()), profile: { id: "broken" } }),
      "utf8",
    );

    await expect(loadResumeLibrary({ rootDir })).rejects.toBeInstanceOf(
      DataLoadError,
    );
    await expect(loadResumeLibrary({ rootDir })).rejects.toMatchObject({
      code: "invalid-schema",
      issues: expect.arrayContaining([
        expect.objectContaining({ path: expect.stringContaining("profile") }),
      ]),
    });
  });
});
