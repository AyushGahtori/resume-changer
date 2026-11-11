import path from "node:path";
import { expectedLibrary, verifyLibrary } from "./fixtures.mjs";
import { sleep, thinkMs } from "./timing.mjs";

function googleToken(assignment) {
  return JSON.stringify({
    sub: assignment.subject,
    email: assignment.email,
    email_verified: true,
    name: assignment.displayName,
  });
}

async function chooseParent(page, parentType, parentId) {
  const value = `${parentType}:${parentId}`;
  const control = page.getByRole("combobox", {
    name: "Job or project for this achievement",
  });
  await control.click();
  await control
    .locator("xpath=..")
    .locator(`.library-select-option[data-value="${value}"]`)
    .click();
}

async function saveAndRead(page, buttonName, match) {
  const responsePromise = page.waitForResponse(
    (response) =>
      match(response.url(), response.request().method()) &&
      response.request().method() !== "OPTIONS",
  );
  await page.getByRole("button", { name: buttonName, exact: true }).click();
  const response = await responsePromise;
  const body = await response.json().catch(() => null);
  if (!response.ok()) {
    const message =
      body?.error || body?.issues?.[0]?.message || response.status();
    throw Object.assign(new Error(`${buttonName} failed: ${message}`), {
      code: "failed",
    });
  }
  return body;
}

export async function runBrowserUser({
  assignment,
  baseURL,
  limiter,
  rng,
  onEvent,
  signal,
  failureFile,
  resume = false,
}) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    baseURL,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(45_000);
  let logicalWrites = 0;
  const recordIds = { jobs: [], projects: [], skills: [] };

  const pageStarted = new Map();
  const apiStarted = new Map();
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/"))
      pageStarted.set(request, performance.now());
  });
  page.on("response", (response) => {
    const request = response.request();
    const url = new URL(request.url());
    const api = url.pathname.startsWith("/api/");
    if (!api && url.hostname !== "127.0.0.1" && url.hostname !== "localhost")
      return;
    const started = api
      ? apiStarted.get(request)?.started
      : pageStarted.get(request);
    const limiterWaitMs = api
      ? (apiStarted.get(request)?.limiterWaitMs ?? 0)
      : 0;
    if (api) apiStarted.delete(request);
    else pageStarted.delete(request);
    void onEvent?.({
      type: "response",
      user: assignment.userNumber,
      channel: api ? "api" : "page",
      op: `${request.method()} ${url.pathname}`,
      status: response.status(),
      limiterWaitMs,
      latencyMs: started == null ? 0 : performance.now() - started,
      error: response.status() >= 500,
      at: Date.now(),
    });
  });
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) return;
    const meta = apiStarted.get(request);
    apiStarted.delete(request);
    void onEvent?.({
      type: "transport",
      user: assignment.userNumber,
      channel: "api",
      op: `${request.method()} ${url.pathname}`,
      limiterWaitMs: meta?.limiterWaitMs ?? 0,
      latencyMs: meta?.started == null ? 0 : performance.now() - meta.started,
      error: true,
      at: Date.now(),
    });
  });

  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (signal?.aborted) {
      await route.abort().catch(() => undefined);
      return;
    }
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      await onEvent?.({
        type: "external",
        user: assignment.userNumber,
        channel: "browser",
        op: url.hostname,
        error: true,
        at: Date.now(),
      });
      await route.abort().catch(() => undefined);
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      const limiterWaitMs = await limiter.acquire();
      apiStarted.set(request, { started: performance.now(), limiterWaitMs });
    }
    await route.continue().catch(() => undefined);
  });

  try {
    // The helper is copied from dev/load-test/browser-auth for this local build only.
    await page.goto("/e2e/load-test-auth", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => typeof window.__resumeLoadTestSignIn === "function",
    );
    const signedIn = await page.evaluate(async (token) => {
      return window.__resumeLoadTestSignIn({ idToken: token });
    }, googleToken(assignment));
    const uid = signedIn?.uid;
    if (!uid)
      throw new Error("The browser did not receive a local account id.");

    for (const pagePath of [
      "/",
      "/library",
      "/history",
      "/settings",
      "/library",
    ]) {
      if (signal?.aborted) {
        throw Object.assign(new Error("interrupted"), { code: "interrupted" });
      }
      await sleep(thinkMs(rng, true), signal);
      const response = await page.goto(pagePath, {
        waitUntil: "domcontentloaded",
      });
      if (!response || response.status() >= 400) {
        throw Object.assign(new Error(`Page ${pagePath} was not available.`), {
          code: "failed",
        });
      }
    }
    await page.getByLabel("Search library").fill("fictional");
    await page.getByLabel("Search library").fill("");
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.evaluate(() => window.scrollTo(0, 0));

    const initial = await page.evaluate(async () => {
      const response = await fetch("/api/account/library");
      if (!response.ok) return null;
      return response.json();
    });
    const library = initial?.library;
    const hasContent =
      library &&
      (library.jobs.length ||
        library.projects.length ||
        library.skills.length ||
        library.credentials.length);
    if (!resume && hasContent) {
      throw Object.assign(
        new Error("Refusing to replace a nonempty account."),
        {
          code: "integrity",
        },
      );
    }

    await sleep(thinkMs(rng, false), signal);
    await page
      .getByRole("button", { name: "Edit profile", exact: true })
      .click();
    const profile = assignment.profile;
    await page.getByLabel("Name", { exact: true }).fill(profile.fullName);
    await page.getByLabel("Headline", { exact: true }).fill(profile.headline);
    await page.getByLabel("Resume contact email").fill(profile.email);
    await page.getByLabel("Phone", { exact: true }).fill(profile.phone);
    await page.getByLabel("Location", { exact: true }).fill(profile.location);
    if (profile.links[0]?.url) {
      if ((await page.getByLabel("Link URL").count()) === 0) {
        await page
          .getByRole("button", { name: "Add link", exact: true })
          .click();
      }
      await page.getByLabel("Link URL").first().fill(profile.links[0].url);
    }
    const profileBody = await saveAndRead(
      page,
      "Save profile",
      (url, method) =>
        url.includes("/api/library/profile") && method === "PATCH",
    );
    if (profileBody?.changed) logicalWrites += 1;
    await page.getByRole("status").last().waitFor();

    await sleep(thinkMs(rng, false), signal);
    await page.getByRole("button", { name: "Add skills", exact: true }).click();
    await page
      .getByLabel("Skill names")
      .fill(assignment.skills.map((skill) => skill.name).join("\n"));
    const skillsBody = await saveAndRead(
      page,
      "Save skills",
      (url, method) => url.endsWith("/api/library/skills") && method === "PUT",
    );
    if (skillsBody?.changed) logicalWrites += 1;
    recordIds.skills = (skillsBody?.skills ?? []).map((skill) => skill.id);

    for (const [index, job] of assignment.jobs.entries()) {
      await sleep(thinkMs(rng, false), signal);
      await page.getByRole("button", { name: "Add job", exact: true }).click();
      await page
        .getByLabel("Company", { exact: true })
        .fill(job.changes.company);
      await page.getByLabel("Title", { exact: true }).fill(job.changes.title);
      if (job.changes.employmentType) {
        await page
          .getByLabel("Employment type")
          .selectOption(job.changes.employmentType);
      }
      if (job.changes.location) {
        await page
          .getByLabel("Location", { exact: true })
          .fill(job.changes.location);
      }
      if (job.changes.startDate) {
        await page.getByLabel("Start month").fill(job.changes.startDate);
      }
      if (job.changes.endDate === null) {
        await page.getByRole("checkbox", { name: "Current role" }).check();
      } else if (job.changes.endDate) {
        await page.getByLabel("End month").fill(job.changes.endDate);
      }
      if (job.changes.description) {
        await page
          .getByRole("textbox", { name: "Description", exact: true })
          .fill(job.changes.description);
      }
      const body = await saveAndRead(
        page,
        "Save job",
        (url, method) =>
          /\/api\/library\/jobs\/[^/]+$/.test(new URL(url).pathname) &&
          method === "PUT",
      );
      if (!body?.job?.id) {
        throw Object.assign(
          new Error("The job save did not return a record."),
          {
            code: "failed",
          },
        );
      }
      if (body.changed) logicalWrites += 1;
      recordIds.jobs[index] = body.job.id;
    }

    for (const [index, project] of assignment.projects.entries()) {
      await sleep(thinkMs(rng, false), signal);
      await page
        .getByRole("button", { name: "Add project", exact: true })
        .click();
      await page.getByLabel("Name", { exact: true }).fill(project.changes.name);
      if (project.changes.role) {
        await page
          .getByLabel("Role", { exact: true })
          .fill(project.changes.role);
      }
      if (project.changes.url) {
        await page.getByLabel("URL", { exact: true }).fill(project.changes.url);
      }
      if (project.changes.description) {
        await page
          .getByRole("textbox", { name: "Description", exact: true })
          .fill(project.changes.description);
      }
      if (project.changes.startDate) {
        await page.getByLabel("Start month").fill(project.changes.startDate);
      }
      if (project.changes.endDate === null) {
        await page.getByRole("checkbox", { name: "Ongoing project" }).check();
      } else if (project.changes.endDate) {
        await page.getByLabel("End month").fill(project.changes.endDate);
      }
      const body = await saveAndRead(
        page,
        "Save project",
        (url, method) =>
          /\/api\/library\/projects\/[^/]+$/.test(new URL(url).pathname) &&
          method === "PUT",
      );
      if (!body?.project?.id) {
        throw Object.assign(
          new Error("The project save did not return a record."),
          {
            code: "failed",
          },
        );
      }
      if (body.changed) logicalWrites += 1;
      recordIds.projects[index] = body.project.id;
    }

    const parents = [
      ...assignment.jobs.map((job, index) => ({
        type: "job",
        id: recordIds.jobs[index],
        points: job.points,
      })),
      ...assignment.projects.map((project, index) => ({
        type: "project",
        id: recordIds.projects[index],
        points: project.points,
      })),
    ];
    const skillNames = assignment.skills.slice(0, 2).map((skill) => skill.name);
    for (const parent of parents) {
      for (const point of parent.points) {
        if (signal?.aborted) {
          throw Object.assign(new Error("interrupted"), {
            code: "interrupted",
          });
        }
        await sleep(thinkMs(rng, false), signal);
        await page
          .getByRole("button", { name: "Detailed entry", exact: true })
          .click();
        await page.getByLabel("Achievement ID").fill(point.id);
        await chooseParent(page, parent.type, parent.id);
        await page.getByLabel("Achievement text").fill(point.text);
        await page.getByLabel("Tags, separated by commas").fill("fictional");
        await page.getByLabel("Source label").fill("Fictional load test");
        for (const name of skillNames) {
          await page
            .getByRole("group", { name: "Linked skills" })
            .getByRole("button", { name, exact: true })
            .click();
        }
        if (point.metric) {
          await page
            .getByRole("button", { name: "Add metric", exact: true })
            .click();
          const fields = page.locator(".metric-fields");
          await fields.getByLabel("Label").fill("Fictional latency");
          await fields.getByLabel("Value").fill("250");
          await fields.getByLabel("Unit").fill("ms");
          await fields
            .getByLabel("Evidence")
            .fill(
              "Fictional load-test observation, not a measured production result.",
            );
        }
        const body = await saveAndRead(
          page,
          "Save achievement",
          (url, method) =>
            url.endsWith("/api/library/points") && method === "POST",
        );
        if (!body?.point?.id) {
          throw Object.assign(
            new Error("The achievement save did not return a point."),
            {
              code: "failed",
            },
          );
        }
        logicalWrites += 1;
      }
    }

    await sleep(thinkMs(rng, true), signal);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page
      .getByText(assignment.jobs[0].changes.company)
      .filter({ visible: true })
      .first()
      .waitFor();
    await page
      .getByText(assignment.jobs[0].points[0].text)
      .filter({ visible: true })
      .first()
      .waitFor();
    const toggle = page.getByRole("button").filter({ hasText: "JOB" }).first();
    if (await toggle.count()) {
      await toggle.click();
      await toggle.click();
    }
    const finalPayload = await page.evaluate(async () => {
      const response = await fetch("/api/account/library");
      if (!response.ok) return null;
      return response.json();
    });
    if (!finalPayload?.library) {
      throw Object.assign(
        new Error("The final library read-back was unavailable."),
        {
          code: "stop",
        },
      );
    }
    const skillIds = new Map(
      (finalPayload.library.skills ?? []).map((skill) => [
        skill.name.toLowerCase(),
        skill.id,
      ]),
    );
    const expected = expectedLibrary(
      {
        ...assignment,
        jobs: assignment.jobs.map((job, index) => ({
          ...job,
          id: recordIds.jobs[index],
        })),
        projects: assignment.projects.map((project, index) => ({
          ...project,
          id: recordIds.projects[index],
        })),
      },
      skillIds,
    );
    const errors = verifyLibrary(finalPayload.library, expected);
    if (errors.length) {
      throw Object.assign(new Error(errors.join("; ")), { code: "integrity" });
    }
    await onEvent?.({
      type: "checkpoint",
      user: assignment.userNumber,
      channel: "browser",
      op: "read-back",
      status: "verified",
      at: Date.now(),
    });
    return { uid, logicalWrites, recordIds };
  } catch (error) {
    if (failureFile) {
      await page
        .screenshot({ path: failureFile, fullPage: true })
        .catch(() => undefined);
    }
    throw error;
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

export function failurePath(directory, userNumber) {
  return path.join(
    directory,
    `user-${String(userNumber).padStart(4, "0")}.png`,
  );
}
