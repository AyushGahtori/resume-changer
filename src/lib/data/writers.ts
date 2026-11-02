import { copyFile, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  AchievementPointSchema,
  AchievementSourceSchema,
  MetricSchema,
  GithubImportApprovalSchema,
  GithubRepositoryAttachmentSchema,
  GithubRepositorySnapshotSchema,
  ResumeLibraryInputSchema,
  ResumeLibraryV2Schema,
  StableIdSchema,
  type AchievementPoint,
  type GithubAchievementEvidence,
  type GithubImportApproval,
  type GithubRepositoryAttachment,
  type GithubRepositorySnapshot,
  type NormalizedResumeLibrary,
  type ResumeLibrary,
} from "../schemas/resume-data";
import { DataLoadError } from "./loaders";
import { getPersonalDataRoot } from "./root";
import { getAppMode } from "../cloud/security";
import { normalizeResumeLibrary } from "../github/server/library-migration";
import {
  AnalysisResultSchema,
  GITHUB_IMPORT_CONTRACT_VERSION,
  GITHUB_IMPORT_SELECTOR_VERSION,
  ImportRecordSchema,
  MeasurementAnswerSchema,
  MeasurementResultSchema,
  PreparedSelectionSchema,
  DraftSchema,
  err,
  ok,
  type AnalysisResult,
  type Draft,
  type ExecutionContext,
  type ImportRecord,
  type MeasurementAnswer,
  type MeasurementResult,
  type PreparedSelection,
  type Result,
} from "../github/contracts";
import type {
  ApprovalPort,
  ImportStorePort,
  MeasurementPort,
} from "../github/ports";

const UpdateChangesSchema = z
  .object({
    text: z.string().trim().min(1).optional(),
    tags: z.array(z.string().trim().min(1)).optional(),
    skillIds: z.array(StableIdSchema).optional(),
    metrics: z.array(MetricSchema).optional(),
    source: AchievementSourceSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((changes) => Object.keys(changes).length > 0, {
    message: "Provide at least one field to update.",
  });

export const CreateAchievementInputSchema = z
  .object({
    parentType: z.enum(["job", "project"]),
    parentId: StableIdSchema,
    point: AchievementPointSchema,
  })
  .strict();

export const UpdateAchievementInputSchema = z
  .object({ changes: UpdateChangesSchema })
  .strict();

const ImportedAchievementUpdateSchema = z
  .object({
    achievementId: StableIdSchema,
    expectedVersion: z.number().int().positive(),
    text: z.string().trim().min(1).max(4_000),
  })
  .strict();

export type CreateAchievementInput = z.infer<
  typeof CreateAchievementInputSchema
>;
export type UpdateAchievementInput = z.infer<
  typeof UpdateAchievementInputSchema
>;

export class LibraryWriteError extends Error {
  constructor(
    readonly code:
      | "not-found"
      | "locked"
      | "invalid-library"
      | "io-error"
      | "version-conflict"
      | "forbidden"
      | "needs-context"
      | "invalid-evidence"
      | "invalid-input"
      | "cancelled",
    message: string,
  ) {
    super(message);
    this.name = "LibraryWriteError";
  }
}

type WriteOptions = {
  rootDir?: string;
  renameFile?: typeof rename;
};

const ApprovalCommandSchema = z
  .object({
    importId: StableIdSchema,
    expectedVersion: z.number().int().positive(),
    selectedDraftIds: z.array(StableIdSchema).min(1).max(8),
    idempotencyKey: z.string().trim().min(1).max(256),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      new Set(input.selectedDraftIds).size !== input.selectedDraftIds.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["selectedDraftIds"],
        message: "A draft can be selected only once.",
      });
    }
  });

const ReviewedMeasurementSchema = z
  .object({
    draftId: StableIdSchema,
    answer: MeasurementAnswerSchema,
    baseline: MeasurementAnswerSchema.optional(),
    result: MeasurementResultSchema,
    confirmedAt: z.iso.datetime().refine((value) => value.endsWith("Z")),
    origin: z.literal("local-review").optional(),
  })
  .strict();

const ApprovalArtifactsSchema = z
  .object({
    preparedRef: z.string().regex(/^[a-f0-9]{64}$/i),
    resultRef: z.string().regex(/^[a-f0-9]{64}$/i),
    prepared: PreparedSelectionSchema,
    result: AnalysisResultSchema,
    snapshot: z
      .object({
        treeSha: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i),
        inspectedAt: z.iso.datetime().refine((value) => value.endsWith("Z")),
        budgetsUsed: GithubRepositorySnapshotSchema.shape.budgetsUsed,
      })
      .strict(),
    measurements: z.array(ReviewedMeasurementSchema).max(40),
    contributionRole: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export type GithubApprovalArtifacts = z.infer<typeof ApprovalArtifactsSchema>;

export type GithubApprovalReviewResolver = (
  record: ImportRecord,
  context: ExecutionContext,
) => Promise<Result<GithubApprovalArtifacts>>;

export type GithubApprovalPortDependencies = {
  store: Pick<ImportStorePort, "get">;
  resolveReview: GithubApprovalReviewResolver;
  measurements: MeasurementPort;
  now?: () => Date;
  id?: () => string;
  /** Test seam for exercising atomic rename failures with a temporary root. */
  renameFile?: typeof rename;
};

function getPoint(library: ResumeLibrary, pointId: string) {
  return [
    ...library.jobs.flatMap((job) => job.points),
    ...library.projects.flatMap((project) => project.points),
  ].find((point) => point.id === pointId);
}

async function readPersonalLibrary(rootDir: string) {
  try {
    const contents = await readFile(
      join(rootDir, "data", "resume-library.json"),
      "utf8",
    );
    const parsed: unknown = JSON.parse(contents);
    const result = ResumeLibraryInputSchema.safeParse(parsed);
    if (!result.success) {
      throw new LibraryWriteError(
        "invalid-library",
        "The saved library no longer matches its schema. Correct the data before editing.",
      );
    }
    try {
      return normalizeResumeLibrary(result.data);
    } catch {
      throw new LibraryWriteError(
        "invalid-library",
        "The saved library could not be safely migrated. Correct the data before editing.",
      );
    }
  } catch (error) {
    if (error instanceof LibraryWriteError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || error instanceof SyntaxError) {
      throw new DataLoadError(
        code === "ENOENT" ? "missing-file" : "invalid-json",
        "data/resume-library.json",
      );
    }
    throw new LibraryWriteError("io-error", "The library could not be read.");
  }
}

async function saveLibrary(
  library: NormalizedResumeLibrary,
  rootDir: string,
  renameFile: typeof rename = rename,
) {
  const target = join(rootDir, "data", "resume-library.json");
  const directory = dirname(target);
  const backup = `${target}.bak`;
  const nonce = randomUUID();
  const temporary = join(directory, `.resume-library-${nonce}.tmp`);
  const backupTemporary = join(directory, `.resume-library-${nonce}.bak.tmp`);
  await mkdir(directory, { recursive: true });

  try {
    const file = await open(temporary, "wx");
    try {
      await file.writeFile(`${JSON.stringify(library, null, 2)}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }

    await copyFile(target, backupTemporary);
    await rm(backup, { force: true });
    await renameFile(backupTemporary, backup);
    await renameFile(temporary, target);
  } catch {
    throw new LibraryWriteError(
      "io-error",
      "The library could not be saved. The existing data was left unchanged; try again.",
    );
  } finally {
    await rm(temporary, { force: true });
    await rm(backupTemporary, { force: true });
  }
}

type LibraryMutation<T> = {
  library: NormalizedResumeLibrary;
  value: T;
  persist: boolean;
};

async function commitLibraryMutation<T>(
  change: (library: NormalizedResumeLibrary) => LibraryMutation<T>,
  options: WriteOptions = {},
): Promise<{ library: NormalizedResumeLibrary; value: T }> {
  if (getAppMode() === "firebase") {
    if (options.rootDir !== undefined)
      throw new Error("Hosted account writes cannot use a filesystem root.");
    const { changeCloudLibrary } = await import("../cloud/library-store");
    let value!: T;
    const library = await changeCloudLibrary((current) => {
      const mutation = change(normalizeResumeLibrary(current));
      value = mutation.value;
      return ResumeLibraryV2Schema.parse(mutation.library);
    });
    return { library: normalizeResumeLibrary(library), value };
  }
  const rootDir = getPersonalDataRoot(options.rootDir);
  const lockPath = join(rootDir, "data", "resume-library.json.lock");
  await mkdir(dirname(lockPath), { recursive: true });
  let lock;
  try {
    lock = await open(lockPath, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new LibraryWriteError(
        "locked",
        "Another library save is in progress. Wait a moment and try again.",
      );
    }
    throw new LibraryWriteError("io-error", "The library could not be saved.");
  }

  try {
    const library = await readPersonalLibrary(rootDir);
    const mutation = change(library);
    const result = ResumeLibraryV2Schema.safeParse(mutation.library);
    if (!result.success) {
      throw new LibraryWriteError(
        "invalid-library",
        "This change conflicts with the library data. Check IDs, skills, and metrics.",
      );
    }
    if (mutation.persist)
      await saveLibrary(result.data, rootDir, options.renameFile);
    return { library: result.data, value: mutation.value };
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}

async function commitPointChange(
  change: (library: NormalizedResumeLibrary) => NormalizedResumeLibrary,
  options: WriteOptions = {},
) {
  const result = await commitLibraryMutation(
    (library) => ({
      library: change(library),
      value: undefined,
      persist: true,
    }),
    options,
  );
  return result.library;
}

export async function createAchievementPoint(
  input: CreateAchievementInput,
  options?: WriteOptions,
) {
  const parsed = CreateAchievementInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new LibraryWriteError(
      "invalid-library",
      "The achievement data is invalid.",
    );
  }

  let created: AchievementPoint | undefined;
  const library = await commitPointChange((current) => {
    const collection =
      parsed.data.parentType === "job" ? current.jobs : current.projects;
    const parent = collection.find((item) => item.id === parsed.data.parentId);
    if (!parent) {
      throw new LibraryWriteError(
        "not-found",
        "The selected job or project was not found.",
      );
    }
    created = parsed.data.point;
    return {
      ...current,
      [parsed.data.parentType === "job" ? "jobs" : "projects"]: collection.map(
        (item) =>
          item.id === parsed.data.parentId
            ? { ...item, points: [...item.points, parsed.data.point] }
            : item,
      ),
    };
  }, options);
  return { library, point: created! };
}

export async function updateAchievementPoint(
  pointId: string,
  input: UpdateAchievementInput,
  options?: WriteOptions,
) {
  const parsedId = StableIdSchema.safeParse(pointId);
  const parsedInput = UpdateAchievementInputSchema.safeParse(input);
  if (!parsedId.success || !parsedInput.success) {
    throw new LibraryWriteError(
      "invalid-library",
      "The achievement update is invalid.",
    );
  }

  let updated: AchievementPoint | undefined;
  const library = await commitPointChange((current) => {
    if (!getPoint(current, parsedId.data)) {
      throw new LibraryWriteError(
        "not-found",
        "The achievement point was not found.",
      );
    }
    const update = <T extends { points: AchievementPoint[] }>(items: T[]) =>
      items.map((item) => ({
        ...item,
        points: item.points.map((point) => {
          if (point.id !== parsedId.data) return point;
          updated = { ...point, ...parsedInput.data.changes };
          return updated;
        }),
      }));
    return {
      ...current,
      jobs: update(current.jobs),
      projects: update(current.projects),
    };
  }, options);
  return { library, point: updated! };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function collectEntityIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectEntityIds);
  if (!value || typeof value !== "object") return [];
  const entries = Object.entries(value);
  return [
    ...(typeof (value as { id?: unknown }).id === "string"
      ? [(value as { id: string }).id]
      : []),
    ...entries
      .filter(([key]) => key !== "id")
      .flatMap(([, item]) => collectEntityIds(item)),
  ];
}

function approvalKeyPrefix(idempotencyKey: string) {
  return `github:${sha256(idempotencyKey)}:`;
}

function approvalPayloadHash(input: z.infer<typeof ApprovalCommandSchema>) {
  return sha256(
    canonical({
      importId: input.importId,
      expectedVersion: input.expectedVersion,
      selectedDraftIds: [...input.selectedDraftIds].sort(),
    }),
  );
}

function getPriorApprovalIds(
  library: NormalizedResumeLibrary,
  input: z.infer<typeof ApprovalCommandSchema>,
): string[] | null {
  const prefix = approvalKeyPrefix(input.idempotencyKey);
  const matches = library.githubImportApprovals.filter((approval) =>
    approval.idempotencyKey.startsWith(prefix),
  );
  if (matches.length === 0) return null;

  const expectedKeys = new Set(
    input.selectedDraftIds.map((draftId) => `${prefix}${sha256(draftId)}`),
  );
  const expectedPayloadHash = approvalPayloadHash(input);
  if (
    matches.length !== expectedKeys.size ||
    matches.some(
      (approval) =>
        !expectedKeys.has(approval.idempotencyKey) ||
        approval.importId !== input.importId ||
        approval.payloadHash !== expectedPayloadHash ||
        approval.approvedAchievements.length !== 1,
    )
  ) {
    throw new LibraryWriteError(
      "version-conflict",
      "This approval key was already used for a different reviewed selection.",
    );
  }

  const byDraftId = new Map(
    matches.map((approval) => [approval.draftId, approval]),
  );
  if (
    input.selectedDraftIds.some((draftId) => !byDraftId.has(draftId)) ||
    new Set(matches.map((approval) => approval.draftId)).size !== matches.length
  ) {
    throw new LibraryWriteError(
      "version-conflict",
      "This approval key was already used for a different reviewed selection.",
    );
  }

  return input.selectedDraftIds.map(
    (draftId) => byDraftId.get(draftId)!.approvedAchievements[0].achievementId,
  );
}

function approvalDomainError(error: unknown) {
  if (error instanceof LibraryWriteError) {
    const code =
      error.code === "locked"
        ? "version-conflict"
        : error.code === "invalid-library"
          ? "invalid-input"
          : error.code === "not-found"
            ? "not-found"
            : error.code === "forbidden"
              ? "forbidden"
              : error.code === "needs-context"
                ? "needs-context"
                : error.code === "invalid-evidence"
                  ? "invalid-evidence"
                  : error.code === "cancelled"
                    ? "cancelled"
                    : error.code === "invalid-input"
                      ? "invalid-input"
                      : error.code === "version-conflict"
                        ? "version-conflict"
                        : "io-error";
    return {
      code,
      message: error.message,
      retryable: error.code === "locked" || error.code === "io-error",
    } as const;
  }
  if (error instanceof DataLoadError) {
    return {
      code: error.code === "missing-file" ? "not-found" : "io-error",
      message:
        error.code === "missing-file"
          ? "The personal library is not available for approval."
          : "The personal library could not be read safely.",
      retryable: false,
    } as const;
  }
  return {
    code: "io-error" as const,
    message: "The reviewed achievements could not be saved.",
    retryable: true,
  };
}

function approvalWriteOptions(
  context: ExecutionContext,
  dependencies: GithubApprovalPortDependencies,
): WriteOptions {
  return {
    ...(getAppMode() === "firebase" ? {} : { rootDir: context.personalRoot }),
    ...(dependencies.renameFile ? { renameFile: dependencies.renameFile } : {}),
  };
}

function assertApprovalContext(context: ExecutionContext) {
  if (context.signal.aborted)
    throw new LibraryWriteError("cancelled", "The approval was cancelled.");
  if (
    !context.access.sessionId.trim() ||
    !context.access.authorizationNamespace.trim() ||
    !context.personalRoot.trim()
  )
    throw new LibraryWriteError(
      "forbidden",
      "An authorized personal workspace is required.",
    );
  const now = context.now();
  if (!Number.isFinite(now.getTime()))
    throw new LibraryWriteError(
      "io-error",
      "A valid server clock is required.",
    );
}

function buildReviewDrafts(
  record: ImportRecord,
  result: AnalysisResult,
  measurements: GithubApprovalArtifacts["measurements"],
) {
  const edits = new Map(record.draftEdits.map((edit) => [edit.draftId, edit]));
  const baseDrafts = new Map(result.drafts.map((draft) => [draft.id, draft]));
  for (const [draftId, edit] of edits) {
    const base = baseDrafts.get(draftId);
    if (!base || sha256(canonical(base)) !== edit.baseResultHash)
      throw new LibraryWriteError(
        "version-conflict",
        "A reviewed draft no longer matches its saved analysis version.",
      );
  }
  const drafts = result.drafts.map((base) => {
    const edit = edits.get(base.id);
    const metricResultIds = [
      ...new Set([
        ...base.metricResultIds,
        ...measurements
          .filter((m) => m.origin === "local-review" && m.draftId === base.id)
          .map((m) => m.result.id),
      ]),
    ];
    if (
      edit?.confirmedMetricResultIds.some((id) => !metricResultIds.includes(id))
    )
      throw new LibraryWriteError(
        "invalid-evidence",
        "A confirmed measurement is outside this reviewed draft.",
      );
    const eligible = Boolean(
      edit?.selectedForSave &&
      edit.contributionConfirmed &&
      (base.supportStatus === "supported" ||
        base.supportStatus === "partial") &&
      edit.confirmedMetricResultIds.every((id) => metricResultIds.includes(id)),
    );
    return DraftSchema.parse({
      ...base,
      metricResultIds,
      approvalEligible: eligible,
      approvalErrors: eligible ? [] : base.approvalErrors,
      ...(edit
        ? {
            version: edit.version,
            text: edit.text,
            selectedForSave: edit.selectedForSave,
            contributionConfirmed: edit.contributionConfirmed,
          }
        : {}),
    });
  });
  return { drafts, edits };
}

function assertNoUnverifiedNumbers(text: string, approvedClauses: string[]) {
  let remainder = text;
  for (const clause of approvedClauses) {
    if (!clause || !remainder.includes(clause))
      throw new LibraryWriteError(
        "invalid-evidence",
        "The reviewed text does not contain the exact locally rendered measurement clause.",
      );
    remainder = remainder.replace(clause, " ");
  }
  remainder = remainder
    .replace(
      /\b(?:node(?:\.js)?|python|react|next(?:\.js)?|typescript|java|go|rust|oauth|http|https|version|v)\s*v?\d+(?:\.\d+){0,3}\b/giu,
      " ",
    )
    .replace(/\b\d{4}-(?:0[1-9]|1[0-2])(?:-[0-3]\d)?\b/gu, " ");
  if (/\d/u.test(remainder)) {
    throw new LibraryWriteError(
      "invalid-evidence",
      "Numbers in an achievement need a confirmed, supported measurement or a recognizable version/date context.",
    );
  }
}

function validateReviewBinding(
  input: z.infer<typeof ApprovalCommandSchema>,
  record: ImportRecord,
  artifacts: GithubApprovalArtifacts,
  context: ExecutionContext,
  now: Date,
) {
  const importRecord = ImportRecordSchema.parse(record);
  const prepared = PreparedSelectionSchema.parse(artifacts.prepared);
  const result = AnalysisResultSchema.parse(artifacts.result);
  const authorizationNamespaceHash = sha256(
    context.access.authorizationNamespace,
  );
  if (
    importRecord.id !== input.importId ||
    importRecord.version !== input.expectedVersion ||
    importRecord.authorizationNamespaceHash !== authorizationNamespaceHash ||
    !context.access.grantedRepositoryIds.includes(
      importRecord.scope.repositoryId,
    )
  )
    throw new LibraryWriteError(
      "version-conflict",
      "This import changed or is no longer authorized. Reload the review before saving.",
    );
  if (importRecord.source !== "personal")
    throw new LibraryWriteError(
      "forbidden",
      "Demo imports cannot be saved to a personal library.",
    );
  if (
    importRecord.lifecycle !== "ready-to-review" ||
    importRecord.activeRunId !== null
  )
    throw new LibraryWriteError(
      "version-conflict",
      "This import is not in a completed review state.",
    );
  if (Date.parse(importRecord.retentionDeadline) <= now.getTime())
    throw new LibraryWriteError(
      "version-conflict",
      "This reviewed import expired. Prepare and review it again before saving.",
    );
  if (
    !importRecord.consent ||
    !importRecord.selectionHash ||
    importRecord.selectionHash !== importRecord.consent.selectionHash ||
    importRecord.selectionVersion !== importRecord.consent.selectionVersion ||
    importRecord.preparedSelectionRef !== artifacts.preparedRef ||
    importRecord.resultRef !== artifacts.resultRef ||
    prepared.importId !== importRecord.id ||
    prepared.version !== importRecord.selectionVersion ||
    prepared.selectionHash !== importRecord.selectionHash ||
    prepared.consentedAt !== importRecord.consent.consentedAt ||
    result.selectionHash !== importRecord.selectionHash ||
    canonical(prepared.scope) !== canonical(importRecord.scope)
  )
    throw new LibraryWriteError(
      "version-conflict",
      "The reviewed evidence or consent no longer matches this import.",
    );
  if (
    new Set(importRecord.draftRefs).size !== importRecord.draftRefs.length ||
    new Set(result.drafts.map((draft) => draft.id)).size !==
      result.drafts.length ||
    canonical([...importRecord.draftRefs].sort()) !==
      canonical(result.drafts.map((draft) => draft.id).sort())
  )
    throw new LibraryWriteError(
      "invalid-evidence",
      "The reviewed drafts do not match the stored analysis result.",
    );
  const { drafts, edits } = buildReviewDrafts(
    importRecord,
    result,
    artifacts.measurements,
  );
  if (
    edits.size !== importRecord.draftEdits.length ||
    [...edits.keys()].some((id) => !importRecord.draftRefs.includes(id))
  )
    throw new LibraryWriteError(
      "invalid-evidence",
      "A reviewed edit does not belong to this analysis result.",
    );
  const selectedInStore = [...edits.values()]
    .filter((edit) => edit.selectedForSave)
    .map((edit) => edit.draftId)
    .sort();
  if (
    canonical(selectedInStore) !== canonical([...input.selectedDraftIds].sort())
  )
    throw new LibraryWriteError(
      "version-conflict",
      "The selected drafts changed. Reload the review and save the current selection.",
    );

  const evidenceById = new Map(
    prepared.evidence.map((evidence) => [evidence.id, evidence]),
  );
  if (evidenceById.size !== prepared.evidence.length)
    throw new LibraryWriteError(
      "invalid-evidence",
      "Evidence IDs are duplicated.",
    );
  for (const evidence of prepared.evidence) {
    if (
      evidence.commitSha !== importRecord.scope.commitSha ||
      sha256(evidence.excerpt) !== evidence.excerptSha256.toLowerCase()
    )
      throw new LibraryWriteError(
        "invalid-evidence",
        "A selected source excerpt is outside the reviewed revision or failed its integrity check.",
      );
  }

  const claimById = new Map(result.claims.map((claim) => [claim.id, claim]));
  if (claimById.size !== result.claims.length)
    throw new LibraryWriteError(
      "invalid-evidence",
      "Claim IDs are duplicated.",
    );
  for (const draft of drafts) {
    for (const claimId of draft.claimIds) {
      const claim = claimById.get(claimId);
      if (!claim)
        throw new LibraryWriteError(
          "invalid-evidence",
          "A reviewed draft refers to an unknown claim.",
        );
      if (claim.classification === "inferred")
        throw new LibraryWriteError(
          "needs-context",
          "An inferred claim needs direct source evidence or user clarification before approval.",
        );
      if (
        claim.evidenceIds.some((id) => !evidenceById.has(id)) ||
        (!claim.evidenceIds.length && !claim.userStatementIds.length)
      )
        throw new LibraryWriteError(
          "invalid-evidence",
          "A reviewed claim refers to evidence that is not in the consented selection.",
        );
      if (
        claim.classification === "user-provided" &&
        (!claim.userStatementIds.length ||
          !importRecord.scope.contributionStatement.trim())
      )
        throw new LibraryWriteError(
          "needs-context",
          "A user-provided claim needs the contribution statement that supports it.",
        );
      if (
        claim.evidenceIds.some(
          (evidenceId) =>
            evidenceById.get(evidenceId)?.classification === "inferred",
        )
      )
        throw new LibraryWriteError(
          "needs-context",
          "Inferred repository evidence cannot support a personal achievement.",
        );
    }
  }
  return { prepared, result, drafts, edits, evidenceById, claimById };
}

function metricToLibraryPoint(input: {
  result: MeasurementResult;
  clause: string;
  metricId: string;
}) {
  const value =
    input.result.derivedQuantity ?? input.result.normalizedValues[0];
  return MetricSchema.parse({
    id: input.metricId,
    label: input.result.definitionId,
    value: String(value),
    unit: input.result.normalizedUnit,
    context: Object.keys(input.result.context).length
      ? canonical(input.result.context)
      : undefined,
    evidence: input.clause,
  });
}

function makeEvidenceRecord(
  source: PreparedSelection["evidence"][number],
  id: string,
  snapshotId: string,
) {
  return {
    id,
    snapshotId,
    commitSha: source.commitSha,
    path: source.path,
    blobSha: source.blobSha,
    kind: source.pointer.kind === "lines" ? "file-excerpt" : "report-field",
    ...(source.pointer.kind === "lines"
      ? {
          lineStart: source.pointer.startLine,
          lineEnd: source.pointer.endLine,
        }
      : { fieldPointer: source.pointer.fields.join(".") }),
    excerpt: source.excerpt,
    excerptHash: source.excerptSha256,
    category:
      source.category === "purpose" || source.category === "manifest"
        ? "configuration"
        : source.category === "implementation"
          ? "implementation"
          : source.category === "test"
            ? "test"
            : source.category === "report"
              ? "report"
              : source.category === "documentation"
                ? "documentation"
                : "other",
    classification: source.classification,
  } as const;
}

function makeSnapshot(input: {
  id: string;
  record: ImportRecord;
  prepared: PreparedSelection;
  evidence: PreparedSelection["evidence"];
  artifacts: GithubApprovalArtifacts;
}): GithubRepositorySnapshot {
  const scopePaths = [...new Set(input.evidence.map((item) => item.path))];
  if (!scopePaths.length || scopePaths.length > 16)
    throw new LibraryWriteError(
      "invalid-evidence",
      "The approved source scope must contain between one and sixteen evidenced files.",
    );
  return GithubRepositorySnapshotSchema.parse({
    id: input.id,
    repositoryId: Number(input.record.scope.repositoryId),
    commitSha: input.record.scope.commitSha,
    treeSha: input.artifacts.snapshot.treeSha,
    inspectedAt: input.artifacts.snapshot.inspectedAt,
    scopePaths,
    pullRequestNumbers: input.record.scope.selectedPullRequestNumbers,
    selectorVersion: GITHUB_IMPORT_SELECTOR_VERSION,
    schemaVersion: GITHUB_IMPORT_CONTRACT_VERSION,
    budgetsUsed: input.artifacts.snapshot.budgetsUsed,
    complete: input.prepared.completeness === "complete",
    limitations: input.prepared.limitations.slice(0, 30),
  });
}

function ensureRepositoryAttachment(input: {
  library: NormalizedResumeLibrary;
  projectId: string;
  record: ImportRecord;
  snapshot: GithubRepositorySnapshot;
  attachmentId: string;
}): {
  library: NormalizedResumeLibrary;
  attachment: GithubRepositoryAttachment;
} {
  const project = input.library.projects.find(
    (item) => item.id === input.projectId,
  );
  if (!project)
    throw new LibraryWriteError(
      "version-conflict",
      "The destination project changed or was removed before approval.",
    );
  const repositoryId = Number(input.record.scope.repositoryId);
  if (!Number.isSafeInteger(repositoryId) || repositoryId <= 0)
    throw new LibraryWriteError(
      "invalid-evidence",
      "The selected repository identity is invalid.",
    );
  const existing = project.repositoryAttachments.find(
    (attachment) => attachment.repositoryId === repositoryId,
  );
  const duplicateSnapshot = existing?.snapshots.find(
    (snapshot) =>
      snapshot.commitSha === input.snapshot.commitSha &&
      snapshot.treeSha === input.snapshot.treeSha &&
      canonical(snapshot.scopePaths) === canonical(input.snapshot.scopePaths) &&
      canonical(snapshot.pullRequestNumbers) ===
        canonical(input.snapshot.pullRequestNumbers),
  );
  const snapshot = duplicateSnapshot ?? input.snapshot;
  let attachment: GithubRepositoryAttachment;
  if (existing) {
    const snapshots = duplicateSnapshot
      ? existing.snapshots
      : [...existing.snapshots, snapshot];
    if (snapshots.length > 100)
      throw new LibraryWriteError(
        "invalid-evidence",
        "This project already has the maximum number of saved repository snapshots.",
      );
    attachment = GithubRepositoryAttachmentSchema.parse({
      ...existing,
      owner: input.record.scope.owner,
      name: input.record.scope.name,
      url: input.record.scope.canonicalUrl,
      visibility: input.record.scope.visibility,
      selectedRef: input.record.scope.ref,
      latestSnapshotId: snapshot.id,
      snapshots,
    });
  } else {
    attachment = GithubRepositoryAttachmentSchema.parse({
      id: input.attachmentId,
      projectId: project.id,
      repositoryId,
      owner: input.record.scope.owner,
      name: input.record.scope.name,
      url: input.record.scope.canonicalUrl,
      visibility: input.record.scope.visibility,
      selectedRef: input.record.scope.ref,
      latestSnapshotId: snapshot.id,
      snapshots: [snapshot],
    });
  }
  const nextProject = {
    ...project,
    repositoryAttachments: existing
      ? project.repositoryAttachments.map((item) =>
          item.id === existing.id ? attachment : item,
        )
      : [...project.repositoryAttachments, attachment],
  };
  const nextLibrary = {
    ...input.library,
    projects: input.library.projects.map((item) =>
      item.id === project.id ? nextProject : item,
    ),
  };
  return { library: ResumeLibraryV2Schema.parse(nextLibrary), attachment };
}

function buildApprovedPoint(input: {
  draft: Draft;
  edit: ImportRecord["draftEdits"][number];
  record: ImportRecord;
  prepared: PreparedSelection;
  result: AnalysisResult;
  evidenceById: Map<string, PreparedSelection["evidence"][number]>;
  claimById: Map<string, AnalysisResult["claims"][number]>;
  measurementReviews: GithubApprovalArtifacts["measurements"];
  measurements: MeasurementPort;
  contributionRole?: string;
  projectRole?: string;
  attachmentId: string;
  snapshotId: string;
  id: () => string;
}): {
  point: AchievementPoint;
  approval: GithubImportApproval;
} {
  if (
    !input.edit ||
    input.edit.version !== input.draft.version ||
    !input.edit.selectedForSave ||
    !input.edit.contributionConfirmed ||
    !input.draft.approvalEligible ||
    !["supported", "partial"].includes(input.draft.supportStatus) ||
    input.draft.approvalErrors.length > 0 ||
    input.draft.projectId !== input.record.destinationProjectId
  )
    throw new LibraryWriteError(
      "needs-context",
      "Confirm this supported draft and its contribution before saving.",
    );

  const selectedClaims = input.draft.claimIds.map((claimId) => {
    const claim = input.claimById.get(claimId);
    if (!claim)
      throw new LibraryWriteError(
        "invalid-evidence",
        "A selected draft refers to a claim that is no longer available.",
      );
    return claim;
  });
  const measurementsById = new Map(
    input.measurementReviews.map((measurement) => [
      measurement.result.id,
      measurement,
    ]),
  );
  if (measurementsById.size !== input.measurementReviews.length)
    throw new LibraryWriteError(
      "invalid-evidence",
      "Measurement result IDs are duplicated.",
    );

  const selectedMeasurementIds = input.edit.confirmedMetricResultIds;
  if (
    selectedMeasurementIds.some(
      (id) => !input.draft.metricResultIds.includes(id),
    )
  )
    throw new LibraryWriteError(
      "invalid-evidence",
      "A confirmed measurement is not part of this reviewed draft.",
    );

  const computedMetrics: Array<{
    result: MeasurementResult;
    clause: string;
    answer: MeasurementAnswer;
    confirmedAt: string;
  }> = [];
  for (const resultId of selectedMeasurementIds) {
    const stored = measurementsById.get(resultId);
    if (
      !stored ||
      stored.draftId !== input.draft.id ||
      !stored.result.confirmed
    )
      throw new LibraryWriteError(
        "needs-context",
        "A selected measurement needs a current confirmation for this draft.",
      );
    const answer = MeasurementAnswerSchema.parse(stored.answer);
    const { answerHash, ...answerPayload } = answer;
    if (sha256(canonical(answerPayload)) !== answerHash)
      throw new LibraryWriteError(
        "version-conflict",
        "A reviewed measurement answer failed its integrity check.",
      );
    const answerValidation = input.measurements.validateMeasurementAnswer({
      answer,
      expectedVersion: answer.version,
    });
    if (!answerValidation.ok)
      throw new LibraryWriteError(
        answerValidation.error.code === "needs-context"
          ? "needs-context"
          : "invalid-evidence",
        answerValidation.error.message,
      );
    if (canonical(answerValidation.value) !== canonical(answer))
      throw new LibraryWriteError(
        "version-conflict",
        "A measurement answer changed after review. Reopen its preview before saving.",
      );
    const derived = input.measurements.deriveMeasurementResult({
      answer,
      ...(stored.baseline ? { baseline: stored.baseline } : {}),
    });
    if (!derived.ok)
      throw new LibraryWriteError(
        derived.error.code === "needs-context"
          ? "needs-context"
          : "invalid-evidence",
        derived.error.message,
      );
    if (!derived.value)
      throw new LibraryWriteError(
        "needs-context",
        "A selected measurement no longer produces an eligible result.",
      );
    const current = MeasurementResultSchema.parse(derived.value);
    const storedComparable = { ...stored.result, confirmed: false };
    const currentComparable = { ...current, confirmed: false };
    if (
      current.id !== resultId ||
      current.definitionId !== stored.result.definitionId ||
      canonical(currentComparable) !== canonical(storedComparable) ||
      current.version !== answer.version
    )
      throw new LibraryWriteError(
        "version-conflict",
        "A measurement changed after review. Reopen its preview before saving.",
      );
    if (
      !["result", "report"].includes(answer.mode) ||
      !["measured", "user-attested"].includes(answer.attestation) ||
      !["measured", "user-attested"].includes(current.evidenceStatus) ||
      answer.definitionId !== current.definitionId ||
      (answer.sourceEvidenceIds.length === 0 &&
        !(
          stored.origin === "local-review" &&
          answer.attestation === "user-attested" &&
          answer.context.sourceDescription?.trim()
        ))
    )
      throw new LibraryWriteError(
        "invalid-evidence",
        "Only a measured or explicitly user-attested result can be saved as a metric.",
      );
    const evidence = answer.sourceEvidenceIds.map((id) => {
      const source = input.evidenceById.get(id);
      if (!source)
        throw new LibraryWriteError(
          "invalid-evidence",
          "A measurement refers to evidence outside the consented selection.",
        );
      return source;
    });
    if (
      current.evidenceStatus === "measured" &&
      !evidence.some((item) => item.classification === "observed")
    )
      throw new LibraryWriteError(
        "invalid-evidence",
        "Measured results require observed source evidence.",
      );
    const rendered = input.measurements.renderMetricClause({ result: current });
    if (!rendered.ok)
      throw new LibraryWriteError("invalid-evidence", rendered.error.message);
    if (rendered.value.previewHash !== stored.result.previewHash)
      throw new LibraryWriteError(
        "version-conflict",
        "The measurement wording changed after review.",
      );
    computedMetrics.push({
      result: current,
      clause: rendered.value.clause,
      answer,
      confirmedAt: stored.confirmedAt,
    });
  }

  const metricClauses = computedMetrics.map((metric) => metric.clause);
  assertNoUnverifiedNumbers(input.draft.text, metricClauses);

  const referencedEvidenceIds = new Set<string>();
  for (const claim of selectedClaims) {
    claim.evidenceIds.forEach((id) => referencedEvidenceIds.add(id));
  }
  computedMetrics.forEach((measurement) => {
    measurement.answer.sourceEvidenceIds.forEach((id) =>
      referencedEvidenceIds.add(id),
    );
  });
  const sourceEvidence = [...referencedEvidenceIds].map((id) => {
    const item = input.evidenceById.get(id);
    if (!item)
      throw new LibraryWriteError(
        "invalid-evidence",
        "A selected claim refers to evidence outside the consented selection.",
      );
    return item;
  });
  if (sourceEvidence.length === 0)
    throw new LibraryWriteError(
      "invalid-evidence",
      "A GitHub achievement needs at least one selected source excerpt.",
    );
  if (sourceEvidence.length > 100)
    throw new LibraryWriteError(
      "invalid-evidence",
      "The reviewed achievement references too many source excerpts.",
    );
  if (new Set(sourceEvidence.map((item) => item.path)).size > 16)
    throw new LibraryWriteError(
      "invalid-evidence",
      "The reviewed achievement references more files than one repository snapshot can preserve.",
    );
  if (input.draft.text.length > 4_000)
    throw new LibraryWriteError(
      "invalid-input",
      "The reviewed achievement is too long to save to the library.",
    );

  const contributionId = StableIdSchema.parse(input.id());
  const evidenceIdMap = new Map(
    sourceEvidence.map((item) => [item.id, StableIdSchema.parse(input.id())]),
  );
  const claimIdMap = new Map(
    selectedClaims.map((claim) => [claim.id, StableIdSchema.parse(input.id())]),
  );
  const metricIdMap = new Map(
    computedMetrics.map((measurement) => [
      measurement.result.id,
      StableIdSchema.parse(input.id()),
    ]),
  );
  const snapshotId = StableIdSchema.parse(input.snapshotId);
  const attachmentId = StableIdSchema.parse(input.attachmentId);
  const contribution = {
    id: contributionId,
    role: input.contributionRole ?? input.projectRole ?? "Project contributor",
    statement: input.record.scope.contributionStatement,
    selectedPaths: [...new Set(sourceEvidence.map((item) => item.path))],
    selectedCommitShas: [input.record.scope.commitSha],
    identitySource: "self-declared" as const,
    confirmed: true as const,
    confirmedAt: input.edit.updatedAt,
    version: input.edit.version,
  };
  const claims = selectedClaims.map((claim) => ({
    id: claimIdMap.get(claim.id)!,
    text: claim.text,
    evidenceIds: claim.evidenceIds.map((id) => evidenceIdMap.get(id)!),
    ...(claim.userStatementIds.length ? { contributionId } : {}),
    classification: claim.classification,
    scope: `${input.record.scope.owner}/${input.record.scope.name}@${input.record.scope.commitSha}`,
    limitations: claim.limitations.slice(0, 20),
  }));
  const evidence = sourceEvidence.map((item) =>
    makeEvidenceRecord(item, evidenceIdMap.get(item.id)!, snapshotId),
  );
  const metrics = computedMetrics.map((metric) =>
    metricToLibraryPoint({
      result: metric.result,
      clause: metric.clause,
      metricId: metricIdMap.get(metric.result.id)!,
    }),
  );
  const confirmedMetrics = computedMetrics.map((metric) => ({
    metricId: metricIdMap.get(metric.result.id)!,
    evidenceIds: metric.answer.sourceEvidenceIds.map((id) =>
      evidenceIdMap.get(id)!,
    ),
    status: metric.result.evidenceStatus as "measured" | "user-attested",
    context: Object.keys(metric.result.context).length
      ? canonical(metric.result.context)
      : undefined,
    confirmed: true as const,
    confirmedAt: metric.confirmedAt,
    confirmationVersion: input.edit.version,
  }));
  const githubEvidence: GithubAchievementEvidence = {
    repositoryAttachmentId: attachmentId,
    snapshotId,
    contribution,
    claims,
    evidence,
    confirmedMetrics,
  };
  const point = AchievementPointSchema.parse({
    id: StableIdSchema.parse(input.id()),
    text: input.draft.text,
    tags: [],
    skillIds: [],
    metrics,
    source: {
      type: "github-repository",
      label: `${input.record.scope.owner}/${input.record.scope.name}`,
      reference: input.record.scope.canonicalUrl,
    },
    enabled: true,
    githubEvidence,
  });
  return {
    point,
    approval: GithubImportApprovalSchema.parse({
      id: StableIdSchema.parse(input.id()),
      importId: input.record.id,
      projectId: input.record.destinationProjectId,
      draftId: input.draft.id,
      draftVersion: input.edit.version,
      draftTextHash: sha256(input.draft.text),
      payloadHash: "0".repeat(64),
      idempotencyKey: "pending",
      approvedAt: input.edit.updatedAt,
      approvedAchievements: [
        {
          achievementId: point.id,
          text: point.text,
          metricIds: point.metrics.map((metric) => metric.id),
        },
      ],
    }),
  };
}

export function createGithubApprovalPort(
  dependencies: GithubApprovalPortDependencies,
): ApprovalPort {
  const id = dependencies.id ?? randomUUID;
  const now = dependencies.now ?? (() => new Date());
  const writeOptions = approvalWriteOptions;

  return {
    async approveGithubImport(rawInput, context) {
      try {
        assertApprovalContext(context);
        const input = ApprovalCommandSchema.parse(rawInput);
        const options = writeOptions(context, dependencies);
        const prior = await commitLibraryMutation(
          (library) => ({
            library,
            value: getPriorApprovalIds(library, input),
            persist: false,
          }),
          options,
        );
        if (prior.value) return ok({ savedIds: prior.value });

        const stored = await dependencies.store.get(
          { id: input.importId },
          context,
        );
        if (!stored.ok) return stored;
        const record = ImportRecordSchema.parse(stored.value);
        const artifactsResult = await dependencies.resolveReview(
          record,
          context,
        );
        if (!artifactsResult.ok) return artifactsResult;
        const artifacts = ApprovalArtifactsSchema.parse(artifactsResult.value);
        const timestamp = now();
        if (!Number.isFinite(timestamp.getTime()))
          throw new LibraryWriteError(
            "io-error",
            "A valid server clock is required.",
          );
        const bound = validateReviewBinding(
          input,
          record,
          artifacts,
          context,
          timestamp,
        );
        if (Date.parse(artifacts.snapshot.inspectedAt) > timestamp.getTime())
          throw new LibraryWriteError(
            "invalid-evidence",
            "The selected repository snapshot has an invalid inspection time.",
          );

        const draftById = new Map(
          bound.drafts.map((draft) => [draft.id, draft]),
        );
        const editById = bound.edits;
        const selectedDrafts = input.selectedDraftIds.map((draftId) => {
          const draft = draftById.get(draftId);
          const edit = editById.get(draftId);
          if (!draft || !edit)
            throw new LibraryWriteError(
              "invalid-evidence",
              "A selected draft is no longer available for review.",
            );
          return { draft, edit };
        });

        const snapshotId = StableIdSchema.parse(id());
        const attachmentId = StableIdSchema.parse(id());
        const pointParts = selectedDrafts.map(({ draft, edit }) =>
          buildApprovedPoint({
            draft,
            edit,
            record,
            prepared: bound.prepared,
            result: bound.result,
            evidenceById: bound.evidenceById,
            claimById: bound.claimById,
            measurementReviews: artifacts.measurements,
            measurements: dependencies.measurements,
            contributionRole: artifacts.contributionRole,
            snapshotId,
            attachmentId,
            id,
          }),
        );
        const requestPayloadHash = approvalPayloadHash(input);
        const keyPrefix = approvalKeyPrefix(input.idempotencyKey);
        const approvalRecords = pointParts.map(({ approval }, index) =>
          GithubImportApprovalSchema.parse({
            ...approval,
            payloadHash: requestPayloadHash,
            idempotencyKey: `${keyPrefix}${sha256(selectedDrafts[index].draft.id)}`,
            approvedAt: timestamp.toISOString(),
          }),
        );
        const snapshot = makeSnapshot({
          id: snapshotId,
          record,
          prepared: bound.prepared,
          evidence: bound.prepared.evidence,
          artifacts,
        });

        const committed = await commitLibraryMutation((current) => {
          const retried = getPriorApprovalIds(current, input);
          if (retried)
            return { library: current, value: retried, persist: false };
          const project = current.projects.find(
            (item) => item.id === record.destinationProjectId,
          );
          if (!project)
            throw new LibraryWriteError(
              "version-conflict",
              "The destination project changed or was removed before approval.",
            );
          if (
            current.githubImportApprovals.some(
              (approval) =>
                approval.importId === record.id &&
                input.selectedDraftIds.includes(approval.draftId),
            )
          )
            throw new LibraryWriteError(
              "version-conflict",
              "A selected draft has already been saved under another approval key.",
            );
          const usedIds = new Set(collectEntityIds(current));
          const generatedIds = [
            ...pointParts.map(({ point }) => point.id),
            ...approvalRecords.map((approval) => approval.id),
            ...pointParts.flatMap(({ point }) => [
              point.githubEvidence!.contribution.id,
              ...point.githubEvidence!.claims.map((claim) => claim.id),
              ...point.githubEvidence!.evidence.map((item) => item.id),
              ...point.metrics.map((metric) => metric.id),
            ]),
            ...(!project.repositoryAttachments.some(
              (attachment) =>
                attachment.repositoryId === Number(record.scope.repositoryId),
            )
              ? [attachmentId]
              : []),
            ...(!project.repositoryAttachments
              .find(
                (attachment) =>
                  attachment.repositoryId === Number(record.scope.repositoryId),
              )
              ?.snapshots.some(
                (saved) =>
                  saved.commitSha === snapshot.commitSha &&
                  saved.treeSha === snapshot.treeSha &&
                  canonical(saved.scopePaths) ===
                    canonical(snapshot.scopePaths) &&
                  canonical(saved.pullRequestNumbers) ===
                    canonical(snapshot.pullRequestNumbers),
              )
              ? [snapshotId]
              : []),
          ];
          if (
            new Set(generatedIds).size !== generatedIds.length ||
            generatedIds.some((generatedId) => usedIds.has(generatedId))
          )
            throw new LibraryWriteError(
              "invalid-library",
              "The approval generated an ID already present in the library. Retry with a fresh review.",
            );

          const attachmentResult = ensureRepositoryAttachment({
            library: current,
            projectId: record.destinationProjectId,
            record,
            snapshot,
            attachmentId,
          });
          const savedSnapshot = attachmentResult.attachment.snapshots.find(
            (saved) =>
              saved.id === attachmentResult.attachment.latestSnapshotId,
          );
          if (!savedSnapshot)
            throw new LibraryWriteError(
              "invalid-library",
              "The repository snapshot could not be attached to the destination project.",
            );
          const savedPoints = pointParts.map(({ point }) =>
            AchievementPointSchema.parse({
              ...point,
              githubEvidence: {
                ...point.githubEvidence!,
                repositoryAttachmentId: attachmentResult.attachment.id,
                snapshotId: savedSnapshot.id,
                evidence: point.githubEvidence!.evidence.map((item) => {
                  const { excerpt: _source, ...reference } = item;
                  return { ...reference, snapshotId: savedSnapshot.id };
                }),
              },
            }),
          );
          const pointsByProject = attachmentResult.library.projects.map(
            (item) =>
              item.id === record.destinationProjectId
                ? {
                    ...item,
                    points: [...item.points, ...savedPoints],
                  }
                : item,
          );
          const next = ResumeLibraryV2Schema.parse({
            ...attachmentResult.library,
            projects: pointsByProject,
            githubImportApprovals: [
              ...current.githubImportApprovals,
              ...approvalRecords,
            ],
          });
          return {
            library: next,
            value: savedPoints.map((point) => point.id),
            persist: true,
          };
        }, options);
        return ok({ savedIds: committed.value });
      } catch (error) {
        return err(approvalDomainError(error));
      }
    },

    async updateImportedAchievement(rawInput, context) {
      try {
        assertApprovalContext(context);
        const input = ImportedAchievementUpdateSchema.parse(rawInput);
        const options = writeOptions(context, dependencies);
        const committed = await commitLibraryMutation((current) => {
          let projectId: string | undefined;
          let currentPoint: AchievementPoint | undefined;
          for (const project of current.projects) {
            const found = project.points.find(
              (point) => point.id === input.achievementId,
            );
            if (found) {
              projectId = project.id;
              currentPoint = found;
              break;
            }
          }
          if (
            !currentPoint ||
            currentPoint.source.type !== "github-repository" ||
            !currentPoint.githubEvidence ||
            !projectId
          )
            throw new LibraryWriteError(
              "not-found",
              "The imported achievement was not found.",
            );
          const linkedApprovals = current.githubImportApprovals.filter(
            (approval) =>
              approval.projectId === projectId &&
              approval.approvedAchievements.some(
                (item) => item.achievementId === input.achievementId,
              ),
          );
          if (
            !linkedApprovals.length ||
            linkedApprovals.some(
              (approval) => approval.draftVersion !== input.expectedVersion,
            )
          )
            throw new LibraryWriteError(
              "version-conflict",
              "This imported achievement changed. Reload it before editing.",
            );
          if (input.text === currentPoint.text)
            return {
              library: current,
              value: {
                achievementId: input.achievementId,
                version: input.expectedVersion,
              },
              persist: false,
            };
          if (!input.text.includes(currentPoint.text))
            throw new LibraryWriteError(
              "needs-context",
              "A reviewed enrichment must preserve the existing achievement text and its source-backed facts.",
            );
          assertNoUnverifiedNumbers(
            input.text,
            currentPoint.metrics.map((metric) => metric.evidence),
          );
          const point = { ...currentPoint, text: input.text };
          const nextApprovals = current.githubImportApprovals.map(
            (approval) => {
              if (!linkedApprovals.some((linked) => linked.id === approval.id))
                return approval;
              return GithubImportApprovalSchema.parse({
                ...approval,
                draftVersion: input.expectedVersion + 1,
                draftTextHash: sha256(input.text),
                approvedAchievements: approval.approvedAchievements.map(
                  (item) =>
                    item.achievementId === input.achievementId
                      ? { ...item, text: input.text }
                      : item,
                ),
              });
            },
          );
          const next = ResumeLibraryV2Schema.parse({
            ...current,
            projects: current.projects.map((project) =>
              project.id === projectId
                ? {
                    ...project,
                    points: project.points.map((item) =>
                      item.id === input.achievementId ? point : item,
                    ),
                  }
                : project,
            ),
            githubImportApprovals: nextApprovals,
          });
          return {
            library: next,
            value: {
              achievementId: input.achievementId,
              version: input.expectedVersion + 1,
            },
            persist: true,
          };
        }, options);
        return ok(committed.value);
      } catch (error) {
        return err(approvalDomainError(error));
      }
    },
  };
}
