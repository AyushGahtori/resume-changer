import { AsyncLocalStorage } from "node:async_hooks";

const deadlines = new AsyncLocalStorage<number>();
/** Reserve time for persistence and a useful response before Vercel's 300s cap. */
export function withRequestBudget<T>(work: () => T, milliseconds = 250_000): T {
  return deadlines.run(Date.now() + milliseconds, work);
}
export function remainingRequestTime(maximum: number, reserve = 0): number {
  const end = deadlines.getStore();
  return end === undefined
    ? maximum
    : Math.max(0, Math.min(maximum, end - Date.now() - reserve));
}
