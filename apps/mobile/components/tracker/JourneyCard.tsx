import {
  getMotionStatus,
  type MotionStatus,
  type ScheduleDelay,
  type VehiclePosition,
} from '@bus-tracker/shared';
import { SymbolView } from 'expo-symbols';
import { type ReactNode, useEffect, useMemo } from 'react';
import { PlatformColor, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';

import { GlassGuard, isGlassAvailable } from '@/components/GlassGuard';
import { RefreshRing } from '@/components/tracker/RefreshRing';
import {
  formatClockHHMM,
  formatDelayLabel,
  formatWalkRemaining,
  useLastUpdatedLabel,
  useRefreshCountdownSeconds,
  type ArrivalStatus,
  type DelayTone,
} from '@/components/tracker/logic';
import {
  bentoTokens,
  glassTokens,
  resolveScreenStatus,
  statusColor,
  surfaceColor,
  type ScreenStatusKind,
} from '@/components/tracker/tokens';
import {
  useApproachHistory,
} from '@/hooks/useApproachHistory';
import { useJourneyStops, type JourneyStopNode } from '@/hooks/useJourneyStops';
import type { TrafficSignalRow } from '@/db/queries';
import type { ApproachingBus, ArrivalEntry } from '@/hooks/useEta';

type TelemetryPosition = Pick<
  VehiclePosition,
  | 'speed'
  | 'bearing'
  | 'lat'
  | 'lng'
  | 'observedAt'
  | 'vehicleId'
  | 'tripId'
  | 'currentStopSequence'
  | 'currentStopId'
  | 'currentStatus'
>;

interface JourneyCardProps {
  entry: ArrivalEntry;
  livePosition: TelemetryPosition | undefined;
  liveCurrent?: ApproachingBus | null;
  liveCurrentPosition?: TelemetryPosition | undefined;
  delay: ScheduleDelay | null;
  isStale: boolean;
  lastUpdated: number | null;
  nextRefreshAt: number | null;
  isRefreshing: boolean;
  polylineMeters: number | null;
  trafficSignals: readonly TrafficSignalRow[];
  arrivalStatus: ArrivalStatus;
  /** Route + stop the journey is resolved against. */
  routeCode: string;
  stopId: string;
  routeLabel: string;
  isWalking?: boolean;
  walkRemainingSeconds?: number | null;
  onStatusChange?: (kind: ScreenStatusKind) => void;
}

/** Beyond this many intermediate stops we collapse the middle of the line. */
const MAX_VISIBLE_UPCOMING = 6;

export function JourneyCard({
  entry,
  livePosition,
  liveCurrent,
  liveCurrentPosition,
  delay,
  isStale,
  lastUpdated,
  nextRefreshAt,
  isRefreshing,
  trafficSignals,
  arrivalStatus,
  routeCode,
  stopId,
  routeLabel,
  isWalking,
  walkRemainingSeconds,
  onStatusChange,
}: JourneyCardProps) {
  const entryLive = entry.live;
  const sched = entry.sched;

  const effectiveLive = entryLive ?? liveCurrent ?? null;
  const effectivePosition = livePosition ?? liveCurrentPosition;
  const hasTrackedLive =
    effectiveLive != null && effectivePosition != null && !isStale;
  const isLive = (entry.kind === 'live' && entryLive != null) || hasTrackedLive;
  const isArrived = arrivalStatus === 'arrived';
  const isArriving = arrivalStatus === 'arriving';

  const history = useApproachHistory({
    vehicleId: isLive ? (effectiveLive?.vehicleId ?? null) : null,
    forwardMeters: effectiveLive?.forwardMeters ?? null,
    minutesToStop: effectiveLive?.minutesToStop ?? null,
    speedKmh: effectivePosition?.speed ?? effectiveLive?.speedKmh ?? null,
    observedAt: effectivePosition?.observedAt ?? null,
    isStale,
  });

  const journey = useJourneyStops({
    routeCode,
    stopId,
    tripId: isLive ? (effectivePosition?.tripId ?? null) : null,
    currentStopSequence: effectivePosition?.currentStopSequence ?? null,
    currentStopId: effectivePosition?.currentStopId ?? null,
    busLat: isLive ? (effectivePosition?.lat ?? null) : null,
    busLng: isLive ? (effectivePosition?.lng ?? null) : null,
  });

  const minutes =
    entry.live?.minutesToStop != null
      ? entry.live.minutesToStop
      : Math.max(0, Math.round((entry.epochMs - Date.now()) / 60_000));

  const screenStatus = resolveScreenStatus({
    hasArrival: true,
    isLive,
    isStale,
    etaMode: isLive ? 'live' : 'schedule',
    arrivalStatus,
    trend: history.trend,
    isWalking: !!isWalking,
  });
  const accent = statusColor(screenStatus);
  useEffect(() => {
    onStatusChange?.(screenStatus);
  }, [screenStatus, onStatusChange]);

  const motion = useMemo(() => {
    if (!isLive) return null;
    return getMotionStatus({
      speedKmh: history.effectiveSpeedKmh ?? effectivePosition?.speed,
      position:
        effectivePosition?.lat != null && effectivePosition?.lng != null
          ? { lat: effectivePosition.lat, lng: effectivePosition.lng }
          : null,
      signals: trafficSignals.map((s) => ({ id: s.osm_id, lat: s.lat, lng: s.lng })),
    });
  }, [
    isLive,
    history.effectiveSpeedKmh,
    effectivePosition?.speed,
    effectivePosition?.lat,
    effectivePosition?.lng,
    trafficSignals,
  ]);

  const delayLabel = formatDelayLabel(delay);
  const hasCompareRow = entry.live != null && sched != null;
  const targetStopName = journey.userStop?.name ?? 'Your stop';

  // ETA shown on the user's stop node.
  const etaText = isArrived
    ? 'Now'
    : isArriving && minutes <= 0
      ? 'Soon'
      : `${minutes} min`;

  // Bus-node subline: motion + speed/dwell + stops-away.
  const busSub = useMemo(() => {
    const parts: string[] = [];
    if (motion) parts.push(motion.label);
    if (motion && (motion.kind === 'moving' || motion.kind === 'slow')) {
      if (history.effectiveSpeedKmh != null && history.effectiveSpeedKmh >= 1) {
        parts.push(
          `${history.speedIsEstimated ? '~' : ''}${Math.round(history.effectiveSpeedKmh)} km/h`,
        );
      }
    } else if (
      (motion?.kind === 'stopped' || motion?.kind === 'at-signal') &&
      history.dwellSeconds != null &&
      history.dwellSeconds >= 5
    ) {
      parts.push(formatDwell(history.dwellSeconds));
    }
    if (journey.stopsAhead != null) {
      parts.push(
        journey.stopsAhead <= 1
          ? 'next stop is yours'
          : `${journey.stopsAhead} stops away`,
      );
    }
    return parts.join('  ·  ');
  }, [motion, history.effectiveSpeedKmh, history.speedIsEstimated, history.dwellSeconds, journey.stopsAhead]);

  // Build the collapsed display list of intermediate stops.
  const visibleUpcoming = useMemo(
    () => collapseUpcoming(journey.upcoming),
    [journey.upcoming],
  );

  const showBusNode = isLive && journey.busStop != null;
  const tone = motion ? MOTION_TONE[motion.kind] : null;

  // Flatten the timeline into ordered rows so first/last (rail caps) are
  // correct regardless of which nodes are present.
  const rows: Array<{ key: string; marker: ReactNode; body: ReactNode }> = [];
  if (showBusNode) {
    rows.push({
      key: 'bus',
      marker: <BusMarker color={accent} />,
      body: (
        <>
          <Text style={styles.busTitle} selectable numberOfLines={1}>
            {routeLabel} bus
          </Text>
          {busSub ? (
            <Text
              style={[styles.busSub, tone ? { color: tone.fg } : null]}
              selectable
              numberOfLines={1}
            >
              {busSub}
            </Text>
          ) : null}
        </>
      ),
    });
  } else if (!journey.ready) {
    rows.push({
      key: 'locating',
      marker: <DotMarker muted />,
      body: (
        <Text style={styles.stopName} selectable numberOfLines={1}>
          {isLive ? 'Locating bus on route…' : 'Timetable service'}
        </Text>
      ),
    });
  }
  visibleUpcoming.forEach((item, idx) => {
    if (item.kind === 'more') {
      rows.push({
        key: `more-${idx}`,
        marker: <MoreMarker />,
        body: (
          <Text style={styles.moreText} selectable numberOfLines={1}>
            +{item.count} stops
          </Text>
        ),
      });
    } else {
      rows.push({
        key: `${item.node.stopId}-${item.node.sequence}`,
        marker: <DotMarker />,
        body: (
          <Text style={styles.stopName} selectable numberOfLines={1}>
            {item.node.name}
          </Text>
        ),
      });
    }
  });
  if (journey.userStop) {
    rows.push({
      key: 'user',
      marker: <UserMarker color={accent} />,
      body: (
        <View style={styles.userRow}>
          <View style={styles.userTextCol}>
            <Text style={styles.userName} selectable numberOfLines={1}>
              {journey.userStop.name}
            </Text>
            <Text style={styles.userSub} selectable numberOfLines={1}>
              your stop
            </Text>
          </View>
          <View
            style={[
              styles.etaPill,
              { borderColor: `${accent}66`, backgroundColor: `${accent}24` },
            ]}
          >
            <Text
              style={[styles.etaText, { color: accent }]}
              selectable
              allowFontScaling={false}
            >
              {etaText}
            </Text>
          </View>
        </View>
      ),
    });
  }

  return (
    <Animated.View layout={LinearTransition.duration(220)} style={styles.shadow}>
      <GlassGuard
        glassEffectStyle="regular"
        style={[styles.card, !isGlassAvailable() && styles.cardFallback]}
      >
        {/* Header */}
        <View style={styles.header}>
          <StatusHeader
            isLive={isLive}
            isStale={isStale}
            lastUpdated={lastUpdated}
            nextRefreshAt={nextRefreshAt}
            isRefreshing={isRefreshing}
            arrivalStatus={arrivalStatus}
            accent={accent}
          />
          {isWalking ? (
            <Chip
              icon="figure.walk"
              color="#0A84FF"
              text={formatWalkRemaining(walkRemainingSeconds ?? 0)}
            />
          ) : hasCompareRow && delayLabel ? (
            <DelayPill label={delayLabel} />
          ) : null}
        </View>

        <View style={styles.arrivalBoard}>
          <View style={styles.arrivalTextCol}>
            <Text style={styles.routeKicker} selectable numberOfLines={1}>
              {routeLabel} journey
            </Text>
            <Text
              style={styles.targetStop}
              selectable
              numberOfLines={2}
              adjustsFontSizeToFit
              minimumFontScale={0.82}
            >
              {targetStopName}
            </Text>
          </View>
          <View
            style={[
              styles.arrivalBadge,
              { borderColor: `${accent}66`, backgroundColor: `${accent}24` },
            ]}
          >
            <Text
              style={[styles.arrivalValue, { color: accent }]}
              selectable
              allowFontScaling={false}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
              numberOfLines={1}
            >
              {etaText}
            </Text>
            <Text style={[styles.arrivalUnit, { color: accent }]} selectable>
              ETA
            </Text>
          </View>
        </View>

        {/* Journey line */}
        <View style={styles.timeline}>
          {rows.map((r, i) => (
            <TimelineRow
              key={r.key}
              isFirst={i === 0}
              isLast={i === rows.length - 1}
              marker={r.marker}
            >
              {r.body}
            </TimelineRow>
          ))}
        </View>
      </GlassGuard>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Timeline row + markers
// ---------------------------------------------------------------------------

const RAIL_X = 15;
const RAIL_W = 2;

function TimelineRow({
  isFirst,
  isLast,
  marker,
  railColor,
  children,
}: {
  isFirst?: boolean;
  isLast?: boolean;
  marker: ReactNode;
  railColor?: string;
  children: ReactNode;
}) {
  return (
    <Animated.View entering={FadeIn.duration(220)} layout={LinearTransition.duration(220)} style={styles.row}>
      <View style={styles.rail}>
        {!isFirst ? (
          <View style={[styles.railLineTop, railColor ? { backgroundColor: railColor } : null]} />
        ) : null}
        {!isLast ? (
          <View style={[styles.railLineBottom, railColor ? { backgroundColor: railColor } : null]} />
        ) : null}
        <View style={styles.markerWrap}>{marker}</View>
      </View>
      <View style={styles.rowBody}>{children}</View>
    </Animated.View>
  );
}

function BusMarker({ color }: { color: string }) {
  return (
    <View style={[styles.busMarker, { backgroundColor: color }]}>
      <SymbolView name="bus.fill" size={13} tintColor="#FFFFFF" resizeMode="scaleAspectFit" />
    </View>
  );
}

function UserMarker({ color }: { color: string }) {
  return (
    <View style={[styles.userMarkerRing, { borderColor: color }]}>
      <View style={[styles.userMarkerDot, { backgroundColor: color }]} />
    </View>
  );
}

function DotMarker({ muted }: { muted?: boolean }) {
  return (
    <View
      style={[
        styles.dot,
        { backgroundColor: (muted ? PlatformColor('tertiaryLabel') : PlatformColor('secondaryLabel')) as unknown as string },
      ]}
    />
  );
}

function MoreMarker() {
  return <View style={styles.moreMarker} />;
}

// ---------------------------------------------------------------------------
// Status header
// ---------------------------------------------------------------------------

function StatusHeader({
  isLive,
  isStale,
  lastUpdated,
  nextRefreshAt,
  isRefreshing,
  arrivalStatus,
  accent,
}: {
  isLive: boolean;
  isStale: boolean;
  lastUpdated: number | null;
  nextRefreshAt: number | null;
  isRefreshing: boolean;
  arrivalStatus: ArrivalStatus;
  accent: string;
}) {
  const updated = useLastUpdatedLabel(lastUpdated);
  const countdown = useRefreshCountdownSeconds(nextRefreshAt);
  const effectivelyRefreshing = isRefreshing || (countdown != null && countdown === 0);
  const refreshLabel = countdown != null && countdown > 0 ? `next ${countdown}s` : null;

  const isArrived = arrivalStatus === 'arrived';
  const isArriving = arrivalStatus === 'arriving';
  const isPassed = arrivalStatus === 'passed';

  const primary = isPassed
    ? 'Passed'
    : isArrived
      ? 'Arrived'
      : isArriving
        ? 'Arriving'
        : effectivelyRefreshing
          ? 'Refreshing…'
          : isLive
            ? isStale
              ? 'Stale'
              : 'Live'
            : lastUpdated == null
              ? 'Waiting'
              : 'Timetable';

  const secondary = effectivelyRefreshing
    ? null
    : isLive && !isStale
      ? updated.shortLabel
      : refreshLabel;

  const dotStatic = !(isLive && !isStale && !isPassed && !isArrived);
  const remainingFraction =
    isLive && !isStale && countdown != null
      ? Math.max(0, Math.min(1, countdown / (glassTokens.pollIntervalMs / 1_000)))
      : null;

  return (
    <View style={styles.statusRow}>
      <RefreshRing
        remainingFraction={remainingFraction}
        color={accent}
        dotColor={accent}
        dotStatic={dotStatic}
        size={18}
      />
      <Text style={[styles.statusText, { color: accent }]} selectable>
        {primary}
      </Text>
      {isStale && isLive ? (
        <SymbolView name="exclamationmark.triangle.fill" size={10} tintColor={accent} weight="semibold" />
      ) : null}
      {secondary ? (
        <>
          <Text style={styles.statusDot}>·</Text>
          <Text style={styles.statusMeta} selectable numberOfLines={1}>
            {secondary}
          </Text>
        </>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Pills
// ---------------------------------------------------------------------------

function DelayPill({ label }: { label: { text: string; tone: DelayTone } }) {
  const { fg, icon } = DELAY_TONE[label.tone];
  return (
    <View style={[styles.pill, { borderColor: `${fg}59`, backgroundColor: `${fg}22` }]}>
      <SymbolView name={icon as Parameters<typeof SymbolView>[0]['name']} size={11} tintColor={fg} weight="semibold" />
      <Text style={[styles.pillText, { color: fg }]} selectable allowFontScaling={false}>
        {label.text}
      </Text>
    </View>
  );
}

function Chip({ icon, color, text }: { icon: string; color: string; text: string }) {
  return (
    <View style={[styles.pill, { borderColor: `${color}59`, backgroundColor: `${color}22` }]}>
      <SymbolView name={icon as Parameters<typeof SymbolView>[0]['name']} size={11} tintColor={color} weight="semibold" />
      <Text style={[styles.pillText, { color }]} selectable allowFontScaling={false} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

const DELAY_TONE: Record<DelayTone, { fg: string; icon: string }> = {
  'on-time': { fg: '#30D158', icon: 'checkmark.circle.fill' },
  late: { fg: '#FF9F0A', icon: 'clock.badge.exclamationmark.fill' },
  early: { fg: '#64D2FF', icon: 'clock.arrow.circlepath' },
};

const MOTION_TONE: Record<MotionStatus, { fg: string; icon: string }> = {
  'at-signal': { fg: '#FF453A', icon: 'hand.raised.fill' },
  stopped: { fg: '#8E8E93', icon: 'pause.fill' },
  slow: { fg: '#FF9F0A', icon: 'tortoise.fill' },
  moving: { fg: '#30D158', icon: 'speedometer' },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type UpcomingItem =
  | { kind: 'stop'; node: JourneyStopNode }
  | { kind: 'more'; count: number };

function collapseUpcoming(upcoming: JourneyStopNode[]): UpcomingItem[] {
  if (upcoming.length <= MAX_VISIBLE_UPCOMING) {
    return upcoming.map((node) => ({ kind: 'stop', node }));
  }
  const head = upcoming.slice(0, 2).map((node) => ({ kind: 'stop', node }) as UpcomingItem);
  const tail = upcoming.slice(-2).map((node) => ({ kind: 'stop', node }) as UpcomingItem);
  const hidden = upcoming.length - 4;
  return [...head, { kind: 'more', count: hidden }, ...tail];
}

function formatDwell(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  shadow: {
    borderRadius: glassTokens.cardRadius,
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.18)',
  },
  card: {
    borderRadius: glassTokens.cardRadius,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surfaceColor.hairline,
    paddingHorizontal: glassTokens.cardPadH,
    paddingTop: 14,
    paddingBottom: 16,
    overflow: 'hidden',
  },
  cardFallback: {
    backgroundColor: surfaceColor.grouped,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 14,
  },
  arrivalBoard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    paddingBottom: 14,
    marginBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: surfaceColor.hairline,
  },
  arrivalTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  routeKicker: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0,
    textTransform: 'uppercase',
    color: PlatformColor('tertiaryLabel'),
  },
  targetStop: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 0,
    color: PlatformColor('label'),
  },
  arrivalBadge: {
    minWidth: 92,
    maxWidth: 128,
    minHeight: 66,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  arrivalValue: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 0,
    fontVariant: ['tabular-nums'],
  },
  arrivalUnit: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0,
    textTransform: 'uppercase',
    opacity: 0.82,
  },
  timeline: {
    gap: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: 40,
  },
  rail: {
    width: 30,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  railLineTop: {
    position: 'absolute',
    top: 0,
    height: '50%',
    left: RAIL_X - RAIL_W / 2,
    width: RAIL_W,
    backgroundColor: surfaceColor.hairline as unknown as string,
  },
  railLineBottom: {
    position: 'absolute',
    bottom: 0,
    height: '50%',
    left: RAIL_X - RAIL_W / 2,
    width: RAIL_W,
    backgroundColor: surfaceColor.hairline as unknown as string,
  },
  markerWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 8,
    paddingLeft: 6,
  },
  busMarker: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
  },
  userMarkerRing: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userMarkerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
  },
  moreMarker: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: surfaceColor.hairline as unknown as string,
  },
  busTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: PlatformColor('label'),
    letterSpacing: 0,
  },
  busSub: {
    fontSize: 13,
    fontWeight: '500',
    color: PlatformColor('secondaryLabel'),
    fontVariant: ['tabular-nums'],
    marginTop: 1,
  },
  stopName: {
    fontSize: 15,
    fontWeight: '500',
    color: PlatformColor('label'),
  },
  moreText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
    color: PlatformColor('tertiaryLabel'),
    textTransform: 'uppercase',
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  userTextCol: {
    flex: 1,
    minWidth: 0,
  },
  userName: {
    fontSize: 18,
    fontWeight: '700',
    color: PlatformColor('label'),
    letterSpacing: 0,
  },
  userSub: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    color: PlatformColor('tertiaryLabel'),
    marginTop: 1,
  },
  etaPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  etaText: {
    fontSize: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    letterSpacing: 0,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flexShrink: 1,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  statusDot: {
    fontSize: 11,
    color: PlatformColor('tertiaryLabel'),
  },
  statusMeta: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: PlatformColor('tertiaryLabel'),
    flexShrink: 1,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.1,
    fontVariant: ['tabular-nums'],
  },
});
