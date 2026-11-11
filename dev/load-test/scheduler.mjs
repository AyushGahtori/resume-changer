export function rampTargets(concurrency) {
  const targets = [];
  for (const value of [5, 20, 50, concurrency]) {
    const target = Math.min(value, concurrency);
    if (target >= 1 && targets.at(-1) !== target) targets.push(target);
  }
  return targets;
}

export function isBrowserUser(userNumber, browserPercent) {
  if (browserPercent <= 0) return false;
  return (
    Math.floor((userNumber * browserPercent) / 100) >
    Math.floor(((userNumber - 1) * browserPercent) / 100)
  );
}

export function browserSlotCap(concurrency, browserPercent) {
  if (browserPercent <= 0) return 0;
  return Math.ceil((concurrency * browserPercent) / 100);
}

export function createLimiter(rps, clock) {
  const interval = 1000 / rps;
  let nextAt = null;
  let chain = Promise.resolve();
  return {
    acquire() {
      const run = chain.then(async () => {
        const now = clock.now();
        const at = nextAt === null ? now : Math.max(now, nextAt);
        nextAt = at + interval;
        const wait = at - now;
        if (wait > 0) await clock.sleep(wait);
        return wait;
      });
      chain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}

export function createSystemClock() {
  return {
    now: () => performance.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

export function createFakeClock() {
  let time = 0;
  const pending = [];
  return {
    now: () => time,
    sleep(ms) {
      return new Promise((resolve) => {
        pending.push({ at: time + ms, resolve });
      });
    },
    async advance(ms) {
      const target = time + ms;
      for (;;) {
        pending.sort((left, right) => left.at - right.at);
        const next = pending[0];
        if (!next || next.at > target) break;
        pending.shift();
        time = next.at;
        next.resolve();
        await Promise.resolve();
      }
      time = target;
    },
  };
}

/**
 * A deterministic stand-in for the rolling pool. Sessions occupy a slot for
 * `sessionMs`, including think time, and admissions stay at one per second.
 */
export function simulatePool({
  users,
  concurrency,
  browserPercent,
  startsPerSecond = 1,
  stageMs = 60_000,
  sessionMs,
  limitMs,
}) {
  const targets = rampTargets(concurrency);
  const intermediates = targets.length - 1;
  const cap = browserSlotCap(concurrency, browserPercent);
  const apiQueue = [];
  const browserQueue = [];
  for (let userNumber = 1; userNumber <= users; userNumber += 1) {
    const queue = isBrowserUser(userNumber, browserPercent)
      ? browserQueue
      : apiQueue;
    queue.push(userNumber);
  }
  const browserUsers = browserQueue.length;
  let time = 0;
  let completed = 0;
  let maxActive = 0;
  let maxBrowsers = 0;
  let lastStart = Number.NEGATIVE_INFINITY;
  const active = [];
  const samples = [];
  const interval = 1000 / startsPerSecond;
  while (
    (apiQueue.length || browserQueue.length || active.length) &&
    time <= limitMs
  ) {
    for (let index = active.length - 1; index >= 0; index -= 1) {
      if (active[index].doneAt <= time) {
        completed += 1;
        active.splice(index, 1);
      }
    }
    maxActive = Math.max(maxActive, active.length);
    const browsers = active.filter((session) => session.browser).length;
    maxBrowsers = Math.max(maxBrowsers, browsers);
    const stage = Math.min(intermediates, Math.floor(time / stageMs));
    const target = targets[stage];
    const choices = [];
    if (apiQueue.length) {
      choices.push({ browser: false, user: apiQueue[0], queue: apiQueue });
    }
    if (browserQueue.length && browsers < cap) {
      choices.push({
        browser: true,
        user: browserQueue[0],
        queue: browserQueue,
      });
    }
    choices.sort((left, right) => left.user - right.user);
    const choice = choices[0];
    if (choice && active.length < target && time - lastStart >= interval) {
      choice.queue.shift();
      active.push({ browser: choice.browser, doneAt: time + sessionMs });
      lastStart = time;
      continue;
    }
    samples.push({ time, active: active.length, target });
    const candidates = [
      ...active.map((session) => session.doneAt),
      lastStart + interval,
    ];
    if (stage < intermediates) candidates.push((stage + 1) * stageMs);
    const future = candidates.filter((value) => value > time);
    const nextEvent = future.length ? Math.min(...future) : Number.NaN;
    if (!Number.isFinite(nextEvent)) {
      if (!active.length) break;
      time += 1;
    } else {
      time = nextEvent;
    }
  }
  return {
    completed,
    started: users - apiQueue.length - browserQueue.length,
    maxActive,
    maxBrowsers,
    browserUsers,
    samples,
  };
}

/** Stops admissions immediately and waits only for the supplied grace period. */
export async function settleAfterInterrupt(active, clock, graceMs) {
  const pending = Promise.allSettled(active);
  const winner = await Promise.race([
    pending.then(() => "settled"),
    clock.sleep(graceMs).then(() => "timeout"),
  ]);
  return { winner };
}
