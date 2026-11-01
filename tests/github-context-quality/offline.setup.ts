import { vi } from "vitest";

vi.stubGlobal("fetch", async () => {
  throw new Error(
    "Network calls are disabled in the GitHub context quality harness.",
  );
});
