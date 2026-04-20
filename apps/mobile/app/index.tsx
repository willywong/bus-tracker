import {
  Button,
  Form,
  Gauge,
  Host,
  HStack,
  Image,
  Section,
  Spacer,
  Text,
  VStack,
} from '@expo/ui/swift-ui';
import {
  buttonStyle,
  controlSize,
  font,
  foregroundStyle,
  gaugeStyle,
  glassEffect,
  padding,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { formatDistanceToNowStrict } from 'date-fns';
import { useEffect, useState } from 'react';
import { PlatformColor } from 'react-native';

import { glassIfAvailable } from '@/components/GlassGuard';
import { openDb } from '@/db/database';
import { getStops, type StopRow } from '@/db/queries';
import { useBusPosition } from '@/hooks/useBusPosition';
import { useEta, type ApproachingBus } from '@/hooks/useEta';
import { useSettings } from '@/hooks/useSettings';
import { useWalkTimer } from '@/hooks/useWalkTimer';

const STALE_TICKER_MS = 90_000;
/** Rough free-flow bus speed used to infer an "on-schedule" baseline for the delay gauge. */
const BASELINE_METERS_PER_MINUTE = 25_000 / 60;
/** Cap delta (minutes) that fills the gauge — anything ≥ this reads as fully delayed. */
const GAUGE_FULL_DELAY_MINUTES = 15;

type DelayStatus = 'onTime' | 'delayed' | 'heavilyDelayed';

function formatMinutes(bus: ApproachingBus | null): string {
  if (!bus || bus.minutesToStop == null) return '—';
  return `${bus.minutesToStop} min`;
}

function computeDelay(bus: ApproachingBus | null): {
  status: DelayStatus;
  deltaMin: number;
} | null {
  if (!bus || bus.minutesToStop == null) return null;
  const baseline = bus.forwardMeters / BASELINE_METERS_PER_MINUTE;
  const deltaMin = bus.minutesToStop - baseline;
  const status: DelayStatus =
    deltaMin <= 1 ? 'onTime' : deltaMin <= 5 ? 'delayed' : 'heavilyDelayed';
  return { status, deltaMin };
}

const statusLabel: Record<DelayStatus, string> = {
  onTime: 'On time',
  delayed: 'Delayed',
  heavilyDelayed: 'Heavily delayed',
};

const statusSystemColor: Record<DelayStatus, ReturnType<typeof PlatformColor>> =
  {
    onTime: PlatformColor('systemGreen'),
    delayed: PlatformColor('systemOrange'),
    heavilyDelayed: PlatformColor('systemRed'),
  };

function useLastUpdatedLabel(lastUpdated: number | null): {
  label: string;
  isStale: boolean;
} {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (lastUpdated == null) {
    return { label: 'Waiting for feed…', isStale: true };
  }
  const age = now - lastUpdated;
  const label = `Updated ${formatDistanceToNowStrict(lastUpdated, { addSuffix: true })}`;
  return { label, isStale: age >= STALE_TICKER_MS };
}

function formatWalkRemaining(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

export default function TrackerScreen() {
  const settings = useSettings();
  const { current, next, minutesToStop } = useEta({
    stopId: settings.preferredStopId,
    trafficProvider: settings.trafficProvider,
  });
  const { lastUpdated } = useBusPosition();
  const updatedTicker = useLastUpdatedLabel(lastUpdated);
  const walk = useWalkTimer(settings.walkMinutes);
  const [stopName, setStopName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = await openDb();
        const stops = await getStops(db);
        if (cancelled) return;
        const match = stops.find(
          (s: StopRow) => s.stop_id === settings.preferredStopId,
        );
        setStopName(match?.stop_name ?? null);
      } catch (err) {
        console.warn('[tracker] failed to load stop name', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settings.preferredStopId]);

  const leaveIn =
    minutesToStop == null
      ? null
      : Math.max(0, minutesToStop - settings.walkMinutes);
  const isLeaveNow = leaveIn != null && leaveIn <= 0;
  const headline = walk.isWalking
    ? `Walking — ${formatWalkRemaining(walk.remainingSeconds ?? 0)}`
    : leaveIn == null
      ? 'Waiting for bus…'
      : isLeaveNow
        ? 'Leave now'
        : `Leave in ${leaveIn} min`;

  const delay = computeDelay(current);
  const gaugeValue = delay
    ? Math.min(1, Math.max(0, delay.deltaMin) / GAUGE_FULL_DELAY_MINUTES)
    : 0;

  return (
    <Host style={{ flex: 1 }} useViewportSizeMeasurement>
      <VStack spacing={16} alignment="leading">
        <VStack
          alignment="leading"
          spacing={4}
          modifiers={[
            padding({ horizontal: 24, vertical: 20 }),
            ...glassIfAvailable(() =>
              glassEffect({
                glass: { variant: 'regular' },
                shape: 'roundedRectangle',
                cornerRadius: 28,
              }),
            ),
          ]}
        >
          <Text
            modifiers={[
              font({ size: 36, weight: 'bold', design: 'rounded' }),
              foregroundStyle(PlatformColor('label')),
            ]}
          >
            {headline}
          </Text>
          <Text
            modifiers={[
              font({ size: 13 }),
              foregroundStyle(PlatformColor('secondaryLabel')),
            ]}
          >
            {stopName ? `to ${stopName}` : 'to your stop'}
          </Text>
        </VStack>
        <Form>
          <Section title="T816 buses">
            <HStack spacing={8}>
              <Image systemName="bus.fill" size={20} />
              <Text>Current</Text>
              <Spacer />
              <Text modifiers={[font({ weight: 'semibold' })]}>
                {formatMinutes(current)}
              </Text>
            </HStack>
            <HStack spacing={8}>
              <Image systemName="arrow.right.circle" size={20} />
              <Text>Next</Text>
              <Spacer />
              <Text
                modifiers={[
                  font({ weight: 'semibold' }),
                  foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
                ]}
              >
                {formatMinutes(next)}
              </Text>
            </HStack>
          </Section>
          <Section>
            <Text
              modifiers={[
                font({ size: 13 }),
                foregroundStyle(
                  updatedTicker.isStale
                    ? PlatformColor('systemRed')
                    : { type: 'hierarchical', style: 'secondary' },
                ),
              ]}
            >
              {updatedTicker.label}
            </Text>
          </Section>
          {delay && (
            <Section title="Status">
              <HStack spacing={12} alignment="center">
                <Gauge
                  value={gaugeValue}
                  min={0}
                  max={1}
                  currentValueLabel={
                    <Text modifiers={[font({ weight: 'semibold' })]}>
                      {delay.deltaMin <= 0
                        ? '0m'
                        : `+${Math.round(delay.deltaMin)}m`}
                    </Text>
                  }
                  modifiers={[
                    gaugeStyle('circularCapacity'),
                    tint(statusSystemColor[delay.status]),
                  ]}
                />
                <VStack alignment="leading" spacing={2}>
                  <Text modifiers={[font({ weight: 'semibold' })]}>
                    {statusLabel[delay.status]}
                  </Text>
                  <Text
                    modifiers={[
                      font({ size: 12 }),
                      foregroundStyle({
                        type: 'hierarchical',
                        style: 'secondary',
                      }),
                    ]}
                  >
                    vs. free-flow baseline
                  </Text>
                </VStack>
                <Spacer />
              </HStack>
            </Section>
          )}
          <Section>
            {walk.isWalking ? (
              <Button
                systemImage="xmark.circle"
                role="destructive"
                onPress={() => {
                  void walk.cancel();
                }}
                modifiers={[buttonStyle('bordered'), controlSize('large')]}
                label="Cancel walk"
              />
            ) : (
              <Button
                systemImage="figure.walk"
                onPress={() => {
                  void walk.start();
                }}
                modifiers={[
                  buttonStyle('borderedProminent'),
                  controlSize('large'),
                ]}
                label="I'm leaving now"
              />
            )}
          </Section>
        </Form>
      </VStack>
    </Host>
  );
}
