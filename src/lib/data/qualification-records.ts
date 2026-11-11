import { z } from "zod";
import {
  CredentialSchema,
  EducationSchema,
  StableIdSchema,
  YearMonthSchema,
  type Credential,
  type Education,
  type Skill,
} from "../schemas/resume-data";
import { normalizeSkillName } from "../skills/group-skills";
import {
  type WriteOptions,
  CreateSkillInputSchema,
  LibraryWriteError,
  collectEntityIds,
  commitLibraryMutation,
  skillIdForName,
} from "./writers";

/**
 * Ordinary library authoring for pasted skills, degrees, and certificates.
 * Stable ids are chosen here. Callers never supply them.
 */

const SKILL_NAME_SEPARATOR = /[,\n\r]+/;

function blankToNull(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

const optionalText = z.preprocess(
  blankToNull,
  z.union([z.string().min(1), z.null()]).optional(),
);

const optionalYearMonth = z.preprocess(
  blankToNull,
  z.union([YearMonthSchema, z.null()]).optional(),
);

const optionalIsoDate = z.preprocess(
  blankToNull,
  z.union([z.iso.date(), z.null()]).optional(),
);

const optionalUrl = z.preprocess(
  blankToNull,
  z.union([z.url(), z.null()]).optional(),
);

const educationInstitution = z
  .string()
  .trim()
  .min(1, "Enter an institution.")
  .optional();

const educationInstitutions = z
  .array(z.string().trim().min(1, "Enter an institution."))
  .min(1, "Enter an institution.")
  .optional();

const educationDegree = z.string().trim().min(1, "Enter a degree.");
const educationField = z.string().trim().min(1, "Enter a field of study.");

function rejectEducationDateOrder(
  value: {
    currentlyStudying?: boolean;
    startDate?: string | null;
    endDate?: string | null;
  },
  context: z.RefinementCtx,
) {
  if (
    value.currentlyStudying === true ||
    !value.startDate ||
    !value.endDate ||
    value.endDate >= value.startDate
  ) {
    return;
  }
  context.addIssue({
    code: "custom",
    path: ["endDate"],
    message: "End date must be the same as or later than start date.",
  });
}

export const CreateSkillsFromTextInputSchema = z
  .object({
    text: z.string(),
  })
  .strict();

export const CreateEducationInputSchema = z
  .object({
    institution: educationInstitution,
    institutions: educationInstitutions,
    degree: educationDegree,
    fieldOfStudy: educationField,
    programName: optionalText,
    description: optionalText,
    startDate: optionalYearMonth,
    endDate: optionalYearMonth,
    currentlyStudying: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.institution && !value.institutions?.length) {
      context.addIssue({
        code: "custom",
        path: ["institution"],
        message: "Enter an institution.",
      });
    }
    rejectEducationDateOrder(value, context);
  });

export const UpdateEducationInputSchema = z
  .object({
    institution: educationInstitution,
    institutions: educationInstitutions,
    degree: educationDegree.optional(),
    fieldOfStudy: educationField.optional(),
    programName: optionalText,
    description: optionalText,
    startDate: optionalYearMonth,
    endDate: optionalYearMonth,
    currentlyStudying: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (Object.keys(value).length === 0) {
      context.addIssue({
        code: "custom",
        message: "Provide at least one field to update.",
      });
    }
    rejectEducationDateOrder(value, context);
  });

const credentialName = z.string().trim().min(1, "Enter a credential name.");
const credentialIssuer = z.string().trim().min(1, "Enter an issuer.");
const credentialKind = z.enum(["license", "certificate"]);

function rejectCredentialDateOrder(
  value: { issuedDate?: string | null; expiresDate?: string | null },
  context: z.RefinementCtx,
) {
  if (
    !value.issuedDate ||
    !value.expiresDate ||
    value.expiresDate >= value.issuedDate
  ) {
    return;
  }
  context.addIssue({
    code: "custom",
    path: ["expiresDate"],
    message: "Expiration date must not be earlier than issue date.",
  });
}

export const CreateCredentialInputSchema = z
  .object({
    kind: credentialKind.optional(),
    name: credentialName,
    issuer: credentialIssuer,
    issuedDate: optionalIsoDate,
    expiresDate: optionalIsoDate,
    credentialId: optionalText,
    url: optionalUrl,
  })
  .strict()
  .superRefine(rejectCredentialDateOrder);

export const UpdateCredentialInputSchema = z
  .object({
    kind: credentialKind.optional(),
    name: credentialName.optional(),
    issuer: credentialIssuer.optional(),
    issuedDate: optionalIsoDate,
    expiresDate: optionalIsoDate,
    credentialId: optionalText,
    url: optionalUrl,
  })
  .strict()
  .superRefine((value, context) => {
    if (Object.keys(value).length === 0) {
      context.addIssue({
        code: "custom",
        message: "Provide at least one field to update.",
      });
    }
    rejectCredentialDateOrder(value, context);
  });

export type CreateEducationInput = z.infer<typeof CreateEducationInputSchema>;
export type UpdateEducationInput = z.infer<typeof UpdateEducationInputSchema>;
export type CreateCredentialInput = z.infer<typeof CreateCredentialInputSchema>;
export type UpdateCredentialInput = z.infer<typeof UpdateCredentialInputSchema>;

type EducationWrite = UpdateEducationInput;
type CredentialWrite = UpdateCredentialInput;

function invalidInput(error: z.ZodError, fallback: string): LibraryWriteError {
  return new LibraryWriteError(
    "invalid-input",
    error.issues[0]?.message ?? fallback,
  );
}

function requireStableId(id: string, message: string) {
  const parsed = StableIdSchema.safeParse(id);
  if (!parsed.success) throw new LibraryWriteError("not-found", message);
  return parsed.data;
}

function skillNamesFromText(text: string) {
  return text
    .split(SKILL_NAME_SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Same slug shape as skillIdForName, with an education- or credential- prefix.
 */
function educationIdForName(name: string, used: Set<string>): string {
  return prefixedIdForName("education", name, used);
}

function credentialIdForName(name: string, used: Set<string>): string {
  return prefixedIdForName("credential", name, used);
}

function prefixedIdForName(
  prefix: "education" | "credential",
  name: string,
  used: Set<string>,
): string {
  const folded = name
    .replace(/c\+\+/gi, "cplusplus")
    .replace(/c#/gi, "csharp")
    .replace(/f#/gi, "fsharp")
    .replace(/\.net/gi, "dotnet");
  let base = normalizeSkillName(folded)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  if (!base) base = prefix;
  const root = `${prefix}-${base}`;
  if (!used.has(root)) return root;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${root}-${index}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new LibraryWriteError(
    "invalid-library",
    `A unique ${prefix} ID could not be chosen.`,
  );
}

function knownSkillKeys(skills: Skill[]) {
  const keys = new Set<string>();
  for (const skill of skills) {
    for (const value of [skill.name, ...skill.aliases]) {
      keys.add(normalizeSkillName(value));
    }
  }
  return keys;
}

export async function createSkillsFromText(
  input: { text: string },
  options?: WriteOptions,
): Promise<{ created: Skill[]; skipped: string[] }> {
  const parsed = CreateSkillsFromTextInputSchema.safeParse(input);
  if (!parsed.success) {
    throw invalidInput(parsed.error, "Enter at least one skill name.");
  }
  const names = skillNamesFromText(parsed.data.text);
  if (names.length === 0) {
    throw new LibraryWriteError(
      "invalid-input",
      "Enter at least one skill name.",
    );
  }
  for (const name of names) {
    const nameCheck = CreateSkillInputSchema.safeParse({ name });
    if (!nameCheck.success)
      throw invalidInput(nameCheck.error, "Enter a skill name.");
  }

  const { value } = await commitLibraryMutation((current) => {
    const keys = knownSkillKeys(current.skills);
    const used = new Set(collectEntityIds(current));
    const created: Skill[] = [];
    const skipped: string[] = [];
    for (const name of names) {
      const key = normalizeSkillName(name);
      if (keys.has(key)) {
        skipped.push(name);
        continue;
      }
      const skill: Skill = {
        id: skillIdForName(name, used),
        name,
        aliases: [],
        sources: ["direct-user"],
        isListedOnCurrentResume: false,
        evidenceAchievementIds: [],
      };
      used.add(skill.id);
      keys.add(key);
      created.push(skill);
    }
    return {
      library: {
        ...current,
        skills: [...current.skills, ...created],
      },
      value: { created, skipped },
      persist: created.length > 0,
    };
  }, options);
  return value;
}

function nextInstitutions(
  input: EducationWrite,
  existing?: string[],
): string[] | undefined {
  if (input.institutions) return input.institutions;
  if (input.institution) return [input.institution];
  return existing;
}

function clearedOrSet(
  value: string | null | undefined,
  existing: string | undefined,
): string | undefined {
  if (value === null) return undefined;
  if (typeof value === "string") return value;
  return existing;
}

function nextEndDate(
  input: EducationWrite,
  existing: string | null | undefined,
): string | null | undefined {
  if (input.currentlyStudying === true) return null;
  if (typeof input.endDate === "string") return input.endDate;
  if (input.endDate === null && input.currentlyStudying === false)
    return undefined;
  if (input.endDate === null) return null;
  return existing;
}

function educationRecord(
  id: string,
  input: EducationWrite,
  base?: Education,
): Education {
  const institutions = nextInstitutions(input, base?.institutions);
  const degree = input.degree ?? base?.degree;
  const fieldOfStudy = input.fieldOfStudy ?? base?.fieldOfStudy;
  if (!institutions?.length || !degree || !fieldOfStudy) {
    throw new LibraryWriteError(
      "invalid-input",
      "Enter an institution, degree, and field of study.",
    );
  }
  const record: Education = { id, institutions, degree, fieldOfStudy };
  const programName = clearedOrSet(input.programName, base?.programName);
  const description = clearedOrSet(input.description, base?.description);
  const startDate = clearedOrSet(input.startDate, base?.startDate);
  if (programName) record.programName = programName;
  if (description) record.description = description;
  if (startDate) record.startDate = startDate;
  const endDate = nextEndDate(input, base?.endDate);
  if (endDate !== undefined) record.endDate = endDate;
  const parsed = EducationSchema.safeParse(record);
  if (!parsed.success) {
    throw invalidInput(parsed.error, "Check the degree fields and try again.");
  }
  return parsed.data;
}

export async function createEducation(
  input: CreateEducationInput,
  options?: WriteOptions,
): Promise<{ education: Education }> {
  const parsed = CreateEducationInputSchema.safeParse(input);
  if (!parsed.success) {
    throw invalidInput(parsed.error, "Check the degree fields and try again.");
  }
  const { value } = await commitLibraryMutation((current) => {
    const institutions = nextInstitutions(parsed.data);
    if (!institutions?.length) {
      throw new LibraryWriteError("invalid-input", "Enter an institution.");
    }
    const education = educationRecord(
      educationIdForName(
        `${parsed.data.degree} ${institutions[0]}`,
        new Set(collectEntityIds(current)),
      ),
      parsed.data,
    );
    return {
      library: {
        ...current,
        profile: {
          ...current.profile,
          education: [...current.profile.education, education],
        },
      },
      value: { education },
      persist: true,
    };
  }, options);
  return value;
}

export async function updateEducation(
  id: string,
  input: UpdateEducationInput,
  options?: WriteOptions,
): Promise<{ education: Education }> {
  const educationId = requireStableId(id, "The degree was not found.");
  const parsed = UpdateEducationInputSchema.safeParse(input);
  if (!parsed.success) {
    throw invalidInput(parsed.error, "Check the degree fields and try again.");
  }
  const { value } = await commitLibraryMutation((current) => {
    const existing = current.profile.education.find(
      (item) => item.id === educationId,
    );
    if (!existing) {
      throw new LibraryWriteError("not-found", "The degree was not found.");
    }
    const education = educationRecord(educationId, parsed.data, existing);
    return {
      library: {
        ...current,
        profile: {
          ...current.profile,
          education: current.profile.education.map((item) =>
            item.id === educationId ? education : item,
          ),
        },
      },
      value: { education },
      persist: true,
    };
  }, options);
  return value;
}

export async function removeEducation(
  id: string,
  options?: WriteOptions,
): Promise<{ id: string }> {
  const educationId = requireStableId(id, "The degree was not found.");
  const { value } = await commitLibraryMutation((current) => {
    if (!current.profile.education.some((item) => item.id === educationId)) {
      throw new LibraryWriteError("not-found", "The degree was not found.");
    }
    return {
      library: {
        ...current,
        profile: {
          ...current.profile,
          education: current.profile.education.filter(
            (item) => item.id !== educationId,
          ),
        },
      },
      value: { id: educationId },
      persist: true,
    };
  }, options);
  return value;
}

function credentialRecord(
  id: string,
  input: CredentialWrite,
  base?: Credential,
): Credential {
  const name = input.name ?? base?.name;
  const issuer = input.issuer ?? base?.issuer;
  const kind = input.kind ?? base?.kind ?? "certificate";
  if (!name || !issuer) {
    throw new LibraryWriteError(
      "invalid-input",
      "Enter a credential name and issuer.",
    );
  }
  const record: Credential = { id, kind, name, issuer };
  const issuedDate = clearedOrSet(input.issuedDate, base?.issuedDate);
  const expiresDate = clearedOrSet(input.expiresDate, base?.expiresDate);
  const externalId = clearedOrSet(input.credentialId, base?.credentialId);
  const url = clearedOrSet(input.url, base?.url);
  if (issuedDate) record.issuedDate = issuedDate;
  if (expiresDate) record.expiresDate = expiresDate;
  if (externalId) record.credentialId = externalId;
  if (url) record.url = url;
  const parsed = CredentialSchema.safeParse(record);
  if (!parsed.success) {
    throw invalidInput(
      parsed.error,
      "Check the credential fields and try again.",
    );
  }
  return parsed.data;
}

export async function createCredential(
  input: CreateCredentialInput,
  options?: WriteOptions,
): Promise<{ credential: Credential }> {
  const parsed = CreateCredentialInputSchema.safeParse(input);
  if (!parsed.success) {
    throw invalidInput(
      parsed.error,
      "Check the credential fields and try again.",
    );
  }
  const { value } = await commitLibraryMutation((current) => {
    const credential = credentialRecord(
      credentialIdForName(parsed.data.name, new Set(collectEntityIds(current))),
      parsed.data,
    );
    return {
      library: {
        ...current,
        credentials: [...current.credentials, credential],
      },
      value: { credential },
      persist: true,
    };
  }, options);
  return value;
}

export async function updateCredential(
  id: string,
  input: UpdateCredentialInput,
  options?: WriteOptions,
): Promise<{ credential: Credential }> {
  const credentialId = requireStableId(id, "The credential was not found.");
  const parsed = UpdateCredentialInputSchema.safeParse(input);
  if (!parsed.success) {
    throw invalidInput(
      parsed.error,
      "Check the credential fields and try again.",
    );
  }
  const { value } = await commitLibraryMutation((current) => {
    const existing = current.credentials.find(
      (item) => item.id === credentialId,
    );
    if (!existing) {
      throw new LibraryWriteError("not-found", "The credential was not found.");
    }
    const credential = credentialRecord(credentialId, parsed.data, existing);
    return {
      library: {
        ...current,
        credentials: current.credentials.map((item) =>
          item.id === credentialId ? credential : item,
        ),
      },
      value: { credential },
      persist: true,
    };
  }, options);
  return value;
}

export async function removeCredential(
  id: string,
  options?: WriteOptions,
): Promise<{ id: string }> {
  const credentialId = requireStableId(id, "The credential was not found.");
  const { value } = await commitLibraryMutation((current) => {
    if (!current.credentials.some((item) => item.id === credentialId)) {
      throw new LibraryWriteError("not-found", "The credential was not found.");
    }
    return {
      library: {
        ...current,
        credentials: current.credentials.filter(
          (item) => item.id !== credentialId,
        ),
      },
      value: { id: credentialId },
      persist: true,
    };
  }, options);
  return value;
}
