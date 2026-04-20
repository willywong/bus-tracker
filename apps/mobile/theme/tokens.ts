import { DynamicColorIOS, PlatformColor, Platform, type TextStyle } from 'react-native';

type ColorPair = { light: string; dark: string };

const dyn = ({ light, dark }: ColorPair) =>
  Platform.OS === 'ios' ? DynamicColorIOS({ light, dark }) : light;

const pcSafe = (name: string, fallback: string) =>
  Platform.OS === 'ios' ? PlatformColor(name) : fallback;

const palette = {
  bg: { light: '#FFFFFF', dark: '#000000' },
  fg: { light: '#000000', dark: '#FFFFFF' },
  muted: { light: '#6E6E73', dark: '#9A9AA2' },
  accent: { light: '#0A84FF', dark: '#0A84FF' },
  success: { light: '#34C759', dark: '#30D158' },
  warning: { light: '#FF9500', dark: '#FF9F0A' },
  danger: { light: '#FF3B30', dark: '#FF453A' },
} satisfies Record<string, ColorPair>;

export const tokens = {
  color: {
    bg: dyn(palette.bg),
    fg: dyn(palette.fg),
    muted: dyn(palette.muted),
    accent: dyn(palette.accent),
    success: dyn(palette.success),
    warning: dyn(palette.warning),
    danger: dyn(palette.danger),
  },
  platform: {
    bg: pcSafe('systemBackground', palette.bg.light),
    fg: pcSafe('label', palette.fg.light),
    muted: pcSafe('secondaryLabel', palette.muted.light),
    accent: pcSafe('systemBlue', palette.accent.light),
    success: pcSafe('systemGreen', palette.success.light),
    warning: pcSafe('systemOrange', palette.warning.light),
    danger: pcSafe('systemRed', palette.danger.light),
  },
  type: {
    title: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
    body: { fontSize: 16, lineHeight: 22, fontWeight: '400' },
    caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
  },
} as const;

export const typeStyle: Record<'title' | 'body' | 'caption', TextStyle> = {
  title: tokens.type.title,
  body: tokens.type.body,
  caption: tokens.type.caption,
};

export const palettePairs = palette;
