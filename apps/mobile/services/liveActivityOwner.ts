/**
 * Who owns the one Live Activity. Go owns it (15/08): while a journey is on,
 * a followed bus doesn't start its own activity (in-app following carries
 * on), and one already up ends. Once Go ends, the bus activity may start
 * again. `RideContext` sets the flag; `useBusLiveActivity` reads it. Pure
 * module state, no native imports, so it runs under `tsx --test`.
 */

let goActive = false;
const listeners = new Set<() => void>();

/** The bus activity shows only while a bus is followed and no journey is on. */
export function busActivityAllowed(following: boolean, goIsActive: boolean): boolean {
  return following && !goIsActive;
}

export function isGoActive(): boolean {
  return goActive;
}

/** Marks a Go journey on or off; listeners hear only a change. */
export function setGoActive(on: boolean): void {
  if (on === goActive) return;
  goActive = on;
  for (const l of listeners) l();
}

/** For `useSyncExternalStore`: returns an unsubscribe. */
export function subscribeGoActive(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
