import { afterEach, describe, expect, it, vi } from "vitest";
import {
  remainingRequestTime,
  withRequestBudget,
} from "../../../src/lib/cloud/request-budget";
import { contentSecurityPolicy } from "../../../src/lib/cloud/headers";
afterEach(() => vi.useRealTimers());
describe("production response hardening", () => {
  it("isolates simultaneous deadlines and clamps expired work to zero", async () => {
    vi.useFakeTimers();
    const results = await Promise.all([
      withRequestBudget(async () => remainingRequestTime(300_000), 20_000),
      withRequestBudget(async () => remainingRequestTime(300_000), 40_000),
    ]);
    expect(results).toEqual([20_000, 40_000]);
    withRequestBudget(
      () => expect(remainingRequestTime(60_000, 40_000)).toBe(10_000),
      50_000,
    );
    withRequestBudget(() => {
      vi.advanceTimersByTime(1001);
      expect(remainingRequestTime(60_000)).toBe(0);
    }, 1000);
    expect(remainingRequestTime(60_000)).toBe(60_000);
  });
  it("permits only nonced production scripts and no local emulator connections", () => {
    const policy = contentSecurityPolicy("Zm9vYmFy", false, false);
    expect(policy).toContain("'nonce-Zm9vYmFy'");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toContain("127.0.0.1");
    expect(() =>
      contentSecurityPolicy("bad'; script-src *", false, false),
    ).toThrow();
  });
});
