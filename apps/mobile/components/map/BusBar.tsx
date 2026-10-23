import { Button, Divider, Host, Image, Menu, Toggle } from '@expo/ui/swift-ui';
import {
  accessibilityHint,
  accessibilityLabel,
  buttonStyle,
  frame,
  glassEffect,
} from '@expo/ui/swift-ui/modifiers';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassGuard } from '@/components/GlassGuard';
import {
  SECTION_LABEL,
  SECTION_SYMBOL,
  SHEET_SECTIONS,
  type SheetSection,
} from '@/components/sheet/sections';
import { SourceMark } from '@/components/trip/Hero';
import { useSettings } from '@/hooks/useSettings';
import { useTrip } from '@/state/TripContext';
import { color, hex, pick, space, type } from '@/theme/design';
import { haptics } from '@/utils/haptics';

/** Every button's height: the two circles' diameter and the squircle's. */
export const BUS_BAR_HEIGHT = 52;
/** The squircle's corner: rounder than a card, squarer than a capsule. */
const PILL_RADIUS = 20;
/** The pill's text grows with Dynamic Type, but stays one row. */
const PILL_MAX_SCALE = 1.3;

const GLASS = { glass: { variant: 'regular', interactive: true } } as const;

/**
 * The map's bottom bar at rest, as Apple Music's: three separate Liquid
 * Glass buttons floating over the map, no sheet behind them. A circle opens
 * the section menu, a squircle shows your bus and opens Your bus, a circle
 * searches. Choosing a section puts the sheet up on it.
 */
export function BusBar({
  section,
  onSection,
  onSettings,
  onBus,
  onTrack,
  onSearch,
}: {
  section: SheetSection;
  /** Puts the sheet up on `next`, the current section included. */
  onSection: (next: SheetSection) => void;
  onSettings: () => void;
  /** Opens Your bus. */
  onBus: () => void;
  /** No route tracked yet: pick one. */
  onTrack: () => void;
  onSearch: () => void;
}) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { bottom: Math.max(insets.bottom - 6, space.md) }]} pointerEvents="box-none">
      <Host matchContents>
        <Menu
          label={
            <Image
              systemName={SECTION_SYMBOL[section]}
              size={21}
              color={pick(hex.section, scheme)}
              modifiers={[
                frame({ width: BUS_BAR_HEIGHT, height: BUS_BAR_HEIGHT }),
                glassEffect({ ...GLASS, shape: 'circle' }),
                accessibilityLabel(`${SECTION_LABEL[section]}. Sections`),
                accessibilityHint('Open Plan, Nearby or Saved, or Settings'),
              ]}
            />
          }
        >
          {SHEET_SECTIONS.map((s) => (
            <Toggle
              key={s}
              label={SECTION_LABEL[s]}
              systemImage={SECTION_SYMBOL[s]}
              isOn={s === section}
              // The current one opens too: its toggle reports off.
              onIsOnChange={() => {
                haptics.selection();
                onSection(s);
              }}
            />
          ))}
          <Divider />
          <Button label="Settings" systemImage="person.crop.circle" onPress={onSettings} />
        </Menu>
      </Host>
      <View style={styles.pillSlot}>
        <BusPill onBus={onBus} onTrack={onTrack} />
      </View>
      <Host matchContents>
        <Button
          onPress={() => {
            haptics.selection();
            onSearch();
          }}
          modifiers={[
            buttonStyle('plain'),
            accessibilityLabel('Search'),
            accessibilityHint('Find a place, a stop or a bus route'),
          ]}
        >
          <Image
            systemName="magnifyingglass"
            size={20}
            color={pick(hex.ink, scheme)}
            modifiers={[
              frame({ width: BUS_BAR_HEIGHT, height: BUS_BAR_HEIGHT }),
              glassEffect({ ...GLASS, shape: 'circle' }),
            ]}
          />
        </Button>
      </Host>
    </View>
  );
}

/**
 * Your tracked bus on a Liquid Glass squircle: a solid route square, the
 * stop and the countdown, live or scheduled. With no route yet it offers to
 * track one.
 */
function BusPill({ onBus, onTrack }: { onBus: () => void; onTrack: () => void }) {
  const trip = useTrip();
  const settings = useSettings();
  const { model } = trip;
  const empty = settings.preferredRouteCode == null || model.state === 'empty';

  const stopName = trip.stopName ?? 'Your stop';
  const spoken = empty
    ? 'Track a bus'
    : [
        `Your bus, route ${trip.routeCode}, ${stopName}`,
        model.compact
          ? `${model.source === 'live' ? 'live' : model.source === 'aging' ? 'live, last updated over a minute ago' : 'scheduled'}, ${model.compact}`
          : null,
      ]
        .filter(Boolean)
        .join(', ');

  return (
    <Pressable
      onPress={() => {
        haptics.selection();
        if (empty) onTrack();
        else onBus();
      }}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint={empty ? 'Pick a route and the stop you board at' : 'Shows your bus'}
    >
      <GlassGuard glassEffectStyle="regular" isInteractive style={styles.pill}>
        {empty ? (
          <>
            <View style={[styles.square, styles.plus]}>
              <SymbolView name="plus" size={14} weight="semibold" tintColor={color.label} />
            </View>
            <Text style={styles.stop} numberOfLines={1} maxFontSizeMultiplier={PILL_MAX_SCALE}>
              Track a bus
            </Text>
          </>
        ) : (
          <>
            <View style={styles.square}>
              <Text style={styles.code} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1}>
                {trip.routeCode}
              </Text>
            </View>
            <Text style={styles.stop} numberOfLines={1} maxFontSizeMultiplier={PILL_MAX_SCALE}>
              {stopName}
            </Text>
            {model.compact ? (
              <View style={styles.countdown}>
                <SourceMark source={model.source} size={10} />
                <Text style={styles.compact} numberOfLines={1} maxFontSizeMultiplier={PILL_MAX_SCALE}>
                  {model.compact}
                </Text>
              </View>
            ) : null}
          </>
        )}
      </GlassGuard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pillSlot: {
    flex: 1,
  },
  pill: {
    height: BUS_BAR_HEIGHT,
    borderRadius: PILL_RADIUS,
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 6,
    paddingRight: space.sm,
    overflow: 'hidden',
  },
  square: {
    width: 36,
    height: 36,
    borderRadius: 12,
    borderCurve: 'continuous',
    backgroundColor: color.ink,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  plus: {
    backgroundColor: color.fill,
  },
  code: {
    color: color.onAccent,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
    fontVariant: ['tabular-nums'],
  },
  stop: {
    ...type.body,
    fontSize: 15,
    fontWeight: '600',
    color: color.label,
    flex: 1,
  },
  countdown: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  compact: {
    ...type.headline,
    fontSize: 16,
    color: color.label,
    fontVariant: ['tabular-nums'],
  },
});
