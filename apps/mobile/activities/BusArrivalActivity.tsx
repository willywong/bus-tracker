import { HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  foregroundStyle,
  padding,
} from '@expo/ui/swift-ui/modifiers';
import {
  createLiveActivity,
  type LiveActivityComponent,
} from 'expo-widgets';

import {
  BUS_SYSTEM_ICON,
  LIVE_ACTIVITY_ACCENT,
  LIVE_ACTIVITY_NAME,
} from '@/constants/liveActivity';

export type BusActivityProps = {
  routeCode: string;
  minutesToStop: number;
  arrivalEpochMs: number;
  delayMinutes: number | null;
  delayTone: 'on-time' | 'late' | 'early' | null;
  stopName: string;
  busPlate: string | null;
  source: 'live' | 'schedule';
};

function accentFor(
  props: BusActivityProps,
  env: { colorScheme: 'light' | 'dark' },
): string {
  if (env.colorScheme === 'dark') return '#FFFFFF';
  if (props.source === 'live') return LIVE_ACTIVITY_ACCENT.live;
  return LIVE_ACTIVITY_ACCENT.schedule;
}

function delayColor(tone: BusActivityProps['delayTone']): string | null {
  if (tone === 'late') return LIVE_ACTIVITY_ACCENT.late;
  if (tone === 'early') return LIVE_ACTIVITY_ACCENT.early;
  if (tone === 'on-time') return LIVE_ACTIVITY_ACCENT.onTime;
  return null;
}

function delayLabel(props: BusActivityProps): string | null {
  if (props.delayTone == null || props.delayMinutes == null) return null;
  if (props.delayTone === 'on-time') return 'on time';
  const m = Math.abs(Math.round(props.delayMinutes));
  return props.delayTone === 'late' ? `${m} min late` : `${m} min early`;
}

function arrivalClock(epochMs: number): string {
  const date = new Date(epochMs);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kuala_Lumpur',
  });
}

const BusArrivalActivity: LiveActivityComponent<BusActivityProps> = (
  props,
  environment,
) => {
  'widget';
  const accent = accentFor(props, environment);
  const minutesText = `${Math.max(0, props.minutesToStop)} min`;
  const delayText = delayLabel(props);
  const delayHex = delayColor(props.delayTone);

  return {
    // Compact — shown when the island is idle (left/right of the island notch).
    compactLeading: (
      <Image
        systemName={BUS_SYSTEM_ICON}
        modifiers={[foregroundStyle(accent)]}
      />
    ),
    compactTrailing: (
      <Text modifiers={[foregroundStyle(accent)]}>
        {minutesText}
      </Text>
    ),

    // Minimal — shown when another activity is also active.
    minimal: (
      <Image
        systemName={BUS_SYSTEM_ICON}
        modifiers={[foregroundStyle(accent)]}
      />
    ),

    // Expanded Dynamic Island — long-press reveals this.
    expandedLeading: (
      <HStack spacing={6} modifiers={[padding({ all: 4 })]}>
        <Image
          systemName={BUS_SYSTEM_ICON}
          modifiers={[foregroundStyle(accent)]}
        />
        <Text modifiers={[foregroundStyle(accent)]}>
          {props.routeCode}
        </Text>
      </HStack>
    ),
    expandedTrailing: (
      <VStack spacing={2} modifiers={[padding({ all: 4 })]}>
        <Text>{minutesText}</Text>
        <Text>{`Arrives ${arrivalClock(props.arrivalEpochMs)}`}</Text>
      </VStack>
    ),
    expandedBottom: (
      <HStack spacing={8} modifiers={[padding({ horizontal: 8, vertical: 4 })]}>
        <Text>{`to ${props.stopName}`}</Text>
        <Spacer />
        {delayText && delayHex ? (
          <Text modifiers={[foregroundStyle(delayHex)]}>
            {delayText}
          </Text>
        ) : null}
      </HStack>
    ),

    // Lock Screen banner — mirrors the in-app CurrentBusCard hero.
    banner: (
      <VStack
        spacing={6}
        modifiers={[padding({ horizontal: 16, vertical: 12 })]}
      >
        <HStack spacing={8}>
          <Image
            systemName={BUS_SYSTEM_ICON}
            modifiers={[foregroundStyle(accent)]}
          />
          <Text modifiers={[foregroundStyle(accent)]}>
            {`${props.source === 'live' ? 'LIVE' : 'SCHEDULED'} · ${props.routeCode}`}
          </Text>
          <Spacer />
          <Text>{arrivalClock(props.arrivalEpochMs)}</Text>
        </HStack>
        <HStack spacing={6}>
          <Text>{minutesText}</Text>
          <Text>away</Text>
          <Spacer />
          {delayText && delayHex ? (
            <Text modifiers={[foregroundStyle(delayHex)]}>
              {delayText}
            </Text>
          ) : null}
        </HStack>
        <Text>{`to ${props.stopName}`}</Text>
      </VStack>
    ),
  };
}

export default createLiveActivity(LIVE_ACTIVITY_NAME, BusArrivalActivity);
