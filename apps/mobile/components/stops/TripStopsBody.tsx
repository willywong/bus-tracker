import {
  toMalaysiaParts,
  type VehiclePosition,
} from '@bus-tracker/shared';
import {
  HStack,
  Image,
  ProgressView,
  Spacer,
  Text,
  VStack,
} from '@expo/ui/swift-ui';
import {
  Animation,
  animation,
  background,
  font,
  foregroundStyle,
  frame,
  opacity,
  padding,
  shapes,
} from '@expo/ui/swift-ui/modifiers';
import { useEffect, useMemo, useState } from 'react';
import type { SFSymbol } from 'sf-symbols-typescript';

import { formatStopName } from '@/components/map/format';
import { openDb } from '@/db/database';
import {
  getTripStopsWithNames,
  type TripStopWithName,
} from '@/db/queries';
import { useTripUpdates } from '@/hooks/useTripUpdates';

export interface TripStopsSheetContext {
  tripId: string;
  routeCode: string;
  /** User's preferred boarding stop — highlighted in the list. */
  userStopId: string | null;
  livePosition?: Pick<
    VehiclePosition,
    'currentStopSequence' | 'currentStopId' | 'currentStatus' | 'observedAt'
  >;
}

/**
 * Stop-by-stop list body with per-stop ETA. When TripUpdates are available the
 * upstream arrival time takes precedence; otherwise falls back to the static
 * schedule. Highlights the user's stop, marks the bus's current position,
 * strikes through SKIPPED stops, and flows an animated chevron between the
 * last-passed stop and the next-up one.
 */
export function TripStopsBody({ context }: { context: TripStopsSheetContext }) {
  const [stops, setStops] = useState<TripStopWithName[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const { byTrip } = useTripUpdates();

  useEffect(() => {
    let cancelled = false;
    setStops(null);
    setError(null);
    (async () => {
      try {
        const db = await openDb();
        const rows = await getTripStopsWithNames(db, context.tripId);
        if (!cancelled) setStops(rows);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [context.tripId]);

  const tripUpdate = byTrip.get(context.tripId);
  const todayMidnight = useMemo(
    () => toMalaysiaParts(new Date()).midnightUtcMs,
    [],
  );
  const flowPhase = useFlowPhase();

  // Active sequence — the stop the bus is at or heading toward. Falls back to
  // matching by stop_id when current_stop_sequence isn't published.
  const activeSequence: number | null = useMemo(() => {
    if (!stops || stops.length === 0) return null;
    const seq = context.livePosition?.currentStopSequence;
    if (typeof seq === 'number') return seq;
    const stopId = context.livePosition?.currentStopId;
    if (!stopId) return null;
    const match = stops.find((s) => s.stopId === stopId);
    return match?.stopSequence ?? null;
  }, [stops, context.livePosition]);

  if (error) {
    return (
      <HStack spacing={10}>
        <Image systemName="exclamationmark.triangle" size={16} color="#8E8E93" />
        <Text
          modifiers={[
            foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
            font({ size: 13 }),
          ]}
        >
          Couldn't load stops — {error.message}
        </Text>
      </HStack>
    );
  }

  if (!stops) {
    return (
      <HStack spacing={10}>
        <ProgressView />
        <Text
          modifiers={[
            foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
            font({ size: 13 }),
          ]}
        >
          Loading stops…
        </Text>
      </HStack>
    );
  }

  if (stops.length === 0) {
    return (
      <Text
        modifiers={[
          foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
          font({ size: 13 }),
        ]}
      >
        No stop data for this trip.
      </Text>
    );
  }

  const rows = stops.map((s) => {
    const update = tripUpdate?.stopTimeUpdates.find(
      (u) =>
        (u.stopId && u.stopId === s.stopId) ||
        u.stopSequence === s.stopSequence,
    );
    const skipped = update?.scheduleRelationship === 'SKIPPED';
    const scheduledMs =
      s.arrivalSeconds != null
        ? todayMidnight + s.arrivalSeconds * 1000
        : s.departureSeconds != null
          ? todayMidnight + s.departureSeconds * 1000
          : null;
    const liveMs =
      update?.arrivalTimeMs ??
      update?.departureTimeMs ??
      (scheduledMs != null && update?.arrivalDelaySec != null
        ? scheduledMs + update.arrivalDelaySec * 1000
        : scheduledMs != null && update?.departureDelaySec != null
          ? scheduledMs + update.departureDelaySec * 1000
          : null);
    const delaySec =
      update?.arrivalDelaySec ?? update?.departureDelaySec ?? null;

    const isUser = s.stopId === context.userStopId;
    const isCurrent =
      activeSequence != null && s.stopSequence === activeSequence;
    const stopClockMs = liveMs ?? scheduledMs;
    const isPast =
      !skipped &&
      (activeSequence != null
        ? s.stopSequence < activeSequence
        : stopClockMs != null && stopClockMs < Date.now() - 60_000);

    return {
      s,
      scheduledMs,
      liveMs,
      delaySec,
      skipped,
      isUser,
      isCurrent,
      isPast,
    };
  });

  const hasCurrent = rows.some((r) => r.isCurrent);
  const nextUpIndex = hasCurrent
    ? -1
    : rows.findIndex((r) => !r.isPast && !r.skipped);

  const currentIdx = rows.findIndex((r) => r.isCurrent);
  const bridgeIndex =
    currentIdx >= 0
      ? currentIdx
      : nextUpIndex > 0
        ? nextUpIndex - 1
        : -1;

  return (
    <VStack spacing={6} alignment="leading">
      <HStack spacing={8}>
        <Text
          modifiers={[
            foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
            font({ size: 12, weight: 'semibold' }),
          ]}
        >
          {context.routeCode.toUpperCase()} · {stops.length} STOPS
        </Text>
        <Spacer />
        {tripUpdate ? (
          <Text
            modifiers={[
              foregroundStyle('#30D158'),
              font({ size: 11, weight: 'semibold' }),
            ]}
          >
            LIVE
          </Text>
        ) : null}
      </HStack>
      <VStack
        spacing={0}
        alignment="leading"
        modifiers={[
          background('#2C2C2E', shapes.roundedRectangle({ cornerRadius: 14 })),
        ]}
      >
        {rows.map((r, i) => (
          <StopRow
            key={`${r.s.stopId}-${r.s.stopSequence}`}
            stop={r.s}
            scheduledMs={r.scheduledMs}
            liveMs={r.liveMs}
            delaySec={r.delaySec}
            skipped={r.skipped}
            isUser={r.isUser}
            isCurrent={r.isCurrent}
            isNextUp={i === nextUpIndex}
            isLastPast={
              currentIdx < 0 && nextUpIndex > 0 && i === nextUpIndex - 1
            }
            isPast={r.isPast}
            currentStatus={context.livePosition?.currentStatus}
            isFirst={i === 0}
            isLast={i === rows.length - 1}
            animateBottomLine={i === bridgeIndex}
            animateTopLine={bridgeIndex >= 0 && i === bridgeIndex + 1}
            flowPhase={flowPhase}
          />
        ))}
      </VStack>
    </VStack>
  );
}

const ROW_HEIGHT = 54;
const LINE_SEGMENT_HEIGHT = (ROW_HEIGHT - 12) / 2;
const LINE_COLOR_PAST = '#48484A';
const LINE_COLOR_FUTURE = '#3A3A3C';
const LINE_COLOR_USER = '#30D158';
const LINE_COLOR_BUS = '#0A84FF';

const CHEVRON_PER_SEGMENT = 2;
const FLOW_PHASES = CHEVRON_PER_SEGMENT * 2;
const CHEVRON_SIZE = 10;

function LineSegment({ color }: { color: string }) {
  return (
    <HStack
      modifiers={[
        frame({ width: 2, height: LINE_SEGMENT_HEIGHT }),
        background(color, shapes.rectangle()),
      ]}
    >
      <Spacer />
    </HStack>
  );
}

function LineSlot() {
  return (
    <HStack modifiers={[frame({ width: 2, height: LINE_SEGMENT_HEIGHT })]}>
      <Spacer />
    </HStack>
  );
}

function AnimatedLine({
  flowPhase,
  position,
}: {
  flowPhase: number;
  position: 'aboveMarker' | 'belowMarker';
}) {
  const startIndex = position === 'belowMarker' ? 0 : CHEVRON_PER_SEGMENT;
  return (
    <VStack
      spacing={1}
      alignment="center"
      modifiers={[frame({ width: 12, height: LINE_SEGMENT_HEIGHT })]}
    >
      {Array.from({ length: CHEVRON_PER_SEGMENT }).map((_, i) => {
        const globalIndex = startIndex + i;
        return (
          <Image
            key={i}
            systemName="chevron.down"
            size={CHEVRON_SIZE}
            color={LINE_COLOR_BUS}
            modifiers={[
              opacity(globalIndex === flowPhase ? 1 : 0.25),
              animation(Animation.easeInOut({ duration: 0.25 }), flowPhase),
            ]}
          />
        );
      })}
    </VStack>
  );
}

function StopRow({
  stop,
  scheduledMs,
  liveMs,
  delaySec,
  skipped,
  isUser,
  isCurrent,
  isNextUp,
  isLastPast,
  isPast,
  currentStatus,
  isFirst,
  isLast,
  animateTopLine,
  animateBottomLine,
  flowPhase,
}: {
  stop: TripStopWithName;
  scheduledMs: number | null;
  liveMs: number | null;
  delaySec: number | null;
  skipped: boolean;
  isUser: boolean;
  isCurrent: boolean;
  isNextUp: boolean;
  /** Derived "bus just passed here" — the past stop immediately before next-up. */
  isLastPast?: boolean;
  isPast: boolean;
  currentStatus?: VehiclePosition['currentStatus'];
  isFirst: boolean;
  isLast: boolean;
  animateTopLine?: boolean;
  animateBottomLine?: boolean;
  flowPhase: number;
}) {
  const accessible = stop.wheelchairBoarding === 1;
  const clock = liveMs ?? scheduledMs;
  const clockLabel = clock != null ? formatClockHM(clock) : '—';
  const delayText = formatDelay(delaySec);
  const minutesAway =
    liveMs != null
      ? Math.max(0, Math.round((liveMs - Date.now()) / 60_000))
      : scheduledMs != null
        ? Math.max(0, Math.round((scheduledMs - Date.now()) / 60_000))
        : null;
  const etaText =
    skipped || isPast
      ? null
      : minutesAway === 0
        ? 'now'
        : minutesAway != null && minutesAway < 60
          ? `${minutesAway} min`
          : null;

  // Marker semantics:
  //  - isCurrent (feed says bus is AT this stop)      → blue bus icon
  //  - isLastPast (derived: last past before next-up) → blue bus icon (bus just left)
  //  - isNextUp (feed lacks seq; bus is heading here) → green bus-stop icon
  //  - isPast (not the bridge)                        → grey checkmark
  //  - isUser                                         → green filled circle
  //  - else                                           → grey outline circle
  const showBusIcon = isCurrent || isLastPast;
  let markerSymbol: SFSymbol;
  let markerColor: string;
  if (showBusIcon) {
    markerSymbol = 'bus.fill';
    markerColor = LINE_COLOR_BUS;
  } else if (isNextUp) {
    markerSymbol = 'signpost.right.fill';
    markerColor = LINE_COLOR_USER;
  } else if (isPast) {
    markerSymbol = 'checkmark.circle.fill';
    markerColor = '#636366';
  } else if (isUser) {
    markerSymbol = 'circle.fill';
    markerColor = LINE_COLOR_USER;
  } else {
    markerSymbol = 'circle';
    markerColor = '#636366';
  }

  const topLineColor = isPast ? LINE_COLOR_PAST : LINE_COLOR_FUTURE;
  const bottomLineColor = isPast ? LINE_COLOR_PAST : LINE_COLOR_FUTURE;

  const nameColor = skipped
    ? '#8E8E93'
    : isPast && !showBusIcon
      ? '#8E8E93'
      : showBusIcon
        ? LINE_COLOR_BUS
        : isNextUp
          ? LINE_COLOR_USER
          : '#FFFFFF';
  const strike = skipped;

  return (
    <HStack
      spacing={12}
      alignment="center"
      modifiers={[
        padding({ horizontal: 14 }),
        frame({ height: ROW_HEIGHT }),
      ]}
    >
      <VStack spacing={0} alignment="center" modifiers={[frame({ width: 12 })]}>
        {isFirst ? (
          <LineSlot />
        ) : animateTopLine ? (
          <AnimatedLine flowPhase={flowPhase} position="aboveMarker" />
        ) : (
          <LineSegment color={topLineColor} />
        )}
        <Image systemName={markerSymbol} size={12} color={markerColor} />
        {isLast ? (
          <LineSlot />
        ) : animateBottomLine ? (
          <AnimatedLine flowPhase={flowPhase} position="belowMarker" />
        ) : (
          <LineSegment color={bottomLineColor} />
        )}
      </VStack>
      <VStack spacing={2} alignment="leading">
        <HStack spacing={6}>
          <Text
            modifiers={[
              font({ size: 15, weight: isUser ? 'semibold' : 'regular' }),
              foregroundStyle(nameColor),
            ]}
          >
            {strike
              ? `${formatStopName(stop.stopName)}`
              : formatStopName(stop.stopName)}
          </Text>
          {accessible ? (
            <Image systemName="figure.roll" size={11} color="#0A84FF" />
          ) : null}
        </HStack>
        {skipped ? (
          <Text
            modifiers={[
              foregroundStyle('#FF453A'),
              font({ size: 11, weight: 'semibold' }),
            ]}
          >
            SKIPPED
          </Text>
        ) : isUser ? (
          <Text
            modifiers={[
              foregroundStyle('#30D158'),
              font({ size: 11, weight: 'semibold' }),
            ]}
          >
            YOUR STOP
          </Text>
        ) : isNextUp ? (
          <Text
            modifiers={[
              foregroundStyle('#30D158'),
              font({ size: 11, weight: 'semibold' }),
            ]}
          >
            NEXT STOP
          </Text>
        ) : null}
      </VStack>
      <Spacer />
      <VStack spacing={2} alignment="trailing">
        {etaText ? (
          <Text
            modifiers={[
              font({ size: 14, weight: 'semibold' }),
              foregroundStyle(isUser ? '#30D158' : '#FFFFFF'),
            ]}
          >
            {etaText}
          </Text>
        ) : (
          <Text
            modifiers={[font({ size: 14 }), foregroundStyle('#8E8E93')]}
          >
            {skipped ? '—' : isPast ? 'passed' : clockLabel}
          </Text>
        )}
        {isPast && clock != null ? (
          <Text modifiers={[font({ size: 11 }), foregroundStyle('#636366')]}>
            {clockLabel}
          </Text>
        ) : delayText && !skipped && !isPast ? (
          <Text
            modifiers={[
              font({ size: 11 }),
              foregroundStyle(delayText.color),
            ]}
          >
            {delayText.text}
          </Text>
        ) : clock != null && !skipped && !isPast && etaText ? (
          <Text modifiers={[font({ size: 11 }), foregroundStyle('#8E8E93')]}>
            {clockLabel}
          </Text>
        ) : null}
      </VStack>
    </HStack>
  );
}

function useFlowPhase(intervalMs = 350): number {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const t = setInterval(
      () => setPhase((p) => (p + 1) % FLOW_PHASES),
      intervalMs,
    );
    return () => clearInterval(t);
  }, [intervalMs]);
  return phase;
}

function formatClockHM(ms: number): string {
  const d = new Date(ms);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function formatDelay(
  sec: number | null,
): { text: string; color: string } | null {
  if (sec == null) return null;
  const m = Math.round(sec / 60);
  if (m === 0) return { text: 'on time', color: '#30D158' };
  if (m > 0) return { text: `${m} min late`, color: '#FF9F0A' };
  return { text: `${Math.abs(m)} min early`, color: '#64D2FF' };
}
