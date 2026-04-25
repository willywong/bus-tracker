import type { VehiclePosition } from '@bus-tracker/shared';
import {
  BottomSheet,
  Group,
  HStack,
  Host,
  Image,
  ScrollView,
  Spacer,
  Text,
  VStack,
} from '@expo/ui/swift-ui';
import {
  background,
  font,
  foregroundStyle,
  frame,
  padding,
  presentationBackgroundInteraction,
  presentationDetents,
  presentationDragIndicator,
  shapes,
  type PresentationDetent,
} from '@expo/ui/swift-ui/modifiers';
import { useEffect, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

import { bearingToCardinal, formatStopName } from '@/components/map/format';
import {
  formatClockHHMM,
  formatDelayLabel,
  formatDistanceToStop,
  type DelayTone,
} from '@/components/tracker/logic';
import type { UseEtaResult } from '@/hooks/useEta';

import {
  TripStopsBody,
  type TripStopsSheetContext,
} from './TripStopsBody';

export type { TripStopsSheetContext } from './TripStopsBody';

export interface TripStopsSheetProps {
  context: TripStopsSheetContext | null;
  onDismiss: () => void;
  /** Optional live telemetry rendered as a minimal summary at the top of the sheet. */
  eta?: UseEtaResult;
  livePosition?: Pick<
    VehiclePosition,
    'speed' | 'bearing' | 'vehicleId'
  >;
  stopName?: string;
}

/**
 * Modal bottom sheet listing every stop on a given trip with per-stop ETA.
 * Presented on demand from the Map card; slides up over the tab bar like any
 * SwiftUI sheet and returns control when dismissed.
 */
export function TripStopsSheet({
  context,
  onDismiss,
  eta,
  livePosition,
  stopName,
}: TripStopsSheetProps) {
  const { width } = useWindowDimensions();
  const [detent, setDetent] = useState<PresentationDetent>('medium');
  const isPresented = context != null;

  useEffect(() => {
    if (isPresented) setDetent('medium');
  }, [isPresented]);

  return (
    <Host matchContents style={[{ position: 'absolute', width }]}>
      <BottomSheet
        isPresented={isPresented}
        onIsPresentedChange={(next) => {
          if (!next) onDismiss();
        }}
      >
        <Group
          modifiers={[
            presentationDetents(['medium', 'large'], {
              selection: detent,
              onSelectionChange: setDetent,
            }),
            presentationDragIndicator('visible'),
            presentationBackgroundInteraction('enabled'),
          ]}
        >
          <VStack
            spacing={14}
            alignment="leading"
            modifiers={[
              padding({ horizontal: 20, top: 18, bottom: 0 }),
              frame({ maxHeight: Infinity }),
            ]}
          >
            <HStack spacing={12}>
              <Text modifiers={[font({ size: 22, weight: 'bold' })]}>
                Stops on this trip
              </Text>
              <Spacer />
              <Image
                systemName="xmark.circle.fill"
                size={24}
                color="#636366"
                onPress={onDismiss}
              />
            </HStack>
            {eta && context ? (
              <LiveSummary
                eta={eta}
                routeCode={context.routeCode}
                livePosition={livePosition}
                stopName={stopName}
              />
            ) : null}
            <ScrollView
              modifiers={[frame({ maxHeight: Infinity })]}
            >
              <VStack
                spacing={14}
                alignment="leading"
                modifiers={[padding({ bottom: 28 })]}
              >
                {context ? <TripStopsBody context={context} /> : null}
              </VStack>
            </ScrollView>
          </VStack>
        </Group>
      </BottomSheet>
    </Host>
  );
}

function LiveSummary({
  eta,
  routeCode,
  livePosition,
  stopName,
}: {
  eta: UseEtaResult;
  routeCode: string;
  livePosition?: Pick<VehiclePosition, 'speed' | 'bearing' | 'vehicleId'>;
  stopName?: string;
}) {
  const derived = deriveSummary(eta);
  const vehicleId = livePosition?.vehicleId ?? eta.current?.vehicleId ?? null;
  const heading = bearingToCardinal(livePosition?.bearing);
  const distance = formatDistanceToStop(eta.current?.forwardMeters ?? null);
  const speed =
    livePosition?.speed != null && Number.isFinite(livePosition.speed)
      ? `${Math.round(livePosition.speed)} km/h`
      : null;
  const niceStop = stopName ? formatStopName(stopName) : null;
  const hasPills = Boolean(distance || speed || heading || vehicleId);

  return (
    <VStack spacing={8} alignment="leading">
      <HStack spacing={6} alignment="center">
        <Circle color={derived.dotColor} size={7} />
        <Text
          modifiers={[
            font({ size: 13, weight: 'semibold' }),
            foregroundStyle('#FFFFFF'),
          ]}
        >
          {derived.statusLabel.toUpperCase()} · {routeCode.toUpperCase()} · {derived.heroText}
        </Text>
        {derived.delayLabel ? (
          <Text
            modifiers={[
              font({ size: 12, weight: 'semibold' }),
              foregroundStyle(DELAY_COLOR[derived.delayLabel.tone]),
            ]}
          >
            · {derived.delayLabel.text}
          </Text>
        ) : null}
        <Spacer />
        {derived.scheduleClock ? (
          <Text
            modifiers={[
              font({ size: 12, weight: 'semibold' }),
              foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
            ]}
          >
            {derived.scheduleClock}
          </Text>
        ) : null}
      </HStack>
      {niceStop ? (
        <Text
          modifiers={[
            font({ size: 12 }),
            foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
          ]}
        >
          to {niceStop}
        </Text>
      ) : null}
      {hasPills ? (
        <HStack spacing={6} alignment="center">
          {distance ? (
            <MetricPill icon="ruler" text={distance} />
          ) : null}
          {speed ? (
            <MetricPill icon="speedometer" text={speed} />
          ) : null}
          {heading ? (
            <MetricPill icon="location.north.line.fill" text={heading} />
          ) : null}
          {vehicleId ? (
            <MetricPill icon="bus.fill" text={vehicleId} />
          ) : null}
          <Spacer />
        </HStack>
      ) : null}
    </VStack>
  );
}

function MetricPill({ icon, text }: { icon: SFSymbol; text: string }) {
  return (
    <HStack
      spacing={4}
      alignment="center"
      modifiers={[
        padding({ horizontal: 9, vertical: 4 }),
        background('#2C2C2E', shapes.capsule()),
      ]}
    >
      <Image systemName={icon} size={10} color="#8E8E93" />
      <Text
        modifiers={[
          font({ size: 11, weight: 'semibold' }),
          foregroundStyle('#FFFFFF'),
        ]}
      >
        {text}
      </Text>
    </HStack>
  );
}

function Circle({ color, size }: { color: string; size: number }) {
  return (
    <Image
      systemName="circle.fill"
      size={size}
      color={color}
      modifiers={[frame({ width: size, height: size })]}
    />
  );
}

const DELAY_COLOR: Record<DelayTone, string> = {
  'on-time': '#30D158',
  late: '#FF9F0A',
  early: '#64D2FF',
};

function deriveSummary(eta: UseEtaResult): {
  statusLabel: string;
  dotColor: string;
  heroText: string;
  scheduleClock: string | null;
  delayLabel: { text: string; tone: DelayTone } | null;
} {
  const hasCurrent = eta.current != null && eta.minutesToStop != null;
  let statusLabel: string;
  let dotColor: string;
  let heroText: string;

  if (eta.arrivalStatus === 'passed') {
    statusLabel = 'Passed';
    dotColor = '#8E8E93';
    heroText = 'Passed';
  } else if (hasCurrent) {
    if (eta.arrivalStatus === 'arrived') {
      statusLabel = 'Arrived';
      dotColor = '#30D158';
      heroText = 'Arrived';
    } else if (eta.arrivalStatus === 'arriving') {
      statusLabel = 'Arriving';
      dotColor = '#FF9F0A';
      heroText = 'Arriving';
    } else if (eta.isStale) {
      statusLabel = 'Stale';
      dotColor = '#FF9F0A';
      heroText = `${eta.minutesToStop} min away`;
    } else {
      statusLabel = 'Live';
      dotColor = '#30D158';
      heroText =
        eta.minutesToStop === 0
          ? 'Arriving now'
          : `${eta.minutesToStop} min away`;
    }
  } else {
    statusLabel = 'Waiting';
    dotColor = '#8E8E93';
    heroText = '—';
  }

  const scheduleClock =
    (statusLabel === 'Live' || statusLabel === 'Arriving') && eta.currentScheduled
      ? formatClockHHMM(eta.currentScheduled.departureEpochMs)
      : null;
  const delayLabel =
    statusLabel === 'Live' || statusLabel === 'Arriving'
      ? formatDelayLabel(eta.resolved.delay)
      : null;

  return { statusLabel, dotColor, heroText, scheduleClock, delayLabel };
}
