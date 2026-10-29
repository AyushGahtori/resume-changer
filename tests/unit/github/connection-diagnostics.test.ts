import { expect, it } from "vitest";
import {
  callbackValidationDetails,
  connectionFailureDetails,
} from "../../../src/lib/github/server/connection-diagnostics";

it("describes callback validation without revealing credentials or browser state", () => {
  const state = "private-browser-state";
  const request = new Request(
    `https://preview.example/api/github/connection/callback?code=private-oauth-code&state=${state}&error_description=private-description`,
    { headers: { cookie: "session=private-account-token" } },
  );
  const details = callbackValidationDetails(request, state, "authorization");
  expect(details).toMatchObject({
    hasCode: true,
    hasState: true,
    hasStateCookie: true,
    stateMatches: true,
    hasExtraParameters: false,
    hasRepeatedParameters: false,
  });
  expect(JSON.stringify(details)).not.toMatch(
    /private|preview.example|session=/,
  );
});

it("flags repeated and extra parameters and allows only known OAuth error labels", () => {
  const details = callbackValidationDetails(
    new Request(
      "https://preview.example/callback?state=a&code=b&code=c&installation_id=private-installation&error=private-provider-text",
    ),
    undefined,
    "failed",
  );
  expect(details).toMatchObject({
    hasStateCookie: false,
    hasExtraParameters: true,
    hasRepeatedParameters: true,
    oauthError: "other",
  });
  expect(JSON.stringify(details)).not.toContain("private");
});

it("distinguishes a missing stored connection from pending state failure without returning error text", () => {
  expect(
    connectionFailureDetails({
      code: "forbidden",
      message: "GitHub authorization expired or was already used.",
      retryable: false,
    }).reason,
  ).toBe("pending-authorization-missing");
  expect(
    connectionFailureDetails({
      code: "forbidden",
      message: "Connect a GitHub account before selecting repositories.",
      retryable: false,
    }).reason,
  ).toBe("no-stored-connection");
  expect(
    connectionFailureDetails({
      code: "forbidden",
      message: "private provider error",
      retryable: false,
    }),
  ).toEqual({ code: "forbidden", reason: "other" });
});
