import { setupProps } from "../../../../src/components/github-import/testing/fixtures";
import type {
  PullRequestSummary,
  RepositorySetupProps,
} from "../../../../src/lib/github/contracts";
import type { RepositorySetupViewProps } from "../../../../src/components/github-import/repository-setup";

export function task22ReadyProps(
  overrides: Partial<RepositorySetupViewProps> = {},
): RepositorySetupViewProps {
  return { ...setupProps("ready"), ...overrides };
}

export function task22PrivateReadyProps() {
  const props = task22ReadyProps();
  const repository = {
    ...props.repositories[0],
    visibility: "private" as const,
  };
  return {
    ...props,
    repositories: [repository],
    selectedRepositoryId: repository.repositoryId,
  };
}

export function task22PrivateDeniedProps() {
  return setupProps("private-denied");
}

export function task22DisconnectedProps() {
  return task22ReadyProps({
    repositories: [],
    selectedRepositoryId: null,
    connectionState: "disconnected",
    selectedProjectId: null,
    ready: false,
    pullRequests: [],
    selectedPullRequestNumbers: [],
    pullRequestState: "idle",
  });
}

export function task22LoadingPullRequestsProps() {
  return task22ReadyProps({
    ready: false,
    pullRequestState: "loading",
    pullRequestStatusMessage: "Loading the latest pull requests…",
  });
}

export function task22LongLabelsProps() {
  const owner = "long-team-name-" + "x".repeat(36);
  const name = "contribution-analysis-dashboard-" + "y".repeat(38);
  const props = task22ReadyProps();
  return {
    ...props,
    repositories: [
      {
        ...props.repositories[0],
        owner,
        name,
        canonicalUrl: `https://github.com/${owner}/${name}`,
      },
    ],
    projects: [
      {
        id: "long-project",
        name:
          "Long project destination for a reviewed GitHub contribution " +
          "that should wrap without hiding where achievements will be saved",
      },
    ],
    selectedProjectId: "long-project",
  };
}

export function task22ManyPullRequestsProps(): RepositorySetupProps & {
  pullRequestState: "ready";
} {
  const props = task22ReadyProps();
  const source = props.pullRequests[0];
  const pullRequests: PullRequestSummary[] = Array.from(
    { length: 4 },
    (_, index) => ({
      ...source,
      number: 17 + index,
      title: `Contribution PR ${17 + index}`,
      selected: index < 3,
    }),
  );
  return {
    ...props,
    ready: false,
    pullRequests,
    selectedPullRequestNumbers: [17, 18, 19],
    pullRequestState: "ready",
  };
}
