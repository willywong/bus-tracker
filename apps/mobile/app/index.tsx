import { SymbolView } from 'expo-symbols';
import { PlatformColor, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useEffect, useMemo, useState } from 'react';

import { formatStopName } from '@/components/map/format';
import { CurrentBusCard } from '@/components/tracker/CurrentBusCard';
import { HeroCountdown } from '@/components/tracker/HeroCountdown';
import { NextBusRow } from '@/components/tracker/NextBusRow';
import { NotifDeniedChip } from '@/components/tracker/NotifDeniedChip';
import { ServiceEdgeRow } from '@/components/tracker/ServiceEdgeRow';
import { TimetableStrip } from '@/components/tracker/TimetableStrip';
import { TrackerCanvas } from '@/components/tracker/TrackerCanvas';
import { WalkCta } from '@/components/tracker/WalkCta';
import {
  formatClockHHMM,
  formatWalkRemaining,
  resolveHeroState,
  useLastUpdatedLabel,
} from '@/components/tracker/logic';
import { sourceColor, trackerSpacing } from '@/components/tracker/tokens';
import { openDb } from '@/db/database';
import {
  getStops,
  getTrafficSignals,
  type StopRow,
  type TrafficSignalRow,
} from '@/db/queries';
import { useBusPosition } from '@/hooks/useBusPosition';
import { useEta } from '@/hooks/useEta';
import { usePushRegistrationState } from '@/hooks/PushRegistrationContext';
import { AVAILABLE_ROUTE_CODES, useSettings } from '@/hooks/useSettings';
import { useWalkTimer } from '@/hooks/useWalkTimer';

export default function TrackerScreen() {
  const settings = useSettings();
  const push = usePushRegistrationState();
  const eta = useEta({
    stopId: settings.preferredStopId,
    routeCode: settings.preferredRouteCode,
    trafficProvider: settings.trafficProvider,
  });
  const {
    minutesToStop,
    scheduledUpcoming,
    currentScheduled,
    primaryArrival,
    secondaryArrival,
    resolved,
    serviceEnded,
    beforeServiceStart,
    firstBusToday,
    lastBusToday,
    polylineMeters,
  } = eta;
  const { lastUpdated, positions } = useBusPosition({
    routeCode: settings.preferredRouteCode,
  });
  const updated = useLastUpdatedLabel(lastUpdated);
  const walk = useWalkTimer(settings.walkMinutes);
  const [stopName, setStopName] = useState<string | null>(null);
  const [trafficSignals, setTrafficSignals] = useState<TrafficSignalRow[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = await openDb();
        const stops = await getStops(db);
        if (cancelled) return;
        const match = stops.find(
          (s: StopRow) => s.stop_id === settings.preferredStopId,
        );
        setStopName(match?.stop_name ?? null);
      } catch (err) {
        console.warn('[tracker] failed to load stop name', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settings.preferredStopId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = await openDb();
        const signals = await getTrafficSignals(
          db,
          settings.preferredRouteCode,
        );
        if (!cancelled) setTrafficSignals(signals);
      } catch (err) {
        console.warn('[tracker] failed to load traffic signals', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settings.preferredRouteCode]);

  const leaveIn =
    minutesToStop == null
      ? null
      : Math.max(0, minutesToStop - settings.walkMinutes);
  const heroState = resolveHeroState({
    isWalking: walk.isWalking,
    leaveIn,
    minutesToStop,
    walkMinutes: settings.walkMinutes,
  });
  const isLeaveNow = heroState === 'leaveNow';
  const isHurry = heroState === 'hurry';

  // Track when leaveIn first hit 0 for the current primary arrival *in true
  // Leave-now state* (bus at/near the stop). Once the same bus has been at 0
  // for ≥60 s the bus is either boarded or missed — swap the hero to "Wait for
  // next bus" until composition picks a new primary.
  //
  // Critical: we skip tracking when heroState is 'hurry'. A hurry row also has
  // leaveIn === 0, but the bus is still actively approaching (minutesToStop is
  // small but non-zero). If we tracked hurry here, the 60-s timer would fire
  // while the bus is still on the way and wrongly show "Wait for next bus".
  const primaryKey =
    primaryArrival?.tripId ?? primaryArrival?.live?.vehicleId ?? null;
  const [leaveNowStuck, setLeaveNowStuck] = useState<{
    key: string;
    at: number;
  } | null>(null);
  useEffect(() => {
    setLeaveNowStuck((prev) => {
      if (heroState === 'hurry') return null;
      if (leaveIn === 0 && primaryKey) {
        return prev && prev.key === primaryKey
          ? prev
          : { key: primaryKey, at: Date.now() };
      }
      if (leaveIn != null && leaveIn > 0) return null;
      // leaveIn null OR primaryKey null — keep prev unless a *different*
      // non-null primaryKey has appeared (true bus change).
      if (prev && primaryKey && prev.key !== primaryKey) return null;
      return prev;
    });
  }, [leaveIn, primaryKey, heroState]);

  const isWaitingForNext =
    leaveNowStuck != null && now - leaveNowStuck.at >= 60_000;

  // While walking, how many spare minutes the user has before the bus arrives
  // at the stop. 14 min bus ETA minus an 8 min walk remaining = 6 min to spare.
  // Floor to be conservative (14.9 min → show 14, not 15).
  const walkingSlackMin =
    walk.isWalking && walk.remainingSeconds != null && minutesToStop != null
      ? Math.max(
          0,
          Math.floor(minutesToStop - walk.remainingSeconds / 60),
        )
      : null;

  const hero = useMemo(() => {
    if (walk.isWalking) {
      return {
        eyebrow: 'Walking to stop',
        value: formatWalkRemaining(walk.remainingSeconds ?? 0),
        unit: 'remaining',
        detail:
          walkingSlackMin != null && walkingSlackMin > 0
            ? `${walkingSlackMin} min to spare`
            : null,
      };
    }
    if (beforeServiceStart && firstBusToday != null) {
      return {
        eyebrow: 'First bus at',
        value: formatClockHHMM(firstBusToday),
        unit: 'scheduled',
        detail: null,
      };
    }
    if (serviceEnded) {
      return {
        eyebrow: 'Service ended',
        value: '—',
        unit: '',
        detail: null,
      };
    }
    if (isWaitingForNext) {
      return {
        eyebrow: 'Wait for next bus',
        value: '—',
        unit: '',
        detail: null,
      };
    }
    if (leaveIn == null) {
      return {
        eyebrow: 'Waiting for bus',
        value: '—',
        unit: '',
        detail: null,
      };
    }
    // Bus arrives before the configured walk time — show the raw bus ETA in
    // red and prompt a faster walk. (leaveIn is already 0 here because
    // minutesToStop < walkMinutes; showing the bus ETA is more informative.)
    if (isHurry && minutesToStop != null) {
      return {
        eyebrow: 'Walk quick',
        value: `${minutesToStop}`,
        unit: minutesToStop === 1 ? 'minute' : 'minutes',
        detail: `Bus arrives before your ${settings.walkMinutes}-min walk`,
      };
    }
    if (leaveIn === 0) {
      return {
        eyebrow: 'Leave now',
        value: '0',
        unit: 'minutes',
        detail: null,
      };
    }
    return {
      eyebrow: isLeaveNow ? 'Leave soon' : 'Leave in',
      value: `${leaveIn}`,
      unit: leaveIn === 1 ? 'minute' : 'minutes',
      detail: null,
    };
  }, [
    walk.isWalking,
    walk.remainingSeconds,
    walkingSlackMin,
    leaveIn,
    isLeaveNow,
    isHurry,
    minutesToStop,
    settings.walkMinutes,
    isWaitingForNext,
    beforeServiceStart,
    firstBusToday,
    serviceEnded,
  ]);

  const subtitle = stopName ? `to ${formatStopName(stopName)}` : 'to your stop';

  return (
    <TrackerCanvas>
      <HeroCountdown
        state={heroState}
        selectedRoute={settings.preferredRouteCode}
        routeOptions={AVAILABLE_ROUTE_CODES}
        onSelectRoute={settings.setPreferredRouteCode}
        eyebrow={hero.eyebrow}
        value={hero.value}
        unit={hero.unit}
        subtitle={subtitle}
        detail={hero.detail}
      />

      {push.permission === 'denied' ? (
        <Animated.View
          entering={FadeIn.duration(220)}
          style={{ marginBottom: 16 }}
        >
          <NotifDeniedChip />
        </Animated.View>
      ) : null}

      <SectionLabel>Buses</SectionLabel>
      {serviceEnded ? (
        <ServiceEdgeRow variant="after-last" lastEpochMs={lastBusToday} />
      ) : beforeServiceStart ? (
        <ServiceEdgeRow variant="before-first" firstEpochMs={firstBusToday} />
      ) : primaryArrival == null ? (
        <EmptyBusesRow />
      ) : (
        <View style={{ gap: 8 }}>
          <CurrentBusCard
            entry={primaryArrival}
            livePosition={positions.find(
              (p) => p.vehicleId === primaryArrival.live?.vehicleId,
            )}
            delay={
              primaryArrival.kind === 'live' ? resolved.delay : null
            }
            isStale={updated.isStale}
            lastUpdated={lastUpdated}
            polylineMeters={polylineMeters}
            trafficSignals={trafficSignals}
          />
          {secondaryArrival ? (
            <NextBusRow
              entry={secondaryArrival}
              livePosition={positions.find(
                (p) => p.vehicleId === secondaryArrival.live?.vehicleId,
              )}
            />
          ) : null}
        </View>
      )}

      {scheduledUpcoming.length > 0 && !serviceEnded ? (
        <>
          <View style={{ height: 16 }} />
          <SectionLabel>Timetable</SectionLabel>
          <TimetableStrip
            departures={scheduledUpcoming}
            anchorTripId={currentScheduled?.tripId ?? null}
            now={now}
          />
        </>
      ) : null}

      <View style={{ height: trackerSpacing.sectionGap }} />

      {serviceEnded ? null : (
        <WalkCta
          isWalking={walk.isWalking}
          isLeaveNow={isLeaveNow}
          onStart={() => {
            void walk.start();
          }}
          onCancel={() => {
            void walk.cancel();
          }}
        />
      )}
    </TrackerCanvas>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text style={labelStyles.text} selectable>
      {children}
    </Text>
  );
}

function EmptyBusesRow() {
  return (
    <View style={emptyStyles.row}>
      <SymbolView name="bus" size={22} tintColor={sourceColor.scheduled} />
      <View style={emptyStyles.textCol}>
        <Text style={emptyStyles.title} selectable>
          No buses in service
        </Text>
        <Text style={emptyStyles.caption} selectable>
          The next run hasn't started yet — check back shortly.
        </Text>
      </View>
    </View>
  );
}

const labelStyles = StyleSheet.create({
  text: {
    fontSize: 13,
    fontWeight: '500',
    color: PlatformColor('secondaryLabel'),
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginLeft: 4,
  },
});

const emptyStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: trackerSpacing.rowH,
    paddingVertical: trackerSpacing.rowV + 2,
    minHeight: 60,
    gap: 14,
  },
  textCol: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 16,
    fontWeight: '500',
    color: PlatformColor('label'),
  },
  caption: {
    fontSize: 12,
    fontWeight: '400',
    color: PlatformColor('secondaryLabel'),
  },
});
