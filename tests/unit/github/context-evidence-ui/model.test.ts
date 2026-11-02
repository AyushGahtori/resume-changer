import { describe, expect, it } from "vitest";
import { adaptFileCandidate } from "../../../../src/components/github-import/context-evidence-ui/adapter";
import {
  countEvidenceViews,
  countExclusionReasons,
  exclusionMessage,
  filterEvidenceEntries,
  pageEvidenceEntries,
} from "../../../../src/components/github-import/context-evidence-ui/model";
import { buildEvidenceUiEntries } from "../../../../src/components/github-import/context-evidence-ui/testing/fixtures";
import type { FileCandidate } from "../../../../src/lib/github/contracts";

describe("GitHub evidence inventory UI model", () => {
  it("keeps inventory, eligible, selected, and excluded counts distinct", () => {
    const entries = buildEvidenceUiEntries();
    expect(countEvidenceViews(entries)).toEqual({
      selected: 3,
      eligible: 3,
      excluded: 7,
      all: 13,
    });
  });

  it("reports structured exclusion reason counts without merging their meanings", () => {
    const counts = countExclusionReasons(buildEvidenceUiEntries());
    expect(counts).toEqual([
      {
        code: "unsupported-binary",
        label: "Unsupported binary or image file",
        count: 1,
      },
      {
        code: "excessive-text-size",
        label: "Text file exceeds the inspection size limit",
        count: 1,
      },
      {
        code: "credential-like-filename",
        label: "Credential-like filename rule",
        count: 1,
      },
      { code: "unsafe-path", label: "Unsafe repository path", count: 1 },
      { code: "symlink", label: "Symbolic link", count: 1 },
      { code: "submodule", label: "Submodule", count: 1 },
      { code: "content-screening", label: "Content screening", count: 1 },
    ]);
  });

  it("explains a filename rule without claiming a credential was found", () => {
    const message = exclusionMessage({ code: "credential-like-filename" });
    expect(message).toMatch(/filename safety rule/);
    expect(message).toMatch(/does not mean the file contents were read/);
    expect(message).not.toMatch(/^A credential was found/i);
  });

  it("searches by path, role, category, and structured exclusion reason", () => {
    const entries = buildEvidenceUiEntries();
    expect(
      filterEvidenceEntries({ entries, view: "all", query: "deployment" }).map(
        (entry) => entry.id,
      ),
    ).toEqual(["eligible-deployment-docs"]);
    expect(
      filterEvidenceEntries({
        entries,
        view: "excluded",
        query: "filename rule",
      }).map((entry) => entry.id),
    ).toEqual(["excluded-credential-name"]);
    expect(
      filterEvidenceEntries({
        entries,
        view: "selected",
        query: "verification",
      }).map((entry) => entry.id),
    ).toEqual(["verification-aggregate"]);
  });

  it("caps each rendered page for a 10,000-entry inventory", () => {
    const entries = buildEvidenceUiEntries("large");
    expect(entries).toHaveLength(10_000);
    const first = pageEvidenceEntries({ entries, page: 0, pageSize: 50 });
    const last = pageEvidenceEntries({ entries, page: 999, pageSize: 50 });
    expect(first.entries).toHaveLength(50);
    expect(first.pageCount).toBe(200);
    expect(last.page).toBe(199);
    expect(last.entries).toHaveLength(50);
    expect(
      pageEvidenceEntries({ entries, page: 0, pageSize: 10_000 }).entries,
    ).toHaveLength(100);
  });

  it("adapts backend safety flags instead of guessing from path extensions", () => {
    const candidate: FileCandidate = {
      id: "candidate-image",
      path: "assets/chart.png",
      blobSha: "1".repeat(40),
      mode: "100644",
      byteSize: 20_000,
      category: "other",
      reasonCodes: [],
      safety: "blocked",
      eligible: false,
      selected: false,
      pinned: false,
    };
    expect(adaptFileCandidate(candidate)).toMatchObject({
      state: "excluded",
      exclusion: { code: "other" },
    });
    expect(
      adaptFileCandidate(candidate, { safetyFlags: ["binary-candidate"] }),
    ).toMatchObject({
      state: "excluded",
      exclusion: { code: "unsupported-binary" },
    });
  });

  it("keeps content-screening findings separate from filename rules", () => {
    const candidate: FileCandidate = {
      id: "candidate-content-screened",
      path: "fixtures/response.txt",
      blobSha: "2".repeat(40),
      mode: "100644",
      byteSize: 340,
      category: "other",
      reasonCodes: [],
      safety: "blocked",
      eligible: false,
      selected: false,
      pinned: false,
    };
    expect(
      adaptFileCandidate(candidate, { screeningFinding: "secret-content" }),
    ).toMatchObject({
      state: "excluded",
      exclusion: { code: "content-screening", finding: "secret-content" },
    });
    expect(
      exclusionMessage({
        code: "content-screening",
        finding: "secret-content",
      }),
    ).toMatch(/Content screening detected a possible secret/);
  });

  it("fails closed when an unsafe or ineligible candidate is marked selected", () => {
    const candidate: FileCandidate = {
      id: "candidate-invalid-selected",
      path: "config/private.pem",
      blobSha: "3".repeat(40),
      mode: "100644",
      byteSize: 1_200,
      category: "other",
      reasonCodes: [],
      safety: "blocked",
      eligible: false,
      selected: true,
      pinned: false,
    };
    const adapted = adaptFileCandidate(candidate, {
      selectedExcerpt: {
        commitSha: "4".repeat(40),
        blobSha: candidate.blobSha,
        startLine: 1,
        endLine: 1,
        excerptSha256: "5".repeat(64),
        text: "must not become a preview",
      },
    });
    expect(adapted).toMatchObject({ state: "excluded" });
    expect(adapted).not.toHaveProperty("preview");
  });
});
