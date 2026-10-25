export class CompilerBusyError extends Error {}

/** Bound CPU-heavy children per running instance; queued requests are bounded too. */
export function createCompilerPool(slots = 2, queueLimit = 4) {
  let active = 0;
  const queue: Array<() => void> = [];
  return async function run<T>(
    work: () => Promise<T>,
    waitMs = 10_000,
  ): Promise<T> {
    if (active < slots) active += 1;
    else {
      if (queue.length >= queueLimit || waitMs <= 0)
        throw new CompilerBusyError(
          "The PDF service is busy. Try again shortly.",
        );
      await new Promise<void>((resolve, reject) => {
        const ready = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          const index = queue.indexOf(ready);
          if (index !== -1) queue.splice(index, 1);
          reject(
            new CompilerBusyError(
              "The PDF service is busy. Try again shortly.",
            ),
          );
        }, waitMs);
        queue.push(ready);
      });
    }
    try {
      return await work();
    } finally {
      const next = queue.shift();
      if (next) next();
      else active -= 1;
    }
  };
}
export const withCompilerSlot = createCompilerPool();
