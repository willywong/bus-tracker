import { FEED_IDS, MODES, type FeedId, type Mode, type TransitNetwork } from "./network.js";

const allModes = new WeakMap<TransitNetwork, Uint8Array>();

/**
 * Per pattern, 1 if its route's mode is in `modes` (every pattern when
 * `modes` is undefined). The all-modes mask is cached per network and shared,
 * so callers must not mutate it.
 */
export function patternMask(net: TransitNetwork, modes?: readonly Mode[]): Uint8Array {
  const P = net.patterns;
  if (modes === undefined) {
    let mask = allModes.get(net);
    if (!mask) allModes.set(net, (mask = new Uint8Array(P.count).fill(1)));
    return mask;
  }
  const want = new Uint8Array(MODES.length);
  for (const m of modes) {
    const i = MODES.indexOf(m);
    if (i >= 0) want[i] = 1;
  }
  const mask = new Uint8Array(P.count);
  for (let p = 0; p < P.count; p++) mask[p] = want[net.routes.mode[P.route[p]]];
  return mask;
}

/**
 * Feeds left out of the network (`meta.included === false`: expired or
 * missing), in {@link FEED_IDS} order. Spec §4.4 returns these as
 * `PlanResult.excludedFeeds` for the banner; they do not depend on `modes`.
 */
export function excludedFeeds(net: TransitNetwork): FeedId[] {
  return FEED_IDS.filter((f) => net.meta.feeds[f]?.included === false);
}
