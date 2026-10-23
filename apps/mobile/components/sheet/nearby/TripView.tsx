import { nearbyRailStations } from '@bus-tracker/shared';
import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { Linking, Share, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';

import { Bus3D, hasBus3D } from '@/components/detail/Bus3D';
import { busKindOf } from '@/modules/bus-model';
import { formatClockHHMM } from '@/components/tracker/logic';
import { Connections } from '@/components/trip/Connections';
import { BusPosition } from '@/components/trip/BusPosition';
import { HeroBlock } from '@/components/trip/Hero';
import { mins, type TripState } from '@/components/trip/model';
import { EmptyState } from '@/components/sheet/EmptyState';
import { DataSources } from '@/components/trip/DataSources';
import { TripRows } from '@/components/trip/Notes';
import { tripStatusItem, tripWarnings, WarningBadges } from '@/components/trip/Warnings';
import { AllStopsButton, OnTheWay } from '@/components/trip/OnTheWay';
import { PrimaryAction } from '@/components/trip/PrimaryAction';
import { Hairline, LinkRow, ROW_ICON_INSET, ToggleRow } from '@/components/trip/Rows';
import { Section, SECTION_RULE, SheetBody } from '@/components/trip/SheetBody';
import { SheetHeader } from '@/components/trip/SheetHeader';
import { Timetable } from '@/components/trip/Timetable';
import type { ScheduledDeparture } from '@/db/queries';
import { useTripHeadsign } from '@/hooks/useMapDetail';
import { useSettings } from '@/hooks/useSettings';
import { ensureNotificationPermission } from '@/services/reminders/notifications';
import { arrivalShareMessage } from '@/services/shareArrival';
import { useRide } from '@/state/RideContext';
import { useTrip } from '@/state/TripContext';
import { color, MARGIN, motion, space, type } from '@/theme/design';

/**
 * Your tracked bus, in full (Nearby's trip view, plan 17/02): the thin hero
 * number, the status line, "Then" and notes, and one action; then the
 * approach, today's times, rail nearby and the trip options. Every detent
 * shows the same column, cut by the sheet's edge, so at peek the rows under
 * the hero show there is more above the fold. With no route yet it invites
 * you to pick one.
 */
export function TripView({ scheme }: { scheme: 'light' | 'dark' }) {
  const trip = useTrip();
  const settings = useSettings();
  const router = useRouter();
  const ride = useRide();
  const { model } = trip;
  const destination = useTripHeadsign(trip.eta.primaryArrival?.tripId ?? null, trip.routeCode);
  const userStop = trip.route?.userStop ?? null;
  const stopPoint = useMemo(
    () => (userStop ? { lat: userStop.stop_lat, lng: userStop.stop_lon } : null),
    [userStop],
  );
  const hasRail = useMemo(
    () => (stopPoint ? nearbyRailStations(stopPoint).length > 0 : false),
    [stopPoint],
  );

  // A stop tapped in the sheet opens its detail; your own stop is the trip.
  const { select } = trip;
  const openStop = useCallback(
    (id: string) => select(id === trip.stopId ? null : { kind: 'stop', stopId: id }),
    [select, trip.stopId],
  );
  const stopCount = trip.route?.stops.length ?? 0;
  const openAllStops = () => router.push('/stops');
  const openDeparture = (d: ScheduledDeparture) =>
    router.push({
      pathname: '/departure',
      params: { tripId: d.tripId, at: String(d.departureEpochMs) },
    });
  const openStation = (station: string) => router.push({ pathname: '/station', params: { station } });
  const shareArrival = () => {
    const message = arrivalShareMessage(trip.routeCode, trip.stopName, model.compact, model.source);
    if (message) void Share.share({ message });
  };

  if (model.state === 'empty') {
    return (
      <EmptyState
        icon="bus"
        title="Track your bus"
        message="Pick a route and the stop you board at. Live buses and your countdown appear here."
        actionLabel="Choose Route"
        onAction={() => router.push('/add-route')}
        scheme={scheme}
      />
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
  // Live or scheduled, and the weather and other warnings: a glass capsule at
  // the header's end, opening the details. Empty states list them inline.
  const status = tripStatusItem(model);
  const warnings = [...(status ? [status] : []), ...tripWarnings(model, settings.walkMinutes)];
  const hero = showsHero(model.state);

  return (
    <>
      <SheetHeader
        routeCode={trip.routeCode}
        title={trip.stopName}
        peek={false}
        status={null}
        source={model.source}
        compact={model.hero}
        accessory={
          hero && warnings.length > 0 ? (
            <WarningBadges items={warnings} onPress={() => router.push('/warnings')} />
          ) : null
        }
      />

      <SheetBody peek={false}>
        {hero ? (
          <>
            {/* Under the route and stop, in view as the sheet opens: the pill's bus lands here. */}
            <View style={hasBus3D ? styles.heroRow : null}>
              <Bus3D
                kind={busKindOf(trip.stopId)}
                routeCode={trip.routeCode}
                destination={destination}
                style={styles.bus}
                opens={{ vehicleId: trip.eta.primaryArrival?.live?.vehicleId ?? null }}
              />
              <TripHero align={hasBus3D ? 'end' : 'start'} />
            </View>
            {model.facts.map((f) => (
              <BusPosition key={f.id} title={f.value} caption={f.caption} />
            ))}
          </>
        ) : (
          <StateBody scheme={scheme} />
        )}

        <TripRows model={model} walkMinutes={settings.walkMinutes} inlineWarnings={!hero} />

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
            <Connections stop={stopPoint} onOpenStation={openStation} />
          </Section>
        ) : null}

        <View style={styles.options}>
          {model.compact != null ? (
            <>
              <LinkRow icon="square.and.arrow.up" title="Share arrival" onPress={shareArrival} />
              <Hairline inset={ROW_ICON_INSET} />
            </>
          ) : null}
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
    </>
  );
}

/** Hands off to Apple Maps in walking mode (Look Around included there). */
export function openWalkingDirections(stop: { lat: number; lng: number }) {
  void Linking.openURL(`https://maps.apple.com/?daddr=${stop.lat},${stop.lng}&dirflg=w`);
}

/** States whose body is an empty state rather than the hero number. */
function showsHero(state: TripState): boolean {
  return !(state === 'loading' || state === 'service-ended' || state === 'no-service');
}

/**
 * The minutes and their status line, crossfading when the state changes
 * (arriving, at stop), beside the bus, which stays put.
 */
function TripHero({ align }: { align: 'start' | 'end' }) {
  const { model } = useTrip();
  const reduceMotion = useReducedMotion();
  return (
    <Animated.View
      key={model.state}
      entering={reduceMotion ? undefined : FadeIn.duration(motion.crossfade)}
      style={styles.hero}
    >
      <HeroBlock model={model} align={align} />
    </Animated.View>
  );
}

/** The body for states without the hero number: loading, ended, no service. */
function StateBody({ scheme }: { scheme: 'light' | 'dark' }) {
  const trip = useTrip();
  const { model } = trip;

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
        <View style={styles.loading}>
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
      return null;
  }
}

const styles = StyleSheet.create({
  // The bus bleeding off the left edge, the minutes on the right.
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  bus: {
    flex: 1,
    height: 150,
    marginLeft: -MARGIN,
  },
  hero: {
    flexShrink: 0,
  },
  loading: {
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
});
