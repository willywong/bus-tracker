/**
 * Geofence region ids, pure so they're testable. One task watches two kinds
 * of region: a favourite's boarding stop (`routeCode|stopId`, the original
 * format, kept so regions registered before Go still route) and a Go ride
 * leg's alight stop (`go|<legIndex>|<stopKey>`, 15/06). iOS watches at most
 * 20 per app, so Go's come first and the favourites fill what's left.
 */

const SEPARATOR = '|';
const GO = 'go';
/** iOS monitors at most 20 regions per app. */
export const MAX_REGIONS = 20;

export type ParsedRegion =
  | { kind: 'favourite'; routeCode: string; stopId: string }
  | { kind: 'go'; legIndex: number };

/** `go|<legIndex>|<stopKey>`: the stop key only keeps ids unique and readable. */
export function goRegionId(legIndex: number, stopKey: string): string {
  return [GO, String(legIndex), stopKey.replaceAll(SEPARATOR, '_')].join(SEPARATOR);
}

export function parseRegionId(id: string): ParsedRegion | null {
  const parts = id.split(SEPARATOR);
  if (parts[0] === GO && parts.length === 3) {
    const legIndex = Number(parts[1]);
    return Number.isInteger(legIndex) && legIndex >= 0 && parts[1] !== '' ? { kind: 'go', legIndex } : null;
  }
  if (parts.length === 2 && parts[0] && parts[1]) return { kind: 'favourite', routeCode: parts[0], stopId: parts[1] };
  return null;
}

/** Go's regions first, then favourites, deduped by id, at most `max`. */
export function mergeRegions<T extends { identifier?: string }>(go: readonly T[], favourites: readonly T[], max = MAX_REGIONS): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of [...go, ...favourites]) {
    if (out.length >= max) break;
    const id = r.identifier ?? '';
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(r);
  }
  return out;
}
