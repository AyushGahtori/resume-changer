import { describe, expect, it } from "vitest";
import { getRoleField, ROLE_FIELDS } from "../../../src/lib/ui/role-fields";

describe("role field descriptors", () => {
  it("lists the three role inputs in form order", () => {
    expect(ROLE_FIELDS.map((field) => field.field)).toEqual([
      "company",
      "roleTitle",
      "jobUrl",
    ]);
    expect(ROLE_FIELDS.map((field) => field.label)).toEqual([
      "Company",
      "Role title",
      "Job link",
    ]);
  });

  it("keeps the existing labels, placeholders, and control identities", () => {
    expect(getRoleField("company")).toMatchObject({
      id: "company",
      name: "company",
      placeholder: "Company name",
      autoComplete: "organization",
    });
    expect(getRoleField("roleTitle")).toMatchObject({
      id: "role-title",
      name: "roleTitle",
      placeholder: "e.g. Backend Engineer",
      autoComplete: "organization-title",
    });
    expect(getRoleField("jobUrl")).toMatchObject({
      id: "job-url",
      name: "jobUrl",
      placeholder: "https://",
      autoComplete: "url",
      inputMode: "url",
    });
  });

  it("gives every field a distinct leading icon", () => {
    const icons = ROLE_FIELDS.map((field) => field.icon);
    expect(new Set(icons).size).toBe(3);
  });

  it("does not mark the optional link field as required", () => {
    // Company and role title stay optional, matching `validateDraft`.
    expect(getRoleField("company")).not.toHaveProperty("required");
    expect(getRoleField("roleTitle")).not.toHaveProperty("required");
  });

  it("rejects an unknown field name", () => {
    expect(() =>
      getRoleField("companyName" as Parameters<typeof getRoleField>[0]),
    ).toThrow(/Unknown role field/);
  });
});
