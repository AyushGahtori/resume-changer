import {
  ResumeLibrarySchema,
  type ResumeLibrary,
} from "../schemas/resume-data";
import { AccountAccessError } from "./security";

export const MAX_LIBRARY_BYTES = 512_000;

/** Bound work before applying the full library schema and cross-reference checks. */
export function validateCloudLibrary(input: unknown): ResumeLibrary {
  const pending = [{ value: input, depth: 0 }];
  let visited = 0;
  while (pending.length) {
    const item = pending.pop()!;
    visited += 1;
    if (visited > 20_000 || item.depth > 15)
      throw new AccountAccessError(
        "This library contains too many nested records.",
        "PAYLOAD_TOO_LARGE",
        413,
      );
    const value = item.value;
    if (typeof value === "string" && value.length > 30_000)
      throw new AccountAccessError(
        "A library text field is too long.",
        "PAYLOAD_TOO_LARGE",
        413,
      );
    if (Array.isArray(value)) {
      if (value.length > 1000)
        throw new AccountAccessError(
          "A library collection is too large.",
          "PAYLOAD_TOO_LARGE",
          413,
        );
      for (const child of value)
        pending.push({ value: child, depth: item.depth + 1 });
    } else if (value && typeof value === "object") {
      const entries = Object.values(value);
      if (entries.length > 60)
        throw new AccountAccessError(
          "A library record has too many fields.",
          "PAYLOAD_TOO_LARGE",
          413,
        );
      for (const child of entries)
        pending.push({ value: child, depth: item.depth + 1 });
    }
  }
  const json = JSON.stringify(input);
  if (!json || new TextEncoder().encode(json).byteLength > MAX_LIBRARY_BYTES)
    throw new AccountAccessError(
      "This library exceeds the account import limit.",
      "PAYLOAD_TOO_LARGE",
      413,
    );
  const parsed = ResumeLibrarySchema.safeParse(input);
  if (!parsed.success)
    throw new AccountAccessError(
      "The library does not match the required resume data format. Check its records and linked IDs.",
      "INVALID_REQUEST",
      400,
    );
  for (const link of [
    ...parsed.data.profile.links.map((link) => link.url),
    ...parsed.data.projects.map((project) => project.url),
    ...parsed.data.credentials.map((credential) => credential.url),
  ]) {
    if (link && !["https:", "http:"].includes(new URL(link).protocol))
      throw new AccountAccessError(
        "Resume links must use HTTP or HTTPS.",
        "INVALID_REQUEST",
        400,
      );
  }
  return parsed.data;
}

export function emptyAccountLibrary(account: {
  email: string;
  displayName: string;
}): ResumeLibrary {
  return {
    schemaVersion: 1,
    profile: {
      id: "profile",
      fullName: account.displayName || account.email.split("@")[0],
      email: account.email,
      links: [],
      education: [],
    },
    jobs: [],
    projects: [],
    skills: [],
    credentials: [],
    preferences: {
      sectionOrder: [
        "experience",
        "projects",
        "education",
        "skills",
        "credentials",
      ],
      maxPages: 1,
    },
  };
}
