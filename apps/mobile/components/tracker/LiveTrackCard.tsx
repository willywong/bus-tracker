import {
  getMotionStatus,
  type MotionStatus,
  type ScheduleDelay,
  type VehiclePosition,
} from '@bus-tracker/shared';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useState } from 'react';
import { PlatformColor, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  LinearTransition,
  SlideInDown,
  SlideOutUp,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { GlassGuard, isGlassAvailable } from '@/components/GlassGuard';
import { bearingToCardinal } from '@/components/map/format';
import { ApproachTrendChart } from '@/components/tracker/ApproachTrendChart';
import { RefreshRing } from '@/components/tracker/RefreshRing';
import {
  formatClockHHMM,
  formatDelayLabel,
  formatDistanceToStop,
  formatVehicleObservedAge,
  useLastUpdatedLabel,
  useRefreshCountdownSeconds,
  type ArrivalStatus,
  type DelayTone,
} from '@/components/tracker/logic';
import {
  glassTokens,
  sourceColor,
  surfaceColor,
  trackerSpacing,
  trendColor,
} from '@/components/tracker/tokens';
import { useApproachHistory, type ApproachTrend } from '@/hooks/useApproachHistory';
import type { TrafficSignalRow } from '@/db/queries';
import type { ApproachingBus, ArrivalEntry } from '@/hooks/useEta';

type TelemetryPosition = Pick<
  VehiclePosition,
  'speed' | 'bearing' | 'lat' | 'lng' | 'observedAt' | 'vehicleId'
>;

interface LiveTrackCardProps {
  entry: ArrivalEntry;
  livePosition: TelemetryPosition | undefined;
  /** Currently-tracked live vehicle, even when `entry` is scheduled. Mirrors the Map's `eta.current`. */
  liveCurrent?: ApproachingBus | null;
  /** VehiclePosition for `liveCurrent`. Fallback telemetry when `entry.live` is absent. */
  liveCurrentPosition?: TelemetryPosition | undefined;
  /** Live-vs-schedule delay for the primary bus. */
  delay: ScheduleDelay | null;
  isStale: boolean;
  lastUpdated: number | null;
  nextRefreshAt: number | null;
  isRefreshing: boolean;
  /** Total polyline length (meters). Drives the approach rail; null hides it. */
  polylineMeters: number | null;
  trafficSignals: readonly TrafficSignalRow[];
  arrivalStatus: ArrivalStatus;
  nextEntry?: ArrivalEntry | null;
  nextLivePosition?: Pick<VehiclePosition, 'speed'> | undefined;
}

const RAIL_ACCENT = '#0A84FF';

export function LiveTrackCard({
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
}: LiveTrackCardProps) {
  const entryLive = entry.live;
  const sched = entry.sched;

  // Back-fill the live view from `eta.current` when the primary timeline row is
  // scheduled but a live vehicle is actually being tracked (duplicate loop rows,
  // or the traffic-ETA race on first mount). Mirrors the Map card so the same
  // GTFS feed drives both screens together.
  const effectiveLive = entryLive ?? liveCurrent ?? null;
  const effectivePosition = livePosition ?? liveCurrentPosition;
  const hasTrackedLive =
    effectiveLive != null && effectivePosition != null && !isStale;
  const isLive = (entry.kind === 'live' && entryLive != null) || hasTrackedLive;
  const isArrived = arrivalStatus === 'arrived';
  const isArriving = arrivalStatus === 'arriving';
  const isPassed = arrivalStatus === 'passed';

  // Rolling telemetry history → trend / dwell / effective speed.
  const history = useApproachHistory({
    vehicleId: isLive ? (effectiveLive?.vehicleId ?? null) : null,
    forwardMeters: effectiveLive?.forwardMeters ?? null,
    minutesToStop: effectiveLive?.minutesToStop ?? null,
    speedKmh: effectivePosition?.speed ?? effectiveLive?.speedKmh ?? null,
    observedAt: effectivePosition?.observedAt ?? null,
    isStale,
  });

  // Headline countdown reflects the primary arrival's own trip.
  const minutes =
    entry.live?.minutesToStop != null
      ? entry.live.minutesToStop
      : Math.max(0, Math.round((entry.epochMs - Date.now()) / 60_000));

  const eyebrow = isPassed
    ? 'PREVIOUS BUS PASSED · NEXT IN'
    : isArrived
      ? 'ARRIVED'
      : isArriving
        ? 'ARRIVING'
        : isLive && minutes <= 0
          ? 'ARRIVING NOW'
          : 'ARRIVING IN';

  const projectedClock = formatClockHHMM(entry.epochMs);
  const inlineClockLabel =
    minutes <= 0 || isArrived
      ? null
      : entry.live != null
        ? `Arrives ${projectedClock}`
        : `at ${projectedClock}`;

  const motion = useMemo(() => {
    if (!isLive) return null;
    return getMotionStatus({
      speedKmh: history.effectiveSpeedKmh ?? effectivePosition?.speed,
      position:
        effectivePosition?.lat != null && effectivePosition?.lng != null
          ? { lat: effectivePosition.lat, lng: effectivePosition.lng }
          : null,
      signals: trafficSignals.map((s) => ({
        id: s.osm_id,
        lat: s.lat,
        lng: s.lng,
      })),
    });
  }, [
    isLive,
    history.effectiveSpeedKmh,
    effectivePosition?.speed,
    effectivePosition?.lat,
    effectivePosition?.lng,
    trafficSignals,
  ]);

  // Progress = 1 − (distance-to-stop / route length), clamped to [0, 1].
  const progress = useMemo(() => {
    const m = effectiveLive?.forwardMeters;
    if (!isLive || m == null || !polylineMeters || polylineMeters <= 0) {
      return null;
    }
    return Math.max(0, Math.min(1, 1 - m / polylineMeters));
  }, [isLive, effectiveLive?.forwardMeters, polylineMeters]);

  const delayLabel = formatDelayLabel(delay);
  const schedClock = sched ? formatClockHHMM(sched.departureEpochMs) : null;
  const liveProjectedClock = entry.live != null && sched ? projectedClock : null;
  const hasCompareRow = entry.live != null && sched != null;
  const showInlineClock =
    inlineClockLabel != null && !(hasCompareRow && liveProjectedClock != null);

  // Telemetry tray cells — distance + speed live in the motion row, so the tray
  // carries the supporting identity/heading/freshness data.
  const vehicleAge = useVehicleAge(effectivePosition?.observedAt ?? null);
  const infoCells = useMemo(() => {
    if (!isLive) return [] as InfoCellData[];
    const cells: InfoCellData[] = [];
    const heading = bearingToCardinal(effectivePosition?.bearing);
    if (heading) {
      const rotation =
        typeof effectivePosition?.bearing === 'number' &&
        Number.isFinite(effectivePosition.bearing)
          ? effectivePosition.bearing
          : undefined;
      cells.push({
        key: 'heading',
        label: 'Heading',
        value: heading,
        icon: 'location.north.line.fill',
        iconRotation: rotation,
      });
    }
    if (effectivePosition?.vehicleId != null) {
      cells.push({
        key: 'vehicle',
        label: 'Vehicle',
        value: effectivePosition.vehicleId,
      });
    }
    if (vehicleAge) {
      cells.push({ key: 'age', label: 'Last ping', value: vehicleAge });
    }
    return cells;
  }, [
    isLive,
    effectivePosition?.bearing,
    effectivePosition?.vehicleId,
    vehicleAge,
  ]);

  const showTrend = isLive && history.samples.length > 0;
  const showTray = isLive && infoCells.length > 0;

  return (
    <Animated.View layout={LinearTransition.duration(220)} style={styles.shadow}>
      <GlassGuard
        glassEffectStyle="regular"
        style={[styles.card, !isGlassAvailable() && styles.cardFallback]}
      >
        <View style={styles.sectionPad}>
          <LiveHeader
            isLive={isLive}
            isStale={isStale}
            lastUpdated={lastUpdated}
            nextRefreshAt={nextRefreshAt}
            isRefreshing={isRefreshing}
            arrivalStatus={arrivalStatus}
          />
        </View>

        <Divider />

        <View style={styles.sectionPad}>
          <View style={styles.eyebrowRow}>
            <Text style={styles.eyebrow} selectable>
              {eyebrow}
            </Text>
            {hasCompareRow && schedClock ? (
              <ScheduleTimes
                schedClock={schedClock}
                liveClock={liveProjectedClock}
                showArrow={delayLabel != null && delayLabel.tone !== 'on-time'}
              />
            ) : null}
          </View>
          <View style={styles.arrivalRow}>
            <View style={styles.valueBlock}>
              {isArrived ? (
                <Animated.Text
                  key="arrived"
                  entering={SlideInDown.duration(260).easing(Easing.out(Easing.cubic))}
                  style={[styles.value, styles.valueArrived]}
                  selectable
                  allowFontScaling={false}
                >
                  Now
                </Animated.Text>
              ) : (
                <>
                  <Animated.Text
                    key={`${minutes}-${entry.kind}`}
                    entering={SlideInDown.duration(260).easing(Easing.out(Easing.cubic))}
                    exiting={SlideOutUp.duration(180).easing(Easing.in(Easing.cubic))}
                    style={[styles.value, isArriving ? styles.valueArriving : null]}
                    selectable
                    allowFontScaling={false}
                  >
                    {minutes}
                  </Animated.Text>
                  <Text
                    style={[styles.unit, isArriving ? styles.valueArriving : null]}
                    selectable
                  >
                    min
                  </Text>
                </>
              )}
            </View>

            {hasCompareRow && delayLabel ? (
              <DelayText label={delayLabel} />
            ) : showInlineClock ? (
              <Text
                style={styles.inlineClock}
                selectable
                numberOfLines={1}
                allowFontScaling={false}
              >
                {inlineClockLabel}
              </Text>
            ) : null}
          </View>
        </View>

        {showTrend ? (
          <>
            <Divider />
            <View style={styles.sectionPad}>
              <View style={styles.trendHeader}>
                <Text style={styles.eyebrow} selectable>
                  LIVE APPROACH
                </Text>
                <TrendCaption trend={history.trend} isStale={isStale} />
              </View>
              <ApproachTrendChart samples={history.samples} trend={history.trend} />
            </View>
          </>
        ) : null}

        {progress != null ? (
          <>
            <Divider />
            <View style={styles.sectionPad}>
              <ApproachRail progress={progress} isStale={isStale} />
            </View>
          </>
        ) : null}

        {motion ? (
          <>
            <Divider />
            <View style={styles.sectionPad}>
              <MotionRow
                motion={motion}
                dwellSeconds={history.dwellSeconds}
                effectiveSpeedKmh={history.effectiveSpeedKmh}
                speedIsEstimated={history.speedIsEstimated}
                forwardMeters={effectiveLive?.forwardMeters ?? null}
                isStale={isStale}
              />
            </View>
          </>
        ) : null}

        {showTray ? (
          <>
            <Divider />
            <View style={styles.sectionPad}>
              <InfoTray cells={infoCells} />
            </View>
          </>
        ) : null}

        {nextEntry ? (
          <NextBusSection entry={nextEntry} livePosition={nextLivePosition} />
        ) : null}
      </GlassGuard>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Live header — refresh ring + status word + next-update countdown.
// ---------------------------------------------------------------------------

function LiveHeader({
  isLive,
  isStale,
  lastUpdated,
  nextRefreshAt,
  isRefreshing,
  arrivalStatus,
}: {
  isLive: boolean;
  isStale: boolean;
  lastUpdated: number | null;
  nextRefreshAt: number | null;
  isRefreshing: boolean;
  arrivalStatus: ArrivalStatus;
}) {
  const updated = useLastUpdatedLabel(lastUpdated);
  const countdown = useRefreshCountdownSeconds(nextRefreshAt);

  const effectivelyRefreshing =
    isRefreshing || (countdown != null && countdown === 0);
  const refreshLabel =
    countdown != null && countdown > 0 ? `next update ${countdown}s` : null;

  const isArrived = arrivalStatus === 'arrived';
  const isArriving = arrivalStatus === 'arriving';
  const isPassed = arrivalStatus === 'passed';

  const tone = isPassed
    ? 'passed'
    : isArrived
      ? 'arrived'
      : isArriving
        ? 'arriving'
        : effectivelyRefreshing
          ? 'live'
          : isLive
            ? isStale
              ? 'stale'
              : 'live'
            : 'neutral';

  const accent =
    tone === 'arrived'
      ? '#30D158'
      : tone === 'arriving'
        ? '#FF9F0A'
        : tone === 'live'
          ? sourceColor.live
          : tone === 'stale'
            ? sourceColor.stale
            : tone === 'passed'
              ? sourceColor.scheduled
              : (PlatformColor('tertiaryLabel') as unknown as string);

  const dotStatic = tone !== 'live' && tone !== 'arriving';

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
              ? 'Waiting for live data'
              : 'Timetable';

  const secondary = effectivelyRefreshing
    ? null
    : isLive && !isStale
      ? updated.shortLabel
      : refreshLabel;

  // The ring sweeps over the poll window; hide it when we're not polling live.
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
      />
      <Text style={[styles.statusText, { color: accent }]} selectable>
        {primary}
      </Text>
      {tone === 'stale' ? (
        <SymbolView
          name="exclamationmark.triangle.fill"
          size={11}
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
// Motion row — state + dwell time + effective speed + distance.
// ---------------------------------------------------------------------------

function MotionRow({
  motion,
  dwellSeconds,
  effectiveSpeedKmh,
  speedIsEstimated,
  forwardMeters,
  isStale,
}: {
  motion: NonNullable<ReturnType<typeof getMotionStatus>>;
  dwellSeconds: number | null;
  effectiveSpeedKmh: number | null;
  speedIsEstimated: boolean;
  forwardMeters: number | null;
  isStale: boolean;
}) {
  const tone = MOTION_TONE[motion.kind];
  const isHalted = motion.kind === 'stopped' || motion.kind === 'at-signal';

  const parts: string[] = [];
  if (isHalted && dwellSeconds != null && dwellSeconds >= 5) {
    parts.push(formatDwell(dwellSeconds));
  }
  if (
    !isHalted &&
    effectiveSpeedKmh != null &&
    Number.isFinite(effectiveSpeedKmh) &&
    effectiveSpeedKmh >= 1
  ) {
    parts.push(
      `${speedIsEstimated ? '~' : ''}${Math.round(effectiveSpeedKmh)} km/h`,
    );
  }
  const distance = formatDistanceToStop(forwardMeters);
  if (distance) parts.push(distance);

  return (
    <Animated.View
      key={motion.kind}
      entering={FadeIn.duration(220)}
      style={[styles.motionRow, isStale ? styles.motionStale : null]}
    >
      <SymbolView
        name={tone.icon as Parameters<typeof SymbolView>[0]['name']}
        size={14}
        tintColor={tone.fg}
        weight="semibold"
      />
      <Text
        style={[styles.motionText, { color: tone.fg }]}
        selectable
        numberOfLines={1}
        allowFontScaling={false}
      >
        {motion.label}
      </Text>
      {parts.length > 0 ? (
        <Text
          style={styles.motionMeta}
          selectable
          numberOfLines={1}
          allowFontScaling={false}
        >
          {`  ·  ${parts.join('  ·  ')}`}
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
// Approach rail
// ---------------------------------------------------------------------------

const BUS_MARKER_SIZE = 24;

function ApproachRail({ progress, isStale }: { progress: number; isStale: boolean }) {
  const p = useSharedValue(progress);
  useEffect(() => {
    p.value = withTiming(progress, {
      duration: 300,
      easing: Easing.out(Easing.cubic),
    });
  }, [p, progress]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${p.value * 100}%` }));
  const busStyle = useAnimatedStyle(() => ({ left: `${p.value * 100}%` }));

  return (
    <View style={[styles.railRow, isStale ? styles.railRowStale : null]}>
      <View style={styles.rail}>
        <View style={styles.railTrack} />
        <Animated.View style={[styles.railFill, fillStyle]} />
        <Animated.View style={[styles.railBus, busStyle]}>
          <View style={styles.busMarker}>
            <SymbolView
              name="bus.fill"
              size={12}
              tintColor="#FFFFFF"
              resizeMode="scaleAspectFit"
            />
          </View>
        </Animated.View>
      </View>
      <SymbolView
        name="signpost.right.fill"
        size={22}
        tintColor={sourceColor.live}
        resizeMode="scaleAspectFit"
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Schedule times + delay
// ---------------------------------------------------------------------------

function ScheduleTimes({
  schedClock,
  liveClock,
  showArrow,
}: {
  schedClock: string;
  liveClock: string | null;
  showArrow: boolean;
}) {
  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      style={styles.schedTimes}
      layout={LinearTransition.duration(220)}
    >
      <Text style={styles.schedLabel} selectable>
        Scheduled
      </Text>
      <Text style={styles.schedClock} selectable allowFontScaling={false}>
        {schedClock}
      </Text>
      {showArrow && liveClock != null ? (
        <>
          <SymbolView
            name="arrow.right"
            size={11}
            tintColor={PlatformColor('tertiaryLabel') as unknown as string}
            weight="semibold"
          />
          <Text style={styles.schedLiveClock} selectable allowFontScaling={false}>
            {liveClock}
          </Text>
        </>
      ) : null}
    </Animated.View>
  );
}

function DelayText({ label }: { label: { text: string; tone: DelayTone } }) {
  const { text, tone } = label;
  const { fg, icon } = DELAY_TONE[tone];
  return (
    <View style={styles.delayRow}>
      <SymbolView
        name={icon as Parameters<typeof SymbolView>[0]['name']}
        size={12}
        tintColor={fg}
        weight="semibold"
      />
      <Text style={[styles.delayText, { color: fg }]} selectable allowFontScaling={false}>
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
// Info tray
// ---------------------------------------------------------------------------

interface InfoCellData {
  key: string;
  label: string;
  value: string;
  icon?: string;
  iconRotation?: number;
}

function InfoTray({ cells }: { cells: InfoCellData[] }) {
  const rows = useMemo(() => {
    const out: InfoCellData[][] = [];
    for (let i = 0; i < cells.length; i += 2) out.push(cells.slice(i, i + 2));
    return out;
  }, [cells]);

  if (rows.length === 0) return null;
  return (
    <View style={styles.infoGrid}>
      {rows.map((row, rowIdx) => (
        <View key={`row-${rowIdx}`} style={styles.infoRow}>
          {row.map((cell) => (
            <InfoCell key={cell.key} cell={cell} />
          ))}
          {row.length === 1 ? <View style={styles.infoCell} /> : null}
        </View>
      ))}
    </View>
  );
}

function InfoCell({ cell }: { cell: InfoCellData }) {
  return (
    <View style={styles.infoCell}>
      <Text style={styles.infoLabel} selectable allowFontScaling={false}>
        {cell.label}
      </Text>
      <View style={styles.infoValueRow}>
        {cell.icon ? (
          <SymbolView
            name={cell.icon as Parameters<typeof SymbolView>[0]['name']}
            size={13}
            tintColor={PlatformColor('label') as unknown as string}
            weight="semibold"
            style={
              cell.iconRotation != null
                ? { transform: [{ rotate: `${cell.iconRotation}deg` }] }
                : undefined
            }
          />
        ) : null}
        <Text style={styles.infoValue} selectable allowFontScaling={false}>
          {cell.value}
        </Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Next bus footer
// ---------------------------------------------------------------------------

function NextBusSection({
  entry,
  livePosition,
}: {
  entry: ArrivalEntry;
  livePosition?: Pick<VehiclePosition, 'speed'> | undefined;
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
  const tagText = isLive ? (speedText ? `Live · ${speedText}` : 'Live') : null;

  return (
    <>
      <Divider />
      <View style={styles.sectionPad}>
        <View style={styles.nextHeader}>
          <Text style={styles.eyebrow} selectable>
            NEXT BUS
          </Text>
          {tagText ? <NextTag text={tagText} /> : null}
        </View>
        <Text style={styles.nextLine} selectable numberOfLines={1} allowFontScaling={false}>
          <Text style={styles.nextWhen}>{whenText}</Text>
          <Text style={styles.nextSep}>{'  ·  '}</Text>
          <Text style={styles.nextClock}>at {clock}</Text>
        </Text>
      </View>
    </>
  );
}

function NextTag({ text }: { text: string }) {
  const fg = sourceColor.live;
  return (
    <View style={styles.nextTag}>
      <View style={[styles.nextTagDot, { backgroundColor: fg }]} />
      <Text style={[styles.nextTagText, { color: fg }]} selectable allowFontScaling={false}>
        {text}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

function Divider() {
  return <View style={styles.divider} />;
}

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
    overflow: 'hidden',
  },
  // When real Liquid Glass isn't available the GlassGuard renders a BlurView;
  // give it a translucent grouped fill so text stays legible on the canvas.
  cardFallback: {
    backgroundColor: surfaceColor.grouped,
  },
  sectionPad: {
    paddingVertical: trackerSpacing.cardSectionV,
    gap: 6,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: surfaceColor.hairline as unknown as string,
    marginHorizontal: -glassTokens.cardPadH,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  statusDot: {
    fontSize: 11,
    color: PlatformColor('tertiaryLabel'),
  },
  statusMeta: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: PlatformColor('tertiaryLabel'),
    flexShrink: 1,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    color: PlatformColor('secondaryLabel'),
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  arrivalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  valueBlock: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  value: {
    fontSize: 40,
    fontWeight: '700',
    lineHeight: 44,
    color: PlatformColor('label'),
    fontVariant: ['tabular-nums'],
    letterSpacing: -1.4,
  },
  valueArrived: {
    color: '#30D158',
    fontSize: 34,
    letterSpacing: -0.6,
  },
  valueArriving: {
    color: '#FF9F0A',
  },
  unit: {
    fontSize: 14,
    fontWeight: '500',
    color: PlatformColor('secondaryLabel'),
  },
  inlineClock: {
    fontSize: 15,
    fontWeight: '500',
    color: PlatformColor('secondaryLabel'),
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.1,
    flexShrink: 1,
  },
  trendHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  trendCaption: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.1,
    flexShrink: 1,
  },
  motionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  motionStale: {
    opacity: 0.6,
  },
  motionText: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  motionMeta: {
    fontSize: 14,
    fontWeight: '500',
    color: PlatformColor('secondaryLabel'),
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.1,
    flexShrink: 1,
  },
  schedTimes: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexShrink: 1,
  },
  schedLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: PlatformColor('tertiaryLabel'),
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  schedClock: {
    fontSize: 13,
    fontWeight: '500',
    color: PlatformColor('secondaryLabel'),
    fontVariant: ['tabular-nums'],
  },
  schedLiveClock: {
    fontSize: 13,
    fontWeight: '600',
    color: PlatformColor('label'),
    fontVariant: ['tabular-nums'],
  },
  delayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  delayText: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.1,
    fontVariant: ['tabular-nums'],
  },
  infoGrid: {
    gap: 14,
  },
  infoRow: {
    flexDirection: 'row',
    gap: 16,
  },
  infoCell: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  infoLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: PlatformColor('tertiaryLabel'),
  },
  infoValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  infoValue: {
    fontSize: 15,
    fontWeight: '600',
    color: PlatformColor('label'),
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.1,
    flexShrink: 1,
  },
  nextHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  nextLine: {
    fontSize: 15,
    color: PlatformColor('label'),
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.1,
  },
  nextWhen: {
    fontWeight: '600',
  },
  nextSep: {
    color: PlatformColor('tertiaryLabel'),
  },
  nextClock: {
    fontWeight: '500',
    color: PlatformColor('secondaryLabel'),
  },
  nextTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(48,209,88,0.14)',
    borderColor: 'rgba(48,209,88,0.35)',
  },
  nextTagDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  nextTagText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    fontVariant: ['tabular-nums'],
  },
  railRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: BUS_MARKER_SIZE,
  },
  railRowStale: {
    opacity: 0.55,
  },
  rail: {
    flex: 1,
    height: BUS_MARKER_SIZE,
    justifyContent: 'center',
  },
  railTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: BUS_MARKER_SIZE / 2 - 1,
    height: 2,
    borderRadius: 1,
    backgroundColor: surfaceColor.hairline as unknown as string,
  },
  railFill: {
    position: 'absolute',
    left: 0,
    top: BUS_MARKER_SIZE / 2 - 1,
    height: 2,
    borderRadius: 1,
    backgroundColor: RAIL_ACCENT,
  },
  railBus: {
    position: 'absolute',
    top: 0,
    marginLeft: -BUS_MARKER_SIZE / 2,
  },
  busMarker: {
    width: BUS_MARKER_SIZE,
    height: BUS_MARKER_SIZE,
    borderRadius: BUS_MARKER_SIZE / 2,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: RAIL_ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.25)',
  },
});
