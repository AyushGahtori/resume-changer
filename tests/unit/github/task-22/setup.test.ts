import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  task22DisconnectedProps,
  task22LoadingPullRequestsProps,
  task22LongLabelsProps,
  task22ManyPullRequestsProps,
  task22PrivateDeniedProps,
  task22PrivateReadyProps,
  task22ReadyProps,
} from "../../../fixtures/github/task-22/setup";
import type { RepositorySetupViewProps } from "../../../../src/components/github-import/repository-setup";

let createRoot: typeof import("react-dom/client").createRoot;
let RepositorySetup: typeof import("../../../../src/components/github-import/repository-setup").RepositorySetup;
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});

beforeAll(async () => {
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    HTMLTextAreaElement: {
      configurable: true,
      value: dom.window.HTMLTextAreaElement,
    },
    HTMLSelectElement: {
      configurable: true,
      value: dom.window.HTMLSelectElement,
    },
    Element: { configurable: true, value: dom.window.Element },
    Node: { configurable: true, value: dom.window.Node },
    Event: { configurable: true, value: dom.window.Event },
  });
  ({ createRoot } = await import("react-dom/client"));
  ({ RepositorySetup } =
    await import("../../../../src/components/github-import/repository-setup"));
});

afterAll(() => dom.window.close());

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots: Array<{ root: Root; host: HTMLDivElement }> = [];

function mount(props: RepositorySetupViewProps) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(createElement(RepositorySetup, props));
  });
  mountedRoots.push({ root, host });
  return host;
}

function buttonNamed(host: HTMLElement, label: string) {
  const button = [...host.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.replace(/\s+/g, " ").trim() === label,
  );
  if (!button) throw new Error("Missing button: " + label);
  return button;
}

function labeledControl(host: HTMLElement, text: string) {
  const label = [...host.querySelectorAll("label")].find((candidate) =>
    candidate.textContent?.replace(/\s+/g, " ").includes(text),
  );
  if (!label?.htmlFor) throw new Error("Missing labeled control: " + text);
  const control = host.querySelector(`#${label.htmlFor}`);
  if (!(control instanceof dom.window.HTMLElement)) {
    throw new Error("Missing control for label: " + text);
  }
  return control;
}

function baseProps(
  overrides: Partial<RepositorySetupViewProps> = {},
): RepositorySetupViewProps {
  return task22ReadyProps({
    onConnect: vi.fn(),
    onRepositoryChange: vi.fn(),
    onDestinationChange: vi.fn(),
    onRoleChange: vi.fn(),
    onPrSelectionChange: vi.fn(),
    ...overrides,
  });
}

afterEach(() => {
  for (const { root, host } of mountedRoots.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RepositorySetup", () => {
  it("renders the selected repository, destination, and snapshot status without starting work", () => {
    const onConnect = vi.fn();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const host = mount(
      baseProps({
        repositoryRevision: { ref: "main", sha },
        onConnect,
      }),
    );

    expect(host.querySelector("h1")?.textContent).toBe(
      "Import GitHub project evidence",
    );
    expect(host.textContent).toContain("example-labs/fictional-dashboard");
    expect(host.textContent).toContain("Public repository");
    expect(host.textContent).toContain("main · 0123456");
    expect(host.textContent).toContain("Fictional Dashboard");
    expect(host.textContent).toContain("Nothing is saved automatically.");
    expect(host.textContent).toContain("Setup ready");
    expect(onConnect).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("supports authorized private repositories without a coming-soon state", () => {
    const host = mount(baseProps(task22PrivateReadyProps()));

    expect(host.textContent).toContain("Private repository");
    expect(host.textContent).toContain(
      "Private repository access is active for this selection.",
    );
    expect(host.textContent).not.toMatch(/coming soon/i);
  });

  it("keeps denied private access blocked and offers an explicit recovery action", () => {
    const onConnect = vi.fn();
    const host = mount(baseProps({ ...task22PrivateDeniedProps(), onConnect }));

    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "does not have access",
    );
    expect(host.textContent).toContain("Access denied");
    expect(host.textContent).toContain("Setup needs attention");
    expect(host.querySelector('[data-readiness="ready"]')).toBeNull();
    expect(host.querySelector('[aria-label="Pull requests"]')).toBeNull();

    act(() => buttonNamed(host, "Review GitHub access").click());
    expect(onConnect).toHaveBeenCalledOnce();
  });

  it("shows disconnected access as actionable and invokes only the supplied callback", () => {
    const onConnect = vi.fn();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const host = mount(baseProps({ ...task22DisconnectedProps(), onConnect }));

    expect(host.textContent).toContain("Not connected");
    expect(host.querySelector("select")).not.toBeNull();
    expect(onConnect).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();

    act(() => buttonNamed(host, "Connect GitHub").click());
    expect(onConnect).toHaveBeenCalledOnce();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("handles expired and unavailable access without reporting a ready setup", () => {
    const onConnect = vi.fn();
    const expired = mount(
      baseProps({
        connectionState: "error",
        connectionPresentationState: "expired",
        connectionStatusMessage: "This GitHub connection has expired.",
        ready: false,
        onConnect,
      }),
    );

    expect(expired.textContent).toContain("Connection expired");
    expect(expired.textContent).toContain(
      "This GitHub connection has expired.",
    );
    expect(expired.querySelector('[data-readiness="ready"]')).toBeNull();
    act(() => buttonNamed(expired, "Reconnect GitHub").click());
    expect(onConnect).toHaveBeenCalledOnce();

    const unavailable = mount(
      baseProps({
        connectionState: "error",
        error: {
          code: "unavailable",
          message: "GitHub is temporarily unavailable.",
          retryable: true,
        },
        ready: false,
      }),
    );
    expect(unavailable.textContent).toContain("Connection unavailable");
    expect(unavailable.textContent).toContain(
      "GitHub is temporarily unavailable.",
    );
    expect(unavailable.querySelector('[data-readiness="ready"]')).toBeNull();
  });

  it("keeps the PR picker pending, supports empty and partial states, and offers the manual fallback", () => {
    const onPrSelectionChange = vi.fn();
    const loading = mount(
      baseProps({
        ...task22LoadingPullRequestsProps(),
        onPrSelectionChange,
      }),
    );
    expect(loading.querySelector('[aria-busy="true"]')?.textContent).toContain(
      "Loading the latest pull requests",
    );
    expect(buttonNamed(loading, "Continue without PR scope").disabled).toBe(
      false,
    );
    act(() => buttonNamed(loading, "Continue without PR scope").click());
    expect(onPrSelectionChange).toHaveBeenCalledWith([]);

    const empty = mount(
      baseProps({
        pullRequests: [],
        selectedPullRequestNumbers: [],
        ready: false,
        pullRequestState: "empty",
      }),
    );
    expect(empty.textContent).toContain("No pull requests were found.");
    expect(empty.querySelector('[aria-label="Pull requests"]')).toBeNull();
    expect(buttonNamed(empty, "Continue without PR scope")).toBeTruthy();

    const partial = mount(
      baseProps({
        pullRequestState: "partial",
        pullRequestStatusMessage: "Some results could not be loaded.",
      }),
    );
    expect(partial.textContent).toContain("Some results could not be loaded.");
    expect(partial.textContent).toContain(
      "#17 Add project summary aggregation",
    );
  });

  it("emits controlled keyboard-selectable changes without changing scope on render", () => {
    const onRepositoryChange = vi.fn();
    const onDestinationChange = vi.fn();
    const onRoleChange = vi.fn();
    const onPrSelectionChange = vi.fn();
    const props = baseProps({
      repositories: [
        ...task22ReadyProps().repositories,
        {
          ...task22ReadyProps().repositories[0],
          repositoryId: "700002",
          owner: "fictional-team",
          name: "private-services",
          canonicalUrl: "https://github.com/fictional-team/private-services",
          visibility: "private",
        },
      ],
      projects: [
        ...task22ReadyProps().projects,
        { id: "project-two", name: "Second project" },
      ],
      onRepositoryChange,
      onDestinationChange,
      onRoleChange,
      onPrSelectionChange,
    });
    const host = mount(props);
    const repositorySelect = labeledControl(
      host,
      "Repository",
    ) as HTMLSelectElement;
    const projectSelect = labeledControl(
      host,
      "Achievement Library project",
    ) as HTMLSelectElement;
    const roleInput = labeledControl(
      host,
      "Your role on this project",
    ) as HTMLTextAreaElement;
    const setRoleValue = Object.getOwnPropertyDescriptor(
      dom.window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    if (!setRoleValue) throw new Error("Textarea value setter is unavailable");

    act(() => {
      repositorySelect.value = "700002";
      repositorySelect.dispatchEvent(
        new dom.window.Event("change", { bubbles: true }),
      );
      projectSelect.value = "project-two";
      projectSelect.dispatchEvent(
        new dom.window.Event("change", { bubbles: true }),
      );
      setRoleValue.call(roleInput, "I built the access-control layer.");
      roleInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    const checkbox = [
      ...host.querySelectorAll<HTMLInputElement>("input[type=checkbox]"),
    ].find((candidate) => candidate.id.endsWith("-pr-18"));
    if (!checkbox) throw new Error("Missing pull request #18 checkbox");
    act(() => checkbox.click());

    expect(onRepositoryChange).toHaveBeenCalledWith("700002");
    expect(onDestinationChange).toHaveBeenCalledWith("project-two");
    expect(onRoleChange).toHaveBeenCalledWith(
      "I built the access-control layer.",
    );
    expect(onPrSelectionChange).toHaveBeenCalledWith([17, 18]);
    expect(props.ready).toBe(true);
    expect(
      host.querySelector("[data-readiness]")?.getAttribute("data-readiness"),
    ).toBe("ready");
  });

  it("keeps permission management secondary to the repository picker", () => {
    const onConnect = vi.fn();
    const props = baseProps({
      onConnect,
      installationUrl:
        "https://github.com/apps/resume-changer-preview/installations/new",
    });
    const host = mount(props);
    const link = host.querySelector<HTMLAnchorElement>(
      'a[href$="/installations/new"]',
    );
    expect(link?.textContent).toContain("Manage repository access on GitHub");
    expect(link?.target).toBe("_blank");
    expect(link?.rel).toContain("noopener");
    expect(host.textContent).toContain(
      "permissions do not select a repository for analysis",
    );
    expect(host.textContent).toContain("read-only access");
    expect(onConnect).not.toHaveBeenCalled();
    const unsafe = mount(
      baseProps({
        installationUrl: "https://evil.example/installations/new",
      }),
    );
    expect(unsafe.querySelector('a[href*="evil.example"]')).toBeNull();
  });

  it("caps selected PRs, retains long labels, and rejects unsafe repository links", () => {
    const host = mount(
      baseProps({
        ...task22ManyPullRequestsProps(),
        repositories: [
          {
            ...task22LongLabelsProps().repositories[0],
            canonicalUrl: "javascript:alert(1)",
          },
        ],
        projects: task22LongLabelsProps().projects,
        selectedProjectId: task22LongLabelsProps().selectedProjectId,
      }),
    );

    const longProps = task22LongLabelsProps();
    expect(host.textContent).toContain(longProps.repositories[0].owner);
    expect(host.textContent).toContain(longProps.repositories[0].name);
    expect(host.textContent).toContain(longProps.projects[0].name);
    expect(host.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(
      host.querySelector<HTMLInputElement>(
        "#" +
          [
            ...host.querySelectorAll<HTMLInputElement>("input[type=checkbox]"),
          ].find((candidate) => candidate.id.endsWith("-pr-20"))?.id,
      )?.disabled,
    ).toBe(true);
  });
});

it("offers one connect action before showing repository permission settings", () => {
  const host = mount(
    baseProps({
      ...task22DisconnectedProps(),
      installationUrl:
        "https://github.com/apps/resume-changer-preview/installations/new",
    }),
  );
  expect(
    [...host.querySelectorAll("button")].filter((button) =>
      button.textContent?.includes("Connect GitHub"),
    ),
  ).toHaveLength(1);
  expect(host.querySelector('a[href$="/installations/new"]')).toBeNull();
  expect(host.textContent).toContain("return here to choose one repository");
});

it("refreshes permissions on return once and allows a manual refresh without reconnecting", () => {
  const refresh = vi.fn(),
    connect = vi.fn();
  const host = mount(
    baseProps({
      onConnect: connect,
      onRefreshRepositories: refresh,
      installationUrl:
        "https://github.com/apps/resume-changer-preview/installations/new",
    }),
  );
  const details = host.querySelector("details");
  expect(details?.open).toBe(false);
  const link = host.querySelector<HTMLAnchorElement>(
    'a[href$="/installations/new"]',
  )!;
  link.addEventListener("click", (event) => event.preventDefault());
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  act(() => {
    link.click();
    window.dispatchEvent(new dom.window.Event("focus"));
    window.dispatchEvent(new dom.window.Event("focus"));
  });
  expect(refresh).toHaveBeenCalledOnce();
  act(() => buttonNamed(host, "Refresh repository list").click());
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(connect).not.toHaveBeenCalled();
});

it("opens recovery for an empty repository list and disables concurrent refresh", () => {
  const host = mount(
    baseProps({
      repositories: [],
      selectedRepositoryId: null,
      ready: false,
      onRefreshRepositories: vi.fn(),
      isRefreshingRepositories: true,
    }),
  );
  expect(host.querySelector("details")?.open).toBe(true);
  expect(
    (buttonNamed(host, "Refreshing repositories…") as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(host.querySelector('[data-readiness="ready"]')).toBeNull();
});
