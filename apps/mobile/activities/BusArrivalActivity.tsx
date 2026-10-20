import {
  HStack,
  Image,
  ProgressView,
  Spacer,
  Text,
  VStack,
} from '@expo/ui/swift-ui';
import {
  background,
  contentTransition,
  font,
  foregroundStyle,
  labelsHidden,
  lineLimit,
  monospacedDigit,
  padding,
  rotationEffect,
  shapes,
  tint,
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
  /** Epoch ms of the realtime poll behind a live ETA ("as of 08:41"). Null for scheduled. */
  updatedAtEpochMs: number | null;
};

/**
 * Live Activity / Dynamic Island, mirroring the in-app trip sheet:
 *   compact  — route badge | "4 min"
 *   minimal  — the live minutes, not a logo
 *   expanded / Lock Screen — stop, big countdown, trip progress line, and a
 *   status line that says live vs scheduled with a glyph and a word.
 *   bannerSmall — Apple Watch Smart Stack and CarPlay: badge, number, status.
 *
 * The app passes a stale date with every live update. When it passes without
 * a fresh poll (app suspended, no signal), iOS sets `environment.isStale` and
 * the countdown greys out with "Last update 08:41" instead of a frozen
 * number posing as live.
 *
 * IMPORTANT: Everything inside this function (helpers, constants, literals)
 * must be inlined. The babel-preset-expo 'widget' plugin serializes this
 * function to a string at build time, and only identifiers available on the
 * widget-extension globalThis (the @expo/ui/swift-ui and modifiers exports,
 * React + jsx-runtime) are resolvable when the string is evaluated. Module-
 * scope helpers and constants will be `undefined` at widget runtime and the
 * Dynamic Island will render empty.
 */
const BusArrivalActivity: LiveActivityComponent<BusActivityProps> = (props, environment) => {
  'widget';

  // --- Palette (inlined — no module refs) --------------------------------
  // Calm Mono: ink on paper, green only for "live". The Dynamic Island is
  // always black, so it always uses light ink; the Lock Screen follows the
  // system appearance.
  const dark = environment?.colorScheme !== 'light';
  const ink = dark ? '#F5F5F7' : '#111114';
  const paper = dark ? '#0E0E10' : '#FFFFFF';
  const islandInk = '#F5F5F7';
  const live = '#30D158';
  const warning = '#FF9F0A';

  const isPreService = props.kind === 'pre-service';
  const systemStale = !!environment?.isStale;
  const isOutdated = (props.isStale || systemStale) && props.source === 'live';
  const isArrived = !isPreService && props.arrivalStatus === 'arrived';
  const isArriving = !isPreService && props.arrivalStatus === 'arriving';
  const isLive = !isPreService && props.source === 'live' && !isOutdated;

  const minutes =
    props.minutesToStop != null ? Math.max(0, Math.floor(props.minutesToStop)) : null;

  const clockOf = (ms: number) =>
    new Date(ms).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Kuala_Lumpur',
    });
  const arrivalClock = clockOf(props.arrivalEpochMs);
  const updatedClock = props.updatedAtEpochMs != null ? clockOf(props.updatedAtEpochMs) : null;

  // The one number. Words for the moments that matter; clock time before
  // service or an hour+ out; never "0 min" and never seconds.
  let heroText: string;
  let heroUnit: string | null = null;
  if (isPreService) {
    heroText = arrivalClock;
  } else if (isArrived) {
    heroText = 'Here';
  } else if (isArriving) {
    heroText = 'Arriving';
  } else if (minutes == null) {
    heroText = arrivalClock;
  } else if (minutes < 1) {
    heroText = 'Due';
  } else if (minutes >= 60) {
    heroText = arrivalClock;
  } else {
    heroText = String(minutes);
    heroUnit = 'min';
  }
  const compactText = heroUnit ? `${heroText} ${heroUnit}` : heroText;
  const minimalText = heroUnit ? heroText : isArrived || isArriving ? '•' : heroText;

  // Status line: glyph + word, colour only reinforces.
  let statusIcon:
    | 'dot.radiowaves.left.and.right'
    | 'clock'
    | 'clock.badge.exclamationmark'
    | 'sunrise'
    | 'checkmark.circle.fill' = 'clock';
  let statusColor: string | null = null;
  let statusText = 'Scheduled';
  if (isPreService) {
    statusIcon = 'sunrise';
    statusText = 'First bus of the day';
  } else if (isArrived) {
    statusIcon = 'checkmark.circle.fill';
    statusColor = live;
    statusText = 'At your stop';
  } else if (isOutdated) {
    statusIcon = 'clock.badge.exclamationmark';
    statusColor = warning;
    statusText = systemStale && updatedClock ? `Last update ${updatedClock}` : 'Updating…';
  } else if (isLive) {
    statusIcon = 'dot.radiowaves.left.and.right';
    statusColor = live;
    statusText = 'Live';
    const dm = props.distanceToStopMeters;
    if (dm != null && Number.isFinite(dm) && dm >= 0) {
      statusText += dm < 1000 ? ` · ${Math.round(dm / 50) * 50} m away` : ` · ${(dm / 1000).toFixed(1)} km away`;
    }
    if (props.delayTone === 'late' && props.delayMinutes != null) {
      statusText += ` · ${Math.abs(Math.round(props.delayMinutes))} min late`;
    }
  }
  const trailingText =
    isPreService || heroUnit == null
      ? ''
      : isLive && updatedClock
        ? `as of ${updatedClock}`
        : `Arrives ${arrivalClock}`;

  const tripStartDate = new Date(props.tripStartEpochMs);
  const arrivalDate = new Date(props.arrivalEpochMs);

  const badge = (size: number, onIsland = false) => (
    <Text
      modifiers={[
        font({ size, weight: 'semibold' }),
        monospacedDigit(),
        foregroundStyle(onIsland ? '#000000' : paper),
        padding({ horizontal: size * 0.5, vertical: size * 0.2 }),
        background(onIsland ? islandInk : ink, shapes.roundedRectangle({ cornerRadius: size * 0.4 })),
        lineLimit(1),
      ]}
    >
      {props.routeCode}
    </Text>
  );

  const statusRow = (size: number) => (
    <HStack spacing={5}>
      <Image
        systemName={statusIcon}
        size={size}
        modifiers={[
          foregroundStyle(
            statusColor ?? { type: 'hierarchical', style: 'secondary' },
          ),
        ]}
      />
      <Text
        modifiers={[
          font({ size: size + 2, weight: isLive ? 'semibold' : 'medium' }),
          foregroundStyle(
            isLive ? { type: 'hierarchical', style: 'primary' } : { type: 'hierarchical', style: 'secondary' },
          ),
          lineLimit(1),
        ]}
      >
        {statusText}
      </Text>
      <Spacer />
      {trailingText ? (
        <Text
          modifiers={[
            font({ size: size + 1, weight: 'medium' }),
            monospacedDigit(),
            foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
          ]}
        >
          {trailingText}
        </Text>
      ) : null}
    </HStack>
  );

  const progressRow = (onIsland = false) => isPreService ? null : (
    <HStack spacing={8}>
      <Image systemName="location.north.fill" size={12} modifiers={[foregroundStyle(onIsland ? islandInk : ink), rotationEffect(90)]} />
      <ProgressView
        timerInterval={{ lower: tripStartDate, upper: arrivalDate }}
        countsDown={false}
        modifiers={[labelsHidden(), tint(onIsland ? islandInk : ink)]}
      />
      <Image systemName="smallcircle.filled.circle" size={15} modifiers={[foregroundStyle(onIsland ? islandInk : ink)]} />
    </HStack>
  );

  const hero = (size: number) => (
    <HStack spacing={4} alignment="firstTextBaseline">
      <Text
        modifiers={[
          font({ size: heroUnit ? size : size * 0.7, weight: 'light' }),
          monospacedDigit(),
          contentTransition('numericText', { countsDown: true }),
          foregroundStyle(
            isArrived
              ? live
              : { type: 'hierarchical', style: isOutdated ? 'secondary' : 'primary' },
          ),
          lineLimit(1),
        ]}
      >
        {heroText}
      </Text>
      {heroUnit ? (
        <Text
          modifiers={[
            font({ size: size * 0.42, weight: 'regular' }),
            foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
          ]}
        >
          {heroUnit}
        </Text>
      ) : null}
    </HStack>
  );

  // --- Dynamic Island ------------------------------------------------------
  const compactLeading = (
    <HStack modifiers={[padding({ leading: 2 })]}>{badge(12, true)}</HStack>
  );
  const compactTrailing = (
    <Text
      modifiers={[
        font({ size: 15, weight: 'medium' }),
        monospacedDigit(),
        contentTransition('numericText', { countsDown: true }),
        foregroundStyle(isArrived ? live : islandInk),
        padding({ trailing: 2 }),
        lineLimit(1),
      ]}
    >
      {compactText}
    </Text>
  );
  const minimal = (
    <Text
      modifiers={[
        font({ size: 15, weight: 'medium' }),
        monospacedDigit(),
        foregroundStyle(isArrived ? live : islandInk),
        lineLimit(1),
      ]}
    >
      {minimalText}
    </Text>
  );

  const expandedBottom = (
    <VStack spacing={10} modifiers={[padding({ horizontal: 12, top: 2, bottom: 8 })]}>
      <HStack spacing={8} alignment="center">
        {badge(13, true)}
        <Text
          modifiers={[
            font({ size: 15, weight: 'semibold' }),
            lineLimit(1),
          ]}
        >
          {props.stopName}
        </Text>
        <Spacer />
        {hero(30)}
      </HStack>
      {progressRow(true)}
      {statusRow(12)}
    </VStack>
  );

  // --- Lock Screen ---------------------------------------------------------
  const banner = (
    <VStack spacing={10} modifiers={[padding({ horizontal: 16, vertical: 14 })]}>
      <HStack spacing={8} alignment="center">
        {badge(14)}
        <VStack spacing={0} alignment="leading">
          <Text
            modifiers={[
              font({ size: 15, weight: 'semibold' }),
              lineLimit(1),
            ]}
          >
            {props.stopName}
          </Text>
          {isPreService ? (
            <Text
              modifiers={[
                font({ size: 13 }),
                foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
              ]}
            >
              First bus
            </Text>
          ) : null}
        </VStack>
        <Spacer />
        {hero(40)}
      </HStack>
      {progressRow()}
      {statusRow(12)}
    </VStack>
  );

  // --- Apple Watch Smart Stack / CarPlay ------------------------------------
  const bannerSmall = (
    <VStack spacing={4} alignment="leading" modifiers={[padding({ horizontal: 10, vertical: 8 })]}>
      <HStack spacing={6} alignment="center">
        {badge(11, true)}
        <Spacer />
        {hero(24)}
      </HStack>
      {statusRow(10)}
    </VStack>
  );

  return {
    compactLeading,
    compactTrailing,
    minimal,
    expandedBottom,
    banner,
    bannerSmall,
  };
};

export default createLiveActivity(LIVE_ACTIVITY_NAME, BusArrivalActivity);
