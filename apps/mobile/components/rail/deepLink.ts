/**
 * Path-style rail deep links (plan 13/05), rewritten to the file routes:
 *
 * - `t816://station/<id>`          → `/station?station=<id>`
 * - `t816://line/<routeId>/<dir>`  → `/line?line=<routeId>&dir=<dir>`
 *
 * The scheme is optional. Anything else, including bare `t816://` (Live
 * Activity, widget) and the query forms (`t816://station?station=…`, which
 * file routing already handles), returns null so the caller leaves it alone.
 * Ids are re-encoded, so `rail%3AKJ` stays `rail%3AKJ` and `rail:KJ`
 * becomes it. Unknown station slugs still map: the sheet says "Station not
 * found".
 */
export function railDeepLink(path: string): string | null {
  const rest = path.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^\/+/, '');
  if (rest === '' || /[?#]/.test(rest)) return null;
  const parts = rest.replace(/\/+$/, '').split('/');
  const [kind, id, dir] = parts;
  if (kind === 'station' && parts.length === 2) {
    const station = reencode(id);
    return station ? `/station?station=${station}` : null;
  }
  if (kind === 'line' && parts.length === 3 && (dir === '0' || dir === '1')) {
    const line = reencode(id);
    return line ? `/line?line=${line}&dir=${dir}` : null;
  }
  return null;
}

/** One path segment, decoded and encoded again; null if empty or malformed. */
function reencode(segment: string | undefined): string | null {
  if (!segment) return null;
  try {
    const decoded = decodeURIComponent(segment);
    return decoded ? encodeURIComponent(decoded) : null;
  } catch {
    return null;
  }
}

/**
 * Bare `t816://` (the bus Live Activity and the widget): the scheme with no
 * path. Scheme optional, so the router's `/` counts too.
 */
export function isBareLink(path: string): boolean {
  return path.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^\/+/, '') === '';
}
