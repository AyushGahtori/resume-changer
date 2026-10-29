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
      stage: "request-handler",
      errorName: "OtherError",
      httpStatus: 502,
    });
    expect(JSON.stringify(protectedRouteFailureDetails(failure))).not.toContain(
      "secret",
    );
  });
});
