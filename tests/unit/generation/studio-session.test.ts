import { describe, expect, it } from "vitest";
import { parseStudioSession } from "../../../src/lib/generation/studio-session";
import { studioGeneration } from "../../helpers/studio-fixtures";
describe("local studio sessions", () => {
  const serialized = JSON.stringify({
    jobSignature: "job-a",
    generation: studioGeneration,
    pdfBase64: Buffer.from("%PDF-1.4 test").toString("base64"),
  });
  it("restores a matching resume and its PDF", () => {
    expect(parseStudioSession(serialized, "job-a", "demo")?.generation).toEqual(
      studioGeneration,
    );
  });
  it("rejects damaged, unrelated, or invalid-PDF sessions", () => {
    expect(parseStudioSession("{broken", "job-a", "demo")).toBeNull();
    expect(parseStudioSession(serialized, "job-b", "demo")).toBeNull();
    expect(parseStudioSession(serialized, "job-a", "personal")).toBeNull();
    expect(
      parseStudioSession(
        JSON.stringify({
          jobSignature: "job-a",
          generation: studioGeneration,
          pdfBase64: "not-pdf",
        }),
        "job-a",
        "demo",
      ),
    ).toBeNull();
  });
});
