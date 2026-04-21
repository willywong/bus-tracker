import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo } from 'react';
import {
  DynamicColorIOS,
  PlatformColor,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ColorValue,
} from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { GlassGuard } from '@/components/GlassGuard';
import { LiveDot } from '@/components/tracker/LiveDot';
import {
  formatClockHHMM,
  formatDeltaMin,
  useLastUpdatedLabel,
} from '@/components/tracker/logic';
import { heroStateColor, surfaceColor } from '@/components/tracker/tokens';
import type { UseEtaResult } from '@/hooks/useEta';
import { tokens } from '@/theme/tokens';

import { PulsingDots } from './PulsingDots';
import { ScheduleFallbackBody } from './ScheduleFallbackBody';
import { formatArrivalClock, formatDistance, formatStopName } from './format';

type CardState = 'live' | 'stale' | 'waiting' | 'schedule';

interface MapStatusCardProps {
  routeCode: string;
  eta: UseEtaResult;
  stopName: string;
  lastUpdated: number | null;
  /** Tap on the refresh icon. Omit to hide the icon. */
  onRefresh?: () => void;
  refreshing?: boolean;
}

export function MapStatusCard({
  routeCode,
  eta,
  stopName,
  lastUpdated,
  onRefresh,
  refreshing = false,
}: MapStatusCardProps) {
  const updated = useLastUpdatedLabel(lastUpdated);

  const nextScheduled = eta.scheduledUpcoming[0] ?? null;
  const scheduleMinutes =
    nextScheduled != null
      ? Math.max(0, Math.round((nextScheduled.departureEpochMs - Date.now()) / 60_000))
      : null;

  const state: CardState =
    eta.current != null && eta.minutesToStop != null
      ? eta.isStale
        ? 'stale'
        : 'live'
      : nextScheduled != null && !eta.serviceEnded
        ? 'schedule'
        : 'waiting';

  const dotColor =
    state === 'live'
      ? heroStateColor.relaxed
      : heroStateColor.waiting;
  const statusLabel =
    state === 'live'
      ? 'Live'
      : state === 'stale'
        ? 'Stale'
        : state === 'schedule'
          ? 'Scheduled'
          : 'Waiting';
  const scheduleSubline =
    state === 'live' && eta.currentScheduled
      ? (() => {
          const clock = formatClockHHMM(
            eta.currentScheduled.departureEpochMs,
          );
          const delta = formatDeltaMin(eta.resolved.delay);
          return delta ? `Scheduled ${clock} · ${delta}` : `Scheduled ${clock}`;
        })()
      : null;

  const niceStop = useMemo(() => formatStopName(stopName), [stopName]);

  return (
    <GlassGuard
      style={styles.card}
      glassEffectStyle="regular"
      blurIntensity={60}
    >
      <View style={styles.scrim} />
      <View style={styles.inner}>
        <View style={styles.statusRow}>
          <LiveDot color={dotColor} size={7} static={state !== 'live'} />
          <Text style={styles.statusText} selectable>
            {statusLabel} · {routeCode}
          </Text>
          <View style={styles.statusSpacer} />
          {eta.trafficError ? <TrafficErrorBadge /> : null}
          {onRefresh ? (
            <RefreshButton onPress={onRefresh} refreshing={refreshing} />
          ) : null}
        </View>

        <Animated.View
          key={state}
          entering={FadeIn.duration(220)}
          exiting={FadeOut.duration(140)}
          style={styles.bodyRow}
        >
          {state === 'waiting' ? (
            <WaitingBody />
          ) : state === 'schedule' && nextScheduled != null && scheduleMinutes != null ? (
            <ScheduleFallbackBody
              minutes={scheduleMinutes}
              nextAt={nextScheduled.departureEpochMs}
            />
          ) : (
            <EtaBody
              minutes={eta.minutesToStop ?? 0}
              forwardMeters={eta.current?.forwardMeters ?? null}
              dimmed={state === 'stale'}
            />
          )}
        </Animated.View>

        <View style={styles.metaRow}>
          <Text style={styles.metaPrimary} numberOfLines={1} selectable>
            to {niceStop || 'your stop'}
          </Text>
          <Text style={styles.metaDot}>·</Text>
          <Text style={styles.metaSecondary} numberOfLines={1} selectable>
            {updated.label}
          </Text>
        </View>
        {scheduleSubline ? (
          <Text style={styles.scheduleSubline} selectable numberOfLines={1}>
            {scheduleSubline}
          </Text>
        ) : null}
      </View>
    </GlassGuard>
  );
}

function EtaBody({
  minutes,
  forwardMeters,
  dimmed,
}: {
  minutes: number;
  forwardMeters: number | null;
  dimmed: boolean;
}) {
  const numberColor: ColorValue = dimmed
    ? PlatformColor('secondaryLabel')
    : PlatformColor('label');
  const clock = formatArrivalClock(minutes);
  const eyebrow = dimmed
    ? clock
      ? `Last seen · ${clock}`
      : 'Last seen'
    : minutes <= 0
      ? 'Arriving now'
      : clock
        ? `Arrives ${clock}`
        : 'Arriving in';

  return (
    <>
      <View style={styles.heroCol}>
        <Text style={styles.eyebrow} selectable numberOfLines={1}>
          {eyebrow}
        </Text>
        <View style={styles.numberRow}>
          <Text
            style={[styles.number, { color: numberColor }]}
            selectable
            allowFontScaling={false}
          >
            {minutes}
          </Text>
          <Text style={styles.unit} selectable>
            min away
          </Text>
        </View>
      </View>
      {forwardMeters != null ? (
        <View style={styles.distancePill}>
          <Text
            style={styles.distanceValue}
            selectable
            allowFontScaling={false}
          >
            {formatDistance(forwardMeters)}
          </Text>
          <Text style={styles.distanceCaption} selectable>
            away
          </Text>
        </View>
      ) : null}
    </>
  );
}

function RefreshButton({
  onPress,
  refreshing,
}: {
  onPress: () => void;
  refreshing: boolean;
}) {
  const angle = useSharedValue(0);
  useEffect(() => {
    if (refreshing) {
      angle.value = 0;
      angle.value = withRepeat(
        withTiming(360, { duration: 900, easing: Easing.linear }),
        -1,
      );
    } else {
      cancelAnimation(angle);
      angle.value = 0;
    }
  }, [refreshing, angle]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${angle.value}deg` }],
  }));

  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel="Refresh"
      style={({ pressed }) => [
        styles.refreshButton,
        pressed ? styles.refreshButtonPressed : null,
      ]}
    >
      <Animated.View style={animatedStyle}>
        <SymbolView
          name="arrow.clockwise"
          size={14}
          tintColor={PlatformColor('secondaryLabel') as unknown as string}
          resizeMode="scaleAspectFit"
        />
      </Animated.View>
    </Pressable>
  );
}

function TrafficErrorBadge() {
  return (
    <View style={styles.trafficBadge}>
      <View
        style={[styles.trafficBadgeDot, { backgroundColor: heroStateColor.waiting }]}
      />
      <Text style={styles.trafficBadgeText} selectable>
        No traffic data
      </Text>
    </View>
  );
}

function WaitingBody() {
  return (
    <View style={styles.heroCol}>
      <Text style={styles.eyebrow} selectable>
        Waiting for bus
      </Text>
      <View style={styles.waitingRow}>
        <PulsingDots color={tokens.color.muted} size={8} gap={8} />
        <Text style={styles.waitingHint} selectable>
          Looking for the next one
        </Text>
      </View>
    </View>
  );
}

const SCRIM_COLOR = DynamicColorIOS({
  light: 'rgba(255, 255, 255, 0.5)',
  dark: 'rgba(0, 0, 0, 0.45)',
});

const styles = StyleSheet.create({
  card: {
    borderRadius: 24,
    overflow: 'hidden',
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    boxShadow: '0 10px 28px rgba(0, 0, 0, 0.28)',
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: SCRIM_COLOR,
  },
  inner: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 14,
    gap: 10,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: PlatformColor('secondaryLabel'),
  },
  statusSpacer: {
    flex: 1,
  },
  trafficBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: surfaceColor.amberTint,
  },
  trafficBadgeDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  trafficBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: PlatformColor('secondaryLabel'),
  },
  bodyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 52,
  },
  heroCol: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    fontSize: 13,
    fontWeight: '500',
    color: PlatformColor('secondaryLabel'),
    letterSpacing: 0.2,
    marginBottom: 2,
  },
  numberRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  number: {
    fontSize: 40,
    lineHeight: 44,
    fontWeight: '300',
    fontVariant: ['tabular-nums'],
    letterSpacing: -1.2,
  },
  unit: {
    fontSize: 15,
    fontWeight: '500',
    color: PlatformColor('secondaryLabel'),
  },
  distancePill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    borderCurve: 'continuous',
    backgroundColor: surfaceColor.blueTint,
    alignItems: 'center',
    minWidth: 78,
  },
  distanceValue: {
    fontSize: 15,
    fontWeight: '600',
    color: PlatformColor('label'),
    fontVariant: ['tabular-nums'],
  },
  distanceCaption: {
    marginTop: 1,
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: PlatformColor('secondaryLabel'),
  },
  waitingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 6,
  },
  waitingHint: {
    fontSize: 13,
    fontWeight: '400',
    color: PlatformColor('tertiaryLabel'),
    flexShrink: 1,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaPrimary: {
    fontSize: 13,
    fontWeight: '500',
    color: PlatformColor('label'),
    flexShrink: 1,
  },
  metaDot: {
    fontSize: 13,
    color: PlatformColor('tertiaryLabel'),
  },
  metaSecondary: {
    fontSize: 13,
    color: PlatformColor('secondaryLabel'),
    flexShrink: 1,
  },
  scheduleSubline: {
    fontSize: 12,
    fontWeight: '500',
    color: PlatformColor('tertiaryLabel'),
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.1,
    marginTop: -2,
  },
  refreshButton: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  refreshButtonPressed: {
    opacity: 0.5,
  },
});
