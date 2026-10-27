import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createE2eGithubServices } from "../../../../src/lib/github/server/testing/e2e-runtime";
import type { Result } from "../../../../src/lib/github/contracts";

const unwrap = <T>(r: Result<T>): T => {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
};
let root: string | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

describe("Gate C synthetic external boundaries", () => {
  it("cannot activate on Vercel or against a personal directory", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("GITHUB_IMPORT_E2E_HARNESS", "1");
    vi.stubEnv("GITHUB_IMPORT_E2E_BACKEND", "1");
    await expect(
      createE2eGithubServices({
        personalRoot: process.cwd(),
        now: () => new Date(),
      }),
    ).rejects.toThrow(/isolated/);
  });
  it("uses the actual PR reader, stores, queue, selector, extractor and atomic writer", async () => {
    root = join(tmpdir(), "resume-changer-playwright-data-" + Date.now());
    await mkdir(join(root, "data"), { recursive: true });
    await copyFile(
      "examples/sample-resume-library.json",
      join(root, "data/resume-library.json"),
    );
    for (const [key, value] of Object.entries({
      VERCEL: "",
      RESUME_APP_MODE: "local",
      RESUME_LIBRARY_ROOT: root,
      GITHUB_IMPORT_E2E_HARNESS: "1",
      GITHUB_IMPORT_E2E_BACKEND: "1",
      NEXT_RUNTIME: "nodejs",
    }))
      vi.stubEnv(key, value);
    const services = await createE2eGithubServices({
      personalRoot: root,
      now: () => new Date(),
    });
    const context = unwrap(
      await services.createContext({
        request: new Request("http://localhost"),
        signal: new AbortController().signal,
      }),
    );
    const scope = unwrap(
      await services.access.authorizeRepository(
        { repositoryId: "42" },
        context,
      ),
    ).scope;
    const prs = unwrap(
      await services.pullRequests.listCandidates({ scope, context }),
    );
    expect(prs.candidates.map((p) => p.number)).toContain(7);
    const library = JSON.parse(
      await readFile(join(root, "data/resume-library.json"), "utf8"),
    );
    const record = unwrap(
      await services.imports.create(
        {
          source: "personal",
          destinationProjectId: library.projects[0].id,
          scope: {
            ...scope,
            selectedPullRequestNumbers: [7],
            contributionStatement:
              "I implemented publishing validation and regression tests.",
          },
        },
        context,
      ),
    );
    unwrap(
      await services.imports.prepare(
        { importId: record.id, expectedVersion: record.version },
        context,
      ),
    );
    const preparation = unwrap(await services.runner.runOnce());
    expect(preparation?.state, JSON.stringify(preparation)).toBe("completed");
    const ready = unwrap(
      await services.imports.get({ importId: record.id }, context),
    );
    expect(ready.prepared?.evidence.length).toBeGreaterThan(0);
    expect(ready.prepared?.completeness).not.toBe("needs-context");
    unwrap(
      await services.imports.enqueueAnalysis(
        {
          importId: record.id,
          expectedVersion: ready.import.version,
          selectionHash: ready.prepared!.selectionHash,
          consentReference: "gate-c-consent",
          idempotencyKey: "gate-c-consent",
        },
        context,
      ),
    );
    const analysis = unwrap(await services.runner.runOnce());
    expect(analysis?.state, JSON.stringify(analysis)).toBe("completed");
    const review = unwrap(
      await services.imports.get({ importId: record.id }, context),
    );
    const draft = review.result!.drafts[0];
    expect(draft.contributionConfirmed).toBe(false);
    unwrap(
      await services.imports.updateDraft(
        {
          importId: record.id,
          draftId: draft.id,
          expectedVersion: review.import.version,
          text: draft.text,
          selectedForSave: true,
          contributionConfirmed: true,
        },
        context,
      ),
    );
    const confirmed = unwrap(
      await services.imports.get({ importId: record.id }, context),
    );
    expect(confirmed.canSaveDraftIds).toContain(draft.id);
    const saved = unwrap(
      await services.imports.approve(
        {
          importId: record.id,
          expectedVersion: confirmed.import.version,
          selectedDraftIds: [draft.id],
          idempotencyKey: "gate-c-save",
        },
        context,
      ),
    );
    expect(saved.savedIds).toHaveLength(1);
  }, 20000);
});
