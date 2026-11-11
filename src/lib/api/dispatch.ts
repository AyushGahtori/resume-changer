import { POST as importHistory } from "@/app/api/account/import/history/handler";
import {
  GET as readLibrary,
  PUT as replaceLibrary,
} from "@/app/api/account/library/handler";
import { POST as writeAchievement } from "@/app/api/ai/achievement/handler";
import { POST as analyzeJob } from "@/app/api/ai/analyze-job-description/handler";
import { POST as autoTailor } from "@/app/api/ai/auto-tailor/handler";
import { POST as selectAchievements } from "@/app/api/ai/select-achievements/handler";
import { POST as tailorAchievements } from "@/app/api/ai/tailor-achievements/handler";
import {
  DELETE as signOut,
  GET as readSession,
  POST as createSession,
} from "@/app/api/auth/session/handler";
import { POST as compile } from "@/app/api/compile/handler";
import { POST as generate } from "@/app/api/generate/handler";
import {
  GET as readHistory,
  POST as saveHistory,
} from "@/app/api/history/handler";
import {
  DELETE as deleteHistoryItem,
  GET as readHistoryItem,
} from "@/app/api/history/[id]/handler";
import { GET as readHistoryPdf } from "@/app/api/history/[id]/pdf/handler";
import {
  GET as listJobAnalyses,
  POST as saveJobAnalysis,
} from "@/app/api/job-analyses/handler";
import {
  DELETE as deleteJobAnalysis,
  GET as readJobAnalysis,
} from "@/app/api/job-analyses/[id]/handler";
import { POST as createParent } from "@/app/api/library/parents/handler";
import { POST as createPoint } from "@/app/api/library/points/handler";
import {
  POST as createSkill,
  PUT as mergeSkillBatch,
} from "@/app/api/library/skills/handler";
import { PATCH as updatePoint } from "@/app/api/library/points/[id]/handler";
import { PATCH as updateProfile } from "@/app/api/library/profile/handler";
import { PUT as upsertJob } from "@/app/api/library/jobs/[id]/handler";
import { PUT as upsertProject } from "@/app/api/library/projects/[id]/handler";
import { GET as loadTestSafety } from "@/lib/load-test/safety-handler";
import { POST as createSkillsBulk } from "@/app/api/library/skills/bulk-handler";
import { POST as createEducation } from "@/app/api/library/education/handler";
import {
  DELETE as deleteEducation,
  PATCH as updateEducation,
} from "@/app/api/library/education/item-handler";
import { POST as createCredential } from "@/app/api/library/credentials/handler";
import {
  DELETE as deleteCredential,
  PATCH as updateCredential,
} from "@/app/api/library/credentials/item-handler";
import { POST as createJob } from "@/app/api/library/jobs/handler";
import {
  DELETE as deleteJob,
  PATCH as updateJob,
} from "@/app/api/library/jobs/item-handler";
import { POST as createProject } from "@/app/api/library/projects/handler";
import {
  DELETE as deleteProject,
  PATCH as updateProject,
} from "@/app/api/library/projects/item-handler";
import { POST as saveNotes } from "@/app/api/library/notes/handler";
import { POST as editResume } from "@/app/api/resume/edit/handler";
import { GET as measureSkills } from "@/app/api/resume/skills/handler";
import { loadTestForbidden } from "@/lib/load-test/runtime";
import { GET as simulationConfig } from "@/app/api/simulation/config/handler";
import { simulationForbidden } from "@/lib/simulation/runtime";
import { resolveGithubApiRoute } from "./github-routes";

type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type RouteContext = { params: Promise<{ id: string }> };
type ApiHandler = (
  request: Request,
  context: RouteContext,
) => Promise<Response>;
type ApiMethods = Partial<Record<ApiMethod, ApiHandler>>;

const emptyContext: RouteContext = { params: Promise.resolve({ id: "" }) };

function direct(handler: (request: Request) => Promise<Response>): ApiHandler {
  return (request) => handler(request);
}

function withId(
  handler: (request: Request, context: RouteContext) => Promise<Response>,
): ApiHandler {
  return (request, context) => handler(request, context);
}

const staticRoutes: Record<string, ApiMethods> = {
  "account/import/history": { POST: direct(importHistory) },
  "account/library": {
    GET: direct(readLibrary),
    PUT: direct(replaceLibrary),
  },
  "ai/achievement": { POST: direct(writeAchievement) },
  "ai/analyze-job-description": { POST: direct(analyzeJob) },
  "ai/auto-tailor": { POST: direct(autoTailor) },
  "ai/select-achievements": { POST: direct(selectAchievements) },
  "ai/tailor-achievements": { POST: direct(tailorAchievements) },
  "auth/session": {
    GET: direct(readSession),
    POST: direct(createSession),
    DELETE: direct(signOut),
  },
  compile: { POST: direct(compile) },
  generate: { POST: direct(generate) },
  history: {
    GET: direct(readHistory),
    POST: direct(saveHistory),
  },
  "job-analyses": {
    GET: direct(listJobAnalyses),
    POST: direct(saveJobAnalysis),
  },
  "library/parents": { POST: direct(createParent) },
  "library/points": { POST: direct(createPoint) },
  "simulation/config": { GET: direct(simulationConfig) },
  "library/skills": { POST: direct(createSkill), PUT: direct(mergeSkillBatch) },
  "load-test/safety": { GET: direct(loadTestSafety) },
  "library/skills/bulk": { POST: direct(createSkillsBulk) },
  "library/profile": { PATCH: direct(updateProfile) },
  "library/education": { POST: direct(createEducation) },
  "library/credentials": { POST: direct(createCredential) },
  "library/jobs": { POST: direct(createJob) },
  "library/projects": { POST: direct(createProject) },
  "library/notes": { POST: direct(saveNotes) },
  "resume/edit": { POST: direct(editResume) },
  "resume/skills": { GET: direct(measureSkills) },
};

export type ApiRouteMatch = {
  methods: ApiMethods;
  context: RouteContext;
};

/** Resolve a public API URL to its independently implemented route handler. */
export function resolveApiRequest(pathname: string): ApiRouteMatch | null {
  let segments: string[];
  try {
    segments = pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }

  if (
    segments[0] !== "api" ||
    segments.some(
      (segment) =>
        segment === "." ||
        segment === ".." ||
        segment.includes("/") ||
        segment.includes("\\"),
    )
  )
    return null;

  const routePath = segments.slice(1);
  const github = resolveGithubApiRoute(routePath);
  if (github) return { methods: github.methods, context: emptyContext };
  const staticKey = routePath.join("/");
  if (Object.hasOwn(staticRoutes, staticKey))
    return { methods: staticRoutes[staticKey], context: emptyContext };

  if (routePath.length === 2 && routePath[0] === "job-analyses" && routePath[1])
    return {
      methods: {
        GET: withId(readJobAnalysis),
        DELETE: withId(deleteJobAnalysis),
      },
      context: { params: Promise.resolve({ id: routePath[1] }) },
    };

  if (routePath.length === 2 && routePath[0] === "history" && routePath[1])
    return {
      methods: {
        GET: withId(readHistoryItem),
        DELETE: withId(deleteHistoryItem),
      },
      context: { params: Promise.resolve({ id: routePath[1] }) },
    };

  if (
    routePath.length === 3 &&
    routePath[0] === "history" &&
    routePath[1] &&
    routePath[2] === "pdf"
  )
    return {
      methods: { GET: withId(readHistoryPdf) },
      context: { params: Promise.resolve({ id: routePath[1] }) },
    };

  if (
    routePath.length === 3 &&
    routePath[0] === "library" &&
    routePath[1] === "points" &&
    routePath[2]
  )
    return {
      methods: { PATCH: withId(updatePoint) },
      context: { params: Promise.resolve({ id: routePath[2] }) },
    };

  if (routePath.length === 3 && routePath[0] === "library" && routePath[2]) {
    const context = { params: Promise.resolve({ id: routePath[2] }) };
    const recordRoutes: Record<string, ApiMethods> = {
      jobs: {
        PUT: withId(upsertJob),
        PATCH: withId(updateJob),
        DELETE: withId(deleteJob),
      },
      projects: {
        PUT: withId(upsertProject),
        PATCH: withId(updateProject),
        DELETE: withId(deleteProject),
      },
      education: {
        PATCH: withId(updateEducation),
        DELETE: withId(deleteEducation),
      },
      credentials: {
        PATCH: withId(updateCredential),
        DELETE: withId(deleteCredential),
      },
    };
    const methods = recordRoutes[routePath[1]];
    if (methods) return { methods, context };
  }

  return null;
}

function allowedMethods(methods: ApiMethods): string {
  const allowed = Object.keys(methods).sort();
  if (methods.GET) allowed.push("HEAD");
  allowed.push("OPTIONS");
  return [...new Set(allowed)].join(", ");
}

function notFound(): Response {
  return Response.json(
    { error: "API route not found." },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}

export function optionsForApiRequest(request: Request): Response {
  const match = resolveApiRequest(new URL(request.url).pathname);
  if (!match) return notFound();
  return new Response(null, {
    status: 204,
    headers: {
      Allow: allowedMethods(match.methods),
      "Cache-Control": "no-store",
    },
  });
}

export async function dispatchApiRequest(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (loadTestForbidden(path, request.method.toUpperCase())) {
    return Response.json(
      {
        error: "This operation is disabled for the local load test.",
        code: "load-test-forbidden",
      },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (simulationForbidden(path, request.method.toUpperCase())) {
    return Response.json(
      {
        error: "This operation is disabled for the user simulation.",
        code: "simulation-forbidden",
      },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (
    (/^\/api\/github\/(?:imports(?:\/|$)|jobs(?:\/|$))/.test(path) ||
      path.startsWith("/api/library/notifications")) &&
    !(
      process.env.VERCEL !== "1" &&
      process.env.GITHUB_IMPORT_E2E_HARNESS === "1"
    )
  ) {
    return Response.json(
      {
        error: {
          code: "needs-context",
          message:
            "This background import has ended. Start a new temporary import in this tab.",
          retryable: false,
        },
      },
      { status: 410, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const match = resolveApiRequest(new URL(request.url).pathname);
  if (!match) return notFound();

  const method = request.method.toUpperCase();
  const handler =
    method === "HEAD" ? match.methods.GET : match.methods[method as ApiMethod];
  if (!handler)
    return Response.json(
      { error: "Method not allowed." },
      {
        status: 405,
        headers: {
          Allow: allowedMethods(match.methods),
          "Cache-Control": "no-store",
        },
      },
    );

  const response = await handler(request, match.context);
  if (method !== "HEAD") return response;
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
