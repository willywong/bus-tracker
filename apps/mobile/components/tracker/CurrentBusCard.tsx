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

import { bearingToCardinal } from '@/components/map/format';
import { LiveDot } from '@/components/tracker/LiveDot';
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
  sourceColor,
  surfaceColor,
  trackerSpacing,
} from '@/components/tracker/tokens';
import type { TrafficSignalRow } from '@/db/queries';
import type { ApproachingBus, ArrivalEntry } from '@/hooks/useEta';

interface CurrentBusCardProps {
  entry: ArrivalEntry;
  livePosition:
    | Pick<
        VehiclePosition,
        'speed' | 'bearing' | 'lat' | 'lng' | 'observedAt' | 'vehicleId'
      >
    | undefined;
  /** Currently-tracked live vehicle, even when `entry` is a scheduled row. Mirrors the Map's `eta.current` so telemetry shows the moment a bus is being tracked. */
  liveCurrent?: ApproachingBus | null;
  /** VehiclePosition for `liveCurrent`. Fallback for telemetry when `entry.live` is absent. */
  liveCurrentPosition?:
    | Pick<
        VehiclePosition,
        'speed' | 'bearing' | 'lat' | 'lng' | 'observedAt' | 'vehicleId'
      >
    | undefined;
  /** Live-vs-schedule delay for the primary bus. Only rendered when both the live and schedule ties are known and within ±15 min. */
  delay: ScheduleDelay | null;
  isStale: boolean;
  lastUpdated: number | null;
  /** Epoch ms when the realtime store will next poll. Drives the "refresh in Xs" countdown. */
  nextRefreshAt: number | null;
  /** True while a realtime poll is in flight. */
  isRefreshing: boolean;
  /** Total polyline length (meters) for the active route. Drives the approach rail's denominator; null hides the rail. */
  polylineMeters: number | null;
  /** Traffic signals on the active route; used to interpret a stationary bus as "at a red light". */
  trafficSignals: readonly TrafficSignalRow[];
  /** Contextual proximity — drives the "ARRIVING" / "ARRIVED" eyebrow + status-row label. */
  arrivalStatus: ArrivalStatus;
  /** The bus immediately after `entry`. Rendered as a small footer section when present. */
  nextEntry?: ArrivalEntry | null;
  /** Live telemetry for the next-bus entry (used for the "live · 55 km/h" tag). */
  nextLivePosition?: Pick<VehiclePosition, 'speed'> | undefined;
}

export function CurrentBusCard({
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
}: CurrentBusCardProps) {
  const entryLive = entry.live;
  const sched = entry.sched;

  // When the primary timeline row is scheduled but a live vehicle is actually
  // being tracked (duplicate scheduled rows on a loop, or the traffic-ETA race
  // on first mount before computeEta can produce live minutes), back-fill the
  // live view from `eta.current`. Mirrors the Map card's behavior so the same
  // GTFS feed drives both screens together.
  const effectiveLive = entryLive ?? liveCurrent ?? null;
  const effectivePosition = livePosition ?? liveCurrentPosition;
  const hasTrackedLive =
    effectiveLive != null && effectivePosition != null && !isStale;
  const isLive =
    (entry.kind === 'live' && entryLive != null) || hasTrackedLive;
  const isArrived = arrivalStatus === 'arrived';
  const isArriving = arrivalStatus === 'arriving';

  // If the primary timeline row is scheduled but a live vehicle is tracked,
  // project the headline clock off the live ETA (matches the Map). Falls back
  // to the scheduled epoch when live minutes aren't ready yet (traffic race).
  const liveProjectedEpochMs =
    entry.kind !== 'live' &&
    hasTrackedLive &&
    effectiveLive?.minutesToStop != null
      ? Date.now() + effectiveLive.minutesToStop * 60_000
      : null;

  const minutes =
    isLive && effectiveLive?.minutesToStop != null
      ? effectiveLive.minutesToStop
      : Math.max(0, Math.round((entry.epochMs - Date.now()) / 60_000));

  const eyebrow = isArrived
    ? 'ARRIVED'
    : isArriving
      ? 'ARRIVING'
      : isLive && minutes <= 0
        ? 'ARRIVING NOW'
        : 'ARRIVING IN';

  const projectedClock = formatClockHHMM(liveProjectedEpochMs ?? entry.epochMs);
  // Inline headline shown next to the big minutes value — only when the
  // schedule compare row isn't already displaying the same clock time. Hides
  // on "arriving now" / "arrived" where the eyebrow already says everything.
  const inlineClockLabel =
    minutes <= 0 || isArrived
      ? null
      : isLive
        ? `Arrives ${projectedClock}`
        : `at ${projectedClock}`;

  const motion = useMemo(() => {
    if (!isLive) return null;
    return getMotionStatus({
      speedKmh: effectivePosition?.speed,
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
    effectivePosition?.speed,
    effectivePosition?.lat,
    effectivePosition?.lng,
    trafficSignals,
  ]);

  // Progress = 1 − (distance-to-stop / route length). T816 is a loop, so right
  // after the bus passes the stop forwardMeters ≈ polylineMeters (full loop to
  // come back around), and near arrival forwardMeters ≈ 0. Clamp to [0, 1] —
  // distanceAlongRoute can briefly exceed polylineLength at the loop seam.
  const progress = useMemo(() => {
    const m = effectiveLive?.forwardMeters;
    if (!isLive || m == null || !polylineMeters || polylineMeters <= 0) {
      return null;
    }
    return Math.max(0, Math.min(1, 1 - m / polylineMeters));
  }, [isLive, effectiveLive?.forwardMeters, polylineMeters]);

  const delayLabel = formatDelayLabel(delay);
  const schedClock = sched ? formatClockHHMM(sched.departureEpochMs) : null;
  const liveProjectedClock = isLive && sched ? projectedClock : null;

  // Only show the compare row when we have a live-vs-schedule comparison worth
  // making. For schedule-only entries the clock is already implied by the
  // inline "at HH:MM" headline — no need to repeat it.
  const hasCompareRow = isLive && sched != null;
  // And when the compare row is rendering the live clock, suppress the inline
  // "Arrives HH:MM" next to the big minutes to avoid showing the same time
  // twice.
  const showInlineClock =
    inlineClockLabel != null && !(hasCompareRow && liveProjectedClock != null);

  // Telemetry grid cells — each is a labelled value that helps a casual user
  // understand what they're looking at. Skip speed when the motion pill
  // already carries it (moving / slow) to avoid duplicating "55 km/h".
  const vehicleAge = useVehicleAge(effectivePosition?.observedAt ?? null);
  const infoCells = useMemo(() => {
    if (!isLive) return [];
    const cells: InfoCellData[] = [];
    const distance = formatDistanceToStop(effectiveLive?.forwardMeters);
    if (distance) {
      cells.push({ key: 'distance', label: 'Distance', value: distance });
    }
    const motionCarriesSpeed =
      motion != null && (motion.kind === 'moving' || motion.kind === 'slow');
    if (
      !motionCarriesSpeed &&
      effectivePosition?.speed != null &&
      Number.isFinite(effectivePosition.speed)
    ) {
      cells.push({
        key: 'speed',
        label: 'Speed',
        value: `${Math.round(effectivePosition.speed)} km/h`,
      });
    }
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
    effectiveLive?.forwardMeters,
    motion,
    effectivePosition?.speed,
    effectivePosition?.bearing,
    effectivePosition?.vehicleId,
    vehicleAge,
  ]);

  const showTray = isLive && infoCells.length > 0;

  return (
    <Animated.View style={styles.card} layout={LinearTransition.duration(220)}>
      <View style={styles.sectionPad}>
        <StatusRow
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
              // Hide the "→ live" half when the bus is on-time; the two
              // clocks would be identical. `DelayText` below still signals it.
              showArrow={
                delayLabel != null && delayLabel.tone !== 'on-time'
              }
            />
          ) : null}
        </View>
        <View style={styles.arrivalRow}>
          <View style={styles.valueBlock}>
            {isArrived ? (
              <Animated.Text
                key="arrived"
                entering={SlideInDown.duration(260).easing(
                  Easing.out(Easing.cubic),
                )}
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
                  entering={SlideInDown.duration(260).easing(
                    Easing.out(Easing.cubic),
                  )}
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

      {progress != null ? (
        <>
          <Divider />
          <View style={styles.sectionPad}>
            <View style={styles.railGroup}>
              <ApproachRail progress={progress} isStale={isStale} />
              {motion ? (
                <MotionIndicator motion={motion} isStale={isStale} />
              ) : null}
            </View>
          </View>
        </>
      ) : motion ? (
        <>
          <Divider />
          <View style={styles.sectionPad}>
            <MotionIndicator motion={motion} isStale={isStale} />
          </View>
        </>
      ) : null}

      {showTray ? <InfoTray cells={infoCells} /> : null}

      {nextEntry ? (
        <NextBusSection entry={nextEntry} livePosition={nextLivePosition} />
      ) : null}
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Divider
// ---------------------------------------------------------------------------

function Divider() {
  return <View style={styles.divider} />;
}

// ---------------------------------------------------------------------------
// Schedule times — inline "SCHEDULED 23:11 → 23:17" row. Sits on the same
// line as the "ARRIVING IN" eyebrow, right-aligned.
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
          <Text
            style={styles.schedLiveClock}
            selectable
            allowFontScaling={false}
          >
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
      <Text
        style={[styles.delayText, { color: fg }]}
        selectable
        allowFontScaling={false}
      >
        {text}
      </Text>
    </View>
  );
}

const DELAY_TONE: Record<DelayTone, { fg: string; icon: string }> = {
  'on-time': {
    fg: '#30D158',
    icon: 'checkmark.circle.fill',
  },
  late: {
    fg: '#FF9F0A',
    icon: 'clock.badge.exclamationmark.fill',
  },
  early: {
    fg: '#64D2FF',
    icon: 'clock.arrow.circlepath',
  },
};

// ---------------------------------------------------------------------------
// Info tray — recessed sub-surface at the bottom of the card. Flush with the
// card's bottom edge (square top, rounded bottom) so it reads as "connected".
// Holds the motion pill plus a 2-column label/value grid.
// ---------------------------------------------------------------------------

interface InfoCellData {
  key: string;
  label: string;
  value: string;
  /** Optional SF Symbol placed inline before the value. */
  icon?: string;
  /** Bearing in degrees, used to rotate the heading icon. */
  iconRotation?: number;
}

function InfoTray({ cells }: { cells: InfoCellData[] }) {
  // Chunk cells into rows of 2. Each row renders equal-width cells.
  const rows = useMemo(() => {
    const out: InfoCellData[][] = [];
    for (let i = 0; i < cells.length; i += 2) {
      out.push(cells.slice(i, i + 2));
    }
    return out;
  }, [cells]);

  if (rows.length === 0) return null;
  return (
    <View style={styles.tray}>
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
// Motion indicator — a subtle, tinted banner under the approach rail showing
// whether the bus is moving, stopped, or held at a signal.
// ---------------------------------------------------------------------------

function MotionIndicator({
  motion,
  isStale,
}: {
  motion: NonNullable<ReturnType<typeof getMotionStatus>>;
  isStale: boolean;
}) {
  const tone = MOTION_TONE[motion.kind];
  return (
    <Animated.View
      key={motion.kind}
      entering={FadeIn.duration(220)}
      style={[styles.motionRow, isStale ? styles.motionStale : null]}
    >
      <SymbolView
        name={tone.icon as Parameters<typeof SymbolView>[0]['name']}
        size={13}
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
    </Animated.View>
  );
}

const MOTION_TONE: Record<MotionStatus, { fg: string; icon: string }> = {
  'at-signal': { fg: '#FF453A', icon: 'hand.raised.fill' },
  stopped: { fg: '#8E8E93', icon: 'pause.fill' },
  slow: { fg: '#FF9F0A', icon: 'tortoise.fill' },
  moving: { fg: '#30D158', icon: 'speedometer' },
};

function useVehicleAge(observedAtMs: number | null): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (observedAtMs == null) return;
    const t = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(t);
  }, [observedAtMs]);
  return formatVehicleObservedAge(observedAtMs, now);
}

// ---------------------------------------------------------------------------
// Next bus — compact footer section. "Next" means the bus AFTER the primary
// one in the card; helps the user plan if they miss this bus.
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
  const minutesFromNow = Math.max(
    0,
    Math.round((entry.epochMs - now) / 60_000),
  );
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
    isLive &&
    livePosition?.speed != null &&
    Number.isFinite(livePosition.speed)
      ? `${Math.round(livePosition.speed)} km/h`
      : null;

  // Only tag the next bus when it's live — the common "scheduled" case is the
  // user's default expectation and a "SCHEDULED" tag just adds noise.
  const tagText = isLive ? (speedText ? `Live · ${speedText}` : 'Live') : null;

  return (
    <>
      <Divider />
      <View style={styles.nextSection}>
        <View style={styles.nextHeader}>
          <Text style={styles.eyebrow} selectable>
            NEXT BUS
          </Text>
          {tagText ? <NextTag text={tagText} /> : null}
        </View>
        <Text
          style={styles.nextLine}
          selectable
          numberOfLines={1}
          allowFontScaling={false}
        >
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
      <Text
        style={[styles.nextTagText, { color: fg }]}
        selectable
        allowFontScaling={false}
      >
        {text}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Approach rail
// ---------------------------------------------------------------------------

const RAIL_ACCENT = '#0A84FF';
const BUS_MARKER_SIZE = 24;

function ApproachRail({
  progress,
  isStale,
}: {
  progress: number;
  isStale: boolean;
}) {
  const p = useSharedValue(progress);
  useEffect(() => {
    p.value = withTiming(progress, {
      duration: 300,
      easing: Easing.out(Easing.cubic),
    });
  }, [p, progress]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${p.value * 100}%`,
  }));
  const busStyle = useAnimatedStyle(() => ({
    left: `${p.value * 100}%`,
  }));

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
// Status row
// ---------------------------------------------------------------------------

function StatusRow({
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

  // Effective "refreshing" — if the scheduled tick has fired (countdown at 0)
  // but the store hasn't yet flipped isRefreshing, treat as refreshing anyway
  // so the label doesn't briefly read "refresh in 0s".
  const effectivelyRefreshing =
    isRefreshing || (countdown != null && countdown === 0);

  const refreshLabel =
    countdown != null && countdown > 0 ? `refresh in ${countdown}s` : null;

  const isArrived = arrivalStatus === 'arrived';
  const isArriving = arrivalStatus === 'arriving';

  const tone: 'live' | 'stale' | 'neutral' | 'arrived' | 'arriving' = isArrived
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

  const dotColor =
    tone === 'arrived'
      ? '#30D158'
      : tone === 'arriving'
        ? '#FF9F0A'
        : tone === 'live'
          ? sourceColor.live
          : tone === 'stale'
            ? sourceColor.stale
            : (PlatformColor('tertiaryLabel') as unknown as string);
  const dotStatic = tone !== 'live' && tone !== 'arriving';
  const labelColor =
    tone === 'arrived'
      ? '#30D158'
      : tone === 'arriving'
        ? '#FF9F0A'
        : tone === 'live'
          ? sourceColor.live
          : tone === 'stale'
            ? sourceColor.stale
            : (PlatformColor('secondaryLabel') as unknown as string);

  const primary = isArrived
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

  return (
    <View style={styles.statusRow}>
      <LiveDot color={dotColor} size={7} static={dotStatic} />
      <Text style={[styles.statusText, { color: labelColor }]} selectable>
        {primary}
      </Text>
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
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  card: {
    backgroundColor: surfaceColor.grouped,
    borderRadius: 16,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surfaceColor.hairline,
    paddingHorizontal: 18,
    overflow: 'hidden',
  },
  sectionPad: {
    paddingVertical: trackerSpacing.cardSectionV,
    gap: 6,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: surfaceColor.hairline as unknown as string,
    marginHorizontal: -18,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
    fontSize: 34,
    fontWeight: '700',
    lineHeight: 38,
    color: PlatformColor('label'),
    fontVariant: ['tabular-nums'],
    letterSpacing: -1,
  },
  valueArrived: {
    color: '#30D158',
    fontSize: 30,
    letterSpacing: -0.6,
  },
  valueArriving: {
    color: '#FF9F0A',
  },
  unit: {
    fontSize: 13,
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
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
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
  railGroup: {
    gap: 2,
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
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.1,
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
  },
  tray: {
    backgroundColor: surfaceColor.inset,
    marginHorizontal: -18,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 16,
    // The card's overflow:hidden + borderRadius clips this flush with the
    // card's bottom corners when the tray is the last section. When NextBus
    // follows, the tray sits square-bottomed and NextBus takes the rounded
    // corners via the same overflow clip.
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
  nextSection: {
    paddingVertical: trackerSpacing.cardSectionV,
    gap: 4,
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
