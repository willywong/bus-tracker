import {
  getMotionStatus,
  type MotionStatus,
  type ScheduleDelay,
  type VehiclePosition,
} from '@bus-tracker/shared';
import { SymbolView } from 'expo-symbols';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { PlatformColor, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { GlassGuard, isGlassAvailable } from '@/components/GlassGuard';
import { bearingToCardinal } from '@/components/map/format';
import { ApproachTrendChart } from '@/components/tracker/ApproachTrendChart';
import { ProgressRing } from '@/components/tracker/ProgressRing';
import { RefreshRing } from '@/components/tracker/RefreshRing';
import {
  formatClockHHMM,
  formatDelayLabel,
  formatDistanceToStop,
  formatVehicleObservedAge,
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
  trendColor,
  type ScreenStatusKind,
} from '@/components/tracker/tokens';
import {
  useApproachHistory,
  type ApproachTrend,
} from '@/hooks/useApproachHistory';
import type { TrafficSignalRow } from '@/db/queries';
import type { ApproachingBus, ArrivalEntry } from '@/hooks/useEta';

type TelemetryPosition = Pick<
  VehiclePosition,
  'speed' | 'bearing' | 'lat' | 'lng' | 'observedAt' | 'vehicleId'
>;

interface LiveTrackBentoProps {
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
  nextEntry?: ArrivalEntry | null;
  nextLivePosition?: Pick<VehiclePosition, 'speed'> | undefined;
  /** Walk timer state — shows a walking chip and recolors the screen blue. */
  isWalking?: boolean;
  walkRemainingSeconds?: number | null;
  /** Reports the resolved screen status so the page can tint the aurora glow. */
  onStatusChange?: (kind: ScreenStatusKind) => void;
}

/** Rough cap (minutes) used to fill the ring when only a scheduled ETA exists. */
const SCHEDULE_RING_CAP_MIN = 20;

export function LiveTrackBento({
  entry,
  livePosition,
  liveCurrent,
  liveCurrentPosition,
  delay,
  isStale,
  lastUpdated,
  nextRefreshAt,
  isRefreshing,
  polylineMeters,
  trafficSignals,
  arrivalStatus,
  nextEntry,
  nextLivePosition,
  isWalking,
  walkRemainingSeconds,
  onStatusChange,
}: LiveTrackBentoProps) {
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

  const minutes =
    entry.live?.minutesToStop != null
      ? entry.live.minutesToStop
      : Math.max(0, Math.round((entry.epochMs - Date.now()) / 60_000));

  // Resolve the one status that drives the glow + ring color.
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

  // Ring progress: live → fraction of route covered; schedule → rough by minutes.
  const ringProgress = useMemo(() => {
    if (isLive && effectiveLive?.forwardMeters != null && polylineMeters && polylineMeters > 0) {
      return Math.max(0, Math.min(1, 1 - effectiveLive.forwardMeters / polylineMeters));
    }
    if (minutes != null) {
      return Math.max(0.04, Math.min(1, 1 - minutes / SCHEDULE_RING_CAP_MIN));
    }
    return 0;
  }, [isLive, effectiveLive?.forwardMeters, polylineMeters, minutes]);

  const ringCenter = isArrived
    ? { value: 'Now', unit: undefined }
    : isArriving && minutes <= 0
      ? { value: 'Soon', unit: undefined }
      : { value: `${minutes}`, unit: 'min' };

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
  const distance = isLive ? formatDistanceToStop(effectiveLive?.forwardMeters) : null;
  const heading = isLive ? bearingToCardinal(effectivePosition?.bearing) : null;
  const showTrend = isLive && history.samples.length > 0;
  const vehicleAge = useVehicleAge(effectivePosition?.observedAt ?? null);

  return (
    <View style={styles.grid}>
      {/* Row 1 — ring + live status */}
      <View style={styles.row}>
        <Tile style={styles.ringTile}>
          <ProgressRing
            progress={ringProgress}
            color={accent}
            centerValue={ringCenter.value}
            centerUnit={ringCenter.unit}
            label={isLive ? 'Approach' : 'Scheduled'}
            subdued={isStale}
          />
        </Tile>

        <Tile style={styles.statusTile}>
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
              text={`Walking · ${formatWalkRemaining(walkRemainingSeconds ?? 0)}`}
            />
          ) : null}

          {motion ? (
            <MotionLine
              motion={motion}
              dwellSeconds={history.dwellSeconds}
              effectiveSpeedKmh={history.effectiveSpeedKmh}
              speedIsEstimated={history.speedIsEstimated}
            />
          ) : (
            <Text style={styles.scheduleNote} selectable numberOfLines={1}>
              {entry.live == null ? 'Timetable service' : 'Waiting for live signal'}
            </Text>
          )}

          {showTrend ? (
            <TrendCaption trend={history.trend} isStale={isStale} />
          ) : null}

          {hasCompareRow && delayLabel ? <DelayPill label={delayLabel} /> : null}
        </Tile>
      </View>

      {/* Row 2 — live approach trend chart */}
      {showTrend ? (
        <Tile style={styles.wideTile}>
          <View style={styles.tileHeader}>
            <Text style={styles.tileLabel} selectable>
              LIVE APPROACH
            </Text>
            <Text style={styles.tileHeaderMeta} selectable numberOfLines={1}>
              {distance ? `${distance} to stop` : 'distance to stop'}
            </Text>
          </View>
          <ApproachTrendChart samples={history.samples} trend={history.trend} />
        </Tile>
      ) : null}

      {/* Row 3 — distance + next bus */}
      <View style={styles.row}>
        {distance ? (
          <Tile style={styles.halfTile}>
            <Text style={styles.tileLabel} selectable>
              DISTANCE
            </Text>
            <Text style={styles.bigStat} selectable allowFontScaling={false}>
              {distance}
            </Text>
            <Text style={styles.statSub} selectable numberOfLines={1}>
              {heading ? `to your stop · ${heading}` : 'to your stop'}
            </Text>
          </Tile>
        ) : null}

        {nextEntry ? (
          <NextBusTile entry={nextEntry} livePosition={nextLivePosition} full={!distance} />
        ) : null}
      </View>

      {/* Telemetry footnote */}
      {isLive && (effectivePosition?.vehicleId || vehicleAge) ? (
        <Text style={styles.telemetry} selectable numberOfLines={1} allowFontScaling={false}>
          {[effectivePosition?.vehicleId, vehicleAge].filter(Boolean).join('  ·  ')}
        </Text>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Tile wrapper
// ---------------------------------------------------------------------------

function Tile({
  children,
  style,
  tint,
}: {
  children: ReactNode;
  style?: object;
  tint?: string;
}) {
  return (
    <GlassGuard
      glassEffectStyle="regular"
      tintColor={tint}
      style={[styles.tile, !isGlassAvailable() && styles.tileFallback, style]}
    >
      {children}
    </GlassGuard>
  );
}

// ---------------------------------------------------------------------------
// Status header — freshness ring + word + meta
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
  const effectivelyRefreshing =
    isRefreshing || (countdown != null && countdown === 0);
  const refreshLabel =
    countdown != null && countdown > 0 ? `next ${countdown}s` : null;

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
        <SymbolView
          name="exclamationmark.triangle.fill"
          size={10}
          tintColor={accent}
          weight="semibold"
        />
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
// Motion line
// ---------------------------------------------------------------------------

function MotionLine({
  motion,
  dwellSeconds,
  effectiveSpeedKmh,
  speedIsEstimated,
}: {
  motion: NonNullable<ReturnType<typeof getMotionStatus>>;
  dwellSeconds: number | null;
  effectiveSpeedKmh: number | null;
  speedIsEstimated: boolean;
}) {
  const tone = MOTION_TONE[motion.kind];
  const isHalted = motion.kind === 'stopped' || motion.kind === 'at-signal';
  let meta: string | null = null;
  if (isHalted && dwellSeconds != null && dwellSeconds >= 5) {
    meta = formatDwell(dwellSeconds);
  } else if (
    !isHalted &&
    effectiveSpeedKmh != null &&
    Number.isFinite(effectiveSpeedKmh) &&
    effectiveSpeedKmh >= 1
  ) {
    meta = `${speedIsEstimated ? '~' : ''}${Math.round(effectiveSpeedKmh)} km/h`;
  }

  return (
    <Animated.View key={motion.kind} entering={FadeIn.duration(220)} style={styles.motionRow}>
      <SymbolView
        name={tone.icon as Parameters<typeof SymbolView>[0]['name']}
        size={16}
        tintColor={tone.fg}
        weight="semibold"
      />
      <Text style={[styles.motionText, { color: tone.fg }]} selectable numberOfLines={1} allowFontScaling={false}>
        {motion.label}
      </Text>
      {meta ? (
        <Text style={styles.motionMeta} selectable numberOfLines={1} allowFontScaling={false}>
          {`  ·  ${meta}`}
        </Text>
      ) : null}
    </Animated.View>
  );
}

const MOTION_TONE: Record<MotionStatus, { fg: string; icon: string }> = {
  'at-signal': { fg: '#FF453A', icon: 'hand.raised.fill' },
  stopped: { fg: '#8E8E93', icon: 'pause.fill' },
  slow: { fg: '#FF9F0A', icon: 'tortoise.fill' },
  moving: { fg: '#30D158', icon: 'speedometer' },
};

function formatDwell(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

// ---------------------------------------------------------------------------
// Trend caption
// ---------------------------------------------------------------------------

const TREND_COPY: Record<ApproachTrend, string> = {
  approaching: 'ETA falling steadily',
  holding: 'Holding — not getting closer',
  slipping: 'Bus moving away',
  unknown: 'Gathering live signal…',
};

function TrendCaption({ trend, isStale }: { trend: ApproachTrend; isStale: boolean }) {
  const color = isStale
    ? (PlatformColor('tertiaryLabel') as unknown as string)
    : (trendColor[trend] ?? trendColor.unknown);
  return (
    <Animated.Text
      key={trend}
      entering={FadeIn.duration(220)}
      style={[styles.trendCaption, { color }]}
      selectable
      numberOfLines={1}
      allowFontScaling={false}
    >
      {TREND_COPY[trend]}
    </Animated.Text>
  );
}

// ---------------------------------------------------------------------------
// Delay pill + walking chip
// ---------------------------------------------------------------------------

function DelayPill({ label }: { label: { text: string; tone: DelayTone } }) {
  const { fg, icon } = DELAY_TONE[label.tone];
  return (
    <View style={[styles.pill, { borderColor: `${fg}59`, backgroundColor: `${fg}22` }]}>
      <SymbolView
        name={icon as Parameters<typeof SymbolView>[0]['name']}
        size={11}
        tintColor={fg}
        weight="semibold"
      />
      <Text style={[styles.pillText, { color: fg }]} selectable allowFontScaling={false}>
        {label.text}
      </Text>
    </View>
  );
}

function Chip({ icon, color, text }: { icon: string; color: string; text: string }) {
  return (
    <View style={[styles.pill, { borderColor: `${color}59`, backgroundColor: `${color}22` }]}>
      <SymbolView
        name={icon as Parameters<typeof SymbolView>[0]['name']}
        size={11}
        tintColor={color}
        weight="semibold"
      />
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

// ---------------------------------------------------------------------------
// Next bus tile
// ---------------------------------------------------------------------------

function NextBusTile({
  entry,
  livePosition,
  full,
}: {
  entry: ArrivalEntry;
  livePosition?: Pick<VehiclePosition, 'speed'> | undefined;
  full?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  const isLive = entry.kind === 'live' && entry.live != null;
  const minutesFromNow = Math.max(0, Math.round((entry.epochMs - now) / 60_000));
  const whenText =
    minutesFromNow <= 0
      ? 'arriving now'
      : minutesFromNow < 60
        ? `in ${minutesFromNow} min`
        : (() => {
            const h = Math.floor(minutesFromNow / 60);
            const m = minutesFromNow % 60;
            return m === 0 ? `in ${h}h` : `in ${h}h ${m}m`;
          })();
  const clock = formatClockHHMM(entry.epochMs);
  const speedText =
    isLive && livePosition?.speed != null && Number.isFinite(livePosition.speed)
      ? `${Math.round(livePosition.speed)} km/h`
      : null;

  return (
    <Tile style={[styles.halfTile, full && styles.fullTile]}>
      <View style={styles.tileHeader}>
        <Text style={styles.tileLabel} selectable>
          NEXT BUS
        </Text>
        {isLive ? (
          <View style={styles.liveTag}>
            <View style={styles.liveTagDot} />
            <Text style={styles.liveTagText} selectable allowFontScaling={false}>
              {speedText ?? 'Live'}
            </Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.bigStat} selectable allowFontScaling={false}>
        {whenText}
      </Text>
      <Text style={styles.statSub} selectable numberOfLines={1}>
        at {clock}
      </Text>
    </Tile>
  );
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

function useVehicleAge(observedAtMs: number | null): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (observedAtMs == null) return;
    const t = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(t);
  }, [observedAtMs]);
  return formatVehicleObservedAge(observedAtMs, now);
}

const styles = StyleSheet.create({
  grid: {
    gap: bentoTokens.gap,
  },
  row: {
    flexDirection: 'row',
    gap: bentoTokens.gap,
    alignItems: 'stretch',
  },
  tile: {
    borderRadius: bentoTokens.tileRadius,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surfaceColor.hairline,
    padding: bentoTokens.tilePad,
    overflow: 'hidden',
  },
  tileFallback: {
    backgroundColor: surfaceColor.grouped,
  },
  ringTile: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
  },
  statusTile: {
    flex: 1,
    justifyContent: 'center',
    gap: 8,
  },
  wideTile: {
    gap: 6,
  },
  halfTile: {
    flex: 1,
    gap: 3,
    minHeight: 92,
    justifyContent: 'center',
  },
  fullTile: {
    flex: 1,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
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
  scheduleNote: {
    fontSize: 14,
    fontWeight: '500',
    color: PlatformColor('secondaryLabel'),
  },
  motionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  motionText: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  motionMeta: {
    fontSize: 14,
    fontWeight: '500',
    color: PlatformColor('secondaryLabel'),
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
  },
  trendCaption: {
    fontSize: 12.5,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
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
  tileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  tileLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: PlatformColor('tertiaryLabel'),
  },
  tileHeaderMeta: {
    fontSize: 11,
    fontWeight: '500',
    color: PlatformColor('secondaryLabel'),
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
  },
  bigStat: {
    fontSize: 24,
    fontWeight: '700',
    color: PlatformColor('label'),
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.6,
    marginTop: 2,
  },
  statSub: {
    fontSize: 12,
    fontWeight: '500',
    color: PlatformColor('secondaryLabel'),
  },
  liveTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(48,209,88,0.14)',
    borderColor: 'rgba(48,209,88,0.35)',
  },
  liveTagDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#30D158',
  },
  liveTagText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: '#30D158',
    fontVariant: ['tabular-nums'],
  },
  telemetry: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.3,
    color: PlatformColor('tertiaryLabel'),
    textAlign: 'center',
    paddingTop: 2,
  },
});
