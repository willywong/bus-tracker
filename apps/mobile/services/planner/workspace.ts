/**
 * Which networks have a `plan()` suspended between slices. `plan()` and a
 * `retime` tail re-plan share the network's RAPTOR workspace (14/05), so
 * nothing may retime on a network while its plan is mid-run. The planner's
 * engine holds it for its run; Go checks before each retime and waits for
 * the next snapshot when it's taken. JS is single-threaded: a synchronous
 * retime between slices is the only way the two can overlap.
 */
const holds = new WeakMap<object, number>();

/** Marks `net`'s workspace as in use; call the returned release once, when the run ends. */
export function holdWorkspace(net: object): () => void {
  holds.set(net, (holds.get(net) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const n = (holds.get(net) ?? 1) - 1;
    if (n <= 0) holds.delete(net);
    else holds.set(net, n);
  };
}

export function workspaceBusy(net: object): boolean {
  return (holds.get(net) ?? 0) > 0;
}
