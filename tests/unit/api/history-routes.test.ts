import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/history/route";
import { DELETE, GET as getOne } from "@/app/api/history/[id]/route";
import { GET as getPdf } from "@/app/api/history/[id]/pdf/route";
import {
  GenerationHistoryError,
  listGenerationHistory,
  saveGenerationHistoryItem,
} from "@/lib/generation/history-store";

const roots: string[] = [];
let previousRoot: string | undefined;

/**
 * The history routes resolve their storage root from RESUME_LIBRARY_ROOT, so the
 * tests point it at a temporary directory instead of the developer's own data.
 */
async function createRoot() {
  const root = await mkdtemp(join(tmpdir(), "resume-history-route-test-"));
  roots.push(root);
  await mkdir(join(root, "data"), { recursive: true });
  await copyFile(
    join(process.cwd(), "examples", "sample-resume-library.json"),
    join(root, "data", "resume-library.json"),
  );
  return root;
}

function generationInput(overrides: Record<string, unknown> = {}) {
  return {
    id: "generation-example-role",
    createdAt: "2026-10-19T12:00:00.000Z",
    company: "Example Systems",
    role: "Platform Engineer",
    selectedAchievementIds: ["achievement-api-reliability"],
    generatedBullets: [
      {
        id: "generated-bullet-1",
        text: "Improved service reliability through queue backpressure.",
        section: "experience",
        sourceAchievementIds: ["achievement-api-reliability"],
      },
    ],
    provider: "gemini",
    status: "drafted",
    repairAttemptCount: 1,
    latex: "\\documentclass{article}\\begin{document}Resume\\end{document}",
    ...overrides,
  };
}

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const context = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(async () => {
  previousRoot = process.env.RESUME_LIBRARY_ROOT;
  process.env.RESUME_LIBRARY_ROOT = await createRoot();
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.RESUME_LIBRARY_ROOT;
  else process.env.RESUME_LIBRARY_ROOT = previousRoot;
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("GET /api/history", () => {
  it("returns the saved generations, newest first", async () => {
    const older = await saveGenerationHistoryItem(
      generationInput({
        id: "generation-older-role",
        createdAt: "2026-10-01T12:00:00.000Z",
      }),
    );
    const newer = await saveGenerationHistoryItem(
      generationInput({
        id: "generation-newer-role",
        createdAt: "2026-10-20T12:00:00.000Z",
      }),
    );

    const response = await GET(new Request("http://localhost/api/history"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.entries.map((entry: { id: string }) => entry.id)).toEqual([
      newer.id,
      older.id,
    ]);
  });

  it("returns an empty list when no generation has been saved", async () => {
    const response = await GET(new Request("http://localhost/api/history"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ entries: [] });
  });

  it("reports a corrupted history file without discarding it", async () => {
    const root = process.env.RESUME_LIBRARY_ROOT!;
    await copyFile(
      join(process.cwd(), "examples", "sample-resume-library.json"),
      join(root, "data", "generation-history.json"),
    );
    // The demo library is not a generation history document.
    const response = await GET(new Request("http://localhost/api/history"));

    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.error).toContain("does not match its data schema");
  });
});

describe("POST /api/history", () => {
  it("saves a generation and returns the stored entry", async () => {
    const response = await post(generationInput());

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.entry).toMatchObject({
      id: "generation-example-role",
      role: "Platform Engineer",
      status: "drafted",
    });
    expect(payload.entry.texPath).toMatch(
      /^data\/generations\/generation-example-role-[a-f0-9]{12}\.tex$/,
    );
    await expect(
      listGenerationHistory({ rootDir: process.env.RESUME_LIBRARY_ROOT }),
    ).resolves.toHaveLength(1);
  });

  it("rejects a request body that is not valid JSON", async () => {
    const response = await post("{not-json");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Request body must be valid JSON.",
    });
  });

  it("rejects an invalid generation with actionable field issues", async () => {
    const response = await post(generationInput({ status: "compiled" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("invalid"),
    });
  });

  it("rejects a compiled generation that carries no PDF", async () => {
    const response = await post(generationInput({ status: "compiled" }));

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toContain("invalid");
  });
});

describe("GET /api/history/[id]", () => {
  it("returns the stored entry together with its LaTeX", async () => {
    await saveGenerationHistoryItem(generationInput());

    const response = await getOne(
      new Request("http://localhost/api/history/generation-example-role"),
      context("generation-example-role"),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.entry.id).toBe("generation-example-role");
    expect(payload.latex).toContain("documentclass");
  });

  it("returns 404 for a generation that does not exist", async () => {
    const response = await getOne(
      new Request("http://localhost/api/history/missing-generation"),
      context("missing-generation"),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: "Generation not found.",
    });
  });

  it("returns 404 for an identifier that is not a stable ID", async () => {
    const response = await getOne(
      new Request("http://localhost/api/history/not%20a%20stable%20id"),
      context("not a stable id"),
    );

    expect(response.status).toBe(404);
  });
});

describe("DELETE /api/history/[id]", () => {
  it("deletes a generation and its stored artifacts", async () => {
    const saved = await saveGenerationHistoryItem(generationInput());

    const response = await DELETE(
      new Request("http://localhost/api/history/generation-example-role", {
        method: "DELETE",
      }),
      context("generation-example-role"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deletedId: "generation-example-role",
    });
    await expect(
      listGenerationHistory({ rootDir: process.env.RESUME_LIBRARY_ROOT }),
    ).resolves.toEqual([]);
    expect(saved.texPath).toBeTruthy();
  });

  it("returns 404 when deleting a generation that does not exist", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/history/missing-generation", {
        method: "DELETE",
      }),
      context("missing-generation"),
    );

    expect(response.status).toBe(404);
  });
});

describe("GET /api/history/[id]/pdf", () => {
  it("serves the stored PDF inline with protective headers", async () => {
    const pdfBase64 = Buffer.from("%PDF-1.4\nresume fixture\n%%EOF").toString(
      "base64",
    );
    await saveGenerationHistoryItem(
      generationInput({ status: "compiled", pdfBase64 }),
    );

    const response = await getPdf(
      new Request("http://localhost/api/history/generation-example-role/pdf"),
      context("generation-example-role"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe(
      'inline; filename="resume.pdf"',
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(Buffer.from(await response.arrayBuffer()).toString()).toContain(
      "%PDF-",
    );
  });

  it("serves the PDF as an attachment when a download is requested", async () => {
    const pdfBase64 = Buffer.from("%PDF-1.4\nresume fixture\n%%EOF").toString(
      "base64",
    );
    await saveGenerationHistoryItem(
      generationInput({ status: "compiled", pdfBase64 }),
    );

    const response = await getPdf(
      new Request(
        "http://localhost/api/history/generation-example-role/pdf?download=1",
      ),
      context("generation-example-role"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="resume.pdf"',
    );
  });

  it("returns 404 when the generation has no PDF artifact", async () => {
    await saveGenerationHistoryItem(generationInput());

    const response = await getPdf(
      new Request("http://localhost/api/history/generation-example-role/pdf"),
      context("generation-example-role"),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: "PDF output is not available.",
    });
  });

  it("returns 404 for a generation that does not exist", async () => {
    const response = await getPdf(
      new Request("http://localhost/api/history/missing-generation/pdf"),
      context("missing-generation"),
    );

    expect(response.status).toBe(404);
  });
});

describe("generation history error handling", () => {
  it("surfaces a history with duplicate identifiers as a conflict", async () => {
    const root = process.env.RESUME_LIBRARY_ROOT!;
    const duplicate = {
      schemaVersion: 1,
      entries: [
        {
          id: "generation-example-role",
          createdAt: "2026-10-19T12:00:00.000Z",
          role: "Platform Engineer",
          selectedAchievementIds: [],
          generatedBullets: [],
          provider: "gemini",
          status: "drafted",
          repairAttemptCount: 0,
        },
        {
          id: "generation-example-role",
          createdAt: "2026-10-20T12:00:00.000Z",
          role: "Platform Engineer",
          selectedAchievementIds: [],
          generatedBullets: [],
          provider: "gemini",
          status: "drafted",
          repairAttemptCount: 0,
        },
      ],
    };
    await writeFile(
      join(root, "data", "generation-history.json"),
      JSON.stringify(duplicate),
    );

    const response = await GET(new Request("http://localhost/api/history"));

    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.error).toContain("does not match its data schema");
  });

  it("keeps the storage error type available for callers to inspect", () => {
    const error = new GenerationHistoryError(
      "not-found",
      "Generation not found.",
    );
    expect(error.code).toBe("not-found");
    expect(error.name).toBe("GenerationHistoryError");
  });
});
