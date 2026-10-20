import { SymbolView } from 'expo-symbols';
import { PlatformColor, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useCallback, useEffect, useState } from 'react';

import { GlassGuard, isGlassAvailable } from '@/components/GlassGuard';
import { AuroraBackdrop } from '@/components/tracker/AuroraBackdrop';
import { JourneyCard } from '@/components/tracker/JourneyCard';
import { JourneyCardSkeleton } from '@/components/tracker/JourneyCardSkeleton';
import { EmptyTrackerHero } from '@/components/tracker/EmptyTrackerHero';
import { GlassDemoSheet } from '@/components/tracker/GlassDemoSheet';
import { NotifDeniedChip } from '@/components/tracker/NotifDeniedChip';
import { ServiceEdgeRow } from '@/components/tracker/ServiceEdgeRow';
import { TimetableStrip } from '@/components/tracker/TimetableStrip';
import { TimetableStripSkeleton } from '@/components/tracker/TimetableStripSkeleton';
import { TrackerCanvas } from '@/components/tracker/TrackerCanvas';
import { TrackerToolbar } from '@/components/tracker/TrackerToolbar';
import { useLastUpdatedLabel } from '@/components/tracker/logic';
import {
  bentoTokens,
  sourceColor,
  statusColor,
  surfaceColor,
  trackerSpacing,
  type ScreenStatusKind,
} from '@/components/tracker/tokens';
import { openDb } from '@/db/database';
import {
  getStops,
  getTrafficSignals,
  type StopRow,
  type TrafficSignalRow,
} from '@/db/queries';
import { useBusLiveActivity } from '@/hooks/useBusLiveActivity';
import { useBusPosition } from '@/hooks/useBusPosition';
import { useEta } from '@/hooks/useEta';
import { useRouteTransition } from '@/hooks/useRouteTransition';
import { usePushRegistrationState } from '@/hooks/PushRegistrationContext';
import { devNow } from '@/utils/devClock';
import { useSettings } from '@/hooks/useSettings';
import { useWalkTimer } from '@/hooks/useWalkTimer';
import { refreshAll } from '@/services/refresh';

export default function TrackerScreen() {
  const { ready, favoritedRoutes } = useSettings();
  const [showAddBus, setShowAddBus] = useState(false);
  const openAddBus = useCallback(() => setShowAddBus(true), []);
  const closeAddBus = useCallback(() => setShowAddBus(false), []);

  if (!ready) return null;

  return (
    <>
      {favoritedRoutes.length === 0 ? (
        <AuroraBackdrop glowColor={statusColor('waiting')}>
          <TrackerCanvas transparent onRefresh={() => {}} refreshing={false}>
            <EmptyTrackerHero onAdd={openAddBus} />
          </TrackerCanvas>
        </AuroraBackdrop>
      ) : (
        <TrackerActive onAddBus={openAddBus} />
      )}
      <GlassDemoSheet isPresented={showAddBus} onDismiss={closeAddBus} />
    </>
  );
}

function TrackerActive({ onAddBus }: { onAddBus: () => void }) {
  const settings = useSettings();
  const push = usePushRegistrationState();
  const activeRoute = settings.preferredRouteCode ?? '';
  const eta = useEta({
    stopId: settings.preferredStopId,
    routeCode: activeRoute,
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
    arrivalStatus,
    lastComputedAt,
  } = eta;
  const isTransitioning = useRouteTransition({
    preferredRouteCode: settings.preferredRouteCode,
    preferredStopId: settings.preferredStopId,
    lastComputedAt,
  });
  const { lastUpdated, positions, nextRefreshAt, isRefreshing } =
    useBusPosition({
      routeCode: settings.preferredRouteCode ?? undefined,
    });
  const updated = useLastUpdatedLabel(lastUpdated);
  const walk = useWalkTimer(settings.walkMinutes);
  const [stopName, setStopName] = useState<string | null>(null);
  const [trafficSignals, setTrafficSignals] = useState<TrafficSignalRow[]>([]);
  const [now, setNow] = useState(() => devNow());
  const [refreshing, setRefreshing] = useState(false);
  const [isTracking, setIsTracking] = useState(false);

  // Reset tracking when the user changes route/stop — the current activity no
  // longer describes the thing they're watching.
  useEffect(() => {
    setIsTracking(false);
  }, [settings.preferredRouteCode, settings.preferredStopId]);

  useBusLiveActivity({
    routeCode: activeRoute,
    stopName,
    primaryArrival,
    resolved,
    arrivalStatus,
    isStale: updated.isStale,
    beforeServiceStart,
    firstBusToday,
    enabled: isTracking,
  });

  useEffect(() => {
    const t = setInterval(() => setNow(devNow()), 15_000);
    return () => clearInterval(t);
  }, []);

  const handleRefresh = useCallback(() => {
    if (refreshing) return;
    setRefreshing(true);
    void refreshAll({ routes: settings.favoritedRoutes })
      .catch((err) => {
        console.warn('[tracker] refresh failed', err);
      })
      .finally(() => {
        setRefreshing(false);
      });
  }, [refreshing, settings.favoritedRoutes]);

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
        console.error(
          '[tracker] failed to load stop name',
          'stopId=', settings.preferredStopId,
          'name=', (err as { name?: string })?.name,
          'message=', (err as { message?: string })?.message,
          'stack=', (err as { stack?: string })?.stack,
          'raw=', err,
        );
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
        const signals = settings.preferredRouteCode
          ? await getTrafficSignals(db, settings.preferredRouteCode)
          : [];
        if (!cancelled) setTrafficSignals(signals);
      } catch (err) {
        console.error(
          '[tracker] failed to load traffic signals',
          'routeCode=', settings.preferredRouteCode,
          'name=', (err as { name?: string })?.name,
          'message=', (err as { message?: string })?.message,
          'stack=', (err as { stack?: string })?.stack,
          'raw=', err,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settings.preferredRouteCode]);

  // Walk "leave now" hint — only used to tint the Walk button.
  const leaveIn =
    minutesToStop == null
      ? null
      : Math.max(0, minutesToStop - settings.walkMinutes);
  const isLeaveNow = leaveIn != null && leaveIn <= 2;

  // The bento reports its resolved status so the aurora glow can match it.
  const [bentoStatus, setBentoStatus] = useState<ScreenStatusKind>('waiting');

  const showTrack =
    primaryArrival != null || (beforeServiceStart && firstBusToday != null);

  const glowKind: ScreenStatusKind = walk.isWalking
    ? 'walking'
    : serviceEnded
      ? 'waiting'
      : beforeServiceStart
        ? 'schedule'
        : primaryArrival == null
          ? 'waiting'
          : bentoStatus;
  const glowColor = statusColor(glowKind);

  return (
    <AuroraBackdrop glowColor={glowColor}>
      <TrackerCanvas transparent onRefresh={handleRefresh} refreshing={refreshing}>
        <TrackerToolbar
          selectedRoute={settings.preferredRouteCode}
          routeOptions={settings.favoritedRoutes}
          onSelectRoute={settings.setPreferredRouteCode}
          onAddBus={onAddBus}
          showTrack={showTrack}
          isTracking={isTracking}
          onTrackToggle={setIsTracking}
          showWalk={!serviceEnded}
          isWalking={walk.isWalking}
          isLeaveNow={isLeaveNow}
          onWalkStart={() => {
            void walk.start();
          }}
          onWalkCancel={() => {
            void walk.cancel();
          }}
        />

        {push.permission === 'denied' ? (
          <Animated.View
            entering={FadeIn.duration(220)}
            style={{ marginBottom: 16 }}
          >
            <NotifDeniedChip />
          </Animated.View>
        ) : null}

        {isTransitioning ? (
          <Animated.View
            key="journey-skel"
            entering={FadeIn.duration(180)}
            exiting={FadeOut.duration(180)}
          >
            <JourneyCardSkeleton />
          </Animated.View>
        ) : (
          <Animated.View
            key="journey-real"
            entering={FadeIn.duration(180)}
            exiting={FadeOut.duration(180)}
          >
            {serviceEnded ? (
              <ServiceEdgeRow variant="after-last" lastEpochMs={lastBusToday} />
            ) : beforeServiceStart ? (
              <ServiceEdgeRow
                variant="before-first"
                firstEpochMs={firstBusToday}
              />
            ) : primaryArrival == null ? (
              <EmptyBusesRow />
            ) : (
              <JourneyCard
                entry={primaryArrival}
                livePosition={positions.find(
                  (p) => p.vehicleId === primaryArrival.live?.vehicleId,
                )}
                liveCurrent={eta.current}
                liveCurrentPosition={
                  eta.current?.vehicleId
                    ? positions.find(
                        (p) => p.vehicleId === eta.current?.vehicleId,
                      )
                    : undefined
                }
                delay={primaryArrival.kind === 'live' ? resolved.delay : null}
                isStale={updated.isStale}
                lastUpdated={lastUpdated}
                nextRefreshAt={nextRefreshAt}
                isRefreshing={isRefreshing}
                polylineMeters={polylineMeters}
                trafficSignals={trafficSignals}
                arrivalStatus={arrivalStatus}
                routeCode={activeRoute}
                stopId={settings.preferredStopId}
                routeLabel={settings.preferredRouteCode ?? 'Bus'}
                isWalking={walk.isWalking}
                walkRemainingSeconds={walk.remainingSeconds}
                onStatusChange={setBentoStatus}
              />
            )}
          </Animated.View>
        )}

      {(isTransitioning || scheduledUpcoming.length > 0) && !serviceEnded ? (
        <>
          <View style={{ height: 16 }} />
          <SectionLabel>Timetable</SectionLabel>
          {isTransitioning ? (
            <Animated.View
              key="tt-skel"
              entering={FadeIn.duration(180)}
              exiting={FadeOut.duration(180)}
            >
              <TimetableStripSkeleton />
            </Animated.View>
          ) : (
            <Animated.View
              key="tt-real"
              entering={FadeIn.duration(180)}
              exiting={FadeOut.duration(180)}
            >
              <TimetableStrip
                departures={scheduledUpcoming}
                anchorTripId={currentScheduled?.tripId ?? null}
                now={now}
              />
            </Animated.View>
          )}
        </>
      ) : null}
      </TrackerCanvas>
    </AuroraBackdrop>
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
    <GlassGuard
      glassEffectStyle="regular"
      style={[emptyStyles.row, !isGlassAvailable() && emptyStyles.rowFallback]}
    >
      <SymbolView name="bus" size={22} tintColor={sourceColor.scheduled} />
      <View style={emptyStyles.textCol}>
        <Text style={emptyStyles.title} selectable>
          No buses in service
        </Text>
        <Text style={emptyStyles.caption} selectable>
          The next run hasn't started yet — check back shortly.
        </Text>
      </View>
    </GlassGuard>
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
    paddingHorizontal: 16,
    paddingVertical: trackerSpacing.rowV + 2,
    minHeight: 64,
    gap: 14,
    borderRadius: bentoTokens.tileRadius,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surfaceColor.hairline,
    overflow: 'hidden',
  },
  rowFallback: {
    backgroundColor: surfaceColor.grouped,
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
