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
};

export const delayStatusColor: Record<DelayStatus, string> = {
  onTime: '#30D158',
  delayed: '#FF9F0A',
  heavilyDelayed: '#FF453A',
};

/** Apple Settings-style flat grays in dark mode (systemGray{5,6}, etc.). */
const dyn = (light: string, dark: string) =>
  Platform.OS === 'ios' ? DynamicColorIOS({ light, dark }) : dark;

export const surfaceColor = {
  /** Canvas background — pure black in dark mode, system gray grouped in light. */
  canvas: dyn('#F2F2F7', '#000000'),
  /** Grouped-list card surface (systemGray6). */
  grouped: dyn('#FFFFFF', '#1C1C1E'),
  /** Hairline / separator (opaqueSeparator-equivalent). */
  hairline: dyn('#C6C6C8', '#2C2C2E'),
  /** Inline accent chip background in amber (low-opacity fill). */
  amberTint: 'rgba(255,159,10,0.14)',
  /** Blue accent chip background. */
  blueTint: 'rgba(10,132,255,0.16)',
} as const;

export const trackerSpacing = {
  screenH: 20,
  heroTopPad: 28,
  heroBottomPad: 36,
  sectionGap: 28,
  rowV: 14,
  rowH: 16,
  cardRadius: 14,
} as const;
