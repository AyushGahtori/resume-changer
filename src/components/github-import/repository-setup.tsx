"use client";

import {
  AlertCircle,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  GitBranch,
  Globe2,
  Info,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useId, type ChangeEvent } from "react";
import type {
  DomainError,
  PullRequestSummary,
  RepositorySetupProps,
} from "@/lib/github/contracts";
import styles from "./repository-setup.module.css";
import { safeGithubInstallationUrl } from "../../lib/github/installation-url";

/** Optional display details supplied by the page controller when available. */
export type RepositorySetupDisplayProps = {
  installationUrl?: string;
  connectionPresentationState?: "expired" | "denied" | "unavailable";
  connectionStatusMessage?: string | null;
  pullRequestState?:
    | "idle"
    | "loading"
    | "ready"
    | "empty"
    | "partial"
    | "error"
    | "unavailable";
  pullRequestStatusMessage?: string | null;
  repositoryRevision?: { ref: string; sha: string } | null;
};

export type RepositorySetupViewProps = RepositorySetupProps &
  RepositorySetupDisplayProps;

const MAX_VISIBLE_PULL_REQUESTS = 30;
const MAX_SELECTED_PULL_REQUESTS = 3;

function canonicalGithubHref(repository: {
  canonicalUrl: string;
  owner: string;
  name: string;
}) {
  try {
    const url = new URL(repository.canonicalUrl);
    const path = url.pathname.replace(/\/$/, "").toLowerCase();
    const expectedPath =
      `/${repository.owner}/${repository.name}`.toLowerCase();
    if (
      url.protocol === "https:" &&
      url.origin === "https://github.com" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash &&
      path === expectedPath
    ) {
      return url.href;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function isFullRevision(sha?: string | null) {
  return Boolean(sha && /^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(sha));
}

function connectionStatus(
  connectionState: RepositorySetupProps["connectionState"],
  error: DomainError | null,
  presentationState?: RepositorySetupDisplayProps["connectionPresentationState"],
  presentationMessage?: string | null,
) {
  if (presentationState === "expired") {
    return {
      label: "Connection expired",
      action: "Reconnect GitHub",
      tone: "expired",
      message:
        presentationMessage ??
        "Reconnect GitHub to refresh access to this repository.",
    } as const;
  }

  if (presentationState === "denied" || error?.code === "forbidden") {
    return {
      label: "Access denied",
      action: "Review GitHub access",
      tone: "denied",
      message:
        presentationMessage ??
        error?.message ??
        "GitHub did not grant access to this repository.",
    } as const;
  }

  if (
    presentationState === "unavailable" ||
    error?.code === "unavailable" ||
    error?.code === "io-error" ||
    error?.code === "rate-limited" ||
    error?.code === "upstream-error"
  ) {
    return {
      label: "Connection unavailable",
      action: "Reconnect GitHub",
      tone: "unavailable",
      message:
        presentationMessage ??
        error?.message ??
        "GitHub connection status could not be checked. Try again when the service is available.",
    } as const;
  }

  if (connectionState === "connected") {
    return {
      label: "Connected",
      action: null,
      tone: "connected",
      message:
        "Only repositories available to this GitHub connection can be selected.",
    } as const;
  }

  if (connectionState === "connecting") {
    return {
      label: "Connecting",
      action: "Connecting…",
      tone: "connecting",
      message: "Waiting for GitHub to finish the connection.",
    } as const;
  }

  if (connectionState === "disconnected") {
    return {
      label: "Not connected",
      action: "Connect GitHub",
      tone: "disconnected",
      message: "Connect an authorized GitHub account to choose repositories.",
    } as const;
  }

  return {
    label: "Connection needs attention",
    action: "Reconnect GitHub",
    tone: "unavailable",
    message:
      error?.message ??
      "Reconnect GitHub or review the repository permissions before continuing.",
  } as const;
}

function pullRequestStateMessage(
  state: NonNullable<RepositorySetupDisplayProps["pullRequestState"]>,
  message?: string | null,
) {
  if (message) return message;
  switch (state) {
    case "idle":
      return "Choose a connected repository to load its recent pull requests.";
    case "loading":
      return "Loading recent pull requests from the selected repository.";
    case "ready":
      return "Select up to three PRs that best describe the work to review.";
    case "empty":
      return "No pull requests were found. You can continue with repository and role context.";
    case "partial":
      return "Some pull request details could not be loaded. Review the available results or continue without PR scope.";
    case "error":
      return "Pull requests could not be loaded. Continue without PR scope or change the repository.";
    case "unavailable":
      return "Pull request access is unavailable for this connection. You can continue without PR scope.";
  }
}

function inferredPullRequestState(
  props: RepositorySetupProps,
): NonNullable<RepositorySetupDisplayProps["pullRequestState"]> {
  if (props.connectionState === "connecting") return "loading";
  if (props.connectionState === "error") return "error";
  if (props.connectionState !== "connected" || !props.selectedRepositoryId) {
    return "idle";
  }
  return props.pullRequests.length ? "ready" : "empty";
}

function pullRequestStateLabel(state: PullRequestSummary["state"]) {
  switch (state) {
    case "open":
      return "Open";
    case "closed":
      return "Closed";
    case "merged":
      return "Merged";
    case "unknown":
      return "Status unknown";
  }
}

export function RepositorySetup(props: RepositorySetupViewProps) {
  const {
    repositories,
    selectedRepositoryId,
    projects,
    selectedProjectId,
    connectionState,
    role,
    pullRequests,
    selectedPullRequestNumbers,
    ready,
    error,
    onConnect,
    onRepositoryChange,
    onDestinationChange,
    onRoleChange,
    onPrSelectionChange,
    connectionPresentationState,
    connectionStatusMessage,
    pullRequestStatusMessage,
    repositoryRevision,
  } = props;
  const pullRequestState =
    props.pullRequestState ?? inferredPullRequestState(props);
  const id = useId().replaceAll(":", "");
  const repoSelectId = `github-repository-${id}`;
  const destinationSelectId = `github-destination-${id}`;
  const roleInputId = `github-role-${id}`;
  const selectedRepository = repositories.find(
    (repository) => repository.repositoryId === selectedRepositoryId,
  );
  const selectedProject = projects.find(
    (project) => project.id === selectedProjectId,
  );
  const connection = connectionStatus(
    connectionState,
    error,
    connectionPresentationState,
    connectionStatusMessage,
  );
  const repositoryHref = selectedRepository
    ? canonicalGithubHref(selectedRepository)
    : undefined;
  const revisionIsAvailable = isFullRevision(repositoryRevision?.sha);
  const selectedNumbers = new Set(selectedPullRequestNumbers);
  const canPickPullRequests =
    connectionState === "connected" &&
    connection.tone === "connected" &&
    Boolean(selectedRepository);
  const canContinueWithoutPr = canPickPullRequests;
  const visiblePullRequests = pullRequests
    .filter(
      (candidate) =>
        Number.isInteger(candidate.number) &&
        candidate.number > 0 &&
        candidate.title.trim().length > 0,
    )
    .slice(0, MAX_VISIBLE_PULL_REQUESTS);
  const setupReady =
    ready &&
    !error &&
    connectionState === "connected" &&
    connection.tone === "connected" &&
    Boolean(selectedRepository) &&
    Boolean(selectedProject);
  const readyState = setupReady
    ? "ready"
    : error || connectionState === "error"
      ? "blocked"
      : "incomplete";
  const readinessMessage = setupReady
    ? "Your repository and destination are ready. Review your contribution scope before preparing evidence."
    : connection.tone === "denied"
      ? "Repository access must be restored before setup can become ready."
      : "Choose an authorized repository and an existing project. PR selection is optional.";

  function handleRepositoryChange(event: ChangeEvent<HTMLSelectElement>) {
    const repositoryId = event.currentTarget.value;
    onRepositoryChange(repositoryId || null);
  }

  function handleDestinationChange(event: ChangeEvent<HTMLSelectElement>) {
    const projectId = event.currentTarget.value;
    onDestinationChange(projectId || null);
  }

  function handleRoleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    onRoleChange(event.currentTarget.value);
  }

  function handlePullRequestChange(number: number, checked: boolean) {
    const next = new Set(selectedPullRequestNumbers);
    if (checked) {
      if (next.size >= MAX_SELECTED_PULL_REQUESTS) return;
      next.add(number);
    } else {
      next.delete(number);
    }
    onPrSelectionChange([...next].sort((first, second) => first - second));
  }

  return (
    <section
      className={styles.root}
      aria-labelledby={`github-import-title-${id}`}
      data-readiness={readyState}
    >
      <nav className={styles.breadcrumb} aria-label="Page location">
        <span>Achievement Library</span>
        <span className={styles.breadcrumbDivider} aria-hidden="true">
          /
        </span>
        <span aria-current="page">GitHub import</span>
      </nav>

      <div className={styles.introRow}>
        <header className={styles.intro}>
          <div className={styles.titleRow}>
            <GitBranch
              aria-hidden="true"
              className={styles.titleIcon}
              size={30}
              strokeWidth={2}
            />
            <h1 className={styles.title} id={`github-import-title-${id}`}>
              Import GitHub project evidence
            </h1>
          </div>
          <p className={styles.subtitle}>
            Turn repository evidence into factual, reviewable achievement
            drafts.
          </p>
        </header>

        <aside className={styles.reviewNotice} aria-label="Review first">
          <Info aria-hidden="true" className={styles.noticeIcon} size={18} />
          <div>
            <p className={styles.noticeTitle}>
              Nothing is saved automatically.
            </p>
            <p className={styles.noticeText}>
              Review the prepared evidence before analysis. Drafts stay here
              until you choose what to save to your Achievement Library.
            </p>
          </div>
        </aside>
      </div>

      {error ? (
        <div className={styles.errorNotice} role="alert">
          <AlertCircle aria-hidden="true" size={18} />
          <div>
            <strong>Setup needs attention</strong>
            <p>{error.message}</p>
          </div>
        </div>
      ) : null}

      <div className={styles.sourceGrid}>
        <section
          className={styles.sourceCard}
          aria-labelledby={`${repoSelectId}-heading`}
        >
          <div className={styles.cardHeading}>
            <span className={styles.githubTile} aria-hidden="true">
              <GitBranch size={21} strokeWidth={2} />
            </span>
            <div className={styles.cardHeadingText}>
              <p className={styles.eyebrow}>Source repository</p>
              <h2 id={`${repoSelectId}-heading`}>Choose where to look</h2>
            </div>
          </div>

          {connectionState === "connected" ? (
            <label className={styles.field} htmlFor={repoSelectId}>
              <span className={styles.fieldLabel}>Repository</span>
              <span className={styles.selectWrap}>
                <select
                  id={repoSelectId}
                  className={styles.select}
                  value={
                    selectedRepository ? selectedRepository.repositoryId : ""
                  }
                  onChange={handleRepositoryChange}
                  disabled={repositories.length === 0}
                >
                  <option value="" disabled>
                    {repositories.length
                      ? "Select an accessible repository"
                      : "No accessible repositories"}
                  </option>
                  {repositories.map((repository) => (
                    <option
                      key={repository.repositoryId}
                      value={repository.repositoryId}
                    >
                      {repository.owner}/{repository.name}
                      {repository.visibility === "private"
                        ? " · Private"
                        : " · Public"}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  aria-hidden="true"
                  className={styles.selectIcon}
                  size={16}
                />
              </span>
            </label>
          ) : (
            <div className={styles.repositoryUnavailable}>
              <p className={styles.fieldLabel}>Repository access</p>
              <p className={styles.helperText}>
                Connect GitHub to choose from repositories you are authorized to
                use.
              </p>
            </div>
          )}

          {selectedRepository ? (
            <div className={styles.repositoryIdentity}>
              <div className={styles.repositoryNameRow}>
                <p className={styles.repositoryName}>
                  {repositoryHref ? (
                    <a
                      href={repositoryHref}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`${selectedRepository.owner}/${selectedRepository.name} on GitHub (opens in a new tab)`}
                    >
                      {selectedRepository.owner}/{selectedRepository.name}
                      <ExternalLink aria-hidden="true" size={14} />
                    </a>
                  ) : (
                    <span>
                      {selectedRepository.owner}/{selectedRepository.name}
                    </span>
                  )}
                </p>
                <span
                  className={`${styles.visibility} ${
                    selectedRepository.visibility === "private"
                      ? styles.privateVisibility
                      : styles.publicVisibility
                  }`}
                >
                  {selectedRepository.visibility === "private" ? (
                    <LockKeyhole aria-hidden="true" size={13} />
                  ) : (
                    <Globe2 aria-hidden="true" size={13} />
                  )}
                  {selectedRepository.visibility === "private"
                    ? "Private repository"
                    : "Public repository"}
                </span>
              </div>
              <div className={styles.revisionBlock}>
                {repositoryRevision && revisionIsAvailable ? (
                  <p className={styles.revision}>
                    <span>Snapshot revision</span>
                    <span
                      title={repositoryRevision.sha}
                      aria-label={`Revision ${repositoryRevision.sha}`}
                    >
                      {repositoryRevision.ref} ·{" "}
                      {repositoryRevision.sha.slice(0, 7)}
                    </span>
                  </p>
                ) : ready ? (
                  <p className={styles.revision}>
                    <span>Revision status</span>
                    <span>Revision ready for evidence preparation</span>
                  </p>
                ) : (
                  <p className={styles.revisionUnavailable}>
                    The exact commit will be pinned before file inspection.
                  </p>
                )}
                {selectedRepository.defaultBranch ? (
                  <p className={styles.branch}>
                    Default branch:{" "}
                    <span>{selectedRepository.defaultBranch}</span>
                  </p>
                ) : null}
              </div>
            </div>
          ) : (
            <p className={styles.helperText}>
              Repository identity and its current revision will appear here
              after selection.
            </p>
          )}
        </section>

        <section
          className={styles.sourceCard}
          aria-labelledby={`${destinationSelectId}-heading`}
        >
          <div className={styles.cardHeading}>
            <span className={styles.projectTile} aria-hidden="true">
              <BriefcaseBusiness size={20} strokeWidth={2} />
            </span>
            <div className={styles.cardHeadingText}>
              <p className={styles.eyebrow}>Destination project</p>
              <h2 id={`${destinationSelectId}-heading`}>
                Where drafts will be saved
              </h2>
            </div>
          </div>

          <label className={styles.field} htmlFor={destinationSelectId}>
            <span className={styles.fieldLabel}>
              Achievement Library project
            </span>
            <span className={styles.selectWrap}>
              <select
                id={destinationSelectId}
                className={styles.select}
                value={selectedProject ? selectedProject.id : ""}
                onChange={handleDestinationChange}
                disabled={projects.length === 0}
              >
                <option value="" disabled>
                  {projects.length
                    ? "Select a project"
                    : "No projects available"}
                </option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <ChevronDown
                aria-hidden="true"
                className={styles.selectIcon}
                size={16}
              />
            </span>
          </label>

          {selectedProject ? (
            <div className={styles.destinationSummary}>
              <p className={styles.destinationName}>{selectedProject.name}</p>
              <p className={styles.helperText}>
                Reviewed points go to this existing project. Its project details
                and demo URL remain unchanged.
              </p>
            </div>
          ) : (
            <p className={styles.helperText}>
              Choose an existing project. Create one in Achievement Library if
              none is available; no project details are changed here.
            </p>
          )}
        </section>

        <section
          className={styles.accessCard}
          aria-labelledby={`${id}-access-heading`}
        >
          <div className={styles.cardHeading}>
            <span
              className={`${styles.connectionIcon} ${styles[`connection${connection.tone}`]}`}
              aria-hidden="true"
            >
              {connectionState === "connected" ? (
                <CheckCircle2 size={19} />
              ) : connectionState === "connecting" ? (
                <LoaderCircle className={styles.spinner} size={19} />
              ) : connection.tone === "denied" ? (
                <AlertCircle size={19} />
              ) : (
                <ShieldCheck size={19} />
              )}
            </span>
            <div className={styles.cardHeadingText}>
              <p className={styles.eyebrow}>GitHub access</p>
              <h2 id={`${id}-access-heading`}>Connection and revision</h2>
            </div>
          </div>

          <p
            className={styles.connectionStatus}
            role={connectionState === "connecting" ? "status" : undefined}
            aria-live={connectionState === "connecting" ? "polite" : undefined}
            aria-busy={connectionState === "connecting" || undefined}
          >
            <span
              className={`${styles.statusDot} ${styles[`dot${connection.tone}`]}`}
              aria-hidden="true"
            />
            <strong>{connection.label}</strong>
          </p>
          <p className={styles.helperText}>{connection.message}</p>

          {connection.action ? (
            <button
              className={styles.connectButton}
              type="button"
              onClick={onConnect}
              disabled={connectionState === "connecting"}
            >
              {connectionState === "error" ? (
                <RefreshCw aria-hidden="true" size={15} />
              ) : (
                <GitBranch aria-hidden="true" size={15} />
              )}
              {connection.action}
            </button>
          ) : null}
          {safeGithubInstallationUrl(props.installationUrl) ? (
            <div className={styles.repositoryAccess}>
              <a
                className={styles.connectButton}
                href={safeGithubInstallationUrl(props.installationUrl)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink aria-hidden="true" size={15} /> Choose
                repositories
              </a>
              <p className={styles.helperText}>
                Choose one or more repositories on GitHub. Resume Changer
                requests read-only access. Reconnect afterward to refresh this
                list.
              </p>
            </div>
          ) : null}
          {selectedRepository?.visibility === "private" &&
          connectionState === "connected" ? (
            <p className={styles.privateAccessNote}>
              <LockKeyhole aria-hidden="true" size={14} />
              Private repository access is active for this selection.
            </p>
          ) : null}
        </section>
      </div>

      <div className={styles.scopeGrid}>
        <section
          className={styles.scopeCard}
          aria-labelledby={`${roleInputId}-heading`}
        >
          <div className={styles.scopeHeading}>
            <div>
              <p className={styles.eyebrow}>Your contribution</p>
              <h2 id={`${roleInputId}-heading`}>What did you work on?</h2>
            </div>
            <span className={styles.optionalLabel}>Brief context</span>
          </div>
          <label className={styles.field} htmlFor={roleInputId}>
            <span className={styles.fieldLabel}>Your role on this project</span>
            <textarea
              className={styles.roleInput}
              id={roleInputId}
              value={role}
              onChange={handleRoleChange}
              placeholder="For example: I built the dashboard and added its data-loading tests."
              rows={3}
              aria-describedby={`${roleInputId}-help`}
            />
          </label>
          <p className={styles.helperText} id={`${roleInputId}-help`}>
            Describe your own work briefly. PR selection helps find evidence; it
            does not confirm that you authored every change.
          </p>
        </section>

        <section
          className={styles.scopeCard}
          aria-labelledby={`${id}-pr-heading`}
        >
          <div className={styles.scopeHeading}>
            <div>
              <p className={styles.eyebrow}>PR scope</p>
              <h2 id={`${id}-pr-heading`}>Select relevant pull requests</h2>
            </div>
            <span className={styles.optionalLabel}>Optional</span>
          </div>

          {canPickPullRequests ? (
            <>
              <p className={styles.prExplanation}>
                Titles and changed-file context guide the review. Selecting a PR
                is not a claim of authorship.
              </p>
              <p
                className={styles.prState}
                role={
                  pullRequestState === "loading"
                    ? "status"
                    : pullRequestState === "error" ||
                        pullRequestState === "unavailable"
                      ? "alert"
                      : undefined
                }
                aria-live={
                  pullRequestState === "loading" ? "polite" : undefined
                }
                aria-busy={pullRequestState === "loading" || undefined}
              >
                {pullRequestState === "loading" ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className={styles.spinner}
                    size={15}
                  />
                ) : null}
                {pullRequestStateMessage(
                  pullRequestState,
                  pullRequestStatusMessage,
                )}
              </p>

              {visiblePullRequests.length > 0 ? (
                <ul
                  className={styles.pullRequestList}
                  aria-label="Pull requests"
                >
                  {visiblePullRequests.map((candidate) => {
                    const checked = selectedNumbers.has(candidate.number);
                    const lockedByLimit =
                      !checked &&
                      selectedNumbers.size >= MAX_SELECTED_PULL_REQUESTS;
                    const checkboxId = `${id}-pr-${candidate.number}`;
                    return (
                      <li
                        className={styles.pullRequestItem}
                        key={candidate.number}
                      >
                        <input
                          className={styles.checkbox}
                          id={checkboxId}
                          type="checkbox"
                          checked={checked}
                          onChange={(event) =>
                            handlePullRequestChange(
                              candidate.number,
                              event.currentTarget.checked,
                            )
                          }
                          disabled={lockedByLimit}
                        />
                        <label
                          className={styles.pullRequestLabel}
                          htmlFor={checkboxId}
                        >
                          <span className={styles.pullRequestTitle}>
                            <span>#{candidate.number}</span> {candidate.title}
                          </span>
                          <span className={styles.pullRequestMeta}>
                            <span className={styles.prBadge}>
                              {pullRequestStateLabel(candidate.state)}
                            </span>
                            {candidate.changedPaths.length > 0 ? (
                              <span>
                                {candidate.changedPaths.length} changed{" "}
                                {candidate.changedPaths.length === 1
                                  ? "file"
                                  : "files"}
                              </span>
                            ) : null}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              ) : null}

              {pullRequests.length > MAX_VISIBLE_PULL_REQUESTS ? (
                <p className={styles.helperText}>
                  This picker shows up to {MAX_VISIBLE_PULL_REQUESTS} pull
                  requests. Refine your contribution scope if you need a
                  different set.
                </p>
              ) : null}

              {selectedNumbers.size >= MAX_SELECTED_PULL_REQUESTS ? (
                <p className={styles.helperText}>
                  Up to {MAX_SELECTED_PULL_REQUESTS} PRs can guide one analysis.
                </p>
              ) : null}

              <button
                className={styles.manualScopeButton}
                type="button"
                onClick={() => onPrSelectionChange([])}
                disabled={!canContinueWithoutPr}
              >
                Continue without PR scope
              </button>
            </>
          ) : (
            <div className={styles.accessRequired}>
              <p
                className={styles.prState}
                role={connection.tone === "denied" ? "alert" : undefined}
              >
                {connectionState === "connected" && !selectedRepository
                  ? "Choose a connected repository to load its pull requests."
                  : connection.message}
              </p>
              {connection.action ? (
                <button
                  className={styles.manualScopeButton}
                  type="button"
                  onClick={onConnect}
                  disabled={connectionState === "connecting"}
                >
                  {connection.action}
                </button>
              ) : null}
            </div>
          )}
        </section>
      </div>

      <div
        className={styles.readiness}
        data-state={readyState}
        role="status"
        aria-live="polite"
      >
        {readyState === "ready" ? (
          <CheckCircle2 aria-hidden="true" size={17} />
        ) : readyState === "blocked" ? (
          <AlertCircle aria-hidden="true" size={17} />
        ) : (
          <Info aria-hidden="true" size={17} />
        )}
        <span className={styles.readinessLabel}>
          {readyState === "ready"
            ? "Setup ready"
            : readyState === "blocked"
              ? "Setup needs attention"
              : "Setup in progress"}
        </span>
        <span className={styles.readinessMessage}>{readinessMessage}</span>
      </div>
    </section>
  );
}
