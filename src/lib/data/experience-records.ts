import { z } from "zod";
import {
  JobV2Schema,
  ProjectV2Schema,
  type JobV2,
  type NormalizedResumeLibrary,
  type ProjectV2,
} from "../schemas/resume-data";
import {
  LibraryWriteError,
  collectEntityIds,
  commitLibraryMutation,
  currentYearMonth,
  parentIdForName,
  type WriteOptions,
} from "./writers";

const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const yearMonthHint = `Use YYYY-MM, for example ${currentYearMonth()}.`;
const END_ORDER = "Use an end date on or after the start date.";
const JOB_END_REQUIRED = "Enter an end date or mark this job as current.";

const EMPLOYMENT_TYPES = [
  "full-time",
  "part-time",
  "contract",
  "internship",
  "freelance",
  "other",
] as const;

const employmentTypeSchema = z.enum(
  EMPLOYMENT_TYPES,
  "Enter a valid employment type.",
);

/**
 * Ids, bullets, and repository attachments are chosen by the server.
 * A client value for any of them is discarded before validation.
 */
function withoutClientControl(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = { ...(value as Record<string, unknown>) };
  delete record.id;
  delete record.kind;
  delete record.points;
  delete record.repositoryAttachments;
  return record;
}

const requiredText = (message: string) =>
  z.string({ error: message }).trim().min(1, message);

const clearableText = (message: string) =>
  z.string({ error: message }).trim().nullable().optional();

const clearableMonth = z
  .union([
    z.string({ error: yearMonthHint }).trim().regex(YEAR_MONTH, yearMonthHint),
    z.literal(""),
    z.null(),
  ])
  .optional();

const clearableUrl = z
  .string({ error: "Enter a valid URL." })
  .trim()
  .nullable()
  .optional()
  .refine(
    (value) =>
      value == null || value.length === 0 || z.url().safeParse(value).success,
    "Enter a valid URL.",
  );

function inputError(issues: { message: string }[], fallback: string) {
  const friendly = issues.find((issue) =>
    /^(Enter |Use |Check )/.test(issue.message),
  );
  if (friendly) return friendly.message;
  if (
    issues.some((issue) =>
      issue.message.includes(
        "End date must be the same as or later than start date.",
      ),
    )
  ) {
    return END_ORDER;
  }
  return fallback;
}

function throwInput(issues: { message: string }[], fallback: string): never {
  throw new LibraryWriteError("invalid-input", inputError(issues, fallback));
}

function endIsBeforeStart(start?: string | null, end?: string | null) {
  return Boolean(start && end && end < start);
}

function definedText(value: string | null | undefined) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function monthValue(value: string | null | undefined) {
  return typeof value === "string" && YEAR_MONTH.test(value)
    ? value
    : undefined;
}

const createJobFields = {
  company: requiredText("Enter an employer."),
  title: requiredText("Enter a job title."),
  employmentType: employmentTypeSchema.default("full-time"),
  location: clearableText("Enter a location."),
  startDate: z
    .string({ error: yearMonthHint })
    .trim()
    .regex(YEAR_MONTH, yearMonthHint),
  endDate: clearableMonth,
  description: clearableText("Enter a description."),
  currentlyEmployed: z
    .boolean({ error: "Check whether you currently work here." })
    .default(false),
};

const createProjectFields = {
  name: requiredText("Enter a project name."),
  role: clearableText("Enter a role."),
  url: clearableUrl,
  description: clearableText("Enter a description."),
  startDate: clearableMonth,
  endDate: clearableMonth,
  ongoing: z
    .boolean({ error: "Check whether this project is ongoing." })
    .optional(),
};

type DateIssueContext = {
  addIssue: (issue: {
    code: "custom";
    path: string[];
    message: string;
  }) => void;
};

function refineJobCreate(
  value: {
    currentlyEmployed?: boolean;
    startDate?: string;
    endDate?: string | null;
  },
  context: DateIssueContext,
) {
  if (value.currentlyEmployed) return;
  const end = monthValue(value.endDate);
  if (!end) {
    context.addIssue({
      code: "custom",
      path: ["endDate"],
      message: JOB_END_REQUIRED,
    });
    return;
  }
  if (endIsBeforeStart(value.startDate, end)) {
    context.addIssue({
      code: "custom",
      path: ["endDate"],
      message: END_ORDER,
    });
  }
}

/**
 * A partial job update may omit the end date. Null still means current,
 * unless the caller said they are no longer employed there.
 */
function refineJobUpdate(
  value: {
    currentlyEmployed?: boolean;
    startDate?: string;
    endDate?: string | null;
  },
  context: DateIssueContext,
) {
  if (value.currentlyEmployed === true) return;
  const end = monthValue(value.endDate);
  if (
    value.currentlyEmployed === false &&
    Object.hasOwn(value, "endDate") &&
    !end
  ) {
    context.addIssue({
      code: "custom",
      path: ["endDate"],
      message: JOB_END_REQUIRED,
    });
    return;
  }
  if (endIsBeforeStart(value.startDate, end)) {
    context.addIssue({
      code: "custom",
      path: ["endDate"],
      message: END_ORDER,
    });
  }
}

function refineProjectDates(
  value: {
    ongoing?: boolean;
    startDate?: string | null;
    endDate?: string | null;
  },
  context: DateIssueContext,
) {
  if (value.ongoing) return;
  if (
    endIsBeforeStart(monthValue(value.startDate), monthValue(value.endDate))
  ) {
    context.addIssue({
      code: "custom",
      path: ["endDate"],
      message: END_ORDER,
    });
  }
}

export const CreateJobInputSchema = z.preprocess(
  withoutClientControl,
  z.object(createJobFields).strict().superRefine(refineJobCreate),
);

export const CreateProjectInputSchema = z.preprocess(
  withoutClientControl,
  z.object(createProjectFields).strict().superRefine(refineProjectDates),
);

export const UpdateJobInputSchema = z.preprocess(
  withoutClientControl,
  z
    .object({
      company: requiredText("Enter an employer.").optional(),
      title: requiredText("Enter a job title.").optional(),
      employmentType: employmentTypeSchema.optional(),
      location: clearableText("Enter a location."),
      startDate: z
        .string({ error: yearMonthHint })
        .trim()
        .regex(YEAR_MONTH, yearMonthHint)
        .optional(),
      endDate: clearableMonth,
      description: clearableText("Enter a description."),
      currentlyEmployed: z
        .boolean({ error: "Check whether you currently work here." })
        .optional(),
    })
    .strict()
    .superRefine(refineJobUpdate)
    .refine((value) => Object.keys(value).length > 0, {
      message: "Enter a change to save.",
    }),
);

export const UpdateProjectInputSchema = z.preprocess(
  withoutClientControl,
  z
    .object({
      name: requiredText("Enter a project name.").optional(),
      role: clearableText("Enter a role."),
      url: clearableUrl,
      description: clearableText("Enter a description."),
      startDate: clearableMonth,
      endDate: clearableMonth,
      ongoing: z
        .boolean({ error: "Check whether this project is ongoing." })
        .optional(),
    })
    .strict()
    .refine((value) => Object.keys(value).length > 0, {
      message: "Enter a change to save.",
    })
    .superRefine(refineProjectDates),
);

type CreateJobInput = z.infer<typeof CreateJobInputSchema>;
type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;
type UpdateJobInput = z.infer<typeof UpdateJobInputSchema>;
type UpdateProjectInput = z.infer<typeof UpdateProjectInputSchema>;

export type RemovedExperienceRecord = {
  kind: "job" | "project";
  id: string;
  removedPointCount: number;
};

function mustParseJob(record: unknown, fallback: string) {
  const parsed = JobV2Schema.safeParse(record);
  if (!parsed.success) throwInput(parsed.error.issues, fallback);
  return parsed.data;
}

function mustParseProject(record: unknown, fallback: string) {
  const parsed = ProjectV2Schema.safeParse(record);
  if (!parsed.success) throwInput(parsed.error.issues, fallback);
  return parsed.data;
}

function buildJob(
  id: string,
  input: CreateJobInput,
  points: JobV2["points"] = [],
) {
  const endDate = input.currentlyEmployed ? null : monthValue(input.endDate);
  if (!input.currentlyEmployed && !endDate) {
    throw new LibraryWriteError("invalid-input", JOB_END_REQUIRED);
  }
  if (endIsBeforeStart(input.startDate, endDate)) {
    throw new LibraryWriteError("invalid-input", END_ORDER);
  }
  const location = definedText(input.location);
  const description = definedText(input.description);
  return mustParseJob(
    {
      id,
      company: input.company,
      title: input.title,
      employmentType: input.employmentType,
      startDate: input.startDate,
      endDate,
      points,
      ...(location ? { location } : {}),
      ...(description ? { description } : {}),
    },
    "Check the job fields and try again.",
  );
}

function buildProject(id: string, input: CreateProjectInput) {
  const startDate = monthValue(input.startDate);
  const endDate = input.ongoing ? null : monthValue(input.endDate);
  if (endIsBeforeStart(startDate, endDate)) {
    throw new LibraryWriteError("invalid-input", END_ORDER);
  }
  const role = definedText(input.role);
  const description = definedText(input.description);
  const url = definedText(input.url);
  return mustParseProject(
    {
      id,
      name: input.name,
      repositoryAttachments: [],
      points: [],
      ...(role ? { role } : {}),
      ...(url ? { url } : {}),
      ...(description ? { description } : {}),
      ...(startDate ? { startDate } : {}),
      ...(input.ongoing ? { endDate: null } : endDate ? { endDate } : {}),
    },
    "Check the project fields and try again.",
  );
}

function assignText(
  record: {
    location?: string;
    role?: string;
    description?: string;
    url?: string;
  },
  key: "location" | "role" | "description" | "url",
  input: object,
  value: string | null | undefined,
) {
  if (!Object.hasOwn(input, key)) return;
  const next = definedText(value);
  if (next) record[key] = next;
  else delete record[key];
}

function applyJobUpdate(job: JobV2, input: UpdateJobInput) {
  const next: JobV2 = { ...job, points: job.points };
  if (input.company !== undefined) next.company = input.company;
  if (input.title !== undefined) next.title = input.title;
  if (input.employmentType !== undefined)
    next.employmentType = input.employmentType;
  assignText(next, "location", input, input.location);
  assignText(next, "description", input, input.description);
  if (input.startDate !== undefined) next.startDate = input.startDate;

  if (input.currentlyEmployed === true) {
    next.endDate = null;
  } else if (Object.hasOwn(input, "endDate")) {
    const endDate = monthValue(input.endDate);
    if (input.currentlyEmployed === false && !endDate) {
      throw new LibraryWriteError("invalid-input", JOB_END_REQUIRED);
    }
    next.endDate = endDate ?? null;
  } else if (input.currentlyEmployed === false && next.endDate === null) {
    throw new LibraryWriteError("invalid-input", JOB_END_REQUIRED);
  }

  if (endIsBeforeStart(next.startDate, next.endDate)) {
    throw new LibraryWriteError("invalid-input", END_ORDER);
  }
  return mustParseJob(next, "Check the job fields and try again.");
}

function applyProjectUpdate(project: ProjectV2, input: UpdateProjectInput) {
  const next: ProjectV2 = {
    ...project,
    points: project.points,
    repositoryAttachments: project.repositoryAttachments,
  };
  if (input.name !== undefined) next.name = input.name;
  assignText(next, "role", input, input.role);
  assignText(next, "url", input, input.url);
  assignText(next, "description", input, input.description);
  if (Object.hasOwn(input, "startDate")) {
    const startDate = monthValue(input.startDate);
    if (startDate) next.startDate = startDate;
    else delete next.startDate;
  }
  if (input.ongoing === true) {
    next.endDate = null;
  } else if (Object.hasOwn(input, "endDate")) {
    const endDate = monthValue(input.endDate);
    if (endDate) next.endDate = endDate;
    else delete next.endDate;
  } else if (input.ongoing === false && next.endDate === null) {
    delete next.endDate;
  }
  if (endIsBeforeStart(next.startDate, next.endDate)) {
    throw new LibraryWriteError("invalid-input", END_ORDER);
  }
  return mustParseProject(next, "Check the project fields and try again.");
}

function withoutPointEvidence(
  library: NormalizedResumeLibrary,
  pointIds: Set<string>,
) {
  return library.skills.map((skill) => {
    const evidenceAchievementIds = skill.evidenceAchievementIds.filter(
      (achievementId) => !pointIds.has(achievementId),
    );
    if (evidenceAchievementIds.length === skill.evidenceAchievementIds.length) {
      return skill;
    }
    return { ...skill, evidenceAchievementIds };
  });
}

export async function createExperienceRecord(
  input: unknown,
  options?: WriteOptions,
) {
  const kind =
    input !== null && typeof input === "object" && !Array.isArray(input)
      ? (input as { kind?: unknown }).kind
      : undefined;

  if (kind === "job") {
    const parsed = CreateJobInputSchema.safeParse(input);
    if (!parsed.success) {
      throwInput(parsed.error.issues, "Check the job fields and try again.");
    }
    const data = parsed.data;
    const result = await commitLibraryMutation((library) => {
      const id = parentIdForName(
        "job",
        data.company,
        new Set(collectEntityIds(library)),
      );
      const record = buildJob(id, data);
      return {
        library: { ...library, jobs: [...library.jobs, record] },
        value: record,
        persist: true,
      };
    }, options);
    return { library: result.library, record: result.value };
  }

  if (kind === "project") {
    const parsed = CreateProjectInputSchema.safeParse(input);
    if (!parsed.success) {
      throwInput(
        parsed.error.issues,
        "Check the project fields and try again.",
      );
    }
    const data = parsed.data;
    const result = await commitLibraryMutation((library) => {
      const id = parentIdForName(
        "project",
        data.name,
        new Set(collectEntityIds(library)),
      );
      const record = buildProject(id, data);
      return {
        library: { ...library, projects: [...library.projects, record] },
        value: record,
        persist: true,
      };
    }, options);
    return { library: result.library, record: result.value };
  }

  throw new LibraryWriteError("invalid-input", "Choose a job or a project.");
}

export async function updateExperienceRecord(
  id: string,
  input: unknown,
  options?: WriteOptions & { kind?: "job" | "project" },
): Promise<{ library: NormalizedResumeLibrary; record: JobV2 | ProjectV2 }> {
  const result = await commitLibraryMutation<JobV2 | ProjectV2>((library) => {
    const job =
      options?.kind === "project"
        ? undefined
        : library.jobs.find((item) => item.id === id);
    if (job) {
      const parsed = UpdateJobInputSchema.safeParse(input);
      if (!parsed.success) {
        throwInput(parsed.error.issues, "Check the job fields and try again.");
      }
      const record = applyJobUpdate(job, parsed.data);
      return {
        library: {
          ...library,
          jobs: library.jobs.map((item) =>
            item.id === job.id ? record : item,
          ),
        },
        value: record,
        persist: true,
      };
    }

    const project =
      options?.kind === "job"
        ? undefined
        : library.projects.find((item) => item.id === id);
    if (!project) {
      throw new LibraryWriteError(
        "not-found",
        "The job or project was not found.",
      );
    }
    const parsed = UpdateProjectInputSchema.safeParse(input);
    if (!parsed.success) {
      throwInput(
        parsed.error.issues,
        "Check the project fields and try again.",
      );
    }
    const record = applyProjectUpdate(project, parsed.data);
    return {
      library: {
        ...library,
        projects: library.projects.map((item) =>
          item.id === project.id ? record : item,
        ),
      },
      value: record,
      persist: true,
    };
  }, options);
  return { library: result.library, record: result.value };
}

export async function removeExperienceRecord(
  id: string,
  options?: WriteOptions & { kind?: "job" | "project" },
): Promise<RemovedExperienceRecord> {
  const result = await commitLibraryMutation((library) => {
    const job =
      options?.kind === "project"
        ? undefined
        : library.jobs.find((item) => item.id === id);
    const project =
      options?.kind === "job"
        ? undefined
        : job
          ? undefined
          : library.projects.find((item) => item.id === id);
    const record = job ?? project;
    if (!record) {
      throw new LibraryWriteError(
        "not-found",
        "The job or project was not found.",
      );
    }
    const pointIds = new Set(record.points.map((point) => point.id));
    const skills = withoutPointEvidence(library, pointIds);
    const removed: RemovedExperienceRecord = {
      kind: job ? "job" : "project",
      id: record.id,
      removedPointCount: record.points.length,
    };
    if (job) {
      return {
        library: {
          ...library,
          jobs: library.jobs.filter((item) => item.id !== job.id),
          skills,
        },
        value: removed,
        persist: true,
      };
    }
    return {
      library: {
        ...library,
        projects: library.projects.filter((item) => item.id !== record.id),
        skills,
        githubImportApprovals: library.githubImportApprovals.filter(
          (approval) => approval.projectId !== record.id,
        ),
      },
      value: removed,
      persist: true,
    };
  }, options);
  return result.value;
}
