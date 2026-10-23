import type { LatLng } from '@bus-tracker/shared';
import { Button, ContentUnavailableView, Host, Image, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  buttonBorderShape,
  buttonStyle,
  controlSize,
  pickerStyle,
  tag,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import * as Location from 'expo-location';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { EstimatedTrains, useAppActive, useTrainClock, type TrainSlot } from '@/components/rail/EstimatedTrains';
import { LineBadge } from '@/components/rail/LineBadge';
import { RAIL_X, StripMap } from '@/components/rail/StripMap';
import { beadY, slotWindow } from '@/components/rail/stripLayout';
import {
  isKtmRoute,
  nearestStationIndex,
  railGlyph,
  routeIndexById,
  runTimes,
  stripHeader,
  stripModel,
} from '@/components/rail/stripModel';
import type { RailFocus } from '@/components/rail/railFocus';
import { formatClockHHMM } from '@/components/tracker/logic';
import { useRailFocus } from '@/hooks/useRailFocus';
import { useTransitNetwork } from '@/hooks/useTransitNetwork';
import { useTrip } from '@/state/TripContext';
import { color, hex, MARGIN, pick, space, type } from '@/theme/design';
import { devNow } from '@/utils/devClock';
import { haptics } from '@/utils/haptics';

const firstParam = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * A whole rail line over the map (spec §6.5, plan 13/04):
 * `/line?line=<net.routes.id>&dir=0|1`. Header with the line's badge, name,
 * "every N mins now" and first and last train, the honesty caption, a
 * segmented direction picker, then the strip map with estimated trains
 * gliding at timetable spacing from one UI-thread clock. Trains are never
 * live: dashed discs, an explicit caption, static under Reduce Motion, and
 * paused while the sheet is covered, scrolled away or the app is in the
 * background. Rows open the station sheet.
 */
export default function LineScreen() {
  const router = useRouter();
  const trip = useTrip();
  const { network, health, status } = useTransitNetwork();
  const params = useLocalSearchParams<{ line?: string | string[]; dir?: string | string[] }>();
  const routeId = firstParam(params.line) ?? '';
  const dirParam: 0 | 1 = firstParam(params.dir) === '1' ? 1 : 0;
  const { height: windowHeight } = useWindowDimensions();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';

  const routeIndex = network ? routeIndexById(network, routeId) : -1;
  const model = useMemo(() => {
    if (!network || routeIndex < 0) return null;
    // A line with one direction only falls back to it.
    return stripModel(network, routeIndex, dirParam, trip.now) ?? stripModel(network, routeIndex, 0, trip.now);
  }, [network, routeIndex, dirParam, trip.now]);
  const ktm = network != null && routeIndex >= 0 && isKtmRoute(network, routeIndex);
  const header = useMemo(() => (model ? stripHeader(model, ktm, formatClockHHMM) : null), [model, ktm]);

  // While this sheet is focused the map shows this line at full strength.
  const focusRouteId = model?.routeId ?? null;
  const railFocus = useMemo<RailFocus | null>(
    () => (focusRouteId ? { stationId: null, routeIds: [focusRouteId], point: null } : null),
    [focusRouteId],
  );
  useRailFocus(railFocus);

  // Bead centres: measured once the rows lay out (Dynamic Type), else the default row height.
  const [measured, setMeasured] = useState<{ pattern: number; ys: number[] } | null>(null);
  const pattern = model?.pattern ?? -1;
  const stationCount = model?.stations.length ?? 0;
  const ys = useMemo(
    () =>
      measured && measured.pattern === pattern && measured.ys.length === stationCount
        ? measured.ys
        : Array.from({ length: stationCount }, (_, i) => beadY(i)),
    [measured, pattern, stationCount],
  );
  const onBeadYs = useCallback(
    (next: number[]) =>
      setMeasured((prev) =>
        prev && prev.pattern === pattern && prev.ys.length === next.length && prev.ys.every((y, i) => Math.abs(y - next[i]) < 0.5)
          ? prev
          : { pattern, ys: next },
      ),
    [pattern],
  );

  // Your nearest station: the last known fix (never prompts), else the trip's stop.
  const [here, setHere] = useState<LatLng | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted) return;
        const last = await Location.getLastKnownPositionAsync();
        if (!cancelled && last) setHere({ lat: last.coords.latitude, lng: last.coords.longitude });
      } catch {
        // No fix: fall back to the trip's stop.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const userStop = trip.route?.userStop ?? null;
  const point = useMemo<LatLng | null>(
    () => here ?? (userStop ? { lat: userStop.stop_lat, lng: userStop.stop_lon } : null),
    [here, userStop],
  );
  const nearestIndex = useMemo(() => (model ? nearestStationIndex(model.stations, point) : -1), [model, point]);

  // The part of the strip on screen, updated when a scroll comes to rest.
  const [view, setView] = useState({ top: 0, height: windowHeight });
  const [stripY, setStripY] = useState(0);
  const onScrollEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement } = e.nativeEvent;
    setView((v) =>
      Math.abs(v.top - contentOffset.y) < 1 && Math.abs(v.height - layoutMeasurement.height) < 1
        ? v
        : { top: contentOffset.y, height: layoutMeasurement.height },
    );
  }, []);
  const onScrollLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const h = e.nativeEvent.layout.height;
      setView((v) => (Math.abs(v.height - h) < 1 ? v : { ...v, height: h }));
    },
    [],
  );

  // Mounted trains: only those in view (≤ 12), recomputed in JS on the 15 s
  // tick, scroll end, direction change and re-measure. Never per frame.
  const timesCache = useRef<{ key: string; map: Map<string, readonly number[]> }>({ key: '', map: new Map() });
  const slots = useMemo<TrainSlot[]>(() => {
    if (!network || !model || model.midnightMs == null) return [];
    const cacheKey = `${model.routeId}:${model.pattern}:${model.midnightMs}`;
    if (timesCache.current.key !== cacheKey) timesCache.current = { key: cacheKey, map: new Map() };
    const cache = timesCache.current.map;
    const t = (devNow() - model.midnightMs) / 1000;
    const offsets = model.stations.map((s) => s.offsetSec);
    const top = view.top - stripY;
    const picked = slotWindow(model.runs, t, model.totalRunSec, offsets, ys, top, top + view.height);
    return picked.map((i) => {
      const key = `${model.pattern}:${model.runs[i]}`;
      let times = cache.get(key);
      if (!times) cache.set(key, (times = runTimes(network, model, i)));
      return { key, times };
    });
  }, [network, model, ys, view, stripY]);

  // One shared clock; it runs only while someone can see it move.
  const isFocused = useIsFocused();
  const appActive = useAppActive();
  const reduceMotion = useReducedMotion();
  const active = isFocused && appActive && !reduceMotion && slots.length > 0;
  const { clock, reseed } = useTrainClock(active);
  const midnightMs = model?.midnightMs ?? null;
  useEffect(() => {
    // The honest position from the wall clock: on every tick, scroll end,
    // direction change and resume (trains jump rather than continue from
    // where they paused). Under Reduce Motion this is the only movement.
    if (midnightMs != null) reseed((devNow() - midnightMs) / 1000);
  }, [reseed, midnightMs, trip.now, view, pattern, appActive, isFocused]);

  const onDirection = useCallback(
    (sel: number | string | null) => {
      const next = Number(sel) === 1 ? 1 : 0;
      if (!model || next === model.dir) return;
      haptics.selection();
      router.setParams({ dir: String(next) });
    },
    [model, router],
  );
  const openStation = useCallback(
    (station: string) => router.push({ pathname: '/station', params: { station } }),
    [router],
  );

  // Our own close button (the native header is off in the layout), so the
  // line's name sits in line with it rather than a header's height below it.
  const closeButton = (
    <Host matchContents>
      <Button
        onPress={() => router.back()}
        modifiers={[
          buttonStyle('glass'),
          buttonBorderShape('circle'),
          controlSize('large'),
          tint(pick(hex.ink, scheme)),
          accessibilityLabel('Close'),
        ]}
      >
        <Image systemName="xmark" size={15} />
      </Button>
    </Host>
  );

  if (!model || !header) {
    const loading = network == null && (status === 'loading' || status === 'refreshing');
    const feed = routeId.startsWith('ktm:') ? 'ktm' : 'rail';
    const expired = health?.[feed]?.state === 'expired';
    return (
      <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={styles.content}>
        <View style={[styles.titleRow, styles.closeOnly]}>{closeButton}</View>
        {loading ? null : (
          <Host style={styles.empty}>
            <ContentUnavailableView
              title={expired ? 'Timetable unavailable' : 'Line not found'}
              systemImage="tram.fill"
            />
          </Host>
        )}
      </ScrollView>
    );
  }

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={styles.content}
        onLayout={onScrollLayout}
        onScrollEndDrag={onScrollEnd}
        onMomentumScrollEnd={onScrollEnd}
      >
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <View style={styles.title} accessible accessibilityRole="header" accessibilityLabel={header.spoken}>
              <LineBadge line={model.line} />
              <Text style={styles.name}>{model.name}</Text>
            </View>
            {closeButton}
          </View>
          <Text style={styles.status} importantForAccessibility="no" accessibilityElementsHidden>
            {header.status}
          </Text>
          {header.footer ? (
            <Text style={styles.footnote} importantForAccessibility="no" accessibilityElementsHidden>
              {header.footer}
            </Text>
          ) : null}
          <Text style={styles.caption} importantForAccessibility="no" accessibilityElementsHidden>
            {header.caption}
          </Text>
        </View>

        {model.directions.length > 1 ? (
          <Host matchContents={{ vertical: true }} style={styles.picker}>
            <Picker selection={model.dir} onSelectionChange={onDirection} modifiers={[pickerStyle('segmented')]}>
              {model.directions.map((d) => (
                <SwiftText key={d.dir} modifiers={[tag(d.dir)]}>
                  {`To ${d.towards}`}
                </SwiftText>
              ))}
            </Picker>
          </Host>
        ) : null}

        <View onLayout={(e) => setStripY(e.nativeEvent.layout.y)}>
          <StripMap
            key={model.pattern}
            stations={model.stations}
            lineColor={model.line.color}
            ys={ys}
            nearestIndex={nearestIndex}
            onBeadYs={onBeadYs}
            onOpenStation={openStation}
            overlay={
              <EstimatedTrains slots={slots} ys={ys} clock={clock} glyph={railGlyph(model.mode)} railX={RAIL_X} />
            }
          />
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: MARGIN,
    paddingTop: space.xs,
    paddingBottom: space.xxl,
    gap: space.md,
  },
  header: {
    gap: space.xxs,
  },
  // Clear of the grabber; the name centres on the close button.
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingTop: space.md,
    marginBottom: space.xxs,
  },
  closeOnly: {
    justifyContent: 'flex-end',
  },
  title: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  name: {
    ...type.title,
    flexShrink: 1,
    color: color.label,
  },
  status: {
    ...type.headline,
    color: color.label,
  },
  footnote: {
    ...type.footnote,
    color: color.label,
  },
  caption: {
    ...type.footnote,
    color: color.secondaryLabel,
    marginTop: space.xxs,
  },
  picker: {
    alignSelf: 'stretch',
  },
  empty: {
    height: 280,
    marginTop: space.xxl,
  },
});
