import { DynamicColorIOS, Platform } from 'react-native';

import type { HeroState, DelayStatus } from './logic';

/**
 * Static hex colors for use in Reanimated styles (PlatformColor cannot cross the worklet
 * boundary). Pairs are chosen to mirror Apple's systemBlue / Mint / Orange / Green / Red.
 */
export const heroStateColor: Record<HeroState, string> = {
  waiting: '#FF9F0A',
  relaxed: '#30D158',
  leaveNow: '#FF9F0A',
  walking: '#0A84FF',
  hurry: '#FF453A',
};

export const delayStatusColor: Record<DelayStatus, string> = {
  onTime: '#30D158',
  delayed: '#FF9F0A',
  heavilyDelayed: '#FF453A',
};

/** Badge colors for LIVE vs SCHEDULED data sources. */
export const sourceColor = {
  live: heroStateColor.relaxed,
  stale: heroStateColor.waiting,
  scheduled: '#8E8E93',
} as const;

/** Apple Settings-style flat grays in dark mode (systemGray{5,6}, etc.). */
const dyn = (light: string, dark: string) =>
  Platform.OS === 'ios' ? DynamicColorIOS({ light, dark }) : dark;

export const surfaceColor = {
  /** Canvas background — pure black in dark mode, system gray grouped in light. */
  canvas: dyn('#F2F2F7', '#000000'),
  /** Grouped-list card surface (systemGray6). */
  grouped: dyn('#FFFFFF', '#1C1C1E'),
  /**
   * Inset tray surface nested inside a `grouped` card. Darker than `grouped`
   * in light mode, lighter in dark mode — mimics Apple's "recessed" inset
   * group. Used for the telemetry tray at the bottom of CurrentBusCard.
   */
  inset: dyn('#F2F2F7', '#2C2C2E'),
  /** Hairline / separator (opaqueSeparator-equivalent). */
  hairline: dyn('#C6C6C8', '#2C2C2E'),
  /** Inline accent chip background in amber (low-opacity fill). */
  amberTint: 'rgba(255,159,10,0.14)',
  /** Blue accent chip background. */
  blueTint: 'rgba(10,132,255,0.16)',
} as const;

export const trackerSpacing = {
  screenH: 20,
  heroTopPad: 12,
  heroBottomPad: 36,
  sectionGap: 28,
  rowV: 14,
  rowH: 16,
  cardRadius: 14,
  /** Vertical padding inside each hairline-divided section of CurrentBusCard. */
  cardSectionV: 11,
} as const;

/**
 * Approach-trend tint colors. The live card, sparkline, and motion caption all
 * read from here so a falling/holding/slipping ETA always speaks one color.
 *  - approaching → green (distance falling, bus making progress)
 *  - holding     → amber (bus not getting closer — stalled / at a signal)
 *  - slipping    → red   (distance growing — bus moving away / looping)
 */
export const trendColor = {
  approaching: '#30D158',
  holding: '#FF9F0A',
  slipping: '#FF453A',
  unknown: '#8E8E93',
} as const;

/** Liquid-glass surface geometry shared by the live card, timetable chips, and islands. */
export const glassTokens = {
  /** Corner radius for the primary live card surface. */
  cardRadius: 22,
  /** Corner radius for glass chips (timetable, pills). */
  chipRadius: 16,
  /** Inner horizontal padding of the live card. */
  cardPadH: 18,
  /** Diameter of the refresh ring drawn around the live dot. */
  ringSize: 22,
  /** Stroke width of the refresh ring. */
  ringStroke: 2,
  /** Fixed height of the approach-trend sparkline Host island. */
  trendChartHeight: 72,
  /** Realtime poll cadence (ms) the refresh ring fills against. Mirrors POLL_INTERVAL_MS. */
  pollIntervalMs: 30_000,
} as const;

/** Bento-grid tile geometry for the cockpit redesign. */
export const bentoTokens = {
  /** Corner radius for each glass tile. */
  tileRadius: 22,
  /** Gap between tiles in the grid. */
  gap: 10,
  /** Inner padding of a tile. */
  tilePad: 14,
  /** Hero approach-ring tick gauge. */
  ringSize: 132,
  ringTickCount: 28,
  /** Span of the tick arc in degrees (gap left at the bottom). */
  ringArcSpanDeg: 270,
  ringTickLength: 10,
  ringTickWidth: 2.5,
} as const;

// ---------------------------------------------------------------------------
// Screen status → one color for the aurora glow + approach ring + accents, so
// the whole Tracker speaks a single mood at a glance.
// ---------------------------------------------------------------------------

export type ScreenStatusKind =
  | 'live' // fresh live signal, approaching
  | 'holding' // stalled / at a signal / stale feed
  | 'slipping' // bus moving away or passed
  | 'arrived' // docked at the stop
  | 'schedule' // timetable-only, no usable live
  | 'walking' // user is walking to the stop
  | 'waiting'; // no arrival to show yet

export const statusPalette: Record<ScreenStatusKind, string> = {
  live: '#30D158',
  holding: '#FF9F0A',
  slipping: '#FF453A',
  arrived: '#30D158',
  schedule: '#0A84FF',
  walking: '#0A84FF',
  waiting: '#8E8E93',
} as const;

export function resolveScreenStatus(input: {
  hasArrival: boolean;
  isLive: boolean;
  isStale: boolean;
  /** 'live' | 'schedule' | 'none' from useEta.resolved.mode. */
  etaMode: string;
  arrivalStatus: 'en-route' | 'arriving' | 'arrived' | 'passed';
  /** Trend from useApproachHistory. */
  trend: 'approaching' | 'holding' | 'slipping' | 'unknown';
  isWalking: boolean;
}): ScreenStatusKind {
  if (input.isWalking) return 'walking';
  if (!input.hasArrival) return 'waiting';
  if (input.arrivalStatus === 'arrived') return 'arrived';
  if (input.arrivalStatus === 'passed') return 'slipping';
  if (!input.isLive || input.etaMode !== 'live') return 'schedule';
  if (input.isStale) return 'holding';
  if (input.trend === 'slipping') return 'slipping';
  if (input.trend === 'holding') return 'holding';
  return 'live';
}

export function statusColor(kind: ScreenStatusKind): string {
  return statusPalette[kind];
}
