import {
  Circle,
  HStack,
  Image,
  ProgressView,
  Spacer,
  Text,
  VStack,
} from '@expo/ui/swift-ui';
import {
  background,
  font,
  foregroundStyle,
  frame,
  labelsHidden,
  monospacedDigit,
  padding,
  shapes,
} from '@expo/ui/swift-ui/modifiers';
import {
  createLiveActivity,
  type LiveActivityComponent,
} from 'expo-widgets';

import { LIVE_ACTIVITY_NAME } from '@/constants/liveActivity';

export type BusActivityProps = {
  /** 'arrival' = bus approaching; 'pre-service' = waiting for first bus of the day. */
  kind: 'arrival' | 'pre-service';
  routeCode: string;
  /** Minutes until the bus reaches the stop. Null in pre-service (no active ETA). */
  minutesToStop: number | null;
  /** Target time: next arrival (arrival) or first-bus-today (pre-service). */
  arrivalEpochMs: number;
  /** Absolute ms when tracking started. Stable across updates; drives the progress bar. */
  tripStartEpochMs: number;
  delayMinutes: number | null;
  delayTone: 'on-time' | 'late' | 'early' | null;
  stopName: string;
  busPlate: string | null;
  source: 'live' | 'schedule';
  /** Distance remaining along the route polyline, in meters. Null until realtime reports it. */
  distanceToStopMeters: number | null;
  /** True when the latest realtime update is older than the stale threshold (~90s). */
  isStale: boolean;
  /** Contextual proximity — 'arriving' = <300 m or ≤1 min; 'arrived' = docked at stop (latched ~45s). */
  arrivalStatus: 'en-route' | 'arriving' | 'arrived';
};

/**
 * IMPORTANT: Everything inside this function (helpers, constants, literals)
 * must be inlined. The babel-preset-expo 'widget' plugin serializes this
 * function to a string at build time, and only identifiers available on the
 * widget-extension globalThis (the @expo/ui/swift-ui and modifiers exports,
 * React + jsx-runtime) are resolvable when the string is evaluated. Module-
 * scope helpers and constants will be `undefined` at widget runtime and the
 * Dynamic Island will render empty.
 */
const BusArrivalActivity: LiveActivityComponent<BusActivityProps> = (props) => {
  'widget';

  // --- Palette (inlined — no module refs) --------------------------------
  const liveBlue = '#0A84FF';
  const scheduleCyan = '#64D2FF';
  const staleGray = '#8E8E93';
  const lateAmber = '#FF9F0A';
  const onTimeGreen = '#34C759';
  const earlyBlue = '#0A84FF';
  const pinRed = '#FF453A';

  const isPreService = props.kind === 'pre-service';

  const accent = isPreService
    ? scheduleCyan
    : props.source === 'live'
      ? liveBlue
      : scheduleCyan;
  const statusAccent = props.isStale ? staleGray : accent;
  const statusLabel = isPreService
    ? 'FIRST BUS'
    : props.isStale
      ? 'STALE'
      : props.source === 'live'
        ? 'LIVE'
        : 'SCHEDULED';
  const statusIcon = isPreService
    ? 'sunrise.fill'
    : props.isStale
      ? 'exclamationmark.circle.fill'
      : props.source === 'live'
        ? 'dot.radiowaves.left.and.right'
        : 'clock.fill';

  // --- Derived values ----------------------------------------------------
  const minutes =
    props.minutesToStop != null ? Math.max(0, props.minutesToStop) : 0;
  const minutesCompact = `${minutes}m`;

  // Distance formatter (inline — matches components/tracker/logic.ts)
  let distanceText: string | null = null;
  const dm = props.distanceToStopMeters;
  if (dm != null && Number.isFinite(dm) && dm >= 0) {
    distanceText =
      dm < 1000
        ? `${Math.round(dm / 10) * 10} m`
        : `${(dm / 1000).toFixed(1)} km`;
  }

  // Delay chip formatting
  let delayText: string | null = null;
  let delayHex: string | null = null;
  if (!isPreService && props.delayTone != null && props.delayMinutes != null) {
    const m = Math.abs(Math.round(props.delayMinutes));
    if (props.delayTone === 'on-time') {
      delayText = 'On time';
      delayHex = onTimeGreen;
    } else if (props.delayTone === 'late') {
      delayText = `${m} min late`;
      delayHex = lateAmber;
    } else {
      delayText = `${m} min early`;
      delayHex = earlyBlue;
    }
  }

  // Arrival-status pill (inline). Only when a live trip is ticking — not in
  // pre-service. Arrived = green, Arriving = amber.
  const isArrived = !isPreService && props.arrivalStatus === 'arrived';
  const isArriving = !isPreService && props.arrivalStatus === 'arriving';
  let arrivalPillText: string | null = null;
  let arrivalPillHex: string | null = null;
  let arrivalPillIcon:
    | 'checkmark.circle.fill'
    | 'figure.walk'
    | null = null;
  if (isArrived) {
    arrivalPillText = 'ARRIVED';
    arrivalPillHex = onTimeGreen;
    arrivalPillIcon = 'checkmark.circle.fill';
  } else if (isArriving) {
    arrivalPillText = 'ARRIVING';
    arrivalPillHex = lateAmber;
    arrivalPillIcon = 'figure.walk';
  }

  // Arrival clock — KL timezone, 12-hour.
  const arrivalDate = new Date(props.arrivalEpochMs);
  const arrivalClock = arrivalDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kuala_Lumpur',
  });

  // Progress bar range — trip start → arrival.
  const tripStartDate = new Date(props.tripStartEpochMs);

  // Inline pill helper — Capsule-shaped background + icon + small label.
  // Must be defined inside the 'widget' function; module-scope would be
  // undefined at widget runtime.
  const pill = (
    systemImage: 'dot.radiowaves.left.and.right' | 'clock.fill' | 'exclamationmark.circle.fill' | 'bus.fill' | 'location.fill' | 'clock.arrow.circlepath' | 'sunrise.fill' | 'checkmark.circle.fill' | 'figure.walk',
    title: string,
    tint: string,
  ) => (
    <HStack
      spacing={3}
      modifiers={[
        padding({ horizontal: 7, vertical: 3 }),
        background(`${tint}26`, shapes.capsule()),
      ]}
    >
      <Image
        systemName={systemImage}
        size={9}
        modifiers={[foregroundStyle(tint)]}
      />
      <Text
        modifiers={[
          font({ size: 11, weight: 'semibold', design: 'rounded' }),
          foregroundStyle(tint),
        ]}
      >
        {title}
      </Text>
    </HStack>
  );

  // --- Compact: idle notch ----------------------------------------------
  // Tiny status dot + bus glyph, live/cyan/gray-stale coded.
  const compactLeading = (
    <HStack spacing={4} modifiers={[padding({ leading: 4 })]}>
      <Circle
        modifiers={[
          frame({ width: 5, height: 5 }),
          foregroundStyle(statusAccent),
        ]}
      />
      <Image
        systemName={isPreService ? 'sunrise.fill' : 'bus.fill'}
        size={15}
        modifiers={[foregroundStyle(accent)]}
      />
    </HStack>
  );
  const compactTrailingText = isPreService
    ? arrivalClock
    : isArrived
      ? 'Here'
      : isArriving
        ? 'Soon'
        : minutesCompact;
  const compactTrailingColor = isArrived
    ? onTimeGreen
    : isArriving
      ? lateAmber
      : accent;
  const compactTrailing = (
    <HStack spacing={0} modifiers={[padding({ trailing: 4 })]}>
      <Text
        modifiers={[
          font({ size: 15, weight: 'semibold', design: 'rounded' }),
          monospacedDigit(),
          foregroundStyle(compactTrailingColor),
        ]}
      >
        {compactTrailingText}
      </Text>
    </HStack>
  );

  // --- Minimal: focus-compact ------------------------------------------
  const minimal = (
    <Image
      systemName={isPreService ? 'sunrise.fill' : 'bus.fill'}
      size={14}
      modifiers={[foregroundStyle(accent)]}
    />
  );

  // --- Expanded: long-press island -------------------------------------
  const expandedBottom = isPreService ? (
    <VStack spacing={10} modifiers={[padding({ horizontal: 12, top: 2, bottom: 6 })]}>
      <HStack spacing={6} alignment="firstTextBaseline">
        <Text
          modifiers={[
            font({ size: 20, weight: 'semibold', design: 'rounded' }),
          ]}
        >
          First bus at
        </Text>
        <Text
          modifiers={[
            font({ size: 20, weight: 'semibold', design: 'rounded' }),
            monospacedDigit(),
            foregroundStyle(accent),
          ]}
        >
          {arrivalClock}
        </Text>
        <Spacer />
      </HStack>

      <HStack spacing={6}>
        <Text
          modifiers={[
            font({ size: 11, weight: 'semibold', design: 'rounded' }),
            foregroundStyle(accent),
          ]}
        >
          {props.routeCode}
        </Text>
        <Spacer />
        <Text
          modifiers={[
            font({ size: 11, weight: 'regular' }),
            foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
          ]}
        >
          {props.stopName}
        </Text>
      </HStack>

      <HStack spacing={6}>
        {pill(statusIcon, statusLabel, statusAccent)}
        <Spacer />
      </HStack>
    </VStack>
  ) : (
    <VStack spacing={10} modifiers={[padding({ horizontal: 12, top: 2, bottom: 6 })]}>
      {isArrived ? (
        <HStack spacing={6} alignment="firstTextBaseline">
          <Text
            modifiers={[
              font({ size: 20, weight: 'semibold', design: 'rounded' }),
              foregroundStyle(onTimeGreen),
            ]}
          >
            Arrived
          </Text>
          <Text
            modifiers={[
              font({ size: 14, weight: 'regular', design: 'rounded' }),
              foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
            ]}
          >
            at your stop
          </Text>
          <Spacer />
        </HStack>
      ) : isArriving ? (
        <HStack spacing={6} alignment="firstTextBaseline">
          <Text
            modifiers={[
              font({ size: 20, weight: 'semibold', design: 'rounded' }),
              foregroundStyle(lateAmber),
            ]}
          >
            Arriving…
          </Text>
          <Text
            modifiers={[
              font({ size: 14, weight: 'regular', design: 'rounded' }),
              foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
            ]}
          >
            {`~ ${arrivalClock}`}
          </Text>
          <Spacer />
        </HStack>
      ) : (
        <HStack spacing={6} alignment="firstTextBaseline">
          <Text
            modifiers={[
              font({ size: 20, weight: 'semibold', design: 'rounded' }),
            ]}
          >
            Arrives in
          </Text>
          <Text
            modifiers={[
              font({ size: 20, weight: 'semibold', design: 'rounded' }),
              monospacedDigit(),
              foregroundStyle(accent),
            ]}
          >
            {`${minutes} min`}
          </Text>
          <Text
            modifiers={[
              font({ size: 14, weight: 'regular', design: 'rounded' }),
              foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
            ]}
          >
            {`at ${arrivalClock}`}
          </Text>
          <Spacer />
        </HStack>
      )}

      <VStack spacing={4}>
        <HStack spacing={8}>
          <Image
            systemName="bus.fill"
            size={13}
            modifiers={[foregroundStyle(accent)]}
          />
          <ProgressView
            timerInterval={{ lower: tripStartDate, upper: arrivalDate }}
            countsDown={false}
            modifiers={[labelsHidden()]}
          />
          <Image
            systemName="signpost.right.fill"
            size={15}
            modifiers={[foregroundStyle(pinRed)]}
          />
        </HStack>
        <HStack spacing={6}>
          <Text
            modifiers={[
              font({ size: 11, weight: 'semibold', design: 'rounded' }),
              foregroundStyle(accent),
            ]}
          >
            {props.routeCode}
          </Text>
          <Spacer />
          <Text
            modifiers={[
              font({ size: 11, weight: 'regular' }),
              foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
            ]}
          >
            {props.stopName}
          </Text>
        </HStack>
      </VStack>

      <HStack spacing={6}>
        {pill(statusIcon, statusLabel, statusAccent)}
        {arrivalPillText && arrivalPillHex && arrivalPillIcon
          ? pill(arrivalPillIcon, arrivalPillText, arrivalPillHex)
          : null}
        {props.busPlate ? pill('bus.fill', props.busPlate, staleGray) : null}
        {distanceText ? pill('location.fill', distanceText, staleGray) : null}
        {delayText && delayHex
          ? pill('clock.arrow.circlepath', delayText, delayHex)
          : null}
        <Spacer />
      </HStack>
    </VStack>
  );

  // --- Banner: lock screen / notification center ------------------------
  const banner = isPreService ? (
    <VStack
      spacing={10}
      modifiers={[padding({ horizontal: 16, vertical: 14 })]}
    >
      <HStack spacing={6}>
        <Image
          systemName={statusIcon}
          size={11}
          modifiers={[foregroundStyle(statusAccent)]}
        />
        <Text
          modifiers={[
            font({ size: 12, weight: 'semibold', design: 'rounded' }),
            foregroundStyle(statusAccent),
          ]}
        >
          {`${statusLabel} · ${props.routeCode}`}
        </Text>
        <Spacer />
      </HStack>

      <HStack spacing={6} alignment="firstTextBaseline">
        <Text
          modifiers={[
            font({ size: 40, weight: 'bold', design: 'rounded' }),
            monospacedDigit(),
            foregroundStyle(accent),
          ]}
        >
          {arrivalClock}
        </Text>
        <Spacer />
      </HStack>

      <HStack spacing={6}>
        <Text
          modifiers={[
            font({ size: 13, weight: 'regular' }),
            foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
          ]}
        >
          First bus of the day
        </Text>
        <Spacer />
        <Text
          modifiers={[
            font({ size: 13, weight: 'regular' }),
            foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
          ]}
        >
          {props.stopName}
        </Text>
      </HStack>
    </VStack>
  ) : (
    <VStack
      spacing={8}
      modifiers={[padding({ horizontal: 16, vertical: 12 })]}
    >
      <HStack spacing={6}>
        <Image
          systemName={statusIcon}
          size={11}
          modifiers={[foregroundStyle(statusAccent)]}
        />
        <Text
          modifiers={[
            font({ size: 12, weight: 'semibold', design: 'rounded' }),
            foregroundStyle(statusAccent),
          ]}
        >
          {`${statusLabel} · ${props.routeCode}`}
        </Text>
        <Spacer />
        <Text
          modifiers={[
            font({ size: 13, weight: 'regular' }),
            foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
          ]}
        >
          {`Arrives ${arrivalClock}`}
        </Text>
      </HStack>

      {isArrived ? (
        <HStack
          spacing={8}
          alignment="firstTextBaseline"
          modifiers={[padding({ top: 2, bottom: 2 })]}
        >
          <Text
            modifiers={[
              font({ size: 34, weight: 'bold', design: 'rounded' }),
              foregroundStyle(onTimeGreen),
            ]}
          >
            Arrived
          </Text>
          <Text
            modifiers={[
              font({ size: 15, weight: 'medium', design: 'rounded' }),
              foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
            ]}
          >
            at your stop
          </Text>
          <Spacer />
          <Text
            modifiers={[
              font({ size: 13, weight: 'regular' }),
              foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
            ]}
          >
            {props.stopName}
          </Text>
        </HStack>
      ) : isArriving ? (
        <HStack
          spacing={8}
          alignment="firstTextBaseline"
          modifiers={[padding({ top: 2, bottom: 2 })]}
        >
          <Text
            modifiers={[
              font({ size: 34, weight: 'bold', design: 'rounded' }),
              foregroundStyle(lateAmber),
            ]}
          >
            Arriving…
          </Text>
          <Text
            modifiers={[
              font({ size: 15, weight: 'medium', design: 'rounded' }),
              foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
            ]}
          >
            near your stop
          </Text>
          <Spacer />
          <Text
            modifiers={[
              font({ size: 13, weight: 'regular' }),
              foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
            ]}
          >
            {props.stopName}
          </Text>
        </HStack>
      ) : (
        <HStack
          spacing={6}
          alignment="firstTextBaseline"
          modifiers={[padding({ top: 2, bottom: 2 })]}
        >
          <Text
            modifiers={[
              font({ size: 44, weight: 'bold', design: 'rounded' }),
              monospacedDigit(),
            ]}
          >
            {String(minutes)}
          </Text>
          <Text
            modifiers={[
              font({ size: 17, weight: 'medium', design: 'rounded' }),
              foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
            ]}
          >
            min away
          </Text>
          <Spacer />
          <Text
            modifiers={[
              font({ size: 13, weight: 'regular' }),
              foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
            ]}
          >
            {props.stopName}
          </Text>
        </HStack>
      )}

      <HStack spacing={10}>
        <Image
          systemName="bus.fill"
          size={14}
          modifiers={[foregroundStyle(accent)]}
        />
        <ProgressView
          timerInterval={{ lower: tripStartDate, upper: arrivalDate }}
          countsDown={false}
          modifiers={[labelsHidden()]}
        />
        <Image
          systemName="signpost.right.fill"
          size={17}
          modifiers={[foregroundStyle(pinRed)]}
        />
      </HStack>

      <HStack spacing={6}>
        {arrivalPillText && arrivalPillHex && arrivalPillIcon
          ? pill(arrivalPillIcon, arrivalPillText, arrivalPillHex)
          : null}
        {props.busPlate ? pill('bus.fill', props.busPlate, staleGray) : null}
        {distanceText ? pill('location.fill', distanceText, staleGray) : null}
        {delayText && delayHex
          ? pill('clock.arrow.circlepath', delayText, delayHex)
          : null}
        <Spacer />
      </HStack>
    </VStack>
  );

  return {
    compactLeading,
    compactTrailing,
    minimal,
    expandedBottom,
    banner,
  };
};

export default createLiveActivity(LIVE_ACTIVITY_NAME, BusArrivalActivity);
