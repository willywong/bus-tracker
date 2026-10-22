import { Button, Host, Text as SwiftText } from '@expo/ui/swift-ui';
import {
  buttonBorderShape,
  buttonStyle,
  controlSize,
  font,
  foregroundStyle,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { nearbyRailStations } from '@bus-tracker/shared';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  Linking,
  StyleSheet,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
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

import { formatClockHHMM } from '@/components/tracker/logic';
import { rideMinutes } from '@/components/ride/model';
import { RideBody } from '@/components/ride/RideBody';
import { Connections } from '@/components/trip/Connections';
import { BusPosition } from '@/components/trip/BusPosition';
import { HeroBlock } from '@/components/trip/Hero';
import { mins, stopsAwayLabel, type TripState } from '@/components/trip/model';
import { DataSources } from '@/components/trip/DataSources';
import { EdgeSwipeBack } from '@/components/trip/EdgeSwipeBack';
import { TripRows } from '@/components/trip/Notes';
import { tripStatusItem, tripWarnings, WarningBadges } from '@/components/trip/Warnings';
import { BusDetailSheet, StopDetailSheet } from '@/components/detail/DetailSheet';
import { WhereToRow } from '@/components/plan/WhereToRow';
import { AllStopsButton, OnTheWay } from '@/components/trip/OnTheWay';
import { PeekCard, TripPeekAction } from '@/components/trip/PeekCard';
import { PrimaryAction } from '@/components/trip/PrimaryAction';
import { Hairline, LinkRow, ROW_ICON_INSET, ToggleRow } from '@/components/trip/Rows';
import { Section, SECTION_RULE, SheetBody } from '@/components/trip/SheetBody';
import { SheetHeader } from '@/components/trip/SheetHeader';
import { sheetPushIn, sheetPushOut } from '@/components/trip/sheetTransition';
import { Timetable } from '@/components/trip/Timetable';
import type { ScheduledDeparture } from '@/db/queries';
import { useSettings } from '@/hooks/useSettings';
import { ensureNotificationPermission } from '@/services/reminders/notifications';
import { toPlace, usePlanner } from '@/state/PlannerContext';
import { useRide } from '@/state/RideContext';
import { useTrip } from '@/state/TripContext';
import {
  color,
  EASE_OUT,
  hex,
  MARGIN,
  motion,
  PEEK_TOP,
  pick,
  SHEET_INITIAL_DETENT,
  sheetDetents,
  space,
  type,
  type DetentIndex,
} from '@/theme/design';

/** After the map settles, how long before all detents return (the snap must land first). */
const COLLAPSE_SETTLE_MS = 300;
/** Detents come back after this long even if the map never reports settling. */
const HOLD_PEEK_MAX_MS = 5000;

type DetentListener = (
  event: 'sheetDetentChange',
  cb: (e: { data: { index: number } }) => void,
) => () => void;

/**
 * The persistent trip sheet over the map, in Calm Mono: opaque paper, ink
 * type, hairline rows. Peek shows the header row; glance the thin hero
 * number, the status line, "Then" and notes, and one action; large adds the
 * approach, today's times, rail nearby and the trip options.
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
  const { model } = trip;
  const peek = trip.detent === 0;
  // The live dot leads the capsule beside the number, then any warnings.
  const statusItem = tripStatusItem(model);
  const peekWarnings = [
    ...(statusItem ? [statusItem] : []),
    ...tripWarnings(model, settings.walkMinutes),
  ];
  const userStop = trip.route?.userStop ?? null;
  const stopPoint = useMemo(
    () => (userStop ? { lat: userStop.stop_lat, lng: userStop.stop_lon } : null),
    [userStop],
  );
  const hasRail = useMemo(
    () => (stopPoint ? nearbyRailStations(stopPoint).length > 0 : false),
    [stopPoint],
  );

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
    const t = setTimeout(
      () =>
        navigation.setOptions({
          sheetAllowedDetents: detents,
          sheetInitialDetentIndex: SHEET_INITIAL_DETENT,
          sheetLargestUndimmedDetentIndex: 1,
        }),
      COLLAPSE_SETTLE_MS,
    );
    return () => clearTimeout(t);
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
    <WhereToRow
      onOpen={() => router.push('/plan')}
      home={home}
      work={work}
      onPlace={(p) => {
        planner.setTo(toPlace(p));
        router.push('/plan');
      }}
    />
  );

  const scrollStyle = [styles.scroll, { paddingBottom: insets.bottom + space.xl }];

  // A stop tapped in the sheet opens its detail; your own stop is the trip.
  const { select } = trip;
  const openStop = useCallback(
    (id: string) => select(id === trip.stopId ? null : { kind: 'stop', stopId: id }),
    [select, trip.stopId],
  );
  const back = useCallback(() => select(null), [select]);
  const stopCount = trip.route?.stops.length ?? 0;
  const openAllStops = () => router.push('/stops');
  const openDeparture = (d: ScheduledDeparture) =>
    router.push({
      pathname: '/departure',
      params: { tripId: d.tripId, at: String(d.departureEpochMs) },
    });

  if (model.state === 'empty') {
    return (
      <SheetScroll contentContainerStyle={scrollStyle} scheme={scheme}>
        {whereTo}
        <EmptyState
          icon="bus"
          title="Track your bus"
          message="Pick a route and the stop you board at. Live buses and your countdown appear here."
          actionLabel="Choose Route"
          onAction={() => router.push('/add-route')}
          scheme={scheme}
        />
      </SheetScroll>
    );
  }

  if (ride.active) {
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
          <RideBody ride={ride} base={model} />
        </SheetBody>
      </SheetScroll>
    );
  }

  if (trip.selection) {
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

  // The bus the hero counts down to, live or scheduled.
  const arrivingTripId = trip.eta.primaryArrival?.sched?.tripId ?? null;
  const showJourney = model.state === 'arrival' && trip.eta.primaryArrival?.kind === 'live';
  // Same guard as OnTheWay, so the section never shows as a bare label.
  const journeyShown =
    showJourney &&
    trip.journey.ready &&
    trip.journey.userStop != null &&
    trip.journey.busStop != null;
  const hasLastBus = model.notes.some((n) => n.id === 'last-bus');

  const peekHasAction = model.action.kind !== 'tight' && model.action.kind !== 'none';
  const stopsAhead = trip.journey.stopsAhead;
  const peekTrailing =
    !showJourney || !model.sourceLine.arrives || !trip.eta.primaryArrival
      ? null
      : peekHasAction
        ? { label: 'Arrives', value: formatClockHHMM(trip.eta.primaryArrival.epochMs) }
        : stopsAhead != null
          ? { label: '', value: stopsAwayLabel(stopsAhead) }
          : null;

  return (
    <SheetScroll key="trip" contentContainerStyle={scrollStyle} scheme={scheme} swap>
      {whereTo}
      <SheetHeader
        routeCode={trip.routeCode}
        title={trip.stopName}
        peek={peek}
        status={model.state === 'arrival' || model.state === 'before-service' ? model.status : null}
        source={model.source}
        compact={model.hero}
        peekContent={
          <PeekCard
            hero={model.hero}
            source={model.source}
            liveMark={false}
            stopsAhead={showJourney ? trip.journey.stopsAhead : null}
            aside={model.sourceLine.arrives ?? model.detail}
            accessory={
              peekWarnings.length > 0 ? (
                <WarningBadges items={peekWarnings} onPress={() => router.push('/warnings')} />
              ) : null
            }
            action={
              // "Too soon" is the walker in the warnings capsule above, so it
              // has no text of its own here.
              model.action.kind !== 'tight' ? (
                <TripPeekAction
                  action={model.action}
                  walkMinutes={settings.walkMinutes}
                  onFollow={trip.follow}
                  onUnfollow={trip.unfollow}
                  onStartWalking={trip.startWalking}
                  onCancelWalking={trip.cancelWalking}
                />
              ) : null
            }
            // Later buses live in the Today grid. While the rail holds the
            // top row, "Arrives …" moves here so the clock time isn't lost;
            // with no button, it takes the left and this says how far.
            trailing={peekTrailing}
          />
        }
      />

      <SheetBody peek={peek}>
        <StateBody scheme={scheme} />

        <TripRows
          model={model}
          walkMinutes={settings.walkMinutes}
          inlineWarnings={!showsHero(model.state)}
        />

        {(model.state === 'arrival' || model.action.kind === 'walking') &&
        model.action.kind !== 'tight' ? (
          <PrimaryAction
            action={model.action}
            walkMinutes={settings.walkMinutes}
            scheme={scheme}
            onFollow={trip.follow}
            onUnfollow={trip.unfollow}
            onStartWalking={trip.startWalking}
            onCancelWalking={trip.cancelWalking}
          />
        ) : null}

        {journeyShown ? (
          <Section title="On the way">
            <OnTheWay journey={trip.journey} arrivalLabel={model.compact} onStopPress={openStop} />
            {stopCount > 0 ? <AllStopsButton count={stopCount} onPress={openAllStops} /> : null}
          </Section>
        ) : null}

        {trip.eta.scheduledUpcoming.length > 0 && model.state !== 'service-ended' ? (
          <Section title="Today">
            <Timetable
              departures={trip.eta.scheduledUpcoming}
              formatClock={formatClockHHMM}
              arrivingTripId={arrivingTripId}
              onPressDeparture={openDeparture}
              firstBusToday={trip.eta.firstBusToday}
              lastBusToday={trip.eta.lastBusToday}
            />
          </Section>
        ) : null}

        {stopPoint && hasRail ? (
          <Section title="Rail nearby">
            <Connections stop={stopPoint} />
          </Section>
        ) : null}

        <View style={styles.options}>
          {model.state === 'arrival' ? (
            <>
              <ToggleRow
                icon="lock.iphone"
                title="Follow on Lock Screen"
                value={trip.isFollowing}
                onValueChange={(on) => (on ? trip.follow() : trip.unfollow())}
                accessibilityLabel="Follow this bus on the Lock Screen"
              />
              <Hairline inset={ROW_ICON_INSET} />
            </>
          ) : null}
          {hasLastBus ? (
            <>
              <ToggleRow
                icon="moon"
                title="Remind me before the last bus"
                caption={`${mins(10 + settings.walkMinutes)} before it leaves, from the timetable`}
                value={trip.lastBusReminder}
                onValueChange={(on) => {
                  trip.setLastBusReminder(on);
                  if (on) void ensureNotificationPermission().catch(() => {});
                }}
              />
              <Hairline inset={ROW_ICON_INSET} />
            </>
          ) : null}
          {!journeyShown && stopCount > 0 ? (
            <>
              <LinkRow
                icon="list.bullet"
                title={`All stops on ${trip.routeCode}`}
                value={String(stopCount)}
                onPress={openAllStops}
              />
              <Hairline inset={ROW_ICON_INSET} />
            </>
          ) : null}
          {ride.destinations.length > 0 ? (
            <>
              <LinkRow
                icon="bell"
                title="Alert me before my stop"
                onPress={() => router.push('/ride')}
              />
              <Hairline inset={ROW_ICON_INSET} />
            </>
          ) : null}
          {stopPoint ? (
            <>
              <LinkRow
                icon="figure.walk"
                title="Walking directions"
                value={mins(settings.walkMinutes)}
                external
                onPress={() => openWalkingDirections(stopPoint)}
                accessibilityHint="Opens Apple Maps"
              />
              <Hairline inset={ROW_ICON_INSET} />
            </>
          ) : null}
        </View>

        <DataSources />
      </SheetBody>
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

function formatKm(meters: number): string {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`;
}

/** Hands off to Apple Maps in walking mode (Look Around included there). */
function openWalkingDirections(stop: { lat: number; lng: number }) {
  void Linking.openURL(`https://maps.apple.com/?daddr=${stop.lat},${stop.lng}&dirflg=w`);
}

/** States whose body is an empty state rather than the hero number. */
function showsHero(state: TripState): boolean {
  return !(state === 'loading' || state === 'service-ended' || state === 'no-service');
}

/** Hero area for the current state — the map above never changes. */
function StateBody({ scheme }: { scheme: 'light' | 'dark' }) {
  const trip = useTrip();
  const settings = useSettings();
  const router = useRouter();
  const { model } = trip;
  const reduceMotion = useReducedMotion();
  const status = tripStatusItem(model);
  const warnings = [...(status ? [status] : []), ...tripWarnings(model, settings.walkMinutes)];

  switch (model.state) {
    case 'loading':
      if (trip.routeLoadFailed) {
        return (
          <EmptyState
            icon="wifi.exclamationmark"
            title="Couldn’t load this route"
            message="The timetable didn’t download. Check your connection and try again."
            actionLabel="Try Again"
            onAction={trip.retryRouteLoad}
            scheme={scheme}
            compact
          />
        );
      }
      return (
        <View style={styles.heroBlock}>
          <View style={styles.placeholderNumber} />
          <Text style={styles.muted}>{model.status}</Text>
        </View>
      );
    case 'service-ended':
      return (
        <EmptyState
          icon="moon.zzz"
          title="No more buses tonight"
          message={model.detail ?? 'Check back in the morning for the first bus.'}
          scheme={scheme}
          compact
        />
      );
    case 'no-service':
      return (
        <EmptyState
          icon="bus"
          title={model.status}
          message="Scheduled times appear here as soon as the next run is due."
          scheme={scheme}
          compact
        />
      );
    default:
      return (
        <Animated.View
          key={model.state}
          entering={reduceMotion ? undefined : FadeIn.duration(motion.crossfade)}
          style={styles.heroBlock}
        >
          <HeroBlock
            model={model}
            accessory={
              warnings.length > 0 ? (
                <WarningBadges items={warnings} onPress={() => router.push('/warnings')} />
              ) : null
            }
          />
          {model.facts.map((f) => (
            <BusPosition key={f.id} title={f.value} caption={f.caption} />
          ))}
        </Animated.View>
      );
  }
}

/** Thin SF Symbol, plain type, one ink button. No illustration chrome. */
function EmptyState({
  icon,
  title,
  message,
  actionLabel,
  onAction,
  scheme,
  compact = false,
}: {
  icon: SFSymbol;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  scheme: 'light' | 'dark';
  compact?: boolean;
}) {
  return (
    <View style={[styles.empty, compact && styles.emptyCompact]}>
      <SymbolView
        name={icon}
        size={compact ? 36 : 56}
        weight="ultraLight"
        tintColor={color.label}
      />
      <Text style={styles.emptyTitle} accessibilityRole="header">
        {title}
      </Text>
      <Text style={styles.emptyMessage}>{message}</Text>
      {actionLabel && onAction ? (
        <Host matchContents style={styles.emptyAction}>
          <Button
            onPress={onAction}
            modifiers={[
              buttonStyle('borderedProminent'),
              buttonBorderShape('capsule'),
              controlSize('large'),
              tint(pick(hex.ink, scheme)),
            ]}
          >
            <SwiftText
              modifiers={[
                font({ size: 17, weight: 'semibold' }),
                foregroundStyle(pick(hex.paper, scheme)),
              ]}
            >
              {actionLabel}
            </SwiftText>
          </Button>
        </Host>
      ) : null}
    </View>
  );
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
  heroBlock: {
    gap: space.lg,
  },
  placeholderNumber: {
    width: 72,
    height: 56,
    borderRadius: 16,
    borderCurve: 'continuous',
    backgroundColor: color.fill,
  },
  muted: {
    ...type.status,
    color: color.secondaryLabel,
  },
  // Major sections are split by a full-width hairline; rows inside a
  // section keep their own (inset) hairlines.
  options: {
    marginHorizontal: -MARGIN,
    paddingHorizontal: MARGIN,
    borderTopWidth: SECTION_RULE,
    borderTopColor: color.hairline,
  },
  empty: {
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.xl,
    paddingTop: space.xxl,
  },
  emptyCompact: {
    paddingTop: space.xs,
    paddingHorizontal: 0,
  },
  emptyTitle: {
    ...type.title,
    fontWeight: '500',
    color: color.label,
    textAlign: 'center',
    marginTop: space.xs,
  },
  emptyMessage: {
    ...type.status,
    color: color.secondaryLabel,
    textAlign: 'center',
  },
  emptyAction: {
    marginTop: space.md,
  },
});
