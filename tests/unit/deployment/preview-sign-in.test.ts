import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { signInErrorMessage } from "../../../src/lib/cloud/sign-in-error";

describe("phase-one Google sign-in", () => {
  it("authorizes the stable Preview address and the previously shared test URL exactly", () => {
    const config = JSON.parse(readFileSync("firebase.json", "utf8"));
    expect(config.auth.authorizedDomains).toEqual(
      expect.arrayContaining([
        "resume-changer-git-phase-one-ayushs-projects-ab23dbca.vercel.app",
        "resume-changer-1a9nxylqw-ayushs-projects-ab23dbca.vercel.app",
        "resume-changer-ayushs-projects-ab23dbca.vercel.app",
      ]),
    );
    expect(
      config.auth.authorizedDomains.some((domain: string) =>
        domain.includes("*"),
      ),
    ).toBe(false);
  });
  it("explains an unauthorized address without exposing provider details", () => {
    const message = signInErrorMessage({
      code: "auth/unauthorized-domain",
      message: "private provider details",
    });
    expect(message).toContain("not configured for this website address");
    expect(message).not.toContain("private provider details");
  });
  it("keeps popup guidance and unknown failures safe", () => {
    expect(signInErrorMessage({ code: "auth/popup-blocked" })).toContain(
      "Allow the sign-in window",
    );
    expect(signInErrorMessage({ code: "auth/popup-closed-by-user" })).toContain(
      "Sign-in was closed",
    );
    for (const error of [
      null,
      undefined,
      "secret",
      new Error("secret"),
      { code: "unknown", message: "secret" },
    ])
      expect(signInErrorMessage(error)).toBe(
        "Sign-in could not finish. Please try again.",
      );
  });
});
