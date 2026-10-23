import { Button, Divider, Host, Image, Menu, Toggle } from '@expo/ui/swift-ui';
import {
  accessibilityHint,
  accessibilityLabel,
  buttonStyle,
  frame,
  glassEffect,
} from '@expo/ui/swift-ui/modifiers';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import {
  type HostInstance,
  Image as RNImage,
  Pressable,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassGuard } from '@/components/GlassGuard';
import {
  SECTION_LABEL,
  SECTION_SYMBOL,
  SHEET_SECTIONS,
  type SheetSection,
} from '@/components/sheet/sections';
import { SourceMark } from '@/components/trip/Hero';
import type { SourceKind } from '@/components/trip/model';
import {
  BUS_HOME_MS,
  busKindOf,
  flyBusHome,
  launchBusFlight,
  pillIconFor,
  type BusKind,
} from '@/modules/bus-model';
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

/*
 * The pill's bus, last drawn: where (window points) and which, so the trip
 * sheet's bus can fly back into it as the sheet goes down, before the pill
 * is back on screen. While it flies the pill leaves its bus out, and draws
 * it again as it lands.
 */
let pillArt: { frame: { x: number; y: number; width: number; height: number }; kind: BusKind } | null =
  null;
let homingUntil = 0;
const homingListeners = new Set<() => void>();
const subscribeHoming = (listener: () => void) => {
  homingListeners.add(listener);
  return () => homingListeners.delete(listener);
};
const homing = () => homingUntil > Date.now();

/** The trip sheet is going down: its bus flies back into the pill. */
export function busHome() {
  if (!pillArt || homing() || !flyBusHome(pillArt.frame, pillArt.kind)) return;
  homingUntil = Date.now() + BUS_HOME_MS;
  for (const listener of homingListeners) listener();
  setTimeout(() => {
    for (const listener of homingListeners) listener();
  }, BUS_HOME_MS);
}

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
              color={pick(hex.ink, scheme)}
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
          <Button label="Settings" systemImage="gearshape" onPress={onSettings} />
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
  const kind = busKindOf(trip.stopId);
  const pillIcon = pillIconFor(kind, useColorScheme() === 'dark');
  // Where the bus is drawn, so it can fly up into the sheet from there.
  const art = useRef<HostInstance>(null);
  const artFrame = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const measureArt = () =>
    art.current?.measureInWindow((x, y, width, height) => {
      artFrame.current = { x, y, width, height };
      pillArt = { frame: artFrame.current, kind };
    });
  const artAway = useSyncExternalStore(subscribeHoming, homing);
  // Laid out before the sheet came up, but a bus kind can change under it.
  useEffect(() => {
    if (pillArt) pillArt = { ...pillArt, kind };
  }, [kind]);

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
      onPressIn={measureArt}
      // The pill moves as the buttons beside it size up, which its bus's own
      // layout doesn't see.
      onLayout={measureArt}
      onPress={() => {
        haptics.selection();
        if (empty) return onTrack();
        if (pillIcon && artFrame.current) launchBusFlight(artFrame.current, kind);
        onBus();
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
            {pillIcon ? (
              <View ref={art} onLayout={measureArt} style={styles.busArt} collapsable={false}>
                <RNImage
                  source={{ uri: pillIcon }}
                  style={[styles.busArtImage, artAway && styles.away]}
                />
              </View>
            ) : (
              <View style={styles.square}>
                <SymbolView name="bus.fill" size={18} weight="semibold" tintColor={color.onAccent} />
              </View>
            )}
            <View style={styles.lines}>
              <Text style={styles.route} numberOfLines={1} maxFontSizeMultiplier={PILL_MAX_SCALE}>
                {trip.routeCode}
              </Text>
              <Text style={styles.stop} numberOfLines={1} maxFontSizeMultiplier={PILL_MAX_SCALE}>
                {stopName}
              </Text>
            </View>
            {model.compact ? (
              <Eta source={model.source} text={model.compact} at={model.sourceLine.arrivesAt} />
            ) : null}
          </>
        )}
      </GlassGuard>
    </Pressable>
  );
}

/**
 * The wait, mirroring the route and stop on the left: the minutes on top,
 * the clock time it arrives under them (under an hour; past that the minutes
 * are a clock already). Live minutes are green, the only colour in the bar;
 * scheduled or aging data marks the time with the clock or the orange dot.
 */
function Eta({ source, text, at }: { source: SourceKind; text: string; at: string | null }) {
  const live = source === 'live';
  return (
    <View style={styles.eta}>
      <Text
        style={[styles.minutes, live && styles.minutesLive]}
        numberOfLines={1}
        maxFontSizeMultiplier={PILL_MAX_SCALE}
      >
        {text}
      </Text>
      {at || !live ? (
        <View style={styles.atRow}>
          {live ? null : <SourceMark source={source} size={10} />}
          {at ? (
            <Text style={styles.at} numberOfLines={1} maxFontSizeMultiplier={PILL_MAX_SCALE}>
              {at}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
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
    paddingRight: 14,
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
  // The 3D bus, when bundled, in place of the squircle: a little wider, so
  // it reads at a glance. iOS draws its shadow from the bus's own outline.
  busArt: {
    width: 44,
    height: 36,
    marginHorizontal: -2,
  },
  away: {
    opacity: 0,
  },
  busArtImage: {
    width: 44,
    height: 36,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 1.5,
    shadowOffset: { width: 0, height: 1 },
  },
  plus: {
    backgroundColor: color.fill,
  },
  lines: {
    flex: 1,
    minWidth: 0,
  },
  route: {
    ...type.body,
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '700',
    color: color.label,
    fontVariant: ['tabular-nums'],
  },
  stop: {
    ...type.body,
    fontSize: 12,
    lineHeight: 15,
    color: color.secondaryLabel,
  },
  eta: {
    alignItems: 'flex-end',
  },
  minutes: {
    ...type.body,
    fontSize: 16,
    lineHeight: 19,
    fontWeight: '700',
    color: color.label,
    fontVariant: ['tabular-nums'],
  },
  minutesLive: {
    color: color.liveText,
  },
  atRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  at: {
    ...type.body,
    fontSize: 12,
    lineHeight: 15,
    color: color.secondaryLabel,
    fontVariant: ['tabular-nums'],
  },
});
