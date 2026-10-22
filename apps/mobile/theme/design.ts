import { DynamicColorIOS, Platform, PlatformColor, type ColorValue } from 'react-native';
import { cubicBezier, Easing } from 'react-native-reanimated';

/**
 * Design tokens — "Calm Mono" (see docs/design/README.md).
 *
 * Ink on paper: the UI is monochrome and type does the work. The one colour
 * is green, and it only ever means "live". Orange marks a warning. Status is
 * always a glyph plus a word, never colour alone.
 */

const ios = (name: string, fallback: string): ColorValue =>
  Platform.OS === 'ios' ? PlatformColor(name) : fallback;

const dynamic = (light: string, dark: string): ColorValue =>
  Platform.OS === 'ios' ? DynamicColorIOS({ light, dark }) : light;

/** Ink and paper, the two colours the UI is drawn in. */
export const INK = { light: '#111114', dark: '#F5F5F7' } as const;
export const PAPER = { light: '#FFFFFF', dark: '#0E0E10' } as const;

export const color = {
  label: ios('label', '#000000'),
  secondaryLabel: ios('secondaryLabel', '#3C3C4399'),
  tertiaryLabel: ios('tertiaryLabel', '#3C3C434D'),
  quaternaryLabel: ios('quaternaryLabel', '#3C3C432E'),
  separator: ios('separator', '#3C3C4349'),
  background: ios('systemBackground', '#FFFFFF'),
  groupedBackground: ios('systemGroupedBackground', '#F2F2F7'),
  secondaryGroupedBackground: ios('secondarySystemGroupedBackground', '#FFFFFF'),
  fill: ios('tertiarySystemFill', '#7676801F'),
  /** Interactive elements are ink, not a brand colour. */
  accent: dynamic(INK.light, INK.dark),
  ink: dynamic(INK.light, INK.dark),
  /** The opaque sheet. */
  paper: dynamic(PAPER.light, PAPER.dark),
  /** Hairline dividers between rows. */
  hairline: dynamic('rgba(17,17,20,0.14)', 'rgba(245,245,247,0.16)'),
  /** Outline of the route chip. */
  outline: dynamic('rgba(17,17,20,0.4)', 'rgba(245,245,247,0.4)'),
  live: ios('systemGreen', '#34C759'),
  warning: ios('systemOrange', '#FF9500'),
  /** Wash behind a warning tile: orange at low strength. */
  warningFill: dynamic('rgba(255,149,0,0.12)', 'rgba(255,159,10,0.18)'),
  critical: ios('systemRed', '#FF3B30'),
  /** Weather glyphs only (the cloud, its rain): drawing, not status. */
  cloud: ios('systemGray', '#8E8E93'),
  rain: ios('systemBlue', '#007AFF'),
  onAccent: dynamic(PAPER.light, PAPER.dark),
} as const;

/**
 * Plain-string colours for places that can't take PlatformColor (map overlays,
 * SwiftUI modifiers that expect hex). Light/dark pairs follow the iOS system
 * palette so they match the semantic colours above.
 */
export const hex = {
  accent: INK,
  ink: INK,
  paper: PAPER,
  /** Map marker fill: close to the muted map so markers read as outlines. */
  mapPaper: { light: '#FFFFFF', dark: '#141416' },
  live: { light: '#34C759', dark: '#30D158' },
  warning: { light: '#FF9500', dark: '#FF9F0A' },
  critical: { light: '#FF3B30', dark: '#FF453A' },
  secondaryLabel: { light: '#8A8A8E', dark: '#98989F' },
  casing: { light: 'rgba(255,255,255,0.9)', dark: 'rgba(0,0,0,0.6)' },
  stopFill: { light: '#FFFFFF', dark: '#141416' },
} as const;

export type Scheme = 'light' | 'dark';

export function pick<T extends { light: string; dark: string }>(
  pair: T,
  scheme: Scheme,
): string {
  return scheme === 'dark' ? pair.dark : pair.light;
}

export const space = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
} as const;

/** Horizontal margin for sheet and screen content. */
export const MARGIN = 22;

export const radius = {
  row: 12,
  group: 20,
} as const;

export const type = {
  hero: { fontSize: 64, lineHeight: 64, fontWeight: '200' as const },
  heroUnit: { fontSize: 20, fontWeight: '400' as const },
  /** Small sentence-case label above a group of rows. */
  section: { fontSize: 13, lineHeight: 18, fontWeight: '500' as const },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' as const },
  body: { fontSize: 17, lineHeight: 22, fontWeight: '400' as const },
  status: { fontSize: 15, lineHeight: 20, fontWeight: '400' as const },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '600' as const },
} as const;

/** Motion durations in ms (Reanimated). SwiftUI equivalents use seconds. */
export const motion = {
  press: 120,
  state: 180,
  crossfade: 200,
  number: 350,
  reposition: 400,
  /** Sheet content revealing as the sheet grows out of peek. */
  sheetIn: 240,
  /** Sheet content leaving as the sheet collapses: faster than it came in. */
  sheetOut: 140,
  /** Trip ⇄ detail: the outgoing view leaves fast... */
  pushOut: 150,
  /** ...and the incoming one arrives a beat later. */
  pushIn: 260,
  pushOverlap: 70,
} as const;

/** Strong ease-out for UI entering or changing state; never ease-in. */
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
/** The same curve for Reanimated CSS transitions. */
export const CSS_EASE_OUT = cubicBezier(0.23, 1, 0.32, 1);
/** How far the sheet body rises as it fades in out of peek. */
export const SHEET_REVEAL_SHIFT = 10;

/** The peek's "Where to?" row: a 44pt glass capsule plus 8pt below it. */
export const WHERE_TO_ROW_HEIGHT = 52;

/**
 * Content height of the peek detent in points: top padding, the "Where to?"
 * row, the two-line header, then the peek card (number and journey, action
 * and next bus). The sheet adds the home indicator inset on top; the strip is
 * allowed to sit in its upper part (about 20pt above the screen edge, like
 * the Apple Maps card) so no empty band shows below it.
 */
export const PEEK_CONTENT_HEIGHT = 160 + WHERE_TO_ROW_HEIGHT;
/** Peek top padding, under the grabber. */
export const PEEK_TOP = 14;

/**
 * Sheet detents for the persistent trip sheet: peek, glance, large. Detents
 * are fractions of the sheet's largest height (the window below the top safe
 * area), so peek is derived from points to hug its content on every phone.
 */
export function sheetDetents(windowHeight: number, topInset: number): [number, number, number] {
  return [peekDetent(windowHeight, topInset), 0.5, 1];
}

/**
 * The itinerary peek holds its header, the result row and Go, so it stands
 * taller than the trip peek it covers.
 */
const ITINERARY_PEEK_HEIGHT = PEEK_CONTENT_HEIGHT + 60;

/** Detents for the `itinerary` sheet: peek (header, row and Go), half, large. */
export function itineraryDetents(windowHeight: number, topInset: number): [number, number, number] {
  return [peekDetent(windowHeight, topInset, ITINERARY_PEEK_HEIGHT, 0.45), 0.5, 1];
}

/** Peek as a fraction of the sheet's largest height. The cap leaves room on an iPhone SE (212 / 647pt). */
function peekDetent(windowHeight: number, topInset: number, height = PEEK_CONTENT_HEIGHT, cap = 0.35): number {
  const max = Math.max(1, windowHeight - topInset);
  return Math.min(cap, height / max);
}
export const SHEET_INITIAL_DETENT = 1;
export type DetentIndex = 0 | 1 | 2;
