import { describe, expect, it } from "vitest";
import sampleLibrary from "../../../examples/sample-resume-library.json";
import { createResumeExportPackage } from "../../../src/lib/generation/export-package";
import { createManualGeneration } from "../../../src/lib/generation/manual-generation";
import type { ResumeLibrary } from "../../../src/lib/schemas/resume-data";

const library = sampleLibrary as ResumeLibrary;
const pointId = library.jobs[0].points[0].id;

function readStoredZip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const files = new Map<string, string>();
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 22, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const name = decoder.decode(
      bytes.subarray(nameStart, nameStart + nameLength),
    );
    const contentStart = nameStart + nameLength + extraLength;
    files.set(
      name,
      decoder.decode(bytes.subarray(contentStart, contentStart + size)),
    );
    offset = contentStart + size;
  }
  return files;
}

function generation() {
  return createManualGeneration(
    library,
    {
      dataSource: "demo",
      company: "Example Systems",
      roleTitle: "Platform Engineer",
      jobUrl: "https://jobs.example/platform",
      jobDescription: "Build platform services and improve reliability.",
      selectedAchievementIds: [pointId],
      tailoringMode: "auto",
    },
    { id: "generation-safe-1", now: new Date("2026-10-19T10:00:00.000Z") },
  );
}

describe("resume export package", () => {
  it("packages generated LaTeX and safe reproducibility metadata without a PDF", async () => {
    const current = generation();
    current.metadata.aiProvider = "gemini";
    current.metadata.fitting = {
      attempts: 3,
      repairAttempts: 1,
      decisions: ["Internal fitting trace must not be exported."],
      status: "filled",
    };
    const exported = createResumeExportPackage(current, null);
    const files = readStoredZip(
      new Uint8Array(await exported.blob.arrayBuffer()),
    );
    const metadataName = "example-systems-platform-engineer.metadata.json";
    const metadata = JSON.parse(files.get(metadataName)!);

    expect(exported.filename).toBe("example-systems-platform-engineer.zip");
    expect(exported.includedPdf).toBe(false);
    expect([...files.keys()]).toEqual([
      "example-systems-platform-engineer.tex",
      metadataName,
    ]);
    expect(files.get("example-systems-platform-engineer.tex")).toContain(
      library.jobs[0].points[0].text,
    );
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      generation: {
        id: "generation-safe-1",
        generatedAt: "2026-10-19T10:00:00.000Z",
        company: "Example Systems",
        roleTitle: "Platform Engineer",
        tailoringMode: "auto",
        selectedAchievementIds: [pointId],
        aiProvider: "gemini",
      },
      validation: {
        latex: "valid",
        pdf: "not-generated",
        pdfPages: null,
        repairAttempts: 1,
        fittingStatus: "filled",
        fittingAttempts: 3,
      },
      files: ["example-systems-platform-engineer.tex", metadataName],
    });
    expect(JSON.stringify(metadata)).not.toContain("jobDescription");
    expect(JSON.stringify(metadata)).not.toContain("jobUrl");
    expect(JSON.stringify(metadata)).not.toContain("decisions");
    expect(JSON.stringify(metadata)).not.toContain("GEMINI_API_KEY");
  });

  it("includes only PDF bytes with a valid PDF signature", async () => {
    const current = generation();
    const valid = createResumeExportPackage(
      current,
      btoa("%PDF-1.7\nverified fixture"),
    );
    const validFiles = readStoredZip(
      new Uint8Array(await valid.blob.arrayBuffer()),
    );
    expect(valid.includedPdf).toBe(true);
    expect(validFiles.get("example-systems-platform-engineer.pdf")).toContain(
      "%PDF-1.7",
    );
    expect(
      JSON.parse(
        validFiles.get("example-systems-platform-engineer.metadata.json")!,
      ).validation,
    ).toMatchObject({ pdf: "verified", pdfPages: 1 });

    const invalid = createResumeExportPackage(current, btoa("not a PDF"));
    expect(invalid.includedPdf).toBe(false);
    expect(
      readStoredZip(new Uint8Array(await invalid.blob.arrayBuffer())).has(
        "example-systems-platform-engineer.pdf",
      ),
    ).toBe(false);
  });

  it("packages the compiled PDF bytes without altering them", async () => {
    const current = generation();
    const pdf = "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n";
    const exported = createResumeExportPackage(current, btoa(pdf));
    const files = readStoredZip(
      new Uint8Array(await exported.blob.arrayBuffer()),
    );
    expect(exported.filename).toBe("example-systems-platform-engineer.zip");
    expect(files.get("example-systems-platform-engineer.pdf")).toBe(pdf);
  });
});
