import { getClockUse24h } from '@/components/tracker/logic';

const SMALL_WORDS = new Set(['la', 'el', 'da', 'do', 'di', 'du']);

/**
 * Acronyms that must always render fully upper-cased. These are Malaysian
 * transit-system names (and one proper-noun neighbourhood abbreviation) that
 * wouldn't be caught by {@link isAlphaNumCode} because they contain no digits.
 */
const ACRONYMS = new Set([
  'mrt',
  'lrt',
  'ktm',
  'brt',
  'erl',
  'klia',
  'ttdi',
]);

/**
 * Display-name overrides for stops whose official/proper-noun spelling
 * doesn't fall out of generic title-casing. Keys are the raw GTFS
 * `stop_name` lowercased, trimmed, and whitespace-collapsed. Values are the
 * canonical human-readable form. Only the display is remapped — the raw
 * stop_name remains unchanged in the DB so GTFS lookups still match.
 *
 * Sources:
 *  - "Lisa De Inn" is the proper hotel name (Jalan Harapan 17/47, Petaling
 *    Jaya). "De" is part of the proper noun, not a Spanish/Portuguese
 *    particle, so it's capitalised.
 *  - "PJ210 Bangunan Sin Chew Daily (Opp)" is the RapidKL stop code
 *    followed by the Malay building name and an "Opp" (opposite-side)
 *    qualifier; Moovit lists it as "Bangunan Sin Chew Daily (Opp) (Pj210)".
 *  - "MRT Phileo Damansara Pintu A" — MRT station entrance A on the Kajang
 *    line. "Pintu" is Malay for "entrance/door".
 */
const STOP_NAME_OVERRIDES: ReadonlyMap<string, string> = new Map([
  ['hotel lisa de inn', 'Hotel Lisa De Inn'],
  ['lisa de inn', 'Lisa De Inn'],
  ['pj210', 'PJ210'],
  ['pj210 bangunan sin chew daily', 'PJ210 Bangunan Sin Chew Daily'],
  [
    'pj210 bangunan sin chew daily, opp',
    'PJ210 Bangunan Sin Chew Daily (Opp)',
  ],
  [
    'pj210 bangunan sin chew daily opp',
    'PJ210 Bangunan Sin Chew Daily (Opp)',
  ],
  ['mrt phileo damansara pintu a', 'MRT Phileo Damansara Pintu A'],
  ['phileo damansara mrt pintu a', 'MRT Phileo Damansara Pintu A'],
  ['phileo damansara pintu a', 'MRT Phileo Damansara Pintu A'],
]);

function normalizeKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * True if a token is an alphanumeric "code" like SS2, PJ210, T816, SS2/24,
 * PJ2/A — Malaysian section codes and RapidKL stop/route codes. These should
 * render fully upper-cased rather than being title-cased to "Ss2".
 */
function isAlphaNumCode(token: string): boolean {
  if (!/[a-z]/.test(token) || !/\d/.test(token)) return false;
  return /^[a-z0-9]+(?:[\/-][a-z0-9]+)*$/.test(token);
}

export function formatStopName(raw: string | null | undefined): string {
  if (!raw) return '';
  const override = STOP_NAME_OVERRIDES.get(normalizeKey(raw));
  if (override) return override;
  return raw
    .toLowerCase()
    .split(/(\s+)/)
    .map((token, i) => {
      if (/^\s+$/.test(token)) return token;
      if (isAlphaNumCode(token)) return token.toUpperCase();
      if (ACRONYMS.has(token)) return token.toUpperCase();
      if (i > 0 && SMALL_WORDS.has(token)) return token;
      return token.charAt(0).toUpperCase() + token.slice(1);
    })
    .join('');
}

export function formatDistance(meters: number | null | undefined): string {
  if (meters == null || !Number.isFinite(meters)) return '—';
  if (meters < 950) return `${Math.max(0, Math.round(meters / 10) * 10)} m`;
  const km = meters / 1000;
  return km >= 10 ? `${km.toFixed(0)} km` : `${km.toFixed(1)} km`;
}

const CARDINALS = [
  'N',
  'NE',
  'E',
  'SE',
  'S',
  'SW',
  'W',
  'NW',
] as const;

export function bearingToCardinal(degrees: number | null | undefined): string | null {
  if (degrees == null || !Number.isFinite(degrees)) return null;
  const normalized = ((degrees % 360) + 360) % 360;
  const index = Math.round(normalized / 45) % 8;
  return CARDINALS[index] ?? 'N';
}

export function formatArrivalClock(
  minutesFromNow: number | null | undefined,
  now: number = Date.now(),
): string | null {
  if (minutesFromNow == null || !Number.isFinite(minutesFromNow)) return null;
  const arrival = new Date(now + Math.max(0, minutesFromNow) * 60_000);
  const use24h = getClockUse24h();
  return arrival.toLocaleTimeString(use24h ? 'en-GB' : 'en-US', {
    hour: use24h ? '2-digit' : 'numeric',
    minute: '2-digit',
    hour12: !use24h,
  });
}
