import { z } from "zod";
import { ProfileSchema, type Profile } from "../schemas/resume-data";
import {
  commitLibraryMutation,
  LibraryWriteError,
  type WriteOptions,
} from "./writers";

const optionalText = z.string().trim();

const linkInputSchema = z
  .object({
    label: optionalText.min(1, "Enter a link label."),
    url: optionalText.min(1, "Enter a link URL.").refine((value) => {
      return z.url().safeParse(value).success;
    }, "Enter a valid link URL."),
  })
  .strict();

/**
 * Contact fields for a library profile.
 *
 * An empty string clears that field. A missing field leaves the saved value
 * in place. Links replace the whole list and have no ids.
 */
export const UpdateProfileInputSchema = z
  .object({
    fullName: optionalText.min(1, "Enter a preferred name."),
    headline: optionalText.optional(),
    email: optionalText
      .optional()
      .refine(
        (value) =>
          value === undefined ||
          value.length === 0 ||
          z.email().safeParse(value).success,
        "Enter a valid email address.",
      ),
    phone: optionalText.optional(),
    location: optionalText.optional(),
    summary: optionalText.optional(),
    links: z.array(linkInputSchema).max(12, "Use 12 links or fewer."),
  })
  .strict();

type OptionalProfileKey =
  "headline" | "email" | "phone" | "location" | "summary";

function inputError(issues: { message: string }[]) {
  const message = issues.find((issue) =>
    /^(Enter |Use |Check )/.test(issue.message),
  );
  return message?.message ?? "Check the profile details and try again.";
}

function optionalProfileField(
  key: OptionalProfileKey,
  value: string | undefined,
  current: string | undefined,
  provided: object,
): Partial<Pick<Profile, OptionalProfileKey>> {
  const next = Object.hasOwn(provided, key) ? value : current;
  if (!next) return {};
  return { [key]: next };
}

export async function updateResumeProfile(
  input: z.infer<typeof UpdateProfileInputSchema>,
  options?: WriteOptions,
) {
  const parsed = UpdateProfileInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new LibraryWriteError(
      "invalid-input",
      inputError(parsed.error.issues),
    );
  }

  const provided = input !== null && typeof input === "object" ? input : {};
  const data = parsed.data;
  const result = await commitLibraryMutation((library) => {
    const current = library.profile;
    const profile: Profile = {
      id: current.id,
      fullName: data.fullName,
      ...optionalProfileField(
        "headline",
        data.headline,
        current.headline,
        provided,
      ),
      ...optionalProfileField("email", data.email, current.email, provided),
      ...optionalProfileField("phone", data.phone, current.phone, provided),
      ...optionalProfileField(
        "location",
        data.location,
        current.location,
        provided,
      ),
      links: data.links.map((link) => ({
        label: link.label,
        url: link.url,
      })),
      ...optionalProfileField(
        "summary",
        data.summary,
        current.summary,
        provided,
      ),
      education: current.education,
    };
    const checked = ProfileSchema.safeParse(profile);
    if (!checked.success) {
      throw new LibraryWriteError(
        "invalid-input",
        inputError(checked.error.issues),
      );
    }

    return {
      library: { ...library, profile: checked.data },
      value: checked.data,
      persist: true,
    };
  }, options);

  return { library: result.library, profile: result.library.profile };
}
