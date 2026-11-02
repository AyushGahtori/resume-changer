import "server-only";
import {
  DOMAIN_ERROR_HTTP_STATUS,
  DeferredMeasurementTaskSchema,
  DraftSchema,
  DomainErrorSchema,
  ImportQuestionSchema,
  ImportRecordSchema,
  ImportReviewStateSchema,
  MeasurementResultSchema,
  JobRecordSchema,
  type DomainErrorCode,
} from "@/lib/github/contracts";
import { z } from "zod";
import {
  AccountAccessError,
  assertAccountBinding,
  assertSameOrigin,
  getAppMode,
  readBoundedBody,
} from "@/lib/cloud/security";
import { accountContext, accountFromRequest } from "@/lib/cloud/server-account";
import { privateResponse } from "@/lib/cloud/protect-route";
import {
  ApproveInputSchema,
  CancelInputSchema,
  CreateImportInputSchema,
  DiscardInputSchema,
  DraftUpdateInputSchema,
  ExtractInputSchema,
  InspectInputSchema,
  MeasurementAnswerInputSchema,
  MeasurementTaskInputSchema,
  RouteIdSchema,
  SelectionInputSchema,
  type ApproveInput,
  type CancelInput,
  type CreateImportInput,
  type DiscardInput,
  type DraftUpdateInput,
  type ExtractInput,
  type InspectInput,
  type MeasurementAnswerInput,
  type MeasurementTaskInput,
  type SelectionInput,
} from "./http-contracts";
import {
  getGithubImportHttpFacade,
  type AcceptedJob,
  type GithubImportHttpFacade,
  type RequestAuthority,
  type ServiceResult,
} from "./facade";

const MAX_BODY_BYTES = 64 * 1024;
const MeasurementAnswerResponseSchema = z
  .object({
    version: z.number().int().positive(),
    result: MeasurementResultSchema.nullable(),
  })
  .strict();
const ApprovalResponseSchema = z
  .object({
    savedIds: z.array(RouteIdSchema).max(100),
    alreadyApplied: z.boolean(),
  })
  .strict();

export type ImportRouteContext = {
  params: Promise<{ id: string }>;
};

export type DraftRouteContext = {
  params: Promise<{ id: string; draftId: string }>;
};

export type QuestionRouteContext = {
  params: Promise<{ id: string; questionId: string }>;
};

type FacadeProvider = (
  request: Request,
) => GithubImportHttpFacade | Promise<GithubImportHttpFacade>;

type ResolvedAuthority = {
  authority: RequestAuthority;
  account?: Awaited<ReturnType<typeof accountFromRequest>>;
};

type AuthorityProvider = (request: Request) => Promise<ResolvedAuthority>;

type Operation<T> = (authority: RequestAuthority) => Promise<{
  result: ServiceResult<T>;
  status: number;
  body?: (value: T) => unknown;
}>;

type SafeError = {
  code: DomainErrorCode;
  message: string;
  retryable: boolean;
  retryAfterSeconds?: number;
};

const PUBLIC_MESSAGES: Record<DomainErrorCode, string> = {
  "invalid-input": "The request is invalid.",
  forbidden: "This action is not available for this account.",
  "not-found": "The import is unavailable.",
  "version-conflict": "This import changed. Refresh and try again.",
  "limit-exceeded": "The request exceeds the supported limit.",
  "needs-context": "More contribution context is required.",
  "invalid-evidence": "The selected evidence could not be used.",
  "rate-limited": "The import service is rate-limited.",
  unavailable: "The import service is temporarily unavailable.",
  "upstream-error": "The upstream service could not complete the request.",
  "io-error": "The import could not be stored.",
  cancelled: "The import was cancelled.",
  interrupted: "The import was interrupted.",
};

const STATUS_BY_ERROR = DOMAIN_ERROR_HTTP_STATUS;

class RouteFailure extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RouteFailure";
  }
}

function failureResponse(
  error: SafeError,
  status = STATUS_BY_ERROR[error.code],
) {
  const headers = new Headers();
  if (error.code === "rate-limited" && error.retryAfterSeconds !== undefined)
    headers.set("Retry-After", String(error.retryAfterSeconds));
  return Response.json(
    { error: DomainErrorSchema.parse(error) },
    { status, headers },
  );
}

function safeServiceError(value: unknown): SafeError {
  if (!value || typeof value !== "object")
    return {
      code: "unavailable",
      message: PUBLIC_MESSAGES.unavailable,
      retryable: true,
    };

  const error = value as Record<string, unknown>;
  const parsed = DomainErrorSchema.safeParse(error);
  const code = parsed.success ? parsed.data.code : "unavailable";
  const retryAfterSeconds =
    parsed.success &&
    parsed.data.retryAfterSeconds !== undefined &&
    parsed.data.retryAfterSeconds > 0 &&
    parsed.data.retryAfterSeconds <= 86_400
      ? parsed.data.retryAfterSeconds
      : undefined;

  return {
    code,
    message: PUBLIC_MESSAGES[code],
    retryable: parsed.success ? parsed.data.retryable : true,
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  };
}

function safeRouteError(error: unknown): SafeError {
  if (error && typeof error === "object" && "domainError" in error)
    return safeServiceError(error.domainError);
  if (error instanceof RouteFailure) {
    return {
      code: error.code,
      message: PUBLIC_MESSAGES[error.code],
      retryable: false,
    };
  }

  if (error instanceof AccountAccessError) {
    const code: DomainErrorCode =
      error.code === "PAYLOAD_TOO_LARGE"
        ? "limit-exceeded"
        : error.code === "RATE_LIMITED"
          ? "rate-limited"
          : error.code === "INVALID_REQUEST"
            ? "invalid-input"
            : error.code === "FORBIDDEN" || error.code === "AUTH_REQUIRED"
              ? "forbidden"
              : "unavailable";
    return {
      code,
      message: PUBLIC_MESSAGES[code],
      retryable: code === "unavailable" || code === "rate-limited",
    };
  }

  return {
    code: "unavailable",
    message: PUBLIC_MESSAGES.unavailable,
    retryable: true,
  };
}

function sendFailure(error: unknown): Response {
  const safe = safeRouteError(error);
  const isUpstreamTimeout =
    (error instanceof Error && error.name === "TimeoutError") ||
    (error &&
      typeof error === "object" &&
      "code" in error &&
      ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(String(error.code)));
  const status = isUpstreamTimeout
    ? 504
    : error instanceof AccountAccessError && error.status === 401
      ? 403
      : STATUS_BY_ERROR[safe.code];
  if (isUpstreamTimeout) {
    return failureResponse(
      {
        code: "upstream-error",
        message: PUBLIC_MESSAGES["upstream-error"],
        retryable: true,
      },
      status,
    );
  }
  return failureResponse(safe, status);
}

function sendServiceResult<T>(
  result: ServiceResult<T>,
  status: number,
  body: (value: T) => unknown = (value) => ({ data: value }),
): Response {
  if (!result || typeof result !== "object" || typeof result.ok !== "boolean")
    return failureResponse(safeServiceError(undefined));
  if (!result.ok) return failureResponse(safeServiceError(result.error));
  return Response.json(body(result.value), { status });
}

async function readBody<T>(
  request: Request,
  schema: {
    safeParse(value: unknown): { success: true; data: T } | { success: false };
  },
): Promise<T> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json")
    throw new RouteFailure("invalid-input", "A JSON request is required.");

  let bytes: Uint8Array;
  try {
    bytes = await readBoundedBody(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof AccountAccessError) throw error;
    throw new RouteFailure("invalid-input", "The request body is invalid.");
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch {
    throw new RouteFailure("invalid-input", "The request body is invalid.");
  }

  const parsed = schema.safeParse(decoded);
  if (!parsed.success)
    throw new RouteFailure("invalid-input", "The request body is invalid.");
  return parsed.data;
}

function readPathId(value: string, label: string): string {
  const parsed = RouteIdSchema.safeParse(value);
  if (!parsed.success)
    throw new RouteFailure("invalid-input", `The ${label} is invalid.`);
  return parsed.data;
}

async function requestAuthority(request: Request): Promise<ResolvedAuthority> {
  const mutating = !["GET", "HEAD", "OPTIONS"].includes(
    request.method.toUpperCase(),
  );
  if (mutating) {
    assertSameOrigin(request);
  } else {
    const site = request.headers.get("sec-fetch-site");
    if (site && site !== "same-origin" && site !== "none")
      throw new AccountAccessError(
        "Cross-site requests are not allowed.",
        "FORBIDDEN",
        403,
      );
    if (request.headers.has("origin")) assertSameOrigin(request);
  }

  if (getAppMode() === "local") return { authority: { kind: "local" } };

  const account = await accountFromRequest(request);
  assertAccountBinding(request, account.uid);
  return {
    authority: { kind: "account", accountId: account.uid },
    account,
  };
}

function dataEnvelope(value: unknown) {
  const version =
    value &&
    typeof value === "object" &&
    "version" in value &&
    typeof value.version === "number" &&
    Number.isInteger(value.version)
      ? value.version
      : undefined;
  return { data: value, ...(version === undefined ? {} : { version }) };
}

function validatedEnvelope<T>(
  schema: z.ZodType<T>,
  value: unknown,
): { data: T; version?: number } {
  return dataEnvelope(schema.parse(value)) as { data: T; version?: number };
}

function acceptedJobEnvelope(value: AcceptedJob, includeRun: boolean) {
  if (value.job) return validatedEnvelope(JobRecordSchema, value.job);
  const jobId = RouteIdSchema.safeParse(value?.jobId);
  const runId =
    value?.runId === undefined
      ? undefined
      : RouteIdSchema.safeParse(value.runId);
  if (!jobId.success || (runId && !runId.success))
    throw new RouteFailure(
      "unavailable",
      "The accepted job reference is invalid.",
    );

  return {
    data: {
      jobId: jobId.data,
      ...(includeRun && runId?.success ? { runId: runId.data } : {}),
      statusUrl: `/api/github/jobs/${encodeURIComponent(jobId.data)}`,
      ...(value.duplicate === true ? { duplicate: true } : {}),
    },
  };
}

export function createGithubImportHandlers(
  facadeProvider: FacadeProvider = getGithubImportHttpFacade,
  authorityProvider: AuthorityProvider = requestAuthority,
) {
  async function endpoint<T>(
    request: Request,
    operation: Operation<T>,
  ): Promise<Response> {
    try {
      const { authority, account } = await authorityProvider(request);
      const invoke = async () => {
        const outcome = await operation(authority);
        return sendServiceResult(outcome.result, outcome.status, outcome.body);
      };
      const response = account
        ? await accountContext.run(account, invoke)
        : await invoke();
      return privateResponse(response);
    } catch (error) {
      return privateResponse(sendFailure(error));
    }
  }

  return {
    create: (request: Request) =>
      endpoint(request, async (authority) => {
        const input: CreateImportInput = await readBody(
          request,
          CreateImportInputSchema,
        );
        const facade = await facadeProvider(request);
        return {
          result: await facade.create({ authority, input }),
          status: 201,
          body: (value) => validatedEnvelope(ImportRecordSchema, value),
        };
      }),

    inspect: (request: Request, context: ImportRouteContext) =>
      endpoint<AcceptedJob>(request, async (authority) => {
        const importId = await readPathId(
          (await context.params).id,
          "import ID",
        );
        const input: InspectInput = await readBody(request, InspectInputSchema);
        const facade = await facadeProvider(request);
        return {
          result: await facade.inspect({ authority, importId, input }),
          status: 202,
          body: (value) => acceptedJobEnvelope(value, false),
        };
      }),

    selection: (request: Request, context: ImportRouteContext) =>
      endpoint(request, async (authority) => {
        const importId = await readPathId(
          (await context.params).id,
          "import ID",
        );
        const input: SelectionInput = await readBody(
          request,
          SelectionInputSchema,
        );
        const facade = await facadeProvider(request);
        return {
          result: await facade.changeSelection({ authority, importId, input }),
          status: 200,
          body: (value) => validatedEnvelope(ImportRecordSchema, value),
        };
      }),

    extract: (request: Request, context: ImportRouteContext) =>
      endpoint<AcceptedJob>(request, async (authority) => {
        const importId = await readPathId(
          (await context.params).id,
          "import ID",
        );
        const input: ExtractInput = await readBody(request, ExtractInputSchema);
        const facade = await facadeProvider(request);
        return {
          result: await facade.enqueueAnalysis({ authority, importId, input }),
          status: 202,
          body: (value) => acceptedJobEnvelope(value, true),
        };
      }),

    get: (request: Request, context: ImportRouteContext) =>
      endpoint(request, async (authority) => {
        const importId = await readPathId(
          (await context.params).id,
          "import ID",
        );
        const facade = await facadeProvider(request);
        return {
          result: await facade.get({ authority, importId }),
          status: 200,
          body: (value) => {
            const data = ImportReviewStateSchema.parse(value);
            return { data, version: data.import.version };
          },
        };
      }),

    updateDraft: (request: Request, context: DraftRouteContext) =>
      endpoint(request, async (authority) => {
        const { id, draftId: rawDraftId } = await context.params;
        const importId = await readPathId(id, "import ID");
        const draftId = await readPathId(rawDraftId, "draft ID");
        const input: DraftUpdateInput = await readBody(
          request,
          DraftUpdateInputSchema,
        );
        const facade = await facadeProvider(request);
        return {
          result: await facade.updateDraft({
            authority,
            importId,
            draftId,
            input,
          }),
          status: 200,
          body: (value) => validatedEnvelope(DraftSchema, value),
        };
      }),

    questions: (request: Request, context: ImportRouteContext) =>
      endpoint(request, async (authority) => {
        const importId = await readPathId(
          (await context.params).id,
          "import ID",
        );
        const facade = await facadeProvider(request);
        return {
          result: await facade.questions({ authority, importId }),
          status: 200,
          body: (value) => ({
            data: z.array(ImportQuestionSchema).max(40).parse(value),
          }),
        };
      }),

    answer: (request: Request, context: QuestionRouteContext) =>
      endpoint(request, async (authority) => {
        const { id, questionId: rawQuestionId } = await context.params;
        const importId = await readPathId(id, "import ID");
        const questionId = await readPathId(rawQuestionId, "question ID");
        const input: MeasurementAnswerInput = await readBody(
          request,
          MeasurementAnswerInputSchema,
        );
        const facade = await facadeProvider(request);
        return {
          result: await facade.answer({
            authority,
            importId,
            questionId,
            input,
          }),
          status: 200,
          body: (value) =>
            validatedEnvelope(MeasurementAnswerResponseSchema, value),
        };
      }),

    measurementTask: (request: Request, context: ImportRouteContext) =>
      endpoint(request, async (authority) => {
        const importId = await readPathId(
          (await context.params).id,
          "import ID",
        );
        const input: MeasurementTaskInput = await readBody(
          request,
          MeasurementTaskInputSchema,
        );
        const facade = await facadeProvider(request);
        return {
          result: await facade.saveMeasurementTask({
            authority,
            importId,
            input,
          }),
          status: 201,
          body: (value) =>
            validatedEnvelope(DeferredMeasurementTaskSchema, value),
        };
      }),

    approve: (request: Request, context: ImportRouteContext) =>
      endpoint(request, async (authority) => {
        const importId = await readPathId(
          (await context.params).id,
          "import ID",
        );
        const input: ApproveInput = await readBody(request, ApproveInputSchema);
        const facade = await facadeProvider(request);
        const result = await facade.approve({ authority, importId, input });
        return {
          result,
          status: result.ok && result.value.alreadyApplied ? 200 : 201,
          body: (value) => validatedEnvelope(ApprovalResponseSchema, value),
        };
      }),

    cancel: (request: Request, context: ImportRouteContext) =>
      endpoint(request, async (authority) => {
        const importId = await readPathId(
          (await context.params).id,
          "import ID",
        );
        const input: CancelInput = await readBody(request, CancelInputSchema);
        const facade = await facadeProvider(request);
        return {
          result: await facade.cancel({ authority, importId, input }),
          status: 200,
          body: (value) => validatedEnvelope(ImportRecordSchema, value),
        };
      }),

    discard: (request: Request, context: ImportRouteContext) =>
      endpoint(request, async (authority) => {
        const importId = await readPathId(
          (await context.params).id,
          "import ID",
        );
        const input: DiscardInput = await readBody(request, DiscardInputSchema);
        const facade = await facadeProvider(request);
        return {
          result: await facade.discard({ authority, importId, input }),
          status: 200,
          body: (value) =>
            validatedEnvelope(
              z.object({ discarded: z.literal(true) }).strict(),
              value,
            ),
        };
      }),
  };
}

const handlers = createGithubImportHandlers();

export const POST = handlers.create;
export const POSTInspect = handlers.inspect;
export const PUTSelection = handlers.selection;
export const POSTExtract = handlers.extract;
export const GETImport = handlers.get;
export const PUTDraft = handlers.updateDraft;
export const GETQuestions = handlers.questions;
export const PUTAnswer = handlers.answer;
export const POSTMeasurementTask = handlers.measurementTask;
export const POSTApprove = handlers.approve;
export const POSTCancel = handlers.cancel;
export const DELETEImport = handlers.discard;

// Keep the exact HTTP schema visible to the route module and contract tests.
export const ImportHttpSchemas = {
  create: CreateImportInputSchema,
  inspect: InspectInputSchema,
  selection: SelectionInputSchema,
  extract: ExtractInputSchema,
  draftUpdate: DraftUpdateInputSchema,
  measurementAnswer: MeasurementAnswerInputSchema,
  measurementTask: MeasurementTaskInputSchema,
  approve: ApproveInputSchema,
  cancel: CancelInputSchema,
  discard: DiscardInputSchema,
};
