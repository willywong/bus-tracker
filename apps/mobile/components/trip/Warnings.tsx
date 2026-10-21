import { Button, Host, RNHostView } from '@expo/ui/swift-ui';
import {
  accessibilityHint,
  accessibilityLabel,
  buttonBorderShape,
  buttonStyle,
  controlSize,
} from '@expo/ui/swift-ui/modifiers';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { StyleSheet, Text, View, type ColorValue } from 'react-native';

import { SourceMark } from '@/components/trip/Hero';
import { Hairline } from '@/components/trip/Rows';
import type { SourceKind, TripModel } from '@/components/trip/model';
import { color, type } from '@/theme/design';

export interface WarningItem {
  key: string;
  /** The warning's own glyph: a cloud for weather, a walker for your walk. */
  icon: SFSymbol;
  /** Bold first line; the gist at a glance. */
  title: string;
  /** Quieter second line: where, or what to do. */
  detail?: string;
  /** Drawn as the live dot (pulsing green, or still orange) instead of `icon`. */
  source?: Exclude<SourceKind, 'scheduled'>;
}

/**
 * Whether the bus is tracked live, as the first item of the status capsule:
 * a pulsing green dot while fresh, a still orange one once ageing. Null on
 * the timetable, where the status line says "Scheduled".
 */
export function tripStatusItem(model: TripModel): WarningItem | null {
  const { source, sourceLine } = model;
  if (source === 'live') {
    return {
      key: 'live',
      icon: 'circle.fill',
      source,
      title: 'Live',
      detail: sourceLine.updated
        ? `From the bus’s GPS · ${sourceLine.updated}`
        : 'From the bus’s GPS',
    };
  }
  if (source === 'aging') {
    return {
      key: 'live',
      icon: 'circle.fill',
      source,
      title: 'Live data is late',
      detail: sourceLine.updated ?? 'The bus hasn’t reported for a while',
    };
  }
  return null;
}

/**
 * Everything worth a heads-up on this trip, most urgent first: a bus that
 * beats your walk, then the model's warning notes (feed down, a bus that
 * isn't reporting, weather).
 */
export function tripWarnings(model: TripModel, walkMinutes: number): WarningItem[] {
  const out: WarningItem[] = [];
  if (model.action.kind === 'tight') {
    out.push({
      key: 'tight',
      icon: 'figure.walk',
      title: 'Too soon to make it',
      detail: `This bus arrives before your ${walkMinutes}-min walk`,
    });
  }
  for (const n of model.notes) {
    if (n.tone !== 'warning' || (n.label && n.value)) continue;
    out.push({
      key: n.id,
      icon: n.icon as SFSymbol,
      title: n.title ?? n.text,
      detail: n.title ? n.text : undefined,
    });
  }
  return out;
}

/**
 * Each glyph in its own colours: weather is a grey cloud with blue rain
 * (SF Symbols palette, layer by layer), a bus that isn't reporting a white
 * question mark on grey, dead live data a grey antenna, no connection a grey
 * wifi, your walk orange.
 */
const PALETTE: Partial<Record<string, ColorValue[]>> = {
  'cloud.bolt.rain.fill': [color.cloud, color.rain],
  'cloud.rain.fill': [color.cloud, color.rain],
  'cloud.heavyrain.fill': [color.cloud, color.rain],
  'questionmark.circle.fill': ['#FFFFFF', color.cloud],
};
const TINT: Partial<Record<string, ColorValue>> = {
  'water.waves': color.rain,
  'antenna.radiowaves.left.and.right.slash': color.cloud,
  'wifi.slash': color.cloud,
};

export function WarningGlyph({ icon, size }: { icon: SFSymbol; size: number }) {
  const palette = PALETTE[icon];
  // A one-colour palette doesn't take on iOS, so single tints go monochrome.
  return palette ? (
    <SymbolView name={icon} size={size} type="palette" colors={palette} resizeMode="scaleAspectFit" />
  ) : (
    <SymbolView
      name={icon}
      size={size}
      type="monochrome"
      tintColor={TINT[icon] ?? color.warning}
      resizeMode="scaleAspectFit"
    />
  );
}

/**
 * The warnings as glyphs only, in a native Liquid Glass capsule button beside
 * the hero number (SwiftUI's glass button style, so it gets the system rim,
 * shadow and press response even on the opaque sheet, where a bare glass
 * view has nothing to refract). The glyphs are RN symbols hosted inside it,
 * since SwiftUI's Image here can't draw a palette. Tapping opens the full
 * text in its own sheet.
 */
export function WarningBadges({ items, onPress }: { items: WarningItem[]; onPress: () => void }) {
  if (items.length === 0) return null;
  const label = items.map((w) => w.title).join('; ');
  return (
    <Host matchContents>
      <Button
        onPress={onPress}
        modifiers={[
          buttonStyle('glass'),
          buttonBorderShape('capsule'),
          controlSize('small'),
          accessibilityLabel(label),
          accessibilityHint('Shows the details'),
        ]}
      >
        <RNHostView matchContents>
          <View style={styles.glyphs} pointerEvents="none">
            {items.map((w) =>
              w.source ? (
                <SourceMark key={w.key} source={w.source} size={BADGE_GLYPH} />
              ) : (
                <WarningGlyph key={w.key} icon={w.icon} size={BADGE_GLYPH} />
              ),
            )}
          </View>
        </RNHostView>
      </Button>
    </Host>
  );
}

/** The full warnings, one row each: glyph, bold title, quiet detail. */
export function WarningList({ items }: { items: WarningItem[] }) {
  return (
    <View>
      {items.map((w, i) => (
        <View key={w.key}>
          {i > 0 ? <Hairline inset={ROW_GLYPH + ROW_GAP} /> : null}
          <View
            style={styles.row}
            accessible
            accessibilityLabel={w.detail ? `${w.title}. ${w.detail}` : w.title}
          >
            <View style={styles.rowGlyph}>
              {w.source ? (
                <SourceMark source={w.source} size={20} />
              ) : (
                <WarningGlyph icon={w.icon} size={24} />
              )}
            </View>
            <View style={styles.rowText}>
              <Text style={styles.title}>{w.title}</Text>
              {w.detail ? <Text style={styles.detail}>{w.detail}</Text> : null}
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

const BADGE_GLYPH = 17;
const ROW_GLYPH = 28;
const ROW_GAP = 14;

const styles = StyleSheet.create({
  glyphs: {
    height: BADGE_GLYPH + 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: ROW_GAP,
    paddingVertical: 14,
  },
  rowGlyph: {
    width: ROW_GLYPH,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...type.body,
    fontWeight: '600',
    color: color.label,
  },
  detail: {
    ...type.status,
    color: color.secondaryLabel,
  },
});
