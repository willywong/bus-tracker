import { Platform, PlatformColor, type ColorValue } from 'react-native';

/**
 * Design tokens for the Liquid Glass redesign (see docs/design/README.md).
 *
 * Colour is semantic-first: system label/background colours carry the UI and
 * a single accent carries interaction. Status colours are reserved for status
 * glyphs and are always paired with a word or symbol — never colour alone.
 */

const ios = (name: string, fallback: string): ColorValue =>
  Platform.OS === 'ios' ? PlatformColor(name) : fallback;

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
  accent: ios('systemBlue', '#007AFF'),
  live: ios('systemGreen', '#34C759'),
  warning: ios('systemOrange', '#FF9500'),
  critical: ios('systemRed', '#FF3B30'),
  onAccent: '#FFFFFF',
} as const;

/**
 * Plain-string colours for places that can't take PlatformColor (map overlays,
 * SwiftUI modifiers that expect hex). Light/dark pairs follow the iOS system
 * palette so they match the semantic colours above.
 */
export const hex = {
  accent: { light: '#007AFF', dark: '#0A84FF' },
  live: { light: '#34C759', dark: '#30D158' },
  warning: { light: '#FF9500', dark: '#FF9F0A' },
  critical: { light: '#FF3B30', dark: '#FF453A' },
  secondaryLabel: { light: '#8A8A8E', dark: '#98989F' },
  casing: { light: '#FFFFFF', dark: 'rgba(0,0,0,0.45)' },
  stopFill: { light: '#FFFFFF', dark: '#1C1C1E' },
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
export const MARGIN = space.md;

export const radius = {
  row: 12,
  group: 20,
} as const;

export const type = {
  hero: { fontSize: 88, lineHeight: 92, fontWeight: '700' as const },
  heroUnit: { fontSize: 22, fontWeight: '600' as const },
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
} as const;

/** Sheet detents for the persistent trip sheet: peek, glance, large. */
export const SHEET_DETENTS = [0.18, 0.5, 1] as const;
export const SHEET_INITIAL_DETENT = 1;
export type DetentIndex = 0 | 1 | 2;
