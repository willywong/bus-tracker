import type { Itinerary } from "../../plan.js";

/** An itinerary's legs as `'walk'` or the ride's label, joined by `'>'` (e.g. `'T816>walk>KG>walk>KJ'`). */
export function outline(it: Itinerary): string {
  return it.legs.map((l) => (l.kind === "walk" ? "walk" : l.label)).join(">");
}

/**
 * Whether `actual` (an {@link outline}) fits `pattern`: the same number of
 * legs, each equal, where a `'*'` in `pattern` stands for any one ride label
 * (never a walk).
 */
export function outlineMatches(pattern: string, actual: string): boolean {
  const p = pattern.split(">");
  const a = actual.split(">");
  if (p.length !== a.length) return false;
  return p.every((x, i) => (x === "*" ? a[i] !== "walk" : x === a[i]));
}
