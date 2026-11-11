import { createEmulatorIdentity, openApiSession } from "./auth.mjs";
import { expectedLibrary, pointPayload, verifyLibrary } from "./fixtures.mjs";
import {
  classifyHttp,
  observeLibrary,
  reconcileMutation,
} from "./reconcile.mjs";
import { isHostingChallenge } from "../../scripts/user-simulation/http.mjs"; // pragma: allowlist secret
import { sleep, thinkMs } from "./timing.mjs";

function profileBody(profile) {
  return {
    changes: {
      fullName: profile.fullName,
      headline: profile.headline,
      email: profile.email,
      phone: profile.phone,
      location: profile.location,
      links: profile.links.map((link) => ({ url: link.url })),
    },
  };
}

function stepsFor(assignment) {
  const skillIds = assignment.skills.map((skill) => skill.id);
  const steps = [
    {
      name: "profile",
      method: "PATCH",
      path: "/api/library/profile",
      body: profileBody(assignment.profile),
      observeKind: "profile",
      expected: assignment.profile,
    },
    {
      name: "skills",
      method: "PUT",
      path: "/api/library/skills",
      body: { items: assignment.skills },
      observeKind: "skills",
      expected: { names: assignment.skills.map((skill) => skill.name) },
    },
  ];
  for (const job of assignment.jobs) {
    steps.push({
      name: `job:${job.id}`,
      method: "PUT",
      path: `/api/library/jobs/${job.id}`,
      body: { changes: job.changes },
      observeKind: "job",
      expected: { id: job.id, label: job.changes.company },
    });
  }
  for (const project of assignment.projects) {
    steps.push({
      name: `project:${project.id}`,
      method: "PUT",
      path: `/api/library/projects/${project.id}`,
      body: { changes: project.changes },
      observeKind: "project",
      expected: { id: project.id, label: project.changes.name },
    });
  }
  for (const job of assignment.jobs) {
    for (const point of job.points) {
      steps.push({
        name: `point:${point.id}`,
        method: "POST",
        path: "/api/library/points",
        body: pointPayload("job", job.id, point, skillIds),
        observeKind: "point",
        expected: { id: point.id, text: point.text },
        point: true,
      });
    }
  }
  for (const project of assignment.projects) {
    for (const point of project.points) {
      steps.push({
        name: `point:${point.id}`,
        method: "POST",
        path: "/api/library/points",
        body: pointPayload("project", project.id, point, skillIds),
        observeKind: "point",
        expected: { id: point.id, text: point.text },
        point: true,
      });
    }
  }
  return steps;
}

export async function runApiUser({
  assignment,
  baseURL,
  authHost,
  limiter,
  timeoutMs,
  rng,
  onEvent,
  pauseAdmissions,
  signal,
  resume = false,
  pagePaths = ["/", "/library", "/history", "/settings"],
  openSession,
  extraHeaders = {},
}) {
  let session = null;
  let refreshed = false;
  let logicalWrites = 0;
  const completed = new Set();

  async function emit(event) {
    await onEvent?.({
      ...event,
      user: assignment.userNumber,
      channel: event.channel ?? "api",
      at: Date.now(),
    });
  }

  async function transmit(spec) {
    if (signal?.aborted) {
      throw Object.assign(new Error("interrupted"), { code: "interrupted" });
    }
    const limiterWaitMs = spec.limited === false ? 0 : await limiter.acquire();
    const started = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${baseURL}${spec.path}`, {
        method: spec.method,
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Origin: baseURL,
          Accept: "application/json",
          ...extraHeaders,
          ...(spec.body ? { "Content-Type": "application/json" } : {}),
          ...(session
            ? {
                Cookie: session.cookie,
                "X-Workspace-Account": session.uid,
              }
            : {}),
        },
        ...(spec.body ? { body: JSON.stringify(spec.body) } : {}),
      });
      const latencyMs = performance.now() - started;
      if (isHostingChallenge(response.status, response.headers)) {
        throw Object.assign(
          new Error("The hosting provider challenged the request."),
          { code: "challenge", status: response.status },
        );
      }
      const text = await response.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
      await emit({
        type: "response",
        op: spec.name,
        channel: spec.channel ?? "api",
        status: response.status,
        limiterWaitMs,
        latencyMs,
        error: response.status >= 500,
        attempt: spec.attempt ?? 1,
      });
      if (response.status >= 300 && response.status < 400) {
        throw Object.assign(new Error("The load test refuses a redirect."), {
          code: "redirect",
        });
      }
      return { status: response.status, body, latencyMs, limiterWaitMs };
    } catch (error) {
      if (error?.code === "redirect" || error?.code === "challenge")
        throw error;
      const latencyMs = performance.now() - started;
      await emit({
        type: "transport",
        op: spec.name,
        channel: spec.channel ?? "api",
        limiterWaitMs,
        latencyMs,
        error: true,
        attempt: spec.attempt ?? 1,
      });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function readLibrary() {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const result = await transmit({
          name: "read-library",
          method: "GET",
          path: "/api/account/library",
          attempt,
        });
        if (result.status >= 500) {
          if (attempt === 1) {
            await sleep(250, signal);
            continue;
          }
          return null;
        }
        if (result.status !== 200) return null;
        return result.body?.library ?? null;
      } catch (error) {
        if (error?.code === "interrupted" || signal?.aborted) throw error;
        if (attempt === 2) return null;
        await sleep(250, signal);
      }
    }
    return null;
  }

  async function authenticate() {
    if (openSession) {
      const opened = await openSession();
      session = { uid: opened.uid, cookie: opened.cookie };
      await emit({
        type: "response",
        op: "session",
        status: 200,
        limiterWaitMs: 0,
        latencyMs: 0,
        error: false,
      });
      return opened.uid;
    }
    const identity = await createEmulatorIdentity({
      authHost,
      origin: baseURL,
      subject: assignment.subject,
      email: assignment.email,
      displayName: assignment.displayName,
    });
    const limiterWaitMs = await limiter.acquire();
    const started = performance.now();
    const opened = await openApiSession({
      baseURL,
      idToken: identity.idToken,
    });
    await emit({
      type: "response",
      op: "session",
      status: 200,
      limiterWaitMs,
      latencyMs: performance.now() - started,
      error: false,
    });
    session = { uid: identity.uid, cookie: opened.cookie };
    return identity.uid;
  }

  const uid = await authenticate();
  let library = await readLibrary();
  if (!library) {
    throw Object.assign(new Error("The initial library could not be read."), {
      code: "stop",
    });
  }
  const hasContent =
    library.jobs.length ||
    library.projects.length ||
    library.skills.length ||
    library.credentials.length;
  if (hasContent && !resume) {
    throw Object.assign(new Error("Refusing to replace a nonempty account."), {
      code: "integrity",
    });
  }

  for (const pagePath of pagePaths) {
    await sleep(thinkMs(rng, true), signal);
    const result = await transmit({
      name: `page:${pagePath}`,
      method: "GET",
      path: pagePath,
      limited: false,
      channel: "page",
    });
    if (result.status !== 200) {
      throw Object.assign(
        new Error(`Page ${pagePath} returned ${result.status}.`),
        {
          code: "failed",
        },
      );
    }
  }

  for (const step of stepsFor(assignment)) {
    if (signal?.aborted) {
      throw Object.assign(new Error("interrupted"), { code: "interrupted" });
    }
    library = await readLibrary();
    const observed = observeLibrary(step.observeKind, library, step.expected);
    if (observed === "equal") {
      completed.add(step.name);
      await emit({ type: "checkpoint", op: step.name, status: "present" });
      continue;
    }
    if (resume && observed === "conflict") {
      throw Object.assign(
        new Error(`Conflicting saved data for ${step.name}.`),
        {
          code: "integrity",
        },
      );
    }
    await sleep(thinkMs(rng, false), signal);
    let committed = false;
    for (let attempt = 1; attempt <= 2 && !committed; attempt += 1) {
      let result = null;
      let uncertain = false;
      try {
        result = await transmit({ ...step, attempt });
      } catch (error) {
        if (
          error?.code === "interrupted" ||
          error?.code === "redirect" ||
          error?.code === "challenge"
        )
          throw error;
        uncertain = true;
      }
      if (result?.status === 401 && !refreshed) {
        refreshed = true;
        await authenticate();
        attempt -= 1;
        continue;
      }
      const kind = uncertain ? "uncertain" : classifyHttp(result.status);
      if (kind === "quota" || kind === "conflict" || kind === "auth") {
        pauseAdmissions?.();
        throw Object.assign(new Error(`${step.name} failed with ${kind}.`), {
          code: "failed",
        });
      }
      if (kind === "validation" || kind === "fail") {
        throw Object.assign(new Error(`${step.name} was rejected.`), {
          code: "failed",
        });
      }
      if (kind === "ok") {
        const changed = step.point || result.body?.changed !== false;
        if (changed) logicalWrites += 1;
        committed = true;
        break;
      }
      const current = await readLibrary();
      const decision = reconcileMutation(
        "uncertain",
        current
          ? observeLibrary(step.observeKind, current, step.expected)
          : "unavailable",
      );
      if (decision === "checkpoint") {
        committed = true;
        logicalWrites += 1;
        break;
      }
      if (decision === "retry" && attempt === 1) continue;
      if (decision === "stop") {
        throw Object.assign(
          new Error(`${step.name} could not be reconciled.`),
          {
            code: "stop",
          },
        );
      }
      throw Object.assign(
        new Error(`${step.name} conflicted after reconciliation.`),
        {
          code: "failed",
        },
      );
    }
    completed.add(step.name);
    await emit({
      type: "checkpoint",
      op: step.name,
      status: "saved",
      step: completed.size,
    });
  }

  await sleep(thinkMs(rng, true), signal);
  const finalLibrary = await readLibrary();
  if (!finalLibrary) {
    throw Object.assign(
      new Error("The final library read-back was unavailable."),
      {
        code: "stop",
      },
    );
  }
  const skillIds = new Map(
    (finalLibrary.skills ?? []).map((skill) => [
      skill.name.toLowerCase(),
      skill.id,
    ]),
  );
  const errors = verifyLibrary(
    finalLibrary,
    expectedLibrary(assignment, skillIds),
  );
  if (errors.length) {
    throw Object.assign(new Error(errors.join("; ")), { code: "integrity" });
  }
  await emit({
    type: "checkpoint",
    op: "read-back",
    status: "verified",
    step: "done",
  });
  return {
    uid,
    logicalWrites,
    recordIds: {
      jobs: assignment.jobs.map((job) => job.id),
      projects: assignment.projects.map((project) => project.id),
    },
  };
}
