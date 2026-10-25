import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CompilerBusyError,
  createCompilerPool,
} from "../../../src/lib/pdf/compiler-pool";
afterEach(() => vi.useRealTimers());
describe("hosted compiler capacity", () => {
  it("queues a bounded number of jobs and releases capacity after failures", async () => {
    const run = createCompilerPool(1, 1);
    let finish!: () => void;
    const first = run(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const calls: string[] = [];
    const next = run(async () => {
      calls.push("second");
      throw new Error("Compiler failure");
    });
    const failure = expect(next).rejects.toThrow("Compiler failure");
    await expect(run(async () => "overflow")).rejects.toBeInstanceOf(
      CompilerBusyError,
    );
    expect(calls).toEqual([]);
    finish();
    await first;
    await failure;
    expect(calls).toEqual(["second"]);
    await expect(run(async () => "healthy")).resolves.toBe("healthy");
  });
  it("expires a queued request without allowing it to run later", async () => {
    vi.useFakeTimers();
    const run = createCompilerPool(1, 1);
    let finish!: () => void;
    const first = run(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const work = vi.fn();
    const waiting = expect(run(work, 1000)).rejects.toBeInstanceOf(
      CompilerBusyError,
    );
    await vi.advanceTimersByTimeAsync(1001);
    await waiting;
    finish();
    await first;
    expect(work).not.toHaveBeenCalled();
    await expect(run(async () => "ready")).resolves.toBe("ready");
  });
});
