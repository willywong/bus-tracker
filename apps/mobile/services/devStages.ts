// TEMPORARY (plan 12/06 Simulator checks): dev-only stage markers on the
// same clock as the refresh's frame-gap log, so each logged gap can be put
// in the stage it fell in. Remove with the other dev harnesses at the end
// of the phase.

let origin: number | null = null;

function isDev(): boolean {
  return (globalThis as unknown as { __DEV__?: boolean }).__DEV__ ?? false;
}

/** Starts the clock (at refresh start); returns its origin. */
export function startDevStages(): number {
  origin = performance.now();
  return origin;
}

/** Logs `[transit-network] stage <name> +T ms` in dev once the clock is started. */
export function devStage(name: string): void {
  if (origin === null || !isDev()) return;
  console.log(`[transit-network] stage ${name} +${Math.round(performance.now() - origin)} ms`);
}
