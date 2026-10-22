import type { TransitNetwork } from "./network.js";
import type { Leg } from "./plan.js";

/**
 * The ride legs as `${label}:${board stop id}>${alight stop id}` joined by
 * `|`, or `walk` with none: the same string as `journeySignature` (14/02).
 * String stop ids rather than indices, so it also matches on tomorrow's
 * network; no times, so a re-timed itinerary keeps it.
 */
export function signatureFromLegs(net: TransitNetwork, legs: readonly Leg[]): string {
  const parts: string[] = [];
  for (const l of legs) {
    if (l.kind !== "ride") continue;
    parts.push(`${l.label}:${net.stops.id[l.from.stop!]}>${net.stops.id[l.to.stop!]}`);
  }
  return parts.length === 0 ? "walk" : parts.join("|");
}

/** 32-bit FNV-1a over the UTF-16 code units of `s`, unsigned. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Spec §4.4's `Itinerary.id`: {@link fnv1a32} of {@link signatureFromLegs}, 7 base-36 digits. */
export function itineraryId(net: TransitNetwork, legs: readonly Leg[]): string {
  return fnv1a32(signatureFromLegs(net, legs)).toString(36).padStart(7, "0");
}
