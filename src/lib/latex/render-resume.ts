import { z } from "zod";
import {
  ResumeLibrarySchema,
  ResumeSectionTypeSchema,
  StableIdSchema,
} from "../schemas/resume-data";
import type {
  AchievementPoint,
  ResumeLibrary,
  ResumeSectionType,
  Skill,
} from "../schemas/resume-data";
import { applyJakeStyleTemplate } from "./jake-template";

const RenderInputSchema = z
  .object({
    library: ResumeLibrarySchema,
    selectedAchievementIds: z.array(StableIdSchema),
    selectedSkillIds: z.array(StableIdSchema).optional(),
    jobDescription: z.string().max(30_000).optional(),
    achievementTextOverrides: z
      .array(
        z
          .object({
            achievementId: StableIdSchema,
            text: z.string().trim().min(1).max(8_000),
          })
          .strict(),
      )
      .max(100)
      .optional(),
    sectionOrder: z.array(ResumeSectionTypeSchema).optional(),
  })
  .strict();

export class ResumeRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResumeRenderError";
  }
}

const LATEX_ESCAPES: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "{": "\\{",
  "}": "\\}",
  $: "\\$",
  "&": "\\&",
  "#": "\\#",
  _: "\\_",
  "%": "\\%",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
};

export function escapeLatexText(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–−]/g, "--")
    .replace(/—/g, "---")
    .replace(/\u00a0/g, "~")
    .replace(/[\\{}$&#_%~^]/g, (character) => LATEX_ESCAPES[character]);
}

function formatMonth(value: string): string {
  const [year, month] = value.split("-");
  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${monthNames[Number(month) - 1]} ${year}`;
}

function formatRange(start?: string, end?: string | null): string {
  if (!start) return "";
  if (end === null) return `${formatMonth(start)} -- Present`;
  return end
    ? `${formatMonth(start)} -- ${formatMonth(end)}`
    : formatMonth(start);
}

function renderHeader(library: ResumeLibrary): string {
  const { profile } = library;
  const contacts: string[] = [];

  if (profile.location) contacts.push(escapeLatexText(profile.location));
  if (profile.phone) contacts.push(escapeLatexText(profile.phone));
  if (profile.email) {
    contacts.push(
      `\\href{mailto:${escapeLatexText(profile.email)}}{${escapeLatexText(profile.email)}}`,
    );
  }
  for (const link of profile.links) {
    const parsedUrl = new URL(link.url);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new ResumeRenderError(
        `Unsupported link protocol for "${link.label}".`,
      );
    }
    contacts.push(
      `\\href{${escapeLatexText(link.url)}}{${escapeLatexText(link.label)}}`,
    );
  }

  const summary = profile.summary ? escapeLatexText(profile.summary) : "";
  const headline = profile.headline ? escapeLatexText(profile.headline) : "";
  const profileSummary =
    headline || summary
      ? `\\ResumeProfileSummary{${headline}}{${summary}}`
      : "";

  return [
    `\\ResumeHeader{${escapeLatexText(profile.fullName)}}{${contacts.join(" \\textbar{} ")}}`,
    profileSummary,
  ]
    .filter(Boolean)
    .join("\n");
}

function renderBullets(
  points: AchievementPoint[],
  textOverrides: Map<string, string>,
): string {
  if (points.length === 0) return "";
  return [
    "\\ResumeBulletListStart",
    ...points.map(
      (point) =>
        `  \\item ${escapeLatexText(textOverrides.get(point.id) ?? point.text)}`,
    ),
    "\\ResumeBulletListEnd",
  ].join("\n");
}

function renderExperience(
  library: ResumeLibrary,
  selectedById: Map<string, AchievementPoint>,
  selectedIds: string[],
  textOverrides: Map<string, string>,
): string {
  const entries = library.jobs.flatMap((job) => {
    const points = selectedIds
      .map((id) => selectedById.get(id))
      .filter(
        (point): point is AchievementPoint =>
          point !== undefined &&
          job.points.some((item) => item.id === point.id),
      );
    if (points.length === 0) return [];

    const subheading = [job.company, job.employmentType]
      .filter(Boolean)
      .map(escapeLatexText)
      .join(" $\\cdot$ ");
    return [
      `\\ResumeEntry{${escapeLatexText(job.title)}}{${formatRange(job.startDate, job.endDate)}}{${subheading}}{${escapeLatexText(job.location ?? "")}}`,
      renderBullets(points, textOverrides),
    ];
  });

  return entries.length ? `\\section*{Experience}\n${entries.join("\n")}` : "";
}

function renderProjects(
  library: ResumeLibrary,
  selectedById: Map<string, AchievementPoint>,
  selectedIds: string[],
  textOverrides: Map<string, string>,
): string {
  const entries = library.projects.flatMap((project) => {
    const points = selectedIds
      .map((id) => selectedById.get(id))
      .filter(
        (point): point is AchievementPoint =>
          point !== undefined &&
          project.points.some((item) => item.id === point.id),
      );
    if (points.length === 0) return [];
    return [
      `\\ResumeEntry{${escapeLatexText(project.name)}}{${formatRange(project.startDate, project.endDate)}}{${escapeLatexText(project.role ?? "")}}{}`,
      renderBullets(points, textOverrides),
    ];
  });

  return entries.length ? `\\section*{Projects}\n${entries.join("\n")}` : "";
}

function renderEducation(library: ResumeLibrary): string {
  const entries = library.profile.education.map((education) => {
    const range = formatRange(education.startDate, education.endDate);
    const institutions = education.institutions
      .map(escapeLatexText)
      .join(" / ");
    const degree = [education.degree, education.fieldOfStudy]
      .filter(Boolean)
      .map(escapeLatexText)
      .join(" in ");
    const subheading = education.programName
      ? `${degree} --- ${escapeLatexText(education.programName)}`
      : degree;
    const description = education.description
      ? escapeLatexText(education.description)
      : "";
    return `\\ResumeEducationEntry{${institutions}}{${range}}{${subheading}}{${description}}`;
  });

  return entries.length ? `\\section*{Education}\n${entries.join("\n")}` : "";
}

function groupSkills(skills: Skill[]): Array<[string, Skill[]]> {
  const groups = new Map<string, Skill[]>();
  for (const skill of skills) {
    const category = skill.category?.trim() || "Other";
    groups.set(category, [...(groups.get(category) ?? []), skill]);
  }
  return [...groups.entries()];
}

const MAX_SKILL_ROW_CHARACTERS = 72;

export function selectSkillsForResume(
  skills: Skill[],
  selectedPoints: AchievementPoint[],
  jobDescription = "",
): Skill[] {
  const normalizedJd = ` ${jobDescription
    .toLocaleLowerCase()
    .replace(/[^a-z0-9+#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
  const pointSkillIds = new Set(
    selectedPoints.flatMap((point) => point.skillIds),
  );
  const score = (skill: Skill) => {
    const terms = [skill.name, ...skill.aliases];
    const matchesJd = terms.some((term) => {
      const normalized = term
        .toLocaleLowerCase()
        .replace(/[^a-z0-9+#]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return normalized.length > 1 && normalizedJd.includes(` ${normalized} `);
    });
    return (
      (matchesJd ? 100 : 0) +
      (pointSkillIds.has(skill.id) ? 10 : 0) +
      (skill.isListedOnCurrentResume ? 1 : 0)
    );
  };
  const groups = groupSkills(skills)
    .map(([category, group], index) => ({
      category,
      group: [...group].sort((left, right) => score(right) - score(left)),
      index,
      strength: Math.max(...group.map(score)),
    }))
    .sort(
      (left, right) =>
        right.strength - left.strength || left.index - right.index,
    );
  const selected: Skill[] = [];
  for (const { category, group } of groups) {
    if (
      new Set(selected.map((skill) => skill.category?.trim() || "Other"))
        .size >= 2
    ) {
      break;
    }
    let characters = category.length + 2;
    for (const skill of group) {
      const next =
        skill.name.length + (characters > category.length + 2 ? 2 : 0);
      if (characters + next > MAX_SKILL_ROW_CHARACTERS) continue;
      selected.push(skill);
      characters += next;
    }
  }
  return selected;
}

function renderSkills(skills: Skill[]): string {
  if (skills.length === 0) return "";
  const rows = groupSkills(skills).map(
    ([category, group]) =>
      `\\ResumeSkillGroup{${escapeLatexText(category)}}{${group
        .map((skill) => escapeLatexText(skill.name))
        .join(", ")}}`,
  );
  return `\\section*{Technical Skills}\n{\\small\n\\begin{tabularx}{\\textwidth}{@{}X@{}}\n${rows.join("\n")}\n\\end{tabularx}\n}`;
}

function renderCredentials(library: ResumeLibrary): string {
  if (library.credentials.length === 0) return "";
  const entries = library.credentials.map((credential) => {
    const issued = credential.issuedDate
      ? formatMonth(credential.issuedDate.slice(0, 7))
      : credential.kind === "license"
        ? "License"
        : "Certificate";
    return `\\ResumeCredential{${escapeLatexText(credential.name)}}{${escapeLatexText(credential.issuer)}}`;
  });
  return `\\section*{Licenses and Certifications}\n${entries.join("\n")}`;
}

const SECTION_RENDERERS: Record<
  ResumeSectionType,
  (context: {
    library: ResumeLibrary;
    selectedById: Map<string, AchievementPoint>;
    selectedIds: string[];
    textOverrides: Map<string, string>;
    skills: Skill[];
  }) => string
> = {
  experience: ({ library, selectedById, selectedIds, textOverrides }) =>
    renderExperience(library, selectedById, selectedIds, textOverrides),
  projects: ({ library, selectedById, selectedIds, textOverrides }) =>
    renderProjects(library, selectedById, selectedIds, textOverrides),
  education: ({ library }) => renderEducation(library),
  skills: ({ skills }) => renderSkills(skills),
  credentials: ({ library }) => renderCredentials(library),
};

export type RenderResumeLatexInput = {
  library: ResumeLibrary;
  selectedAchievementIds: string[];
  selectedSkillIds?: string[];
  jobDescription?: string;
  achievementTextOverrides?: Array<{
    achievementId: string;
    text: string;
  }>;
  sectionOrder?: ResumeSectionType[];
};

export function renderResumeLatex(input: RenderResumeLatexInput): string {
  const parsed = RenderInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ResumeRenderError(
      "Resume data or rendering preferences are invalid.",
    );
  }

  const {
    library,
    selectedAchievementIds,
    selectedSkillIds,
    jobDescription,
    achievementTextOverrides = [],
    sectionOrder,
  } = parsed.data;
  if (new Set(selectedAchievementIds).size !== selectedAchievementIds.length) {
    throw new ResumeRenderError(
      "An achievement point may be selected only once.",
    );
  }
  if (sectionOrder && new Set(sectionOrder).size !== sectionOrder.length) {
    throw new ResumeRenderError("A resume section may appear only once.");
  }

  const pointById = new Map<string, AchievementPoint>();
  for (const point of [
    ...library.jobs.flatMap((job) => job.points),
    ...library.projects.flatMap((project) => project.points),
  ]) {
    pointById.set(point.id, point);
  }

  for (const id of selectedAchievementIds) {
    const point = pointById.get(id);
    if (!point) throw new ResumeRenderError(`Unknown achievement ID: ${id}.`);
    if (!point.enabled) {
      throw new ResumeRenderError(`Achievement ID is disabled: ${id}.`);
    }
  }

  const selectedIds = new Set(selectedAchievementIds);
  const textOverrides = new Map<string, string>();
  for (const item of achievementTextOverrides) {
    if (textOverrides.has(item.achievementId)) {
      throw new ResumeRenderError(
        "A tailored achievement may be supplied only once.",
      );
    }
    if (!selectedIds.has(item.achievementId)) {
      throw new ResumeRenderError(
        `A tailored achievement must be selected: ${item.achievementId}.`,
      );
    }
    textOverrides.set(item.achievementId, item.text);
  }

  const skillById = new Map(library.skills.map((skill) => [skill.id, skill]));
  const chosenSkillIds =
    selectedSkillIds ??
    library.skills
      .filter((skill) => skill.isListedOnCurrentResume)
      .map((skill) => skill.id);
  if (new Set(chosenSkillIds).size !== chosenSkillIds.length) {
    throw new ResumeRenderError("A skill may be selected only once.");
  }
  const skills = chosenSkillIds.map((id) => {
    const skill = skillById.get(id);
    if (!skill) throw new ResumeRenderError(`Unknown skill ID: ${id}.`);
    if (
      !skill.isListedOnCurrentResume &&
      !skill.evidenceAchievementIds.some((pointId) => selectedIds.has(pointId))
    ) {
      throw new ResumeRenderError(
        `Skill "${skill.name}" needs a selected supporting achievement point.`,
      );
    }
    return skill;
  });

  const resolvedOrder = sectionOrder ?? library.preferences.sectionOrder;
  const selectedById = new Map(
    selectedAchievementIds.map((id) => [id, pointById.get(id)!]),
  );
  const compactSkills = selectSkillsForResume(
    skills,
    [...selectedById.values()],
    jobDescription,
  );
  const context = {
    library,
    selectedById,
    selectedIds: selectedAchievementIds,
    textOverrides,
    skills: compactSkills,
  };
  const sections = resolvedOrder
    .map((section) => SECTION_RENDERERS[section](context))
    .filter(Boolean);

  return applyJakeStyleTemplate(
    [renderHeader(library), ...sections].join("\n\n"),
  );
}
