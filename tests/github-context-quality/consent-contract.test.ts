import { describe, expect, it, vi } from "vitest";
import type { EvidenceBundle, InterviewContext } from "./contracts";
import {
  hashConsentInput,
  persistedSyntheticSession,
  saveConfirmedDrafts,
  SyntheticConsentHarness,
  type SyntheticConsentInput,
} from "./privacy-contract";

const context: InterviewContext = {
  projectPurpose: "Synthetic records dashboard",
  ownership: "selected-areas",
  contribution: "I built the import parser.",
  selectedPaths: ["src/parser.ts"],
};

function consentInput(
  overrides: Partial<SyntheticConsentInput> = {},
): SyntheticConsentInput {
  const selection: EvidenceBundle = {
    repositoryId: "synthetic-privacy",
    commitSha: "e".repeat(40),
    selectionId: "selection-a",
    sections: [
      {
        id: "section-a",
        repositoryId: "synthetic-privacy",
        commitSha: "e".repeat(40),
        fileId: "parser",
        path: "src/parser.ts",
        blobSha: "f".repeat(40),
        lineStart: 1,
        lineEnd: 2,
        contentHash: "1".repeat(64),
        excerpt: "SYNTHETIC SOURCE SENTINEL",
        role: "implementation",
        topicHints: ["import-parser"],
        safety: "safe",
        warnings: [],
        estimatedTokens: 6,
        sourceBytes: 28,
      },
    ],
    selectedFileIds: ["parser"],
    coveredFeatureHints: ["import-parser"],
    limitations: [],
    budget: {
      selectedTokens: 6,
      selectedBytes: 28,
      selectedLines: 2,
      simulatedRequests: 1,
    },
  };
  return {
    context,
    selection,
    screenshotHashes: ["image-hash-original"],
    ...overrides,
  };
}

describe("synthetic consent and privacy contracts", () => {
  it("makes zero provider calls before consent and after a context or screenshot edit", async () => {
    const harness = new SyntheticConsentHarness();
    const generate = vi.fn(async () => ({ runId: "synthetic-run" }));
    const original = consentInput();
    const approval = { contentHash: hashConsentInput(original) };

    await expect(
      harness.submit({
        current: original,
        idempotencyKey: "run-1",
        provider: { generate },
      }),
    ).resolves.toEqual({ status: "needs-consent" });

    const editedContext = consentInput({
      context: { ...context, contribution: "I built a different parser." },
    });
    await expect(
      harness.submit({
        current: editedContext,
        approval,
        idempotencyKey: "run-1",
        provider: { generate },
      }),
    ).resolves.toEqual({ status: "needs-consent" });

    const replacedScreenshot = consentInput({
      screenshotHashes: ["image-hash-replaced"],
    });
    await expect(
      harness.submit({
        current: replacedScreenshot,
        approval,
        idempotencyKey: "run-1",
        provider: { generate },
      }),
    ).resolves.toEqual({ status: "needs-consent" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("submits only the exact approved bundle and makes an identical retry idempotent", async () => {
    const harness = new SyntheticConsentHarness();
    const input = consentInput();
    const generate = vi.fn(async () => ({ runId: "synthetic-run-1" }));
    const request = {
      current: input,
      approval: { contentHash: hashConsentInput(input) },
      idempotencyKey: "approved-run-1",
      provider: { generate },
    };

    await expect(harness.submit(request)).resolves.toEqual({
      status: "completed",
      result: { runId: "synthetic-run-1" },
    });
    await expect(harness.submit(request)).resolves.toEqual({
      status: "completed",
      result: { runId: "synthetic-run-1" },
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith(input);
  });

  it("rejects reusing an idempotency key for a different approved bundle", async () => {
    const harness = new SyntheticConsentHarness();
    const first = consentInput();
    const generate = vi.fn(async () => ({ runId: "synthetic-run-1" }));
    const firstApproval = { contentHash: hashConsentInput(first) };
    await harness.submit({
      current: first,
      approval: firstApproval,
      idempotencyKey: "same-key",
      provider: { generate },
    });

    const changed = consentInput({ screenshotHashes: ["new-image-hash"] });
    const second = await harness.submit({
      current: changed,
      approval: { contentHash: hashConsentInput(changed) },
      idempotencyKey: "same-key",
      provider: { generate },
    });
    expect(second).toEqual({ status: "idempotency-conflict" });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("saves only selected drafts with explicit contribution confirmation", () => {
    const saved = saveConfirmedDrafts([
      {
        id: "accepted",
        selected: true,
        contributionConfirmed: true,
        text: "Reviewed synthetic claim.",
      },
      {
        id: "not-selected",
        selected: false,
        contributionConfirmed: true,
        text: "Synthetic claim.",
      },
      {
        id: "not-confirmed",
        selected: true,
        contributionConfirmed: false,
        text: "Synthetic claim.",
      },
    ]);
    expect(saved.map(({ id }) => id)).toEqual(["accepted"]);
  });

  it("keeps source text and screenshot bytes out of persistent staging", () => {
    const input = consentInput();
    const session = persistedSyntheticSession(input);
    const serialized = JSON.stringify(session);
    expect(session).toMatchObject({
      repositoryId: "synthetic-privacy",
      sourceFileIds: ["parser"],
      screenshotHashes: ["image-hash-original"],
    });
    expect(serialized).not.toContain("SYNTHETIC SOURCE SENTINEL");
    expect(serialized).not.toContain("data:image/");
    expect(Object.keys(session)).not.toContain("screenshotBytes");
  });
});
