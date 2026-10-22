import { useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import {
  StyleSheet,
  useColorScheme,
  useWindowDimensions,
  View,
  type HostInstance,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { routeInfoOf } from '@/components/plan/results';
import { GoBody, goHeader } from '@/components/ride/GoBody';
import { destinationName } from '@/components/ride/journey';
import { rideMinutes } from '@/components/ride/model';
import { RideBody } from '@/components/ride/RideBody';
import { mins } from '@/components/trip/model';
import { EdgeSwipeBack } from '@/components/trip/EdgeSwipeBack';
import { BusDetailSheet, StopDetailSheet } from '@/components/detail/DetailSheet';
import { WhereToRow } from '@/components/plan/WhereToRow';
import { SheetBody } from '@/components/trip/SheetBody';
import { SheetHeader } from '@/components/trip/SheetHeader';
import { sheetPushIn, sheetPushOut } from '@/components/trip/sheetTransition';
import { sheetMode } from '@/components/sheet/mode';
import { NearbySection } from '@/components/sheet/NearbySection';
import { useSettings } from '@/hooks/useSettings';
import { toPlace, usePlanner } from '@/state/PlannerContext';
import { useRide } from '@/state/RideContext';
import { useTrip } from '@/state/TripContext';
import { hex, motion, PEEK_TOP, pick, sheetDetents, space, type DetentIndex } from '@/theme/design';
import { devNow } from '@/utils/devClock';

/** After the map settles, how long before all detents return (the snap must land first). */
const COLLAPSE_SETTLE_MS = 300;
/** Detents come back after this long even if the map never reports settling. */
const HOLD_PEEK_MAX_MS = 5000;
/** After the detents return, how long before the sheet has come to rest. */
const SHEET_SETTLE_MS = 500;

type DetentListener = (
  event: 'sheetDetentChange',
  cb: (e: { data: { index: number } }) => void,
) => () => void;

/**
 * The persistent trip sheet over the map, in Calm Mono: opaque paper, ink
 * type, hairline rows. "Where to?" tops every state. Go, a ride and a stop or
 * bus detail each take the whole sheet (`sheetMode`); otherwise it shows your
 * tracked bus (`NearbySection`).
 */
export default function TripSheet() {
  const trip = useTrip();
  const settings = useSettings();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const ride = useRide();
  const planner = usePlanner();
  const peek = trip.detent === 0;

  useEffect(() => {
    const addListener = (navigation as unknown as { addListener: DetentListener }).addListener;
    return addListener.call(navigation, 'sheetDetentChange', (e) => {
      const i = Math.max(0, Math.min(2, e.data.index)) as DetentIndex;
      trip.setDetent(i);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation]);

  // Dragging the map drops the sheet from glance to peek. The native sheet
  // only takes a detent index at presentation, so while the map is dragged
  // it is offered the peek detent alone (UIKit snaps to it and makes it the
  // selected one). Once the map settles, and the snap has landed, all three
  // come back and the sheet stays at peek; restoring mid-drag undoes the
  // snap. UIKit doesn't report a change it didn't see the user make, so the
  // detent is set here too. The same pin holds while `plan` or `itinerary`
  // is up, so the trip never shows above a shorter sheet.
  const { height: windowHeight } = useWindowDimensions();
  const { holdPeek, setHoldPeek, setDetent } = trip;
  const pinned = holdPeek || planner.presented;
  const held = useRef(false);
  const topRow = useRef<HostInstance>(null);
  useEffect(() => {
    const detents = sheetDetents(windowHeight, insets.top);
    if (pinned) {
      held.current = true;
      // The initial index only matters at presentation, but must stay in range.
      navigation.setOptions({
        sheetAllowedDetents: [detents[0]],
        sheetInitialDetentIndex: 0,
        sheetLargestUndimmedDetentIndex: 0,
      });
      setDetent(0);
      // In case the map never reports settling. A planner sheet holds the
      // pin for as long as it's up.
      if (!holdPeek) return;
      const safety = setTimeout(() => setHoldPeek(false), HOLD_PEEK_MAX_MS);
      return () => clearTimeout(safety);
    }
    if (!held.current) return;
    held.current = false;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const t = setTimeout(() => {
      navigation.setOptions({
        sheetAllowedDetents: detents,
        sheetInitialDetentIndex: 0,
        sheetLargestUndimmedDetentIndex: 1,
      });
      // UIKit can return to the detent it had selected before the pin (seen
      // as glance after Go closes the itinerary) without reporting it, so
      // read where the sheet came to rest.
      settle = setTimeout(() => {
        topRow.current?.measureInWindow((_x, y) => {
          setDetent(nearestDetent(windowHeight - y, detents, windowHeight - insets.top));
        });
      }, SHEET_SETTLE_MS);
    }, COLLAPSE_SETTLE_MS);
    return () => {
      clearTimeout(t);
      clearTimeout(settle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinned, holdPeek]);

  // A "Where to?" quick action waits for this sheet: pushed before it, `plan`
  // would end up underneath the trip on a cold launch.
  const { pendingOpen, clearPending } = planner;
  useEffect(() => {
    if (!pendingOpen) return;
    clearPending();
    router.push('/plan');
  }, [pendingOpen, clearPending, router]);

  // Search is chrome (as in Apple Maps): the row tops every state of the sheet.
  const home = settings.savedPlaces.find((p) => p.kind === 'home') ?? null;
  const work = settings.savedPlaces.find((p) => p.kind === 'work') ?? null;
  const whereTo = (
    <View ref={topRow} collapsable={false}>
      <WhereToRow
        onOpen={() => {
          // A plain "Where to?" searches afresh, not the last destination.
          planner.setTo(null);
          router.push('/plan');
        }}
        home={home}
        work={work}
        onPlace={(p) => {
          planner.setTo(toPlace(p));
          router.push('/plan');
        }}
      />
    </View>
  );

  const scrollStyle = [styles.scroll, { paddingBottom: insets.bottom + space.xl }];

  // A stop tapped in the sheet opens its detail; your own stop is the trip.
  const { select } = trip;
  const openStop = useCallback(
    (id: string) => select(id === trip.stopId ? null : { kind: 'stop', stopId: id }),
    [select, trip.stopId],
  );
  const back = useCallback(() => select(null), [select]);

  const mode = sheetMode({
    go: ride.itinerary != null && ride.journey != null && ride.journeyNetwork != null,
    riding: ride.active,
    detail: trip.selection != null,
  });

  // Go (15/06): the journey, leg by leg. It doesn't need a tracked route.
  if (mode === 'go' && ride.itinerary && ride.journey && ride.journeyNetwork) {
    const go = goHeader(
      ride.itinerary,
      ride.journey,
      devNow(),
      routeInfoOf(ride.journeyNetwork),
      ride.journeyDestination?.name ?? destinationName(ride.itinerary),
    );
    return (
      <SheetScroll key="go" contentContainerStyle={scrollStyle} scheme={scheme}>
        {whereTo}
        <SheetHeader
          routeCode=""
          badge={go.badge}
          title={go.title}
          peek={peek}
          status={go.status}
          source={go.source}
          compact={go.compact}
          strip={go.strip}
        />
        <SheetBody peek={peek}>
          <GoBody ride={ride} scheme={scheme} />
        </SheetBody>
      </SheetScroll>
    );
  }

  if (mode === 'ride') {
    const p = ride.progress;
    return (
      <SheetScroll contentContainerStyle={scrollStyle} scheme={scheme}>
        {whereTo}
        <SheetHeader
          routeCode={trip.routeCode}
          title={ride.destination ? `To ${ride.destination.name}` : trip.stopName}
          peek={peek}
          status={p?.nextStop ? `Next: ${p.nextStop.name}` : null}
          source="live"
          compact={
            p == null
              ? null
              : p.phase === 'arrived'
                ? { text: 'Here', unit: null, kind: 'word' }
                : p.phase === 'next-is-yours'
                  ? { text: 'Next', unit: null, kind: 'word' }
                  : {
                      text: String(p.stopsToGo),
                      unit: 'stops',
                      kind: 'minutes',
                    }
          }
          strip={
            p && p.phase !== 'arrived'
              ? {
                  left: {
                    icon: 'bus',
                    text: `About ${mins(rideMinutes(p.remainingMeters))}`,
                  },
                  right: {
                    text: formatKm(p.remainingMeters),
                    trailing: 'to go',
                  },
                }
              : null
          }
        />
        <SheetBody peek={peek}>
          <RideBody ride={ride} base={trip.model} />
        </SheetBody>
      </SheetScroll>
    );
  }

  if (mode === 'detail' && trip.selection) {
    const sel = trip.selection;
    const key = sel.kind === 'stop' ? `stop:${sel.stopId}` : `bus:${sel.vehicleId}`;
    return (
      <EdgeSwipeBack key={key} onBack={back}>
        <SheetScroll contentContainerStyle={scrollStyle} scheme={scheme} swap>
          {whereTo}
          {sel.kind === 'stop' ? (
            <StopDetailSheet stopId={sel.stopId} peek={peek} onBack={back} onStopPress={openStop} />
          ) : (
            <BusDetailSheet
              vehicleId={sel.vehicleId}
              peek={peek}
              onBack={back}
              onStopPress={openStop}
            />
          )}
        </SheetScroll>
      </EdgeSwipeBack>
    );
  }

  return (
    <SheetScroll key="trip" contentContainerStyle={scrollStyle} scheme={scheme} swap>
      {whereTo}
      <NearbySection peek={peek} scheme={scheme} />
    </SheetScroll>
  );
}

/**
 * The sheet's scroll view with a paper edge under the grabber: once content
 * scrolls, it fades out beneath the sheet's top instead of sliding, clipped,
 * behind the grabber. The edge is invisible at rest so it never veils the
 * header, and fades in over the first few points of scroll (UI thread).
 */
function SheetScroll({
  contentContainerStyle,
  scheme,
  swap = false,
  children,
}: {
  contentContainerStyle: StyleProp<ViewStyle>;
  scheme: 'light' | 'dark';
  /** Slide in and out when the trip and a detail swap (keyed by the caller). */
  swap?: boolean;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const y = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    y.set(e.contentOffset.y);
  });
  const edgeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(y.get(), [0, TOP_EDGE_FADE_IN], [0, 1], 'clamp'),
  }));
  const paper = pick(hex.paper, scheme);
  return (
    <Animated.View
      style={styles.fill}
      entering={swap ? (reduceMotion ? SWAP_FADE_IN : sheetPushIn) : undefined}
      exiting={swap ? (reduceMotion ? SWAP_FADE_OUT : sheetPushOut) : undefined}
    >
      <Animated.ScrollView
        contentContainerStyle={contentContainerStyle}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        {children}
      </Animated.ScrollView>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.topEdge,
          {
            backgroundImage: `linear-gradient(to bottom, ${paper} 55%, ${paper}00 100%)`,
          },
          edgeStyle,
        ]}
      />
    </Animated.View>
  );
}

// Reduce Motion: the same swap as a plain crossfade, no travel.
const SWAP_FADE_IN = FadeIn.duration(motion.pushIn).delay(motion.pushOverlap);
const SWAP_FADE_OUT = FadeOut.duration(motion.pushOut);

/** The detent whose height is nearest `shown` points of sheet, given the fractions' full height. */
function nearestDetent(shown: number, detents: readonly number[], full: number): DetentIndex {
  let best = 0;
  detents.forEach((f, i) => {
    if (Math.abs(f * full - shown) < Math.abs(detents[best] * full - shown)) best = i;
  });
  return best as DetentIndex;
}

function formatKm(meters: number): string {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`;
}

/** Points of scroll over which the top edge fades in. */
const TOP_EDGE_FADE_IN = 12;

const styles = StyleSheet.create({
  scroll: {
    paddingTop: PEEK_TOP,
  },
  fill: {
    flex: 1,
  },
  // Solid under the grabber, then a short fade.
  topEdge: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: PEEK_TOP + 12,
  },
});
