import { JSDOM } from "jsdom";
import { act, createElement, type ReactNode } from "react";
import type { Root } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type {
  ImportReviewState,
  ImportStep,
} from "../../../src/lib/github/contracts";

const mocks = vi.hoisted(() => ({
  getImport: vi.fn(),
  sessionFetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: () => undefined,
    replace: () => undefined,
    refresh: () => undefined,
  }),
}));

vi.mock("next/link", async () => {
  const { createElement: link } = await import("react");
  return {
    default: ({
      href,
      children,
      ...props
    }: {
      href: string;
      children?: ReactNode;
    }) => link("a", { href, ...props }, children),
  };
});

vi.mock("../../../src/lib/github/client", () => ({
  createImportClient: () => ({
    get: mocks.getImport,
    subscribeStatus: () => ({
      ok: true,
      value: {
        close() {},
        cursor: null,
      },
    }),
  }),
}));

vi.mock("../../../src/lib/github/session-client", () => ({
  sessionFetch: mocks.sessionFetch,
  resetImportSession: vi.fn(),
  cancelImportRequest: vi.fn(),
}));

let createRoot: typeof import("react-dom/client").createRoot;
let ImportWorkspace: typeof import("../../../src/components/github-import/import-workspace").ImportWorkspace;
let visibleImportStep: typeof import("../../../src/components/github-import/import-workspace").visibleImportStep;

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/library/github/does-not-exist-123",
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
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  });
  ({ createRoot } = await import("react-dom/client"));
  ({ ImportWorkspace, visibleImportStep } =
    await import("../../../src/components/github-import/import-workspace"));
});

afterAll(() => dom.window.close());

const mountedRoots: Array<{ root: Root; host: HTMLDivElement }> = [];

function review(
  lifecycle: ImportReviewState["import"]["lifecycle"],
  options: { id?: string; drafts?: boolean } = {},
): ImportReviewState {
  return {
    import: { id: options.id ?? "import-1", lifecycle },
    result: options.drafts ? { drafts: [{}] } : null,
  } as ImportReviewState;
}

function step(input: {
  importId: string | null;
  loading?: boolean;
  review?: ImportReviewState | null;
  forceSetup?: boolean;
  routeState?: ImportStep;
}) {
  return visibleImportStep({
    importId: input.importId,
    loading: input.loading ?? false,
    review: input.review ?? null,
    forceSetup: input.forceSetup ?? false,
    routeState: input.routeState ?? "analysis",
  });
}

beforeEach(() => {
  mocks.getImport.mockReset();
  mocks.sessionFetch.mockReset();
  mocks.sessionFetch.mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          data: {
            state: "disconnected",
            repositories: [],
            nextCursor: null,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );
});

afterEach(() => {
  for (const { root, host } of mountedRoots.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
  document.body.replaceChildren();
});

async function renderMissing(
  message: string,
  source: "personal" | "demo" = "personal",
) {
  mocks.getImport.mockResolvedValue({
    ok: false,
    error: { code: "needs-context", message, retryable: false },
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(ImportWorkspace, {
        source,
        importId: "does-not-exist-123",
        routeState: "analysis",
        initialState: null,
        projects: [{ id: "project-1", name: "Example project" }],
      }),
    );
  });
  mountedRoots.push({ root, host });
  return host;
}

describe("visibleImportStep", () => {
  it("does not mark Analyze current for a well-formed id that is not a live import", () => {
    expect(
      step({ importId: "does-not-exist-123", routeState: "analysis" }),
    ).toBe("missing");
    expect(
      step({
        importId: "does-not-exist-123",
        loading: true,
        routeState: "analysis",
      }),
    ).toBe("pending");
    expect(
      step({
        importId: "other-import",
        review: review("ready-to-analyze", { id: "import-1" }),
        routeState: "analysis",
      }),
    ).toBe("missing");
  });

  it("opens a live import on the step its lifecycle actually reached", () => {
    expect(
      step({
        importId: "import-1",
        review: review("created"),
        routeState: "analysis",
      }),
    ).toBe("setup");
    expect(
      step({
        importId: "import-1",
        review: review("ready-to-analyze"),
        routeState: "setup",
      }),
    ).toBe("analysis");
    expect(
      step({
        importId: "import-1",
        review: review("ready-to-review"),
        routeState: "analysis",
      }),
    ).toBe("review");
    expect(
      step({
        importId: "import-1",
        review: review("partial", { drafts: true }),
        routeState: "setup",
      }),
    ).toBe("review");
    expect(
      step({
        importId: "import-1",
        review: review("preparing"),
        routeState: "setup",
      }),
    ).toBe("analysis");
    expect(
      step({
        importId: "import-1",
        review: review("ready-to-analyze"),
        forceSetup: true,
      }),
    ).toBe("setup");
    expect(step({ importId: null, routeState: "setup" })).toBe("setup");
  });
});

describe("missing GitHub import", () => {
  it("renders a not-found state with links and does not open Analyze", async () => {
    const host = await renderMissing(
      "Connect GitHub before starting an import.",
    );

    expect(host.querySelector("[data-step]")?.getAttribute("data-step")).toBe(
      "missing",
    );
    expect(host.querySelector('[aria-current="step"]')).toBeNull();
    expect(host.textContent).toContain("This import was not found");
    expect(host.textContent).not.toContain(
      "Connect GitHub before starting an import.",
    );
    expect(host.textContent).not.toContain("Import repository achievements");
    expect(
      host.querySelector('a[href="/library/github/new"]')?.textContent,
    ).toContain("Start a new import");
    expect(host.querySelector('a[href="/library"]')?.textContent).toContain(
      "Return to the library",
    );
  });

  it("keeps the ended-import explanation and both recovery links", async () => {
    const host = await renderMissing(
      "This temporary import ended. Start a new import; unsaved evidence is not retained after reload.",
    );

    expect(host.textContent).toContain("temporary import ended");
    expect(host.querySelector('a[href="/library/github/new"]')).not.toBeNull();
    expect(host.querySelector('a[href="/library"]')).not.toBeNull();
    expect(host.querySelector('[aria-current="step"]')).toBeNull();
  });

  it("points a demo import back at the demo library", async () => {
    const host = await renderMissing(
      "This temporary import ended. Start a new import; unsaved evidence is not retained after reload.",
      "demo",
    );

    expect(
      host.querySelector('a[href="/library/github/new?source=demo"]'),
    ).not.toBeNull();
    expect(host.querySelector('a[href="/library?source=demo"]')).not.toBeNull();
  });
});
