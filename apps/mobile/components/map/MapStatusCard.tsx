import type { VehiclePosition } from '@bus-tracker/shared';
import { SymbolView } from 'expo-symbols';
import { useMemo } from 'react';
import {
  DynamicColorIOS,
  PlatformColor,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ColorValue,
} from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { GlassGuard } from '@/components/GlassGuard';
import { LiveDot } from '@/components/tracker/LiveDot';
import {
  formatClockHHMM,
  formatDelayLabel,
  formatDistanceToStop,
  useLastUpdatedLabel,
  useRefreshCountdownSeconds,
  type DelayTone,
} from '@/components/tracker/logic';
import {
  heroStateColor,
  sourceColor,
  surfaceColor,
} from '@/components/tracker/tokens';
import type { UseEtaResult } from '@/hooks/useEta';
import { tokens } from '@/theme/tokens';

import { PulsingDots } from './PulsingDots';
import { ScheduleFallbackBody } from './ScheduleFallbackBody';
import { bearingToCardinal, formatArrivalClock, formatStopName } from './format';

type CardState =
  | 'live'
  | 'stale'
  | 'waiting'
  | 'schedule'
  | 'service-ended'
  | 'before-service'
  | 'arriving'
  | 'arrived'
  | 'passed';

interface MapStatusCardProps {
  routeCode: string;
  routeLongName?: string | null;
  eta: UseEtaResult;
  stopName: string;
  lastUpdated: number | null;
  /** Raw telemetry for the primary live bus (populated from the realtime feed). */
  livePosition?: Pick<
    VehiclePosition,
    'speed' | 'bearing' | 'vehicleId' | 'observedAt'
  >;
  /** Epoch ms when the realtime store will next poll. Drives the "refresh in Xs" countdown. */
  nextRefreshAt?: number | null;
  /** True while a realtime poll is in flight. */
  isRefreshing?: boolean;
  /** When provided, renders a tappable "Stops" pill in the status row that opens the trip's stop-by-stop list. */
  onOpenStops?: () => void;
}

export function MapStatusCard({
  routeCode,
  routeLongName = null,
  eta,
  stopName,
  lastUpdated,
  livePosition,
  nextRefreshAt = null,
  isRefreshing = false,
  onOpenStops,
}: MapStatusCardProps) {
  const updated = useLastUpdatedLabel(lastUpdated);
  const countdown = useRefreshCountdownSeconds(nextRefreshAt);
  // Treat "countdown at 0" as refreshing too — the scheduled tick has fired
  // but the store hasn't yet flipped isRefreshing, and "refresh in 0s" reads
  // stale for the ~200 ms in between.
  const effectivelyRefreshing =
    isRefreshing || (countdown != null && countdown === 0);
  const feedStatusLabel = effectivelyRefreshing
    ? 'Refreshing…'
    : countdown != null && countdown > 0
      ? `refresh in ${countdown}s`
      : updated.label;

  const nextScheduled = eta.scheduledUpcoming[0] ?? null;
  const scheduleMinutes =
    nextScheduled != null
      ? Math.max(0, Math.round((nextScheduled.departureEpochMs - Date.now()) / 60_000))
      : null;

  const state: CardState =
    eta.arrivalStatus === 'passed'
      ? 'passed'
      : eta.current != null && eta.minutesToStop != null
        ? eta.arrivalStatus === 'arrived'
          ? 'arrived'
          : eta.arrivalStatus === 'arriving'
            ? 'arriving'
            : eta.isStale
              ? 'stale'
              : 'live'
        : eta.serviceEnded
          ? 'service-ended'
          : eta.beforeServiceStart
            ? 'before-service'
            : nextScheduled != null
              ? 'schedule'
              : 'waiting';

  const dotColor =
    state === 'arrived'
      ? '#30D158'
      : state === 'arriving'
        ? '#FF9F0A'
        : state === 'live'
          ? heroStateColor.relaxed
          : state === 'passed'
            ? sourceColor.scheduled
            : state === 'service-ended' || state === 'before-service'
              ? (PlatformColor('tertiaryLabel') as unknown as string)
              : heroStateColor.waiting;
  const statusLabel =
    state === 'arrived'
      ? 'Arrived'
      : state === 'arriving'
        ? 'Arriving'
        : state === 'live'
          ? 'Live'
          : state === 'stale'
            ? 'Stale'
            : state === 'passed'
              ? 'Passed'
              : state === 'schedule'
                ? 'Scheduled'
                : state === 'service-ended'
                  ? 'Off duty'
                  : state === 'before-service'
                    ? 'Pre-service'
                    : 'Waiting';
  const scheduleClock =
    (state === 'live' || state === 'arriving') && eta.currentScheduled
      ? formatClockHHMM(eta.currentScheduled.departureEpochMs)
      : null;
  const delayLabel =
    state === 'live' || state === 'arriving'
      ? formatDelayLabel(eta.resolved.delay)
      : null;

  const showTelemetry =
    state === 'live' ||
    state === 'stale' ||
    state === 'arriving' ||
    state === 'arrived';
  const showMetaRow = state !== 'service-ended' && state !== 'before-service';

  // Next-bus minutes for the passed state — prefer secondary live arrival,
  // fall back to the next scheduled departure so the card always has
  // something actionable to show.
  const passedNextMinutes =
    state === 'passed'
      ? eta.secondaryArrival != null
        ? Math.max(
            0,
            Math.round((eta.secondaryArrival.epochMs - Date.now()) / 60_000),
          )
        : scheduleMinutes
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
          {state === 'stale' ? (
            <SymbolView
              name="exclamationmark.triangle.fill"
              size={11}
              tintColor={dotColor}
              weight="semibold"
            />
          ) : null}
          <View style={styles.statusSpacer} />
          {eta.trafficError ? <TrafficErrorBadge /> : null}
          {onOpenStops ? <StopsPill onPress={onOpenStops} /> : null}
        </View>
        {routeLongName ? (
          <Text style={styles.routeLongName} selectable numberOfLines={1}>
            {routeLongName}
          </Text>
        ) : null}

        <Animated.View
          key={state}
          entering={FadeIn.duration(220)}
          exiting={FadeOut.duration(140)}
          style={styles.bodyRow}
        >
          {state === 'waiting' ? (
            <WaitingBody />
          ) : state === 'service-ended' ? (
            <ServiceEdgeBody
              variant="after-last"
              lastEpochMs={eta.lastBusToday}
            />
          ) : state === 'before-service' ? (
            <ServiceEdgeBody
              variant="before-first"
              firstEpochMs={eta.firstBusToday}
            />
          ) : state === 'schedule' && nextScheduled != null && scheduleMinutes != null ? (
            <ScheduleFallbackBody
              minutes={scheduleMinutes}
              nextAt={nextScheduled.departureEpochMs}
            />
          ) : state === 'passed' ? (
            <PassedBody nextMinutes={passedNextMinutes} />
          ) : state === 'arrived' ? (
            <ArrivalBody tone="arrived" />
          ) : state === 'arriving' ? (
            <>
              <ArrivalBody tone="arriving" />
              {scheduleClock ? (
                <ScheduleStack
                  schedClock={scheduleClock}
                  delayLabel={delayLabel}
                />
              ) : null}
            </>
          ) : (
            <>
              <EtaBody
                minutes={eta.minutesToStop ?? 0}
                dimmed={state === 'stale'}
              />
              {scheduleClock ? (
                <ScheduleStack
                  schedClock={scheduleClock}
                  delayLabel={delayLabel}
                />
              ) : null}
            </>
          )}
        </Animated.View>

        {showTelemetry ? (
          <TelemetryRow
            forwardMeters={eta.current?.forwardMeters ?? null}
            speed={livePosition?.speed}
            bearing={livePosition?.bearing}
            vehicleId={livePosition?.vehicleId ?? eta.current?.vehicleId ?? null}
          />
        ) : null}

        {showMetaRow ? (
          <View style={styles.metaRow}>
            <Text style={styles.metaPrimary} numberOfLines={1} selectable>
              to {niceStop || 'your stop'}
            </Text>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.metaSecondary} numberOfLines={1} selectable>
              {feedStatusLabel}
            </Text>
          </View>
        ) : null}
      </View>
    </GlassGuard>
  );
}

function ServiceEdgeBody({
  variant,
  firstEpochMs,
  lastEpochMs,
}: {
  variant: 'before-first' | 'after-last';
  firstEpochMs?: number | null;
  lastEpochMs?: number | null;
}) {
  const { title, caption } = useMemo(() => {
    if (variant === 'before-first') {
      return {
        title:
          firstEpochMs != null
            ? `First bus at ${formatClockHHMM(firstEpochMs)}`
            : 'Service has not started',
        caption: 'Timetable service hasn’t started for the day.',
      };
    }
    const last = lastEpochMs != null ? formatClockHHMM(lastEpochMs) : null;
    return {
      title: last ? `Service ended · Last bus ${last}` : 'Service ended',
      caption: 'Check back tomorrow morning.',
    };
  }, [variant, firstEpochMs, lastEpochMs]);

  return (
    <View style={styles.serviceEdgeRow}>
      <SymbolView
        name="clock.fill"
        size={22}
        tintColor={PlatformColor('secondaryLabel') as unknown as string}
      />
      <View style={styles.serviceEdgeTextCol}>
        <Text style={styles.serviceEdgeTitle} selectable numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.serviceEdgeCaption} selectable numberOfLines={2}>
          {caption}
        </Text>
      </View>
    </View>
  );
}

function ScheduleStack({
  schedClock,
  delayLabel,
}: {
  schedClock: string;
  delayLabel: { text: string; tone: DelayTone } | null;
}) {
  const toneColor = delayLabel ? DELAY_TONE_COLOR[delayLabel.tone] : null;
  return (
    <View style={styles.schedStack}>
      <Text style={styles.schedLabel} selectable>
        Scheduled
      </Text>
      <Text
        style={styles.schedClock}
        selectable
        allowFontScaling={false}
      >
        {schedClock}
      </Text>
      {delayLabel && toneColor ? (
        <Text
          style={[styles.schedDelay, { color: toneColor }]}
          selectable
          allowFontScaling={false}
        >
          {delayLabel.text}
        </Text>
      ) : null}
    </View>
  );
}

const DELAY_TONE_COLOR: Record<DelayTone, string> = {
  'on-time': '#30D158',
  late: '#FF9F0A',
  early: '#64D2FF',
};

function TelemetryRow({
  forwardMeters,
  speed,
  bearing,
  vehicleId,
}: {
  forwardMeters: number | null;
  speed?: number;
  bearing?: number;
  vehicleId: string | null;
}) {
  const parts = useMemo(() => {
    const out: {
      key: string;
      icon?: string;
      text: string;
      rotation?: number;
    }[] = [];
    const distance = formatDistanceToStop(forwardMeters);
    if (distance) out.push({ key: 'dist', icon: 'ruler', text: distance });
    if (speed != null && Number.isFinite(speed)) {
      out.push({
        key: 'speed',
        icon: 'speedometer',
        text: `${Math.round(speed)} km/h`,
      });
    }
    const heading = bearingToCardinal(bearing);
    if (heading) {
      out.push({
        key: 'head',
        icon: 'location.north.line.fill',
        text: heading,
        rotation:
          typeof bearing === 'number' && Number.isFinite(bearing)
            ? bearing
            : undefined,
      });
    }
    if (vehicleId) {
      out.push({ key: 'vid', text: `Bus ${vehicleId}` });
    }
    return out;
  }, [forwardMeters, speed, bearing, vehicleId]);

  if (parts.length === 0) return null;

  return (
    <View style={styles.telemetryRow}>
      {parts.map((p, i) => (
        <View key={p.key} style={styles.telemetryPart}>
          {i > 0 ? (
            <Text style={styles.telemetrySep} selectable>
              ·
            </Text>
          ) : null}
          {p.icon ? (
            <SymbolView
              name={p.icon as Parameters<typeof SymbolView>[0]['name']}
              size={11}
              tintColor={PlatformColor('secondaryLabel') as unknown as string}
              weight="semibold"
              style={
                p.rotation != null
                  ? { transform: [{ rotate: `${p.rotation}deg` }] }
                  : undefined
              }
            />
          ) : null}
          <Text style={styles.telemetryText} selectable allowFontScaling={false}>
            {p.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

function EtaBody({
  minutes,
  dimmed,
}: {
  minutes: number;
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
  );
}

function ArrivalBody({ tone }: { tone: 'arriving' | 'arrived' }) {
  const color = tone === 'arrived' ? '#30D158' : '#FF9F0A';
  const eyebrow = tone === 'arrived' ? 'Bus arrived' : 'Bus arriving';
  const title = tone === 'arrived' ? 'Now' : 'Soon';
  const subtitle = tone === 'arrived' ? 'at your stop' : 'near your stop';
  return (
    <View style={styles.heroCol}>
      <Text style={styles.eyebrow} selectable numberOfLines={1}>
        {eyebrow}
      </Text>
      <View style={styles.numberRow}>
        <Text
          style={[styles.arrivalTitle, { color }]}
          selectable
          allowFontScaling={false}
        >
          {title}
        </Text>
        <Text style={styles.unit} selectable>
          {subtitle}
        </Text>
      </View>
    </View>
  );
}

function PassedBody({ nextMinutes }: { nextMinutes: number | null }) {
  const subtitle =
    nextMinutes == null
      ? 'Next bus later'
      : nextMinutes <= 0
        ? 'Next bus any moment'
        : `Next in ${nextMinutes} min`;
  return (
    <View style={styles.heroCol}>
      <Text style={styles.eyebrow} selectable numberOfLines={1}>
        Already passed
      </Text>
      <View style={styles.numberRow}>
        <Text
          style={[styles.arrivalTitle, { color: sourceColor.scheduled }]}
          selectable
          allowFontScaling={false}
        >
          Gone
        </Text>
        <Text style={styles.unit} selectable numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
    </View>
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

function StopsPill({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel="View all stops on this trip"
    >
      {({ pressed }) => (
        <View
          style={[
            styles.stopsPill,
            pressed ? styles.stopsPillPressed : null,
          ]}
        >
          <SymbolView
            name="list.bullet"
            size={12}
            tintColor="#FFFFFF"
            weight="semibold"
          />
          <Text style={styles.stopsPillText} allowFontScaling={false}>
            Stops
          </Text>
        </View>
      )}
    </Pressable>
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
  routeLongName: {
    fontSize: 13,
    fontWeight: '500',
    color: PlatformColor('secondaryLabel'),
    marginTop: -4,
    letterSpacing: -0.1,
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
  arrivalTitle: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '700',
    letterSpacing: -0.8,
  },
  unit: {
    fontSize: 15,
    fontWeight: '500',
    color: PlatformColor('secondaryLabel'),
  },
  telemetryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: -2,
  },
  telemetryPart: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  telemetrySep: {
    fontSize: 12,
    color: PlatformColor('tertiaryLabel'),
    marginRight: 2,
  },
  telemetryText: {
    fontSize: 12,
    fontWeight: '500',
    color: PlatformColor('secondaryLabel'),
    fontVariant: ['tabular-nums'],
  },
  schedStack: {
    alignItems: 'flex-end',
    gap: 2,
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
    fontSize: 14,
    fontWeight: '500',
    color: PlatformColor('secondaryLabel'),
    fontVariant: ['tabular-nums'],
  },
  schedDelay: {
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.1,
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
  serviceEdgeRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  serviceEdgeTextCol: {
    flex: 1,
    gap: 2,
  },
  serviceEdgeTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: PlatformColor('label'),
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.1,
  },
  serviceEdgeCaption: {
    fontSize: 12,
    fontWeight: '400',
    color: PlatformColor('secondaryLabel'),
    letterSpacing: 0.1,
  },
  scheduleSubline: {
    fontSize: 12,
    fontWeight: '500',
    color: PlatformColor('tertiaryLabel'),
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.1,
    marginTop: -2,
  },
  stopsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: '#0A84FF',
    overflow: 'hidden',
  },
  stopsPillPressed: {
    opacity: 0.75,
  },
  stopsPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: 0.1,
  },
});
