import {
  DatePicker,
  Form,
  Host,
  HStack,
  Image,
  Picker,
  Section,
  Slider,
  Text,
} from '@expo/ui/swift-ui';
import {
  font,
  foregroundStyle,
  padding,
  tag,
} from '@expo/ui/swift-ui/modifiers';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { formatStopName } from '@/components/map/format';
import { openDb } from '@/db/database';
import { getStops, type StopRow } from '@/db/queries';
import {
  NOTIF_BUFFER_CHOICES_MIN,
  TRAFFIC_PROVIDERS,
  useSettings,
  type TrafficProvider,
} from '@/hooks/useSettings';

function minutesFromDate(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

function dateAtMinuteOfDay(minuteOfDay: number): Date {
  const d = new Date();
  d.setHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);
  return d;
}

function formatMinuteOfDay(minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60)
    .toString()
    .padStart(2, '0');
  const m = (minuteOfDay % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

const providerLabel: Record<TrafficProvider, string> = {
  here: 'HERE',
  tomtom: 'TomTom',
};

export default function SettingsScreen() {
  const settings = useSettings();
  const [stops, setStops] = useState<StopRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = await openDb();
        const rows = await getStops(db);
        if (!cancelled) setStops(rows);
      } catch (err) {
        console.warn('[settings] failed to load stops', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!settings.ready || stops.length === 0) {
    return <View style={{ flex: 1 }} />;
  }

  const notifBufferIndex = NOTIF_BUFFER_CHOICES_MIN.indexOf(
    settings.notifBufferMin,
  );
  const preferredStopIndex = Math.max(
    0,
    stops.findIndex((s) => s.stop_id === settings.preferredStopId),
  );
  const providerIndex = TRAFFIC_PROVIDERS.indexOf(settings.trafficProvider);

  return (
    <Host style={{ flex: 1 }} useViewportSizeMeasurement>
      <Form>
        <Section
          header={<Text>Walk</Text>}
          footer={
            <Text>
              Minutes to walk from your starting point to the bus stop.
            </Text>
          }
        >
          <HStack spacing={12} modifiers={[padding({ vertical: 6 })]}>
            <Image systemName="figure.walk" size={18} color="#8E8E93" />
            <Slider
              value={settings.walkMinutes}
              min={5}
              max={20}
              step={1}
              onValueChange={(v) => settings.setWalkMinutes(Math.round(v))}
            />
            <Text
              modifiers={[
                font({ weight: 'semibold' }),
                foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
              ]}
            >
              {`${settings.walkMinutes} min`}
            </Text>
          </HStack>
        </Section>

        <Section
          header={<Text>Notifications</Text>}
          footer={
            <Text>
              Alert this many minutes before you need to leave. 0 is exactly
              on time.
            </Text>
          }
        >
          <Picker
            label="Lead time"
            selection={notifBufferIndex < 0 ? 0 : notifBufferIndex}
            onSelectionChange={(i) => {
              const idx = typeof i === 'number' ? i : Number(i);
              const choice = NOTIF_BUFFER_CHOICES_MIN[idx];
              if (choice != null) settings.setNotifBufferMin(choice);
            }}
          >
            {NOTIF_BUFFER_CHOICES_MIN.map((m, i) => (
              <Text key={m} modifiers={[tag(i)]}>
                {`${m} min`}
              </Text>
            ))}
          </Picker>
        </Section>

        <Section
          header={<Text>Preferred stop</Text>}
          footer={<Text>Alighting stop used for ETA and directions.</Text>}
        >
          <Picker
            label="Stop"
            selection={preferredStopIndex}
            onSelectionChange={(i) => {
              const idx = typeof i === 'number' ? i : Number(i);
              const stop = stops[idx];
              if (stop) settings.setPreferredStopId(stop.stop_id);
            }}
          >
            {stops.map((s, i) => (
              <Text key={s.stop_id} modifiers={[tag(i)]}>
                {formatStopName(s.stop_name)}
              </Text>
            ))}
          </Picker>
        </Section>

        <Section
          header={<Text>Traffic</Text>}
          footer={<Text>Live travel-time source for ETA adjustments.</Text>}
        >
          <Picker
            label="Provider"
            selection={providerIndex < 0 ? 0 : providerIndex}
            onSelectionChange={(i) => {
              const idx = typeof i === 'number' ? i : Number(i);
              const provider = TRAFFIC_PROVIDERS[idx];
              if (provider) settings.setTrafficProvider(provider);
            }}
          >
            {TRAFFIC_PROVIDERS.map((p, i) => (
              <Text key={p} modifiers={[tag(i)]}>
                {providerLabel[p]}
              </Text>
            ))}
          </Picker>
        </Section>

        <Section
          header={<Text>Quiet hours</Text>}
          footer={
            <Text>
              {`No alerts between ${formatMinuteOfDay(settings.quietStartMin)} and ${formatMinuteOfDay(settings.quietEndMin)}.`}
            </Text>
          }
        >
          <DatePicker
            title="Start"
            selection={dateAtMinuteOfDay(settings.quietStartMin)}
            displayedComponents={['hourAndMinute']}
            onDateChange={(d) => settings.setQuietStartMin(minutesFromDate(d))}
          />
          <DatePicker
            title="End"
            selection={dateAtMinuteOfDay(settings.quietEndMin)}
            displayedComponents={['hourAndMinute']}
            onDateChange={(d) => settings.setQuietEndMin(minutesFromDate(d))}
          />
        </Section>
      </Form>
    </Host>
  );
}
