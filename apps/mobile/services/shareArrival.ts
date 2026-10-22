/**
 * The "Share arrival" text: "T816 to Hotel Lisa De Inn: 4 min (live
 * estimate)." Null when there is nothing to share yet (no countdown, or no
 * stop to name).
 */
export function arrivalShareMessage(
  routeCode: string,
  stopName: string | null,
  compact: string | null,
  source: 'live' | 'scheduled' | string,
): string | null {
  if (!compact || !stopName) return null;
  const how = source === 'scheduled' ? 'scheduled' : 'live estimate';
  return `${routeCode} to ${stopName}: ${compact} (${how}).`;
}
