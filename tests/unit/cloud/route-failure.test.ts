import { describe, expect, it } from "vitest";
import {
  ProtectedRouteFailure,
  protectedRouteFailureDetails,
} from "@/lib/cloud/route-failure";

describe("protected route failure diagnostics", () => {
  it("reports a fixed stage and an allowlisted provider code", () => {
    const failure = new ProtectedRouteFailure(
      "github-services",
      Object.assign(new Error("private service-account text"), {
        code: "app/invalid-credential",
        status: 500,
      }),
    );

    expect(protectedRouteFailureDetails(failure)).toEqual({
      code: "ACCOUNT_REQUEST_FAILED",
      causeType: "object",
      stage: "github-services",
      errorName: "Error",
      errorCode: "app/invalid-credential",
      httpStatus: 500,
    });
    expect(JSON.stringify(protectedRouteFailureDetails(failure))).not.toContain(
      "private service-account text",
    );
  });

  it("omits unknown codes and does not leak arbitrary exception names", () => {
    const failure = Object.assign(new Error("secret token"), {
      name: "Bearer-secret-token",
      code: "secret-token-value",
      status: 502,
    });

    expect(protectedRouteFailureDetails(failure)).toEqual({
      code: "ACCOUNT_REQUEST_FAILED",
      causeType: "object",
      stage: "request-handler",
      errorName: "OtherError",
      httpStatus: 502,
    });
    expect(JSON.stringify(protectedRouteFailureDetails(failure))).not.toContain(
      "secret",
    );
  });
});

it("identifies fixed startup failures without emitting exception text", () => {
  expect(
    protectedRouteFailureDetails(
      new ProtectedRouteFailure(
        "github-services",
        new Error("Invalid credential vault configuration."),
      ),
    ),
  ).toEqual({
    code: "ACCOUNT_REQUEST_FAILED",
    causeType: "object",
    stage: "github-services",
    errorName: "Error",
    reason: "hosted-vault",
    messageWords: ["invalid", "credential"],
  });
  expect(
    protectedRouteFailureDetails(
      new Error("Invalid credential vault configuration. private key"),
    ),
  ).not.toHaveProperty("reason");
});

it("reports only compiled numeric code locations from a private stack", () => {
  const failure = new Error("private-secret");
  failure.stack =
    "Error: private-secret\n at privateFunction (/var/task/.next/server/chunks/1234.js:5:67)\n at x (/private/user/path.ts:1:2)";
  const details = protectedRouteFailureDetails(failure);
  expect(details).toMatchObject({
    sites: [{ chunk: "1234.js", line: 5, column: 67 }],
  });
  expect(JSON.stringify(details)).not.toMatch(/private|Function|var\/task/);
});

it("handles serialized loader errors without revealing arbitrary message words", () => {
  const details = protectedRouteFailureDetails(
    new ProtectedRouteFailure("github-services", {
      name: "Error",
      message: "Cannot find module private-token-12345",
      stack:
        "Error: private-token-12345\n at loader (/var/task/.next/server/chunks/1234.js:1:2)",
    }),
  );
  expect(details).toMatchObject({
    reason: "module-loading",
    messageWords: ["cannot", "find", "module"],
    sites: [{ chunk: "1234.js", line: 1, column: 2 }],
  });
  expect(JSON.stringify(details)).not.toMatch(/private|token|var\/task/);
});
