export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error("interrupted"), { code: "interrupted" }));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error("interrupted"), { code: "interrupted" }));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function thinkMs(rng, browsing = false) {
  const span = browsing ? 7_001 : 3_001;
  const minimum = browsing ? 8_000 : 2_000;
  return minimum + Math.floor(rng() * span);
}
