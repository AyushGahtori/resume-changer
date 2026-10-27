import { createHash } from "node:crypto";
import { rename } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  DeferredMeasurementTaskSchema,
  GITHUB_IMPORT_POLICY,
  ImportCacheEntrySchema,
  ImportCacheIdentitySchema,
  ImportCacheValueSchema,
  ImportRecordSchema,
  RepositoryScopeSchema,
  err,
  ok,
  type DomainErrorCode,
  type ExecutionContext,
  type Result,
} from "../contracts";
import type {
  DeferredMeasurementTaskStoreFactory,
  ImportStoreFactory,
  ImportRecordPatch,
} from "../ports";
import { inspectFileContent, getPathExclusionReason } from "./file-policy-core";
import {
  readLocalState,
  withLocalStateLock,
  writeLocalState,
} from "./local-state";

const MAX_BYTES = 64 * 1024 * 1024;
const DocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    imports: z.array(ImportRecordSchema).max(500),
    cache: z.array(ImportCacheEntrySchema).max(2_000),
    deferred: z.array(DeferredMeasurementTaskSchema).max(500),
  })
  .strict();
type Document = z.infer<typeof DocumentSchema>;
type Dependencies = Parameters<ImportStoreFactory>[0] & {
  renameFile?: typeof rename;
};
class StoreFault extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
  }
}
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function fault(code: DomainErrorCode, message: string): never {
  throw new StoreFault(code, message);
}
function active(record: Document["imports"][number], deps: Dependencies) {
  if (!record.activeRunId) return Promise.resolve(false);
  return (
    deps.isJobActive?.({ importId: record.id, runId: record.activeRunId }) ??
    Promise.resolve(true)
  );
}
function engine(deps: Dependencies) {
  async function run<T>(
    context: ExecutionContext,
    mutate: boolean,
    action: (doc: Document, ns: string, now: Date) => Promise<T> | T,
  ): Promise<Result<T>> {
    try {
      if (context.signal.aborted)
        fault("cancelled", "The operation was cancelled.");
      if (!context.access.sessionId || !context.access.authorizationNamespace)
        fault("forbidden", "An authorized personal workspace is required.");
      const root = context.personalRoot;
      const ns = hash(context.access.authorizationNamespace);
      const target = join(root, "data", "github-imports", `${ns}.json`);
      const operation = async () => {
        let doc: Document;
        try {
          doc = DocumentSchema.parse(
            JSON.parse(await readLocalState(root, target, MAX_BYTES)),
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT")
            doc = { schemaVersion: 1, imports: [], cache: [], deferred: [] };
          else throw error;
        }
        const now = deps.now();
        if (!Number.isFinite(now.getTime()))
          fault("invalid-input", "A valid server clock is required.");
        const result = await action(doc, ns, now);
        if (mutate) {
          const text = `${JSON.stringify(DocumentSchema.parse(doc))}\n`;
          if (Buffer.byteLength(text) > MAX_BYTES)
            fault("limit-exceeded", "The staged workspace is full.");
          await writeLocalState(root, target, text, deps.renameFile);
        }
        return ok(result);
      };
      return mutate
        ? await withLocalStateLock(root, target, operation)
        : await operation();
    } catch (error) {
      if (error instanceof StoreFault)
        return err({
          code: error.code,
          message: error.message,
          retryable: false,
        });
      return err({
        code: "io-error",
        message:
          "Staged data could not be read or saved. Existing data was preserved.",
        retryable: true,
      });
    }
  }
  function requireGrant(context: ExecutionContext, repositoryId: string) {
    if (!context.access.grantedRepositoryIds.includes(repositoryId))
      fault("forbidden", "Repository access is no longer authorized.");
  }
  function find(
    doc: Document,
    id: string,
    ns: string,
    context: ExecutionContext,
  ) {
    const r = doc.imports.find(
      (r) => r.id === id && r.authorizationNamespaceHash === ns,
    );
    if (!r) fault("not-found", "Staged import not found.");
    requireGrant(context, r.scope.repositoryId);
    return r;
  }
  return { run, find, requireGrant };
}

export function createImportStore(
  deps: Dependencies,
): ReturnType<ImportStoreFactory> {
  const db = engine(deps);
  const capacity =
    deps.cacheCapacityBytes ?? GITHUB_IMPORT_POLICY.cacheCapacityBytes;
  if (
    !Number.isSafeInteger(capacity) ||
    capacity < 1 ||
    capacity > GITHUB_IMPORT_POLICY.cacheCapacityBytes
  )
    throw new Error("Invalid cache capacity.");
  async function protectedKeys(doc: Document) {
    const keys = new Set<string>();
    for (const r of doc.imports)
      if (await active(r, deps))
        for (const k of [
          r.preparedSelectionRef,
          r.resultRef,
          r.candidateInventoryRef,
        ])
          if (k) keys.add(k);
    for (const r of doc.imports)
      if (await active(r, deps))
        for (const revision of r.reviewHistory)
          for (const k of [revision.preparedSelectionRef, revision.resultRef])
            if (k) keys.add(k);
    return keys;
  }
  function trimCache(doc: Document, protectedEntries: Set<string>) {
    let size = doc.cache.reduce((sum, e) => sum + e.byteSize, 0);
    let evicted = 0;
    for (const e of [...doc.cache].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    )) {
      if (size <= capacity) break;
      if (protectedEntries.has(e.key)) continue;
      doc.cache = doc.cache.filter((c) => c.key !== e.key);
      size -= e.byteSize;
      evicted++;
    }
    if (size > capacity)
      fault(
        "limit-exceeded",
        "Active imports occupy the cache. Wait or cancel before adding evidence.",
      );
    return { size, evicted };
  }
  return {
    create(input, context) {
      return db.run(context, true, (doc, ns, now) => {
        if (input.source !== "personal")
          fault(
            "forbidden",
            "Demo imports cannot be persisted as personal data.",
          );
        const scope = RepositoryScopeSchema.parse(input.scope);
        db.requireGrant(context, scope.repositoryId);
        const r = ImportRecordSchema.parse({
          id: deps.id(),
          version: 1,
          source: "personal",
          destinationProjectId: input.destinationProjectId,
          authorizationNamespaceHash: ns,
          scope,
          selectionVersion: 1,
          selectionHash: null,
          lifecycle: "created",
          activeRunId: null,
          consent: null,
          preparedSelectionRef: null,
          resultRef: null,
          resultRunId: null,
          approvalKeyHash: null,
          draftRefs: [],
          draftEdits: [],
          pinnedFileIds: [],
          removedFileIds: [],
          candidateInventoryRef: null,
          reviewHistory: [],
          savedIds: [],
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          retentionDeadline: new Date(
            now.getTime() + GITHUB_IMPORT_POLICY.stageRetentionMs,
          ).toISOString(),
        });
        if (doc.imports.some((e) => e.id === r.id))
          fault("version-conflict", "The generated import ID already exists.");
        doc.imports.push(r);
        return r;
      });
    },
    get({ id }, context) {
      return db.run(context, false, async (doc, ns, now) => {
        const r = db.find(doc, id, ns, context);
        if (
          Date.parse(r.retentionDeadline) <= now.getTime() &&
          r.lifecycle !== "approved" &&
          !(await active(r, deps))
        )
          return {
            ...r,
            lifecycle: "expired" as const,
            resultRef: null,
            resultRunId: null,
            preparedSelectionRef: null,
            candidateInventoryRef: null,
            draftRefs: [],
            draftEdits: [],
            reviewHistory: [],
            pinnedFileIds: [],
            removedFileIds: [],
            consent: null,
          };
        return r;
      });
    },
    completePreparation(input, context) {
      return db.run(context, true, async (doc, ns, now) => {
        const record = db.find(doc, input.id, ns, context);
        if (record.version !== input.expectedVersion)
          fault(
            "version-conflict",
            "This import changed before preparation completed.",
          );
        if (record.lifecycle !== "preparing" || !record.activeRunId)
          fault(
            "version-conflict",
            "This preparation run is no longer active.",
          );
        if (record.activeRunId !== input.runId)
          fault(
            "version-conflict",
            "A newer preparation run owns this import.",
          );
        if (record.selectionVersion !== input.selectionVersion)
          fault(
            "version-conflict",
            "The evidence selection changed during preparation.",
          );
        if (!deps.isJobActive)
          fault("unavailable", "Preparation job fencing is not configured.");
        if (
          !(await deps.isJobActive({
            importId: record.id,
            runId: input.runId,
          }))
        )
          fault(
            "cancelled",
            "The preparation run was cancelled before it completed.",
          );
        if (
          !/^[a-f0-9]{64}$/i.test(input.selectionHash) ||
          !/^[a-f0-9]{64}$/i.test(input.preparedSelectionRef) ||
          !/^[a-f0-9]{64}$/i.test(input.candidateInventoryRef)
        )
          fault("invalid-input", "Prepared evidence references are invalid.");
        if (
          record.selectionHash === input.selectionHash &&
          record.preparedSelectionRef === input.preparedSelectionRef &&
          record.candidateInventoryRef === input.candidateInventoryRef
        )
          return record;
        const next = ImportRecordSchema.parse({
          ...record,
          selectionHash: input.selectionHash,
          preparedSelectionRef: input.preparedSelectionRef,
          candidateInventoryRef: input.candidateInventoryRef,
          version: record.version + 1,
          updatedAt: now.toISOString(),
        });
        doc.imports[doc.imports.indexOf(record)] = next;
        return next;
      });
    },
    completeAnalysis(input, context) {
      return db.run(context, true, async (doc, ns, now) => {
        const record = db.find(doc, input.id, ns, context);
        if (record.version !== input.expectedVersion)
          fault(
            "version-conflict",
            "This import changed before analysis completed.",
          );
        if (
          record.activeRunId !== input.runId ||
          record.selectionVersion !== input.selectionVersion ||
          record.selectionHash !== input.selectionHash ||
          !record.consent ||
          record.consent.selectionVersion !== input.selectionVersion ||
          record.consent.selectionHash !== input.selectionHash
        )
          fault(
            "version-conflict",
            "The analysis run no longer owns the consented selection.",
          );
        if (!deps.isJobActive)
          fault("unavailable", "Analysis job fencing is not configured.");
        if (
          !(await deps.isJobActive({
            importId: record.id,
            runId: input.runId,
          }))
        )
          fault(
            "cancelled",
            "The analysis run was cancelled before it completed.",
          );
        if (!/^[a-f0-9]{64}$/i.test(input.resultRef))
          fault("invalid-input", "The analysis result reference is invalid.");
        const next = ImportRecordSchema.parse({
          ...record,
          resultRef: input.resultRef,
          resultRunId: input.runId,
          draftRefs: input.draftRefs,
          draftEdits: [],
          reviewHistory: input.reviewHistory,
          lifecycle: "analyzing",
          version: record.version + 1,
          updatedAt: now.toISOString(),
        });
        doc.imports[doc.imports.indexOf(record)] = next;
        return next;
      });
    },
    discard({ id, expectedVersion }, context) {
      return db.run(context, true, async (doc, ns) => {
        const record = db.find(doc, id, ns, context);
        if (record.version !== expectedVersion)
          fault(
            "version-conflict",
            "This import changed. Reload before discarding it.",
          );
        if (record.lifecycle === "approved" || record.savedIds.length > 0)
          fault(
            "forbidden",
            "Saved achievements cannot be discarded with their import.",
          );
        doc.imports = doc.imports.filter((entry) => entry.id !== id);
        const stillImported = doc.imports.some(
          (entry) =>
            entry.authorizationNamespaceHash === ns &&
            entry.scope.repositoryId === record.scope.repositoryId,
        );
        if (!stillImported) {
          doc.cache = doc.cache.filter(
            (entry) =>
              entry.identity.repositoryId !== record.scope.repositoryId,
          );
        } else {
          const referenced = new Set(
            doc.imports
              .flatMap((entry) => [
                entry.preparedSelectionRef,
                entry.resultRef,
                entry.candidateInventoryRef,
                ...entry.reviewHistory.flatMap((revision) => [
                  revision.preparedSelectionRef,
                  revision.resultRef,
                ]),
              ])
              .filter((key): key is string => key !== null),
          );
          doc.cache = doc.cache.filter(
            (entry) =>
              entry.identity.repositoryId !== record.scope.repositoryId ||
              referenced.has(entry.key),
          );
        }
        return { discarded: true as const };
      });
    },
    updateExpectedVersion(input, context) {
      return db.run(context, true, (doc, ns, now) => {
        const r = db.find(doc, input.id, ns, context);
        if (r.version !== input.expectedVersion)
          fault(
            "version-conflict",
            "This import changed. Reload before saving edits.",
          );
        if (
          Date.parse(r.retentionDeadline) <= now.getTime() ||
          r.lifecycle === "expired"
        )
          fault("version-conflict", "This staged import expired.");
        const keys: Array<keyof ImportRecordPatch> = [
          "destinationProjectId",
          "scope",
          "selectionVersion",
          "selectionHash",
          "lifecycle",
          "activeRunId",
          "consent",
          "preparedSelectionRef",
          "resultRef",
          "resultRunId",
          "approvalKeyHash",
          "draftRefs",
          "draftEdits",
          "savedIds",
          "pinnedFileIds",
          "removedFileIds",
          "candidateInventoryRef",
          "reviewHistory",
        ];
        if (
          Object.keys(input.patch).some(
            (k) => !keys.includes(k as keyof ImportRecordPatch),
          )
        )
          fault(
            "invalid-input",
            "The import patch contains unsupported fields.",
          );
        const changedScope =
          input.patch.scope &&
          canonical(input.patch.scope) !== canonical(r.scope);
        const changedManualSelection =
          (input.patch.pinnedFileIds !== undefined &&
            canonical(input.patch.pinnedFileIds) !==
              canonical(r.pinnedFileIds)) ||
          (input.patch.removedFileIds !== undefined &&
            canonical(input.patch.removedFileIds) !==
              canonical(r.removedFileIds));
        const changedDestination =
          input.patch.destinationProjectId !== undefined &&
          input.patch.destinationProjectId !== r.destinationProjectId;
        const changedSelection =
          changedScope || changedManualSelection || changedDestination;
        if (changedSelection && r.lifecycle === "approved")
          fault(
            "version-conflict",
            "Approved imports cannot change their evidence scope.",
          );
        const next = {
          ...r,
          ...input.patch,
          version: r.version + 1,
          updatedAt: now.toISOString(),
        };
        db.requireGrant(context, next.scope.repositoryId);
        if (changedSelection) {
          if (
            input.patch.consent ||
            input.patch.resultRef ||
            input.patch.preparedSelectionRef
          )
            fault(
              "invalid-input",
              "A changed selection needs fresh preparation and consent.",
            );
          Object.assign(next, {
            selectionVersion: r.selectionVersion + 1,
            selectionHash: null,
            consent: null,
            preparedSelectionRef: null,
            candidateInventoryRef: null,
            resultRef: null,
            resultRunId: null,
            approvalKeyHash: null,
            draftRefs: [],
            draftEdits: [],
            savedIds: [],
            activeRunId: null,
            lifecycle: "created",
          });
        }
        const checked = ImportRecordSchema.parse(next);
        doc.imports[doc.imports.indexOf(r)] = checked;
        return checked;
      });
    },
    cacheGet({ identity }, context) {
      return db.run(context, false, async (doc, ns, now) => {
        const checked = ImportCacheIdentitySchema.parse(identity);
        db.requireGrant(context, checked.repositoryId);
        const key = hash(canonical({ identity: checked, ns }));
        const found = doc.cache.find(
          (e) => e.key === key && e.authorizationNamespaceHash === ns,
        );
        if (
          !found ||
          (Date.parse(found.expiresAt) <= now.getTime() &&
            !(await protectedKeys(doc)).has(found.key))
        )
          return null;
        if (hash(canonical(found.value)) !== found.valueHash)
          fault("io-error", "Cached evidence failed integrity validation.");
        return found;
      });
    },
    cacheGetByKey({ key }, context) {
      return db.run(context, false, async (doc, ns, now) => {
        if (!/^[a-f0-9]{64}$/i.test(key))
          fault("invalid-input", "The cache reference is invalid.");
        const found = doc.cache.find(
          (entry) =>
            entry.key === key.toLowerCase() &&
            entry.authorizationNamespaceHash === ns,
        );
        if (
          !found ||
          !context.access.grantedRepositoryIds.includes(
            found.identity.repositoryId,
          )
        )
          return null;
        if (
          Date.parse(found.expiresAt) <= now.getTime() &&
          !(await protectedKeys(doc)).has(found.key)
        )
          return null;
        if (hash(canonical(found.value)) !== found.valueHash)
          fault("io-error", "Cached evidence failed integrity validation.");
        return found;
      });
    },
    cachePut(input, context) {
      return db.run(context, true, async (doc, ns, now) => {
        const identity = ImportCacheIdentitySchema.parse(input.identity);
        const value = ImportCacheValueSchema.parse(input.value);
        db.requireGrant(context, identity.repositoryId);
        if (identity.kind !== value.kind)
          fault("invalid-input", "Cache identity and value kinds differ.");
        if (
          identity.kind === "inventory" &&
          value.kind === "inventory" &&
          (identity.scope.repositoryId !== identity.repositoryId ||
            identity.scope.commitSha !== identity.commitSha ||
            value.candidates.some(
              (candidate) => candidate.selected || candidate.pinned,
            ) ||
            new Set(value.candidates.map((candidate) => candidate.id)).size !==
              value.candidates.length)
        )
          fault(
            "invalid-evidence",
            "Cached inventory does not match its pinned revision.",
          );
        if (
          value.kind === "safe-content" &&
          identity.kind === "safe-content" &&
          value.files.some(
            (f) =>
              f.blobSha !== identity.blobSha ||
              getPathExclusionReason({
                path: f.path,
                mode: "100644",
                byteSize: Buffer.byteLength(f.content),
              }) !== null ||
              createHash(f.blobSha.length === 64 ? "sha256" : "sha1")
                .update(`blob ${Buffer.byteLength(f.content)}\0`)
                .update(f.content)
                .digest("hex") !== f.blobSha.toLowerCase() ||
              !inspectFileContent(f.content, f.path).safe,
          )
        )
          fault(
            "invalid-evidence",
            "Cached content must match its blob and pass screening.",
          );
        if (
          value.kind === "selected-bundle" &&
          identity.kind === "selected-bundle" &&
          (value.prepared.selectionHash !== identity.selectionHash ||
            canonical(value.prepared.scope) !== canonical(identity.scope) ||
            canonical([...value.prepared.selectedFileIds].sort()) !==
              canonical([...identity.selectedFileIds].sort()) ||
            value.prepared.evidence.some(
              (e) =>
                e.commitSha !== identity.commitSha ||
                !identity.sourceHashes.includes(e.blobSha) ||
                hash(e.excerpt) !== e.excerptSha256,
            ))
        )
          fault(
            "invalid-evidence",
            "Cached source locations do not match the revision.",
          );
        if (
          value.kind === "extraction-result" &&
          identity.kind === "extraction-result" &&
          value.result.selectionHash !== identity.selectionHash
        )
          fault(
            "invalid-evidence",
            "Cached extraction refers to another selection.",
          );
        const expires = input.expiresAt
          ? Date.parse(input.expiresAt)
          : now.getTime() + GITHUB_IMPORT_POLICY.stageRetentionMs;
        if (
          !Number.isFinite(expires) ||
          expires <= now.getTime() ||
          expires > now.getTime() + GITHUB_IMPORT_POLICY.stageRetentionMs
        )
          fault("invalid-input", "Cache retention cannot exceed 24 hours.");
        const entry = ImportCacheEntrySchema.parse({
          key: hash(canonical({ identity, ns })),
          authorizationNamespaceHash: ns,
          identity,
          value,
          valueHash: hash(canonical(value)),
          createdAt: now.toISOString(),
          expiresAt: new Date(expires).toISOString(),
          byteSize: Buffer.byteLength(canonical(value)),
        });
        // Include cache metadata, not just source text, in the disk ceiling.
        entry.byteSize = Buffer.byteLength(JSON.stringify(entry));
        doc.cache = doc.cache.filter((e) => e.key !== entry.key);
        doc.cache.push(entry);
        const keys = await protectedKeys(doc);
        keys.add(entry.key);
        trimCache(doc, keys);
        return entry;
      });
    },
    expire(input, context) {
      return db.run(context, true, async (doc, ns, now) => {
        const before = input.before ? Date.parse(input.before) : now.getTime();
        if (!Number.isFinite(before) || before > now.getTime())
          fault("invalid-input", "Cleanup cannot expire future data.");
        const keys = await protectedKeys(doc);
        let expiredImports = 0;
        let preservedActiveImports = 0;
        for (const r of doc.imports) {
          if (
            r.authorizationNamespaceHash !== ns ||
            r.lifecycle === "approved" ||
            r.lifecycle === "expired" ||
            Date.parse(r.retentionDeadline) > before
          )
            continue;
          if (await active(r, deps)) {
            preservedActiveImports++;
            continue;
          }
          Object.assign(r, {
            lifecycle: "expired",
            version: r.version + 1,
            updatedAt: now.toISOString(),
            consent: null,
            preparedSelectionRef: null,
            candidateInventoryRef: null,
            resultRef: null,
            resultRunId: null,
            approvalKeyHash: null,
            draftRefs: [],
            draftEdits: [],
            reviewHistory: [],
            pinnedFileIds: [],
            removedFileIds: [],
            activeRunId: null,
          });
          expiredImports++;
        }
        const old = doc.cache.length;
        doc.cache = doc.cache.filter(
          (e) => Date.parse(e.expiresAt) > before || keys.has(e.key),
        );
        const expiredCacheEntries = old - doc.cache.length;
        const trimmed = trimCache(doc, keys);
        return {
          expiredImports,
          expiredCacheEntries,
          evictedCacheEntries: trimmed.evicted,
          preservedActiveImports,
          bytesAfterCleanup: trimmed.size,
        };
      });
    },
    invalidateAuthorizationNamespace(input, context) {
      return db.run(context, true, (doc, ns, now) => {
        if (hash(input.authorizationNamespace) !== ns)
          fault("forbidden", "Cannot invalidate another workspace.");
        const removedEntries = doc.cache.length;
        doc.cache = [];
        for (const r of doc.imports)
          if (r.lifecycle !== "approved")
            Object.assign(r, {
              lifecycle: "cancelled",
              version: r.version + 1,
              updatedAt: now.toISOString(),
              consent: null,
              preparedSelectionRef: null,
              candidateInventoryRef: null,
              resultRef: null,
              resultRunId: null,
              approvalKeyHash: null,
              draftRefs: [],
              draftEdits: [],
              reviewHistory: [],
              pinnedFileIds: [],
              removedFileIds: [],
              activeRunId: null,
            });
        return { removedEntries };
      });
    },
  };
}

export const createDeferredMeasurementTaskStore: DeferredMeasurementTaskStoreFactory =
  (deps) => {
    const db = engine(deps);
    return {
      create(input, context) {
        return db.run(context, true, (doc, _ns, now) => {
          const task = DeferredMeasurementTaskSchema.parse({
            ...input,
            id: deps.id(),
            version: 1,
            createdAt: now.toISOString(),
            retentionDeadline: new Date(
              now.getTime() +
                GITHUB_IMPORT_POLICY.deferredMeasurementRetentionMs,
            ).toISOString(),
          });
          if (doc.deferred.some((t) => t.id === task.id))
            fault("version-conflict", "Deferred task ID already exists.");
          doc.deferred.push(task);
          return task;
        });
      },
      get({ id }, context) {
        return db.run(context, false, (doc, _ns, now) => {
          const task = doc.deferred.find(
            (t) =>
              t.id === id && Date.parse(t.retentionDeadline) > now.getTime(),
          );
          if (!task) fault("not-found", "Deferred measurement task not found.");
          return task;
        });
      },
      delete(input, context) {
        return db.run(context, true, (doc) => {
          const task = doc.deferred.find((t) => t.id === input.id);
          if (!task) fault("not-found", "Deferred task not found.");
          if (task.version !== input.expectedVersion)
            fault("version-conflict", "Deferred task changed.");
          doc.deferred = doc.deferred.filter((t) => t.id !== task.id);
          return { deleted: true as const };
        });
      },
      expire(input, context) {
        return db.run(context, true, (doc, _ns, now) => {
          const before = input.before
            ? Date.parse(input.before)
            : now.getTime();
          if (!Number.isFinite(before) || before > now.getTime())
            fault("invalid-input", "Cleanup cannot expire future data.");
          const old = doc.deferred.length;
          doc.deferred = doc.deferred.filter(
            (t) => Date.parse(t.retentionDeadline) > before,
          );
          return { expired: old - doc.deferred.length };
        });
      },
    };
  };
