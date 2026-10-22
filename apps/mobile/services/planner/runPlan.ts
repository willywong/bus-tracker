/**
 * Drives a sliced generator (the engine's `plan()`) on the JS thread: steps
 * it for at most `sliceMs`, then hands the thread back with a timer, so the
 * UI keeps its frames (docs/design/README.md "Memory and search"). Unlike
 * the shared `runSteps`, it can be cancelled between slices.
 */
export interface RunPlanOptions {
  /** Longest stretch of steps before yielding the thread. */
  sliceMs?: number;
  schedule?: (cb: () => void, ms: number) => unknown;
  cancelSchedule?: (handle: unknown) => void;
  /** Monotonic clock in ms. */
  now?: () => number;
}

export interface PlanRun<T> {
  /** The generator's return value, or null once cancelled. Rejects if it throws. */
  promise: Promise<T | null>;
  /** Stops stepping, closes the generator (`return()`), resolves `promise` with null. */
  cancel(): void;
}

export const PLAN_SLICE_MS = 8;

export function runPlan<T>(gen: Generator<void, T, void>, opts: RunPlanOptions = {}): PlanRun<T> {
  const sliceMs = opts.sliceMs ?? PLAN_SLICE_MS;
  const schedule = opts.schedule ?? ((cb: () => void, ms: number) => setTimeout(cb, ms));
  const cancelSchedule = opts.cancelSchedule ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const now = opts.now ?? (() => performance.now());

  let done = false;
  let pending: unknown = null;
  let settle: (v: T | null) => void = () => {};
  let fail: (e: unknown) => void = () => {};
  const promise = new Promise<T | null>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });

  const slice = () => {
    pending = null;
    if (done) return;
    const start = now();
    try {
      for (;;) {
        const step = gen.next();
        if (step.done) {
          done = true;
          settle(step.value);
          return;
        }
        if (now() - start >= sliceMs) break;
      }
    } catch (e) {
      done = true;
      fail(e);
      return;
    }
    pending = schedule(slice, 0);
  };

  // The first slice runs on the next turn, so a caller can cancel before any work.
  pending = schedule(slice, 0);

  return {
    promise,
    cancel() {
      if (done) return;
      done = true;
      if (pending != null) cancelSchedule(pending);
      pending = null;
      try {
        gen.return(undefined as never);
      } catch {
        // A generator's finally that throws is not the caller's problem.
      }
      settle(null);
    },
  };
}
