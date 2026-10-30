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
import { POST as createPoint } from "@/app/api/library/points/handler";
import { PATCH as updatePoint } from "@/app/api/library/points/[id]/handler";
import { POST as editResume } from "@/app/api/resume/edit/handler";
import { GET as measureSkills } from "@/app/api/resume/skills/handler";
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
  "library/points": { POST: direct(createPoint) },
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
