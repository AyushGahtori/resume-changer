import { afterEach, expect, it, vi } from "vitest";
const { fetcher } = vi.hoisted(() => ({ fetcher: vi.fn() }));
vi.mock("../../../src/lib/cloud/api-fetch", () => ({ apiFetch: fetcher }));
import {
  sessionFetch,
  resetImportSession,
  bindImportSessionAccount,
  hasImportSession,
} from "../../../src/lib/github/session-client";
const enc = new TextEncoder();
const result = (
  state: string | null,
  body: unknown = { data: { id: "test" } },
) => JSON.stringify({ type: "result", state, status: 200, body }) + "\n";
const reply = (text: string) =>
  new Response(text, { headers: { "Content-Type": "application/x-ndjson" } });
afterEach(() => {
  resetImportSession();
  vi.clearAllMocks();
});
it("serializes operations against the latest tab state and clears it for account changes", async () => {
  fetcher
    .mockResolvedValueOnce(reply(result("first")))
    .mockResolvedValueOnce(reply(result("second")));
  const a = sessionFetch("/api/github/imports", { method: "POST", body: "{}" });
  const b = sessionFetch("/api/github/imports/test");
  await Promise.all([a, b]);
  expect(JSON.parse(fetcher.mock.calls[1][1].body).state).toBe("first");
  expect(hasImportSession()).toBe(true);
  bindImportSessionAccount("bob");
  expect(hasImportSession()).toBe(false);
});
it("retains the last completed-file checkpoint when the response ends early", async () => {
  fetcher.mockResolvedValueOnce(
    reply(
      JSON.stringify({ type: "checkpoint", state: "completed-file" }) + "\n",
    ),
  );
  await expect(
    sessionFetch("/api/github/imports", { method: "POST", body: "{}" }),
  ).rejects.toThrow(/response was lost/);
  fetcher.mockResolvedValueOnce(reply(result("retry")));
  await sessionFetch("/api/github/imports/test");
  expect(JSON.parse(fetcher.mock.calls[1][1].body).state).toBe(
    "completed-file",
  );
});
it("rejects late results after discard and never restores expired state", async () => {
  let complete!: (value: Response) => void;
  fetcher.mockImplementationOnce(
    () => new Promise<Response>((r) => (complete = r)),
  );
  const pending = sessionFetch("/api/github/imports", {
    method: "POST",
    body: "{}",
  });
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
  resetImportSession();
  complete(reply(result("late")));
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(hasImportSession()).toBe(false);
  fetcher.mockResolvedValueOnce(new Response("expired", { status: 410 }));
  await sessionFetch("/api/github/imports/test");
  expect(hasImportSession()).toBe(false);
});
it("does not automatically repeat a lost AI result", async () => {
  fetcher.mockResolvedValueOnce(reply(result("ready")));
  await sessionFetch("/api/github/imports", { method: "POST", body: "{}" });
  fetcher.mockRejectedValueOnce(new Error("connection lost"));
  await expect(
    sessionFetch("/api/github/imports/test/extract", {
      method: "POST",
      body: "{}",
    }),
  ).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(2);
});
