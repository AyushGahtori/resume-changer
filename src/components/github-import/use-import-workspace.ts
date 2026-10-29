"use client";
import { useOptionalImportStatus } from "../library/import-status-provider";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../lib/cloud/api-fetch";
import {
  DeferredMeasurementTaskSchema,
  DomainErrorSchema,
  ImportRecordSchema,
  RepositoryPathSchema,
  RepositoryScopeSchema,
  RepositorySummarySchema,
  type PullRequestSummary,
  type ConnectionState,
  type DomainError,
  type Draft,
  type FileCandidate,
  type ImportRecord,
  type ImportReviewState,
  type MeasurementAnswer,
  type MeasurementResult,
  type ProjectOption,
  type RepositoryScope,
  type RepositorySummary,
  type SaveState,
} from "../../lib/github/contracts";
import {
  createImportClient,
  type GithubImportClient,
} from "../../lib/github/client";
import {
  canAnalyzeSelection,
  getWorkspaceDrafts,
  isPreparedSelectionCurrent,
  makeConsentReference,
  reconcileDraftOverrides,
  selectedEligibleDraftIds,
  readyToSubmitDraftIds,
  readDraftOverrides,
  type DraftOverrides,
} from "./workspace-state";

type Source = "personal" | "demo";
type ConnectionReply = {
  state?: string;
  repositories?: unknown[];
  nextCursor?: string | null;
  message?: string;
  error?: unknown;
};

function errorValue(value: unknown, fallback: string): DomainError {
  const parsed = DomainErrorSchema.safeParse(value);
  return parsed.success
    ? parsed.data
    : { code: "unavailable", message: fallback, retryable: true };
}

function readConnectionError(body: ConnectionReply, fallback: string) {
  return errorValue(body.error, body.message ?? fallback);
}

function parseExtras(numbersText: string, pathsText: string) {
  const rawNumbers = numbersText
    .split(/[\s,]+/u)
    .map((value) => value.trim())
    .filter(Boolean);
  const numbers = [...new Set(rawNumbers.map(Number))];
  if (
    rawNumbers.some((value) => !/^\d+$/u.test(value)) ||
    numbers.some((value) => !Number.isSafeInteger(value) || value < 1) ||
    numbers.length > 3
  ) {
    return {
      error: "Choose up to three pull requests for this evidence bundle.",
      numbers: [],
      paths: [],
    };
  }

  const rawPaths = pathsText
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter(Boolean);
  const paths = [...new Set(rawPaths)];
  if (
    paths.length > 100 ||
    paths.some((path) => !RepositoryPathSchema.safeParse(path).success)
  ) {
    return {
      error: "Use up to 100 relative, safe repository paths.",
      numbers,
      paths: [],
    };
  }
  return { error: "", numbers, paths };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

async function measurementHash(answer: Omit<MeasurementAnswer, "answerHash">) {
  const bytes = new TextEncoder().encode(JSON.stringify(stableValue(answer)));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function useImportWorkspace(input: {
  source: Source;
  importId: string | null;
  projects: ProjectOption[];
  initialState: ImportReviewState | null;
  initialProjectId?: string;
}) {
  const router = useRouter();
  const sharedStatus = useOptionalImportStatus();
  const watchImport = sharedStatus?.watchImport;
  const latestReview = useRef<ImportReviewState | null>(input.initialState);
  const [client] = useState<GithubImportClient>(() => createImportClient());
  const [activeImportId, setActiveImportId] = useState(input.importId);
  const [source, setSource] = useState<Source>(input.source);
  const [review, setReview] = useState<ImportReviewState | null>(
    input.initialState,
  );
  const [draftOverrides, setDraftOverrides] = useState<DraftOverrides>({});
  const [projects] = useState(input.projects);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    input.initialState?.import.destinationProjectId ??
      input.initialProjectId ??
      input.projects[0]?.id ??
      null,
  );
  const [pullRequests, setPullRequests] = useState<PullRequestSummary[]>([]);
  const [pullRequestState, setPullRequestState] = useState<
    "idle" | "loading" | "ready" | "empty" | "partial" | "error"
  >("idle");
  const [pullRequestStatusMessage, setPullRequestStatusMessage] = useState("");
  const [repositories, setRepositories] = useState<RepositorySummary[]>([]);
  const [selectedRepositoryId, setSelectedRepositoryId] = useState<
    string | null
  >(null);
  const [repositoryScope, setRepositoryScope] =
    useState<RepositoryScope | null>(input.initialState?.import.scope ?? null);
  const [pendingPinnedFileIds, setPendingPinnedFileIds] = useState<string[]>(
    input.initialState?.import.pinnedFileIds ?? [],
  );
  const [pendingRemovedFileIds, setPendingRemovedFileIds] = useState<string[]>(
    input.initialState?.import.removedFileIds ?? [],
  );
  const [candidateSelectionChanged, setCandidateSelectionChanged] =
    useState(false);
  const [inspectedFileId, setInspectedFileId] = useState<string | null>(null);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected");
  const [connectionMessage, setConnectionMessage] = useState("");
  const [connectionPresentationState, setConnectionPresentationState] =
    useState<"expired" | "denied" | "unavailable">();
  const [isRefreshingRepositories, setIsRefreshingRepositories] = useState(
    input.source === "personal",
  );
  const repositoryRequest = useRef(0);
  const [role, setRole] = useState(
    input.initialState?.import.scope.contributionStatement ?? "",
  );
  const [pullRequestText, setPullRequestText] = useState(
    (input.initialState?.import.scope.selectedPullRequestNumbers ?? []).join(
      ", ",
    ),
  );
  const [manualPathText, setManualPathText] = useState(
    (input.initialState?.import.scope.selectedPaths ?? []).join("\n"),
  );
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [loading, setLoading] = useState(Boolean(input.importId));
  const [busy, setBusy] = useState<
    "idle" | "preparing" | "analyzing" | "saving" | "discarding"
  >("idle");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [actionError, setActionError] = useState<DomainError | null>(null);
  const [connectionError, setConnectionError] = useState<DomainError | null>(
    null,
  );
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [forceSetup, setForceSetup] = useState(false);
  const [answers, setAnswers] = useState<
    Record<string, MeasurementAnswer | undefined>
  >({});
  const [measurementResults, setMeasurementResults] = useState<
    Record<string, MeasurementResult | undefined>
  >({});
  const [metricDraftPreviews, setMetricDraftPreviews] = useState<
    Record<
      string,
      { text: string; hash: string; resultId: string; baseText: string }
    >
  >({});
  const [expandedDraftId, setExpandedDraftId] = useState<string | null>(null);
  const [previousDrafts, setPreviousDrafts] = useState<Draft[]>([]);
  const pendingConsent = useRef<string | null>(null);
  const pendingApproval = useRef<{ signature: string; key: string } | null>(
    null,
  );
  const appliedSelectionVersion = useRef<number | null>(null);
  const importId = activeImportId;

  const applyReview = useCallback(
    (incoming: ImportReviewState) => {
      if (
        latestReview.current?.import.id === incoming.import.id &&
        latestReview.current.import.version > incoming.import.version
      )
        return;
      latestReview.current = incoming;
      setReview(incoming);
      setSource(input.source === "demo" ? "demo" : incoming.import.source);
      if (
        appliedSelectionVersion.current !== incoming.import.selectionVersion
      ) {
        appliedSelectionVersion.current = incoming.import.selectionVersion;
        setRepositoryScope(incoming.import.scope);
        setSelectedProjectId(incoming.import.destinationProjectId);
        setSelectedRepositoryId(incoming.import.scope.repositoryId);
        setRole(incoming.import.scope.contributionStatement);
        setPullRequestText(
          incoming.import.scope.selectedPullRequestNumbers.join(", "),
        );
        setManualPathText(incoming.import.scope.selectedPaths.join("\n"));
        setPendingPinnedFileIds(incoming.import.pinnedFileIds);
        setPendingRemovedFileIds(incoming.import.removedFileIds);
        setCandidateSelectionChanged(false);
        setRepositories((current) =>
          current.some(
            (item) => item.repositoryId === incoming.import.scope.repositoryId,
          )
            ? current
            : [
                ...current,
                {
                  repositoryId: incoming.import.scope.repositoryId,
                  owner: incoming.import.scope.owner,
                  name: incoming.import.scope.name,
                  canonicalUrl: incoming.import.scope.canonicalUrl,
                  visibility: incoming.import.scope.visibility,
                  defaultBranch: null,
                  permission: "unknown",
                },
              ],
        );
      }
      setSavedIds(incoming.import.savedIds);
      setAnswers(incoming.measurementAnswers ?? {});
      setMeasurementResults(
        Object.fromEntries(
          incoming.questions.map((q) => [
            q.id,
            incoming.measurementResults.find(
              (m) =>
                m.definitionId ===
                  incoming.measurementAnswers?.[q.id]?.definitionId &&
                m.version === incoming.measurementAnswers?.[q.id]?.version,
            ),
          ]),
        ),
      );
      setDraftOverrides((current) =>
        reconcileDraftOverrides(incoming, current),
      );
    },
    [input.source],
  );

  const draftStorageKey = review
    ? `resume.github-drafts.v1:${review.import.authorizationNamespaceHash}:${review.import.id}`
    : null;
  const [restoredKey, setRestoredKey] = useState<string | null>(null);
  useEffect(() => {
    if (!draftStorageKey || restoredKey === draftStorageKey || !review) return;
    try {
      const stored = readDraftOverrides(
        window.sessionStorage.getItem(draftStorageKey),
      );
      setDraftOverrides((current) =>
        reconcileDraftOverrides(review, { ...stored, ...current }),
      );
    } catch {}
    setRestoredKey(draftStorageKey);
  }, [draftStorageKey, restoredKey, review]);
  useEffect(() => {
    if (!draftStorageKey || restoredKey !== draftStorageKey) return;
    try {
      if (Object.keys(draftOverrides).length)
        window.sessionStorage.setItem(
          draftStorageKey,
          JSON.stringify(draftOverrides),
        );
      else window.sessionStorage.removeItem(draftStorageKey);
    } catch {}
  }, [draftStorageKey, restoredKey, draftOverrides]);

  const refreshReview = useCallback(
    async (id = importId) => {
      if (!id) return null;
      const result = await client.get(id);
      if (!result.ok) {
        setActionError(result.error);
        return null;
      }
      applyReview(result.value);
      return result.value;
    },
    [applyReview, client, importId],
  );

  useEffect(() => {
    setActiveImportId(input.importId);
    if (input.initialState) applyReview(input.initialState);
  }, [applyReview, input.importId, input.initialState]);

  useEffect(() => {
    let mounted = true;
    if (!importId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void client.get(importId).then((result) => {
      if (!mounted) return;
      if (result.ok) applyReview(result.value);
      else setActionError(result.error);
      setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, [applyReview, client, importId]);

  useEffect(() => {
    if (!importId) return;
    if (watchImport) return watchImport(importId, applyReview);
    const subscription = client.subscribeStatus(
      (incoming) => {
        if (incoming.import.id === importId) applyReview(incoming);
      },
      (error) => setActionError(error),
    );
    return () => {
      if (subscription.ok) subscription.value.close();
    };
  }, [applyReview, client, importId, watchImport]);

  useEffect(() => {
    if (!selectedRepositoryId || connectionState !== "connected") return;
    let active = true;
    setPullRequestState("loading");
    void client.listPullRequests(selectedRepositoryId).then((result) => {
      if (!active) return;
      if (result.ok) {
        setPullRequests(result.value.candidates);
        setPullRequestState(
          result.value.completeness === "partial"
            ? "partial"
            : result.value.candidates.length
              ? "ready"
              : "empty",
        );
        setPullRequestStatusMessage(
          result.value.limitations
            .map((reason) =>
              reason === "recent-list-does-not-search-older-history"
                ? "Only recent pull requests are listed; add an older PR number in optional scope."
                : reason === "recent-candidate-list-incomplete"
                  ? "Some pull request details could not be loaded."
                  : reason.replaceAll("-", " "),
            )
            .join(" "),
        );
      } else {
        setPullRequests([]);
        setPullRequestState("error");
        setPullRequestStatusMessage(result.error.message);
      }
    });
    return () => {
      active = false;
    };
  }, [client, connectionState, selectedRepositoryId]);
  useEffect(() => {
    if (!expandedDraftId || !importId || metricDraftPreviews[expandedDraftId])
      return;
    const question = review?.questions.find(
      (q) => q.draftId === expandedDraftId,
    );
    const answer = question ? answers[question.id] : undefined;
    const result = question ? measurementResults[question.id] : undefined;
    if (!result || !answer || !question) return;
    let active = true;
    void client
      .previewMeasurementDraft({
        importId,
        draftId: expandedDraftId,
        measurementResultId: result.id,
      })
      .then((preview) => {
        if (active && preview.ok)
          setMetricDraftPreviews((current) => ({
            ...current,
            [expandedDraftId]: {
              ...preview.value,
              resultId: result.id,
              baseText: review!.result!.drafts.find(
                (d) => d.id === expandedDraftId,
              )!.text,
            },
          }));
      });
    return () => {
      active = false;
    };
  }, [
    expandedDraftId,
    importId,
    client,
    answers,
    measurementResults,
    metricDraftPreviews,
    review,
  ]);
  const loadRepositories = useCallback(async () => {
    const requestId = ++repositoryRequest.current;
    setIsRefreshingRepositories(true);
    const collected: RepositorySummary[] = [];
    let cursor: string | null = null;
    let state = "disconnected";
    let message = "";
    let failure: DomainError | null = null;
    try {
      do {
        const query = cursor ? "?cursor=" + encodeURIComponent(cursor) : "";
        const response = await apiFetch(
          "/api/github/connection/repositories" + query,
          { method: "GET", cache: "no-store" },
        );
        const envelope = (await response.json().catch(() => null)) as
          ({ data?: ConnectionReply } & ConnectionReply) | null;
        const body = envelope?.data ?? envelope;
        if (!response.ok || !body) {
          failure = readConnectionError(
            body ?? {},
            "GitHub repositories could not be loaded.",
          );
          state = "unavailable";
          break;
        }
        state = body.state ?? "unavailable";
        message = body.message ?? "";
        for (const raw of body.repositories ?? []) {
          const parsed = RepositorySummarySchema.safeParse(raw);
          if (parsed.success) collected.push(parsed.data);
        }
        cursor = body.nextCursor ?? null;
      } while (state === "connected" && cursor && collected.length < 1_000);
    } catch {
      state = "unavailable";
      failure = {
        code: "unavailable",
        message: "GitHub repositories could not be reached.",
        retryable: true,
      };
    }
    if (!mountedRef.current || requestId !== repositoryRequest.current) return;
    setIsRefreshingRepositories(false);
    setConnectionError(failure);
    setRepositories(collected);
    setConnectionPresentationState(
      state === "expired" || state === "denied" || state === "unavailable"
        ? state
        : undefined,
    );
    // A stored connecting cookie after navigation means sign-in was abandoned;
    // there is no active request to wait for. Keep the Connect action usable.
    setConnectionMessage(
      state === "connecting"
        ? "GitHub sign-in was not completed. Connect again, then choose your repository here."
        : message,
    );
    setConnectionState(
      state === "connected"
        ? "connected"
        : state === "disconnected" || state === "connecting"
          ? "disconnected"
          : "error",
    );
    if (state === "connected") {
      const available = new Set(
        collected.map((repository) => repository.repositoryId),
      );
      setSelectedRepositoryId((current) =>
        current && available.has(current) ? current : null,
      );
      setRepositoryScope((current) =>
        current && available.has(current.repositoryId) ? current : null,
      );
      setConsentAccepted(false);
    }
  }, []);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    if (input.source === "personal") void loadRepositories();
    return () => {
      mountedRef.current = false;
    };
  }, [input.importId, input.source, loadRepositories]);

  const connect = useCallback(async () => {
    setConnectionError(null);
    setConnectionState("connecting");
    setConnectionPresentationState(undefined);
    setConnectionMessage("");
    try {
      const response = await apiFetch("/api/github/connection/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          returnTo: importId
            ? "/library/github/" + encodeURIComponent(importId)
            : "/library/github/new" +
              (selectedProjectId
                ? "?projectId=" + encodeURIComponent(selectedProjectId)
                : ""),
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        data?: { authorizationUrl?: string; state?: string; message?: string };
        error?: unknown;
      } | null;
      const destination = body?.data?.authorizationUrl;
      if (!response.ok || !destination) {
        setConnectionError(
          errorValue(
            body?.error,
            body?.data?.message ?? "GitHub connection is unavailable.",
          ),
        );
        setConnectionState("error");
        return;
      }
      const url = new URL(destination, window.location.origin);
      if (url.protocol !== "https:" || url.hostname !== "github.com") {
        setConnectionError({
          code: "upstream-error",
          message: "GitHub returned an invalid authorization link.",
          retryable: false,
        });
        setConnectionState("error");
        return;
      }
      window.location.assign(url.href);
    } catch {
      setConnectionError({
        code: "unavailable",
        message: "GitHub connection could not be started.",
        retryable: true,
      });
      setConnectionState("error");
    }
  }, [importId, selectedProjectId]);

  const chooseRepository = useCallback(async (repositoryId: string | null) => {
    setSelectedRepositoryId(repositoryId);
    setRepositoryScope(null);
    if (!repositoryId) return;
    setConnectionError(null);
    try {
      const response = await apiFetch("/api/github/connection/repositories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repositoryId }),
      });
      const body = (await response.json().catch(() => null)) as {
        data?: { scope?: unknown };
        error?: unknown;
      } | null;
      if (!response.ok || !body?.data?.scope) {
        setConnectionError(
          errorValue(
            body?.error,
            "The selected repository could not be authorized.",
          ),
        );
        return;
      }
      const parsed = RepositoryScopeSchema.safeParse(body.data.scope);
      if (!parsed.success) {
        setConnectionError({
          code: "upstream-error",
          message: "GitHub returned invalid repository scope.",
          retryable: false,
        });
        return;
      }
      setRepositoryScope(parsed.data);
    } catch {
      setConnectionError({
        code: "unavailable",
        message: "The selected repository could not be reached.",
        retryable: true,
      });
    }
  }, []);

  const extras = useMemo(
    () => parseExtras(pullRequestText, manualPathText),
    [pullRequestText, manualPathText],
  );
  const selectedPullRequests = useMemo(() => {
    const parsed = parseExtras(pullRequestText, "");
    return parsed.numbers;
  }, [pullRequestText]);

  const buildScope = useCallback((): RepositoryScope | null => {
    if (!repositoryScope || !role.trim() || extras.error) return null;
    const parsed = RepositoryScopeSchema.safeParse({
      ...repositoryScope,
      selectedPullRequestNumbers: extras.numbers,
      selectedPaths: extras.paths,
      contributionStatement: role.trim(),
    });
    if (!parsed.success) {
      setActionError({
        code: "invalid-input",
        message: "Check the role, pull requests, and repository paths.",
        retryable: false,
      });
      return null;
    }
    return parsed.data;
  }, [extras, repositoryScope, role]);

  const saveSelection = useCallback(
    async (
      id: string,
      expectedVersion: number,
      scope: RepositoryScope,
      pinnedFileIds: string[],
      removedFileIds: string[],
    ): Promise<
      { ok: true; value: ImportRecord } | { ok: false; error: DomainError }
    > => {
      if (
        !candidateSelectionChanged &&
        selectedProjectId === review?.import.destinationProjectId
      ) {
        return client.changeSelection(
          id,
          expectedVersion,
          scope,
          pinnedFileIds,
        );
      }
      try {
        const response = await apiFetch(
          "/api/github/imports/" + encodeURIComponent(id) + "/selection",
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              expectedVersion,
              scope,
              pinnedFileIds,
              removedFileIds,
              destinationProjectId: selectedProjectId ?? undefined,
            }),
          },
        );
        const body = (await response.json().catch(() => null)) as {
          data?: unknown;
          error?: unknown;
        } | null;
        if (!response.ok) {
          return {
            ok: false,
            error: errorValue(
              body?.error,
              "The file selection could not be saved.",
            ),
          };
        }
        const parsed = ImportRecordSchema.safeParse(body?.data);
        if (!parsed.success) {
          return {
            ok: false,
            error: {
              code: "upstream-error",
              message: "The file selection response could not be verified.",
              retryable: false,
            },
          };
        }
        return { ok: true, value: parsed.data };
      } catch {
        return {
          ok: false,
          error: {
            code: "unavailable",
            message: "The file selection service could not be reached.",
            retryable: true,
          },
        };
      }
    },
    [
      candidateSelectionChanged,
      client,
      selectedProjectId,
      review?.import.destinationProjectId,
    ],
  );

  const prepareJob = useCallback(
    async (id: string, version: number) => {
      setBusy("preparing");
      setActionError(null);
      setConsentAccepted(false);
      setForceSetup(false);
      pendingConsent.current = null;
      const result = await client.prepare(id, version);
      if (!result.ok) {
        setActionError(result.error);
        setBusy("idle");
        await refreshReview(id);
        return false;
      }
      setActiveImportId(id);
      await refreshReview(id);
      setBusy("idle");
      return true;
    },
    [client, refreshReview],
  );

  const createAndPrepare = useCallback(async () => {
    if (source !== "personal") {
      setActionError({
        code: "forbidden",
        message:
          "Demo imports are read-only. Switch to your personal library to connect GitHub.",
        retryable: false,
      });
      return;
    }
    const scope = buildScope();
    if (!scope || !selectedProjectId) {
      setActionError({
        code: "invalid-input",
        message:
          "Choose a destination, repository, and role before preparing evidence.",
        retryable: false,
      });
      return;
    }
    setBusy("preparing");
    setActionError(null);
    const created = await client.create({
      source,
      destinationProjectId: selectedProjectId,
      scope,
    });
    if (!created.ok) {
      setActionError(created.error);
      setBusy("idle");
      return;
    }
    setActiveImportId(created.value.id);
    setRepositoryScope(scope);
    const prepared = await client.prepare(
      created.value.id,
      created.value.version,
    );
    if (!prepared.ok) {
      setActionError(prepared.error);
      await refreshReview(created.value.id);
      setBusy("idle");
      router.replace("/library/github/" + encodeURIComponent(created.value.id));
      return;
    }
    await refreshReview(created.value.id);
    setBusy("idle");
    router.replace("/library/github/" + encodeURIComponent(created.value.id));
  }, [buildScope, client, refreshReview, router, selectedProjectId, source]);

  const updateSelectionAndPrepare = useCallback(async () => {
    if (!review || !importId) return;
    const scope = buildScope();
    if (!scope) return;
    if (
      review.import.activeRunId &&
      ["queued", "analyzing"].includes(review.import.lifecycle)
    ) {
      setActionError({
        code: "version-conflict",
        message:
          "Wait for the accepted run to finish before preparing a changed selection.",
        retryable: false,
      });
      return;
    }
    setPreviousDrafts(getWorkspaceDrafts(review, draftOverrides));
    setBusy("preparing");
    setActionError(null);
    let editingVersion = review.import.version;
    for (const [draftId, override] of Object.entries(draftOverrides)) {
      if (!override.dirty) continue;
      const draft = review.result?.drafts.find((d) => d.id === draftId);
      if (
        !draft ||
        override.conflict ||
        draft.version !== override.baseVersion
      ) {
        setActionError({
          code: "version-conflict",
          message: "Review the newer draft before changing scope.",
          retryable: false,
        });
        setBusy("idle");
        return;
      }
      const changed = await client.updateDraft(
        importId,
        draftId,
        editingVersion,
        override.text,
        {
          selectedForSave: override.selectedForSave,
          contributionConfirmed: override.contributionConfirmed,
          confirmedMetricResultIds: override.confirmedMetricResultIds,
        },
      );
      if (!changed.ok) {
        setActionError(changed.error);
        setBusy("idle");
        return;
      }
      const current = await client.get(importId);
      if (!current.ok) {
        setActionError(current.error);
        setBusy("idle");
        return;
      }
      editingVersion = current.value.import.version;
    }
    const latest = await client.get(importId);
    if (!latest.ok) {
      setActionError(latest.error);
      setBusy("idle");
      return;
    }
    applyReview(latest.value);
    const changed = await saveSelection(
      importId,
      latest.value.import.version,
      scope,
      pendingPinnedFileIds,
      pendingRemovedFileIds,
    );
    if (!changed.ok) {
      setActionError(changed.error);
      setBusy("idle");
      await refreshReview(importId);
      return;
    }
    setConsentAccepted(false);
    pendingConsent.current = null;
    pendingApproval.current = null;
    await prepareJob(importId, changed.value.version);
  }, [
    applyReview,
    buildScope,
    client,
    draftOverrides,
    importId,
    pendingPinnedFileIds,
    pendingRemovedFileIds,
    prepareJob,
    refreshReview,
    review,
    saveSelection,
  ]);

  const pinCandidate = useCallback((fileId: string) => {
    setCandidateSelectionChanged(true);
    setPendingPinnedFileIds((current) =>
      current.includes(fileId) ? current : [...current, fileId],
    );
    setPendingRemovedFileIds((current) =>
      current.filter((id) => id !== fileId),
    );
  }, []);

  const removeCandidate = useCallback((fileId: string) => {
    setCandidateSelectionChanged(true);
    setPendingPinnedFileIds((current) => current.filter((id) => id !== fileId));
    setPendingRemovedFileIds((current) =>
      current.includes(fileId) ? current : [...current, fileId],
    );
  }, []);

  const analyze = useCallback(async () => {
    if (!review || !importId) return;
    if (!consentAccepted || !canAnalyzeSelection(review, source)) {
      setActionError({
        code: "version-conflict",
        message:
          "Review the current bundle and confirm its exact disclosure before analyzing.",
        retryable: false,
      });
      return;
    }
    setBusy("analyzing");
    setActionError(null);
    const consentReference = pendingConsent.current ?? makeConsentReference();
    pendingConsent.current = consentReference;
    const result = await client.enqueueAnalysis(
      importId,
      review.import.version,
      review.prepared!.selectionHash,
      consentReference,
    );
    if (!result.ok) {
      setActionError(result.error);
      setBusy("idle");
      await refreshReview(importId);
      return;
    }
    pendingConsent.current = null;
    await refreshReview(importId);
    setBusy("idle");
  }, [client, consentAccepted, importId, refreshReview, review, source]);

  const editDraft = useCallback(
    (
      draft: Draft,
      patch: Partial<
        Pick<Draft, "text" | "selectedForSave" | "contributionConfirmed"> & {
          confirmedMetricResultIds?: string[];
        }
      >,
    ) => {
      setDraftOverrides((current) => {
        const previous = current[draft.id];
        const next = {
          text: patch.text ?? previous?.text ?? draft.text,
          selectedForSave:
            patch.selectedForSave ??
            previous?.selectedForSave ??
            draft.selectedForSave,
          confirmedMetricResultIds:
            patch.confirmedMetricResultIds ??
            (patch.text !== undefined
              ? []
              : (previous?.confirmedMetricResultIds ??
                latestReview.current?.import.draftEdits.find(
                  (e) => e.draftId === draft.id,
                )?.confirmedMetricResultIds ??
                [])),
          contributionConfirmed:
            (patch.text !== undefined ? false : patch.contributionConfirmed) ??
            previous?.contributionConfirmed ??
            draft.contributionConfirmed,
          baseVersion: previous?.baseVersion ?? draft.version,
          dirty: true,
          conflict: previous?.conflict ?? false,
        };
        return { ...current, [draft.id]: next };
      });
    },
    [],
  );

  const persistEdits = useCallback(
    async (state: ImportReviewState) => {
      const drafts = new Map(
        (state.result?.drafts ?? []).map((draft) => [draft.id, draft]),
      );
      const persisted: DraftOverrides = { ...draftOverrides };
      let currentImportVersion = state.import.version;
      for (const [draftId, override] of Object.entries(draftOverrides)) {
        if (!override.dirty) continue;
        const draft = drafts.get(draftId);
        if (
          !draft ||
          override.conflict ||
          draft.version !== override.baseVersion
        ) {
          setActionError({
            code: "version-conflict",
            message:
              "A newer draft version needs review before it can be saved.",
            retryable: false,
          });
          return null;
        }
        const updated = await client.updateDraft(
          state.import.id,
          draftId,
          currentImportVersion,
          override.text,
          {
            selectedForSave: override.selectedForSave,
            contributionConfirmed: override.contributionConfirmed,
            confirmedMetricResultIds: override.confirmedMetricResultIds,
          },
        );
        if (!updated.ok) {
          setActionError(updated.error);
          return null;
        }
        const changed = await client.get(state.import.id);
        if (!changed.ok) {
          setActionError(changed.error);
          return null;
        }
        currentImportVersion = changed.value.import.version;
        persisted[draftId] = {
          ...override,
          baseVersion: updated.value.version,
          dirty: false,
          conflict: false,
        };
        setDraftOverrides({ ...persisted });
      }
      const fresh = await client.get(state.import.id);
      if (!fresh.ok) {
        setActionError(fresh.error);
        return null;
      }
      applyReview(fresh.value);
      return { state: fresh.value, overrides: persisted };
    },
    [applyReview, client, draftOverrides],
  );

  const approve = useCallback(async () => {
    if (!review || !importId || review.expired) return;
    setBusy("saving");
    setSaveState("saving");
    setActionError(null);
    const persisted = await persistEdits(review);
    if (!persisted) {
      setSaveState("error");
      setBusy("idle");
      return;
    }
    const selectedIds = selectedEligibleDraftIds(
      persisted.state,
      persisted.overrides,
    );
    if (!selectedIds.length) {
      setActionError({
        code: "invalid-evidence",
        message:
          "Select and confirm at least one eligible draft before saving.",
        retryable: false,
      });
      setSaveState("error");
      setBusy("idle");
      return;
    }
    const signature = importId + ":" + selectedIds.join(",");
    if (pendingApproval.current?.signature !== signature) {
      pendingApproval.current = { signature, key: makeConsentReference() };
    }
    const result = await client.approve(
      importId,
      persisted.state.import.version,
      selectedIds,
      pendingApproval.current.key,
    );
    if (!result.ok) {
      setActionError(result.error);
      setSaveState("error");
      setBusy("idle");
      await refreshReview(importId);
      return;
    }
    pendingApproval.current = null;
    setSavedIds(result.value.savedIds);
    setSaveState("saved");
    await refreshReview(importId);
    setBusy("idle");
  }, [client, importId, persistEdits, refreshReview, review]);

  const answerQuestion = useCallback(
    async (questionId: string, answer: MeasurementAnswer) => {
      if (!importId || !review) return false;
      setActionError(null);
      const preserved = await persistEdits(review);
      if (!preserved) return false;
      const question = preserved.state.questions.find(
        (item) => item.id === questionId,
      );
      if (!question) return false;
      const payload = { ...answer, questionId, version: question.version };
      const { answerHash: _oldHash, ...fields } = payload;
      const answerHash = await measurementHash(fields);
      const result = await client.answerMeasurement({
        importId,
        questionId,
        expectedVersion: preserved.state.import.version,
        answer: { ...fields, answerHash },
      });
      if (!result.ok) {
        setActionError(result.error);
        return false;
      }
      setAnswers((current) => ({
        ...current,
        [questionId]: { ...fields, answerHash },
      }));
      if (result.value.result)
        setMeasurementResults((current) => ({
          ...current,
          [questionId]: result.value.result!,
        }));
      if (result.value.result) {
        const preview = await client.previewMeasurementDraft({
          importId,
          draftId: question.draftId,
          measurementResultId: result.value.result.id,
        });
        if (!preview.ok) {
          setActionError(preview.error);
          return false;
        }
        setMetricDraftPreviews((current) => ({
          ...current,
          [question.draftId]: {
            ...preview.value,
            resultId: result.value.result!.id,
            baseText: preserved.state.result!.drafts.find(
              (d) => d.id === question.draftId,
            )!.text,
          },
        }));
      } else {
        setMetricDraftPreviews((current) => {
          const next = { ...current };
          delete next[question.draftId];
          return next;
        });
      }
      await refreshReview(importId);
      return true;
    },
    [client, importId, refreshReview, review, persistEdits],
  );

  const skipQuestion = useCallback(
    async (questionId: string, version: number, mode: "skip" | "defer") => {
      if (mode === "defer") {
        if (!importId || !review) return false;
        const preserved = await persistEdits(review);
        if (!preserved) return false;
        const response = await apiFetch(
          "/api/github/imports/" +
            encodeURIComponent(importId) +
            "/measurement-tasks",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              expectedVersion: preserved.state.import.version,
              task: { questionId },
            }),
          },
        );
        const body = (await response.json().catch(() => null)) as {
          data?: unknown;
          error?: unknown;
        } | null;
        if (!response.ok) {
          setActionError(
            errorValue(body?.error, "Measurement help could not be deferred."),
          );
          return false;
        }
        if (!DeferredMeasurementTaskSchema.safeParse(body?.data).success) {
          setActionError({
            code: "upstream-error",
            message: "The deferred measurement task could not be verified.",
            retryable: false,
          });
          return false;
        }
        await refreshReview(importId);
        return true;
      }
      const withoutHash = {
        questionId,
        version,
        mode,
        originalValues: [],
        originalUnits: [],
        definitionId: null,
        statistic: null,
        context: {},
        sourceEvidenceIds: [],
        attestation: "none" as const,
      };
      const answer: MeasurementAnswer = {
        ...withoutHash,
        answerHash: await measurementHash(withoutHash),
      };
      return answerQuestion(questionId, answer);
    },
    [answerQuestion, importId, refreshReview, review, persistEdits],
  );

  const cancel = useCallback(async () => {
    if (!review || !importId || !review.import.activeRunId) return;
    const result = await client.cancel(importId, review.import.activeRunId);
    if (!result.ok) setActionError(result.error);
    await refreshReview(importId);
  }, [client, importId, refreshReview, review]);

  const discard = useCallback(async () => {
    if (!review || !importId) return;

    setBusy("discarding");
    const result = await client.discard(importId, review.import.version);
    if (!result.ok) {
      setActionError(result.error);
      setBusy("idle");
      return false;
    }
    router.push("/library" + (source === "demo" ? "?source=demo" : ""));
    return true;
  }, [client, importId, review, router, source]);

  const goBack = useCallback(() => {
    router.push("/library" + (source === "demo" ? "?source=demo" : ""));
  }, [router, source]);

  const currentDrafts = useMemo(
    () => getWorkspaceDrafts(review, draftOverrides),
    [draftOverrides, review],
  );
  const selectionIsDirty = Boolean(
    review &&
    (candidateSelectionChanged ||
      selectedProjectId !== review.import.destinationProjectId ||
      role.trim() !== review.import.scope.contributionStatement ||
      JSON.stringify(extras.numbers) !==
        JSON.stringify(review.import.scope.selectedPullRequestNumbers) ||
      JSON.stringify(extras.paths) !==
        JSON.stringify(review.import.scope.selectedPaths)),
  );
  const canAnalyze =
    connectionState === "connected" &&
    !isRefreshingRepositories &&
    canAnalyzeSelection(review, source) &&
    !selectionIsDirty &&
    consentAccepted &&
    busy === "idle";
  const eligibleIds = readyToSubmitDraftIds(review, draftOverrides);
  const isStale = Boolean(
    review?.prepared &&
    (!isPreparedSelectionCurrent(review) || selectionIsDirty),
  );
  const effectiveProjects = useMemo(() => projects, [projects]);

  const candidates = useMemo<FileCandidate[]>(
    () => review?.candidates ?? [],
    [review],
  );

  return {
    source,
    importId,
    review,
    client,
    loading,
    busy,
    saveState,
    actionError,
    connectionError,
    connectionState,
    connectionMessage,
    connectionPresentationState,
    isRefreshingRepositories,
    repositories,
    selectedRepositoryId,
    repositoryScope,
    projects: effectiveProjects,
    selectedProjectId,
    role,
    pullRequestText,
    manualPathText,
    selectedPullRequests,
    extras,
    pullRequests,
    pullRequestState,
    pullRequestStatusMessage,
    candidates,
    consentAccepted,
    canAnalyze,
    isStale,
    currentDrafts,
    draftOverrides,
    eligibleIds,
    savedIds,
    answers,
    measurementResults,
    expandedDraftId,
    metricDraftPreviews,
    previousDrafts,
    pendingPinnedFileIds,
    pendingRemovedFileIds,
    candidateSelectionChanged,
    selectionIsDirty,
    inspectedFileId,
    forceSetup,
    setSelectedProjectId,
    setRole,
    setPullRequestText,
    setManualPathText,
    setConsentAccepted,
    setExpandedDraftId,
    connect,
    loadRepositories,
    chooseRepository,
    createAndPrepare,
    updateSelectionAndPrepare,
    analyze,
    editDraft,
    approve,
    answerQuestion,
    skipQuestion,
    cancel,
    discard,
    goBack,
    refreshReview,
    setForceSetup,
    pinCandidate,
    removeCandidate,
    setInspectedFileId,
  };
}
