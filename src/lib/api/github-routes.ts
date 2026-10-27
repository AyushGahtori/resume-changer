import { GET as preview } from "@/app/api/github/imports/[id]/drafts/[draftId]/preview/handler";
import * as imports from "@/app/api/github/imports/handler";
import { GET as job } from "@/app/api/github/jobs/[jobId]/handler";
import { GET as events } from "@/app/api/github/jobs/events/handler";
import { GET as notifications } from "@/app/api/library/notifications/handler";
import { POST as readNotification } from "@/app/api/library/notifications/[id]/read/handler";
import {
  startGithubConnection,
  githubConnectionCallback,
  githubConnectionRepositories,
  disconnectGithubConnection,
} from "../github/server/connection-session";

type Handler = (request: Request) => Promise<Response>;
type Match = {
  methods: Partial<Record<"GET" | "POST" | "PUT" | "DELETE", Handler>>;
};

/** Preserve one deployed API function while retaining independently testable handlers. */
export function resolveGithubApiRoute(parts: string[]): Match | null {
  const key = parts.join("/");
  const direct: Record<string, Match["methods"]> = {
    "github/imports": { POST: imports.POST },
    "github/connection/start": { POST: startGithubConnection },
    "github/connection/callback": { GET: githubConnectionCallback },
    "github/connection/repositories": {
      GET: githubConnectionRepositories,
      POST: githubConnectionRepositories,
    },
    "github/connection/disconnect": { POST: disconnectGithubConnection },
    "github/jobs/events": { GET: events },
    "library/notifications": { GET: notifications },
  };
  if (Object.hasOwn(direct, key)) return { methods: direct[key]! };
  const [root, section, id, operation, child] = parts;
  if (root === "github" && section === "jobs" && parts.length === 3)
    return {
      methods: {
        GET: (r) => job(r, { params: Promise.resolve({ jobId: id! }) }),
      },
    };
  if (
    root === "library" &&
    section === "notifications" &&
    operation === "read" &&
    parts.length === 4
  )
    return {
      methods: {
        POST: (r) =>
          readNotification(r, { params: Promise.resolve({ id: id! }) }),
      },
    };
  if (root !== "github" || section !== "imports" || !id) return null;
  const context = { params: Promise.resolve({ id }) };
  if (parts.length === 3)
    return {
      methods: {
        GET: (r) => imports.GETImport(r, context),
        DELETE: (r) => imports.DELETEImport(r, context),
      },
    };
  if (parts.length === 4) {
    const operations: Record<string, Match["methods"]> = {
      inspect: { POST: (r) => imports.POSTInspect(r, context) },
      selection: { PUT: (r) => imports.PUTSelection(r, context) },
      extract: { POST: (r) => imports.POSTExtract(r, context) },
      approve: { POST: (r) => imports.POSTApprove(r, context) },
      cancel: { POST: (r) => imports.POSTCancel(r, context) },
      "measurement-questions": { GET: (r) => imports.GETQuestions(r, context) },
      "measurement-tasks": {
        POST: (r) => imports.POSTMeasurementTask(r, context),
      },
    };
    if (Object.hasOwn(operations, operation!))
      return { methods: operations[operation!]! };
  }
  if (parts.length === 6 && operation === "drafts" && parts[5] === "preview")
    return {
      methods: {
        GET: (r) =>
          preview(r, { params: Promise.resolve({ id, draftId: child! }) }),
      },
    };
  if (parts.length === 5 && operation === "drafts")
    return {
      methods: {
        PUT: (r) =>
          imports.PUTDraft(r, {
            params: Promise.resolve({ id, draftId: child! }),
          }),
      },
    };
  if (parts.length === 5 && operation === "measurement-answers")
    return {
      methods: {
        PUT: (r) =>
          imports.PUTAnswer(r, {
            params: Promise.resolve({ id, questionId: child! }),
          }),
      },
    };
  return null;
}
