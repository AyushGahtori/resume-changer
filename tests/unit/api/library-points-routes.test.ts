import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/library/points/route";
import { PATCH } from "@/app/api/library/points/[id]/route";
import type { ResumeLibrary } from "@/lib/schemas/resume-data";

const roots: string[] = [];
let previousRoot: string | undefined;
let libraryFile: string;

/**
 * The library routes write to the personal library under RESUME_LIBRARY_ROOT, so
 * the tests point that at a temporary copy of the fictional demo library.
 */
async function createRoot() {
  const root = await mkdtemp(join(tmpdir(), "resume-library-route-test-"));
  roots.push(root);
  await mkdir(join(root, "data"), { recursive: true });
  libraryFile = join(root, "data", "resume-library.json");
  await copyFile(
    join(process.cwd(), "examples", "sample-resume-library.json"),
    libraryFile,
  );
  return root;
}

async function readLibrary() {
  return JSON.parse(await readFile(libraryFile, "utf8")) as ResumeLibrary;
}

function newPoint(id = "achievement-new-route-entry") {
  return {
    id,
    text: "Added a synthetic route test achievement for reliable releases.",
    tags: ["testing"],
    skillIds: ["skill-automation"],
    metrics: [],
    source: { type: "direct-user" as const, label: "Synthetic route test" },
    enabled: true,
  };
}

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/library/points", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

function patch(id: string, body: unknown) {
  return PATCH(
    new Request(`http://localhost/api/library/points/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

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

describe("POST /api/library/points", () => {
  it("adds an achievement to the selected job and persists it", async () => {
    const library = await readLibrary();
    const parentId = library.jobs[0].id;

    const response = await post({
      parentType: "job",
      parentId,
      point: newPoint(),
    });

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.point.id).toBe("achievement-new-route-entry");

    const saved = await readLibrary();
    const job = saved.jobs.find((item) => item.id === parentId)!;
    expect(job.points.map((point) => point.id)).toContain(
      "achievement-new-route-entry",
    );
  });

  it("persists reviewed text, selected skills, and source attribution", async () => {
    const library = await readLibrary();
    const parentId = library.jobs[0].id;
    const reviewedText =
      "Reviewed wording is the only text sent to the library writer.";
    const sourceAchievementIds = ["achievement-cloud-deployment-platform"];
    const skillIds = ["skill-automation"];
    const point = {
      ...newPoint("achievement-reviewed-canvas-entry"),
      text: reviewedText,
      skillIds,
      source: {
        type: "direct-user" as const,
        label: "Reviewed in Imagination Canvas",
        reference: JSON.stringify({ sourceAchievementIds, skillIds }),
      },
    };

    const response = await post({ parentType: "job", parentId, point });

    expect(response.status).toBe(201);
    const saved = await readLibrary();
    const persisted = saved.jobs
      .find((item) => item.id === parentId)!
      .points.find((item) => item.id === point.id)!;
    expect(persisted.text).toBe(reviewedText);
    expect(persisted.skillIds).toEqual(skillIds);
    expect(persisted.source).toEqual(point.source);
  });

  it("adds an achievement to a project", async () => {
    const library = await readLibrary();
    const parentId = library.projects[0].id;

    const response = await post({
      parentType: "project",
      parentId,
      point: newPoint("achievement-new-project-entry"),
    });

    expect(response.status).toBe(201);
    const saved = await readLibrary();
    const project = saved.projects.find((item) => item.id === parentId)!;
    expect(project.points.map((point) => point.id)).toContain(
      "achievement-new-project-entry",
    );
  });

  it("rejects a request body that is not valid JSON", async () => {
    const response = await post("{not-json");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Request body must be valid JSON.",
    });
  });

  it("rejects an invalid achievement with field-level issues", async () => {
    const response = await post({
      parentType: "job",
      parentId: "job-example-cloud-labs",
      point: { ...newPoint(), text: "" },
    });

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toBe("Check the achievement fields and try again.");
    expect(payload.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "point.text" })]),
    );
  });

  it("rejects a point that links the same skill twice", async () => {
    const response = await post({
      parentType: "job",
      parentId: "job-example-cloud-labs",
      point: {
        ...newPoint(),
        skillIds: ["skill-automation", "skill-automation"],
      },
    });

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "point.skillIds" }),
      ]),
    );
  });

  it("returns 404 when the selected job does not exist", async () => {
    const response = await post({
      parentType: "job",
      parentId: "job-does-not-exist",
      point: newPoint(),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: "The selected job or project was not found.",
    });
  });

  it("leaves the stored library unchanged when the change is rejected", async () => {
    const before = await readFile(libraryFile, "utf8");

    await post({
      parentType: "job",
      parentId: "job-does-not-exist",
      point: newPoint(),
    });

    await expect(readFile(libraryFile, "utf8")).resolves.toBe(before);
  });
});

describe("PATCH /api/library/points/[id]", () => {
  it("updates an achievement and persists the change", async () => {
    const response = await patch("achievement-cloud-deployment-platform", {
      changes: { text: "Reworded synthetic achievement for the route test." },
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.point.text).toBe(
      "Reworded synthetic achievement for the route test.",
    );

    const saved = await readLibrary();
    const point = saved.jobs
      .flatMap((job) => job.points)
      .find((item) => item.id === "achievement-cloud-deployment-platform");
    expect(point?.text).toBe(
      "Reworded synthetic achievement for the route test.",
    );
  });

  it("can disable an achievement without removing it", async () => {
    const response = await patch("achievement-cloud-deployment-platform", {
      changes: { enabled: false },
    });

    expect(response.status).toBe(200);
    const saved = await readLibrary();
    const point = saved.jobs
      .flatMap((job) => job.points)
      .find((item) => item.id === "achievement-cloud-deployment-platform");
    expect(point?.enabled).toBe(false);
  });

  it("rejects a request body that is not valid JSON", async () => {
    const response = await patch("achievement-cloud-deployment-platform", "{");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Request body must be valid JSON.",
    });
  });

  it("rejects a change with no fields", async () => {
    const response = await patch("achievement-cloud-deployment-platform", {
      changes: {},
    });

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "changes" })]),
    );
  });

  it("rejects an unknown field in the change", async () => {
    const response = await patch("achievement-cloud-deployment-platform", {
      changes: { unsupportedField: "value" },
    });

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "changes" })]),
    );
  });

  it("returns 404 when the achievement does not exist", async () => {
    const response = await patch("achievement-does-not-exist", {
      changes: { enabled: false },
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: "The achievement point was not found.",
    });
  });

  it("leaves the stored library unchanged when the change is rejected", async () => {
    const before = await readFile(libraryFile, "utf8");

    await patch("achievement-does-not-exist", { changes: { enabled: false } });

    await expect(readFile(libraryFile, "utf8")).resolves.toBe(before);
  });
});
