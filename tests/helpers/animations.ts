import type { Locator } from "@playwright/test";

/**
 * Waits until the animations inside an element have come to rest.
 *
 * `Animation.finished` is not a usable "the layout has settled" signal on its
 * own:
 *
 * - An animation with an infinite iteration count never finishes, so waiting
 *   for it would hang. The loading spinner in the job description form is
 *   such an animation.
 * - A CSS transition that is superseded by a new one is cancelled, and its
 *   `finished` promise then rejects with an `AbortError`. Changing the
 *   viewport size repeatedly restarts the sidebar transition, so the promise
 *   can reject while the transition that replaced it is still running.
 *
 * The wait therefore ignores infinite animations, tolerates a cancellation,
 * and keeps waiting for the transition that replaced it.
 */
export async function waitForAnimationsToSettle(
  locator: Locator,
  timeout = 10_000,
) {
  await locator.evaluate(async (element, limit) => {
    const deadline = performance.now() + limit;

    /**
     * An animation that repeats forever has no end.
     */
    const isFinite = (animation: Animation) => {
      const timing = animation.effect?.getTiming();
      if (timing?.iterations === Infinity) return false;
      return animation.effect?.getComputedTiming().endTime !== Infinity;
    };

    /**
     * Waits for the next frame, so the browser can apply pending styles
     * and start the transitions that follow a layout change. The timeout
     * keeps the wait moving when the page is not visible.
     */
    const nextFrame = () =>
      new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        requestAnimationFrame(done);
        setTimeout(done, 50);
      });

    while (performance.now() < deadline) {
      await nextFrame();
      const animations = element
        .getAnimations({ subtree: true })
        .filter(isFinite);
      if (animations.length === 0) return;
      // A cancelled transition rejects with an `AbortError`. The transition
      // that replaced it is a new animation, which the loop below picks up.
      await Promise.allSettled(animations.map((a) => a.finished));
    }

    throw new Error(`Animations did not settle within ${limit}ms.`);
  }, timeout);
}
