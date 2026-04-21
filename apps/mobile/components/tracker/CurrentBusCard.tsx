import {
  getMotionStatus,
  type MotionStatus,
  type ScheduleDelay,
  type VehiclePosition,
} from '@bus-tracker/shared';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo } from 'react';
import { PlatformColor, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInRight,
  LinearTransition,
  SlideInDown,
  SlideOutUp,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { bearingToCardinal, formatArrivalClock } from '@/components/map/format';
import { LiveDot } from '@/components/tracker/LiveDot';
import {
  formatClockHHMM,
  formatDeltaMin,
  useLastUpdatedLabel,
} from '@/components/tracker/logic';
import {
  sourceColor,
  surfaceColor,
  trackerSpacing,
} from '@/components/tracker/tokens';
import type { TrafficSignalRow } from '@/db/queries';
import type { ArrivalEntry } from '@/hooks/useEta';

interface CurrentBusCardProps {
  entry: ArrivalEntry;
  livePosition:
    | Pick<VehiclePosition, 'speed' | 'bearing' | 'lat' | 'lng'>
    | undefined;
  /** Live-vs-schedule delay for the primary bus. Only rendered when both the live and schedule ties are known and within ±15 min. */
  delay: ScheduleDelay | null;
  isStale: boolean;
  lastUpdated: number | null;
  /** Total polyline length (meters) for the active route. Drives the approach rail's denominator; null hides the rail. */
  polylineMeters: number | null;
  /** Traffic signals on the active route; used to interpret a stationary bus as "at a red light". */
  trafficSignals: readonly TrafficSignalRow[];
}

export function CurrentBusCard({
  entry,
  livePosition,
  delay,
  isStale,
  lastUpdated,
  polylineMeters,
  trafficSignals,
}: CurrentBusCardProps) {
  const live = entry.live;
  const sched = entry.sched;
  const isLive = entry.kind === 'live' && live != null;

  const minutes =
    isLive && live?.minutesToStop != null
      ? live.minutesToStop
      : Math.max(0, Math.round((entry.epochMs - Date.now()) / 60_000));

  const headline = isLive
    ? live?.minutesToStop != null && live.minutesToStop <= 0
      ? 'Arriving now'
      : `Arrives ${formatArrivalClock(minutes) ?? formatClockHHMM(entry.epochMs)}`
    : `Scheduled ${formatClockHHMM(entry.epochMs)}`;

  const motion = useMemo(() => {
    if (!isLive) return null;
    return getMotionStatus({
      speedKmh: livePosition?.speed,
      position:
        livePosition?.lat != null && livePosition?.lng != null
          ? { lat: livePosition.lat, lng: livePosition.lng }
          : null,
      signals: trafficSignals.map((s) => ({
        id: s.osm_id,
        lat: s.lat,
        lng: s.lng,
      })),
    });
  }, [isLive, livePosition?.speed, livePosition?.lat, livePosition?.lng, trafficSignals]);

  const chips = buildChips({ isLive, sched, livePosition, delay, isStale, motion });

  // Progress = 1 − (distance-to-stop / route length). T816 is a loop, so right
  // after the bus passes the stop forwardMeters ≈ polylineMeters (full loop to
  // come back around), and near arrival forwardMeters ≈ 0. Clamp to [0, 1] —
  // distanceAlongRoute can briefly exceed polylineLength at the loop seam.
  const progress = useMemo(() => {
    const m = live?.forwardMeters;
    if (!isLive || m == null || !polylineMeters || polylineMeters <= 0) {
      return null;
    }
    return Math.max(0, Math.min(1, 1 - m / polylineMeters));
  }, [isLive, live?.forwardMeters, polylineMeters]);

  return (
    <Animated.View style={styles.card} layout={LinearTransition.duration(220)}>
      {isLive ? <StatusRow isStale={isStale} lastUpdated={lastUpdated} /> : null}

      <View style={styles.headerRow}>
        <Text style={styles.label} selectable>
          Current
        </Text>
        <View style={styles.valueBlock}>
          <Animated.Text
            key={`${minutes}-${entry.kind}`}
            entering={SlideInDown.duration(260).easing(
              Easing.out(Easing.cubic),
            )}
            exiting={SlideOutUp.duration(180).easing(Easing.in(Easing.cubic))}
            style={styles.value}
            selectable
            allowFontScaling={false}
          >
            {minutes}
          </Animated.Text>
          <Text style={styles.unit} selectable>
            min
          </Text>
        </View>
      </View>

      <Text style={styles.headline} selectable numberOfLines={1}>
        {headline}
      </Text>

      {motion ? <MotionLine motion={motion} /> : null}

      {progress != null ? (
        <ApproachRail progress={progress} isStale={isStale} />
      ) : null}

      {chips.length > 0 ? (
        <Animated.View
          entering={FadeIn.duration(220)}
          style={styles.chipStrip}
          layout={LinearTransition.duration(220)}
        >
          {chips.map(({ key, ...chipProps }, i) => (
            <Animated.View
              key={key}
              entering={FadeInRight.duration(180).delay(i * 40)}
              layout={LinearTransition.duration(220)}
            >
              <Chip {...chipProps} />
            </Animated.View>
          ))}
        </Animated.View>
      ) : null}
    </Animated.View>
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
        name="mappin.circle.fill"
        size={22}
        tintColor={sourceColor.live}
        resizeMode="scaleAspectFit"
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Motion status line — "Stopped at a traffic light" / "On the move · 53 km/h"
// ---------------------------------------------------------------------------

function MotionLine({
  motion,
}: {
  motion: NonNullable<ReturnType<typeof getMotionStatus>>;
}) {
  const { icon, kind } = MOTION_CHIP[motion.kind];
  const { fg } = chipColors(kind);
  return (
    <Animated.View
      key={motion.kind}
      entering={FadeIn.duration(220)}
      style={styles.motionRow}
    >
      <SymbolView
        name={icon as Parameters<typeof SymbolView>[0]['name']}
        size={13}
        tintColor={fg}
        weight="semibold"
      />
      <Text
        style={[styles.motionText, { color: fg }]}
        selectable
        numberOfLines={1}
        allowFontScaling={false}
      >
        {motion.label}
      </Text>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Status row
// ---------------------------------------------------------------------------

function StatusRow({
  isStale,
  lastUpdated,
}: {
  isStale: boolean;
  lastUpdated: number | null;
}) {
  const updated = useLastUpdatedLabel(lastUpdated);
  return (
    <View style={styles.statusRow}>
      <LiveDot
        color={isStale ? sourceColor.stale : sourceColor.live}
        size={7}
        static={isStale}
      />
      <Text style={[styles.statusText, { color: isStale ? sourceColor.stale : sourceColor.live }]} selectable>
        {isStale ? 'Stale' : 'Live'}
      </Text>
      {updated.shortLabel ? (
        <>
          <Text style={styles.statusDot}>·</Text>
          <Text style={styles.statusMeta} selectable numberOfLines={1}>
            {updated.shortLabel}
          </Text>
        </>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Chips
// ---------------------------------------------------------------------------

type ChipKind =
  | 'scheduled'
  | 'delay-on-time'
  | 'delay-late'
  | 'delay-early'
  | 'motion-at-signal'
  | 'motion-stopped'
  | 'motion-slow'
  | 'motion-moving'
  | 'heading'
  | 'stale';

interface ChipProps {
  key: string;
  icon: string;
  text: string;
  kind: ChipKind;
  /** Bearing in degrees for heading chips; used to rotate the SF Symbol. */
  rotation?: number;
}

function Chip({ icon, text, kind, rotation }: Omit<ChipProps, 'key'>) {
  const { bg, fg, border } = chipColors(kind);
  return (
    <View style={[styles.chip, { backgroundColor: bg, borderColor: border }]}>
      <SymbolView
        name={icon as Parameters<typeof SymbolView>[0]['name']}
        size={11}
        tintColor={fg}
        weight="semibold"
        style={
          rotation != null ? { transform: [{ rotate: `${rotation}deg` }] } : undefined
        }
      />
      <Text style={[styles.chipText, { color: fg }]} selectable allowFontScaling={false}>
        {text}
      </Text>
    </View>
  );
}

function chipColors(kind: ChipKind): { bg: string; fg: string; border: string } {
  switch (kind) {
    case 'delay-on-time':
      return { bg: 'rgba(48,209,88,0.14)', fg: '#30D158', border: 'rgba(48,209,88,0.35)' };
    case 'delay-late':
      return { bg: surfaceColor.amberTint, fg: '#FF9F0A', border: 'rgba(255,159,10,0.35)' };
    case 'delay-early':
      return { bg: 'rgba(100,210,255,0.14)', fg: '#64D2FF', border: 'rgba(100,210,255,0.35)' };
    case 'motion-at-signal':
      return { bg: 'rgba(208,2,27,0.14)', fg: '#FF453A', border: 'rgba(255,69,58,0.35)' };
    case 'motion-stopped':
      return { bg: 'rgba(142,142,147,0.14)', fg: '#8E8E93', border: 'rgba(142,142,147,0.35)' };
    case 'motion-slow':
      return { bg: surfaceColor.amberTint, fg: '#FF9F0A', border: 'rgba(255,159,10,0.35)' };
    case 'motion-moving':
      return { bg: 'rgba(48,209,88,0.14)', fg: '#30D158', border: 'rgba(48,209,88,0.35)' };
    case 'stale':
      return { bg: surfaceColor.amberTint, fg: '#FF9F0A', border: 'rgba(255,159,10,0.35)' };
    default:
      return {
        bg: 'transparent',
        // Runtime color – PlatformColor returns a ColorValue, but chipText accepts string | ColorValue.
        fg: '#8E8E93',
        border: surfaceColor.hairline as unknown as string,
      };
  }
}

const MOTION_CHIP: Record<
  MotionStatus,
  { icon: string; kind: ChipKind }
> = {
  // hand.raised.fill reads as a "stop" gesture — matches the red traffic-light treatment.
  'at-signal': { icon: 'hand.raised.fill', kind: 'motion-at-signal' },
  stopped: { icon: 'pause.fill', kind: 'motion-stopped' },
  slow: { icon: 'tortoise.fill', kind: 'motion-slow' },
  moving: { icon: 'speedometer', kind: 'motion-moving' },
};

function buildChips({
  isLive,
  sched,
  livePosition,
  delay,
  isStale,
  motion,
}: {
  isLive: boolean;
  sched: { departureEpochMs: number } | null;
  livePosition:
    | Pick<VehiclePosition, 'speed' | 'bearing' | 'lat' | 'lng'>
    | undefined;
  delay: ScheduleDelay | null;
  isStale: boolean;
  motion: ReturnType<typeof getMotionStatus>;
}): ChipProps[] {
  const chips: ChipProps[] = [];

  // Scheduled chip — only on the live variant (schedule-only already shows the
  // clock time in the headline).
  if (isLive && sched) {
    chips.push({
      key: 'sched',
      icon: 'clock.fill',
      text: formatClockHHMM(sched.departureEpochMs),
      kind: 'scheduled',
    });
  }

  if (isLive && delay) {
    const text = formatDeltaMin(delay) ?? '';
    if (text) {
      const kind: ChipKind =
        delay.onTimeWindow === 'on-time'
          ? 'delay-on-time'
          : delay.onTimeWindow === 'late'
            ? 'delay-late'
            : 'delay-early';
      const icon =
        delay.onTimeWindow === 'on-time'
          ? 'checkmark.circle.fill'
          : delay.onTimeWindow === 'late'
            ? 'clock.badge.exclamationmark.fill'
            : 'clock.arrow.circlepath';
      chips.push({ key: 'delay', icon, text, kind });
    }
  }

  // Motion status has its own subtitle line (see MotionLine). When we have
  // speed but couldn't compute a motion status (no position fix yet), keep the
  // old raw km/h chip so the strip still shows something useful.
  if (
    isLive &&
    !motion &&
    livePosition?.speed != null &&
    Number.isFinite(livePosition.speed)
  ) {
    chips.push({
      key: 'speed-raw',
      icon: 'speedometer',
      text: `${Math.round(livePosition.speed)} km/h`,
      kind: 'motion-moving',
    });
  }

  if (isLive) {
    const heading = bearingToCardinal(livePosition?.bearing);
    if (heading) {
      chips.push({
        key: 'heading',
        icon: 'location.north.line.fill',
        text: heading,
        kind: 'heading',
        rotation:
          typeof livePosition?.bearing === 'number' && Number.isFinite(livePosition.bearing)
            ? livePosition.bearing
            : undefined,
      });
    }
  }

  if (isLive && isStale) {
    chips.push({
      key: 'stale',
      icon: 'exclamationmark.circle.fill',
      text: 'Stale',
      kind: 'stale',
    });
  }

  return chips;
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
    paddingTop: 14,
    paddingBottom: 16,
    gap: 10,
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    color: PlatformColor('label'),
    letterSpacing: -0.1,
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
  unit: {
    fontSize: 13,
    fontWeight: '500',
    color: PlatformColor('secondaryLabel'),
  },
  headline: {
    fontSize: 17,
    fontWeight: '500',
    color: PlatformColor('label'),
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.1,
  },
  motionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: -4,
  },
  motionText: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.1,
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
  },
  chipStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  railRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: BUS_MARKER_SIZE + 4,
    marginTop: 2,
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
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
    fontVariant: ['tabular-nums'],
  },
});

// prevent lint noise on unused token in this module
void trackerSpacing;
