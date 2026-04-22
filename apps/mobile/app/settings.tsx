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
import { getStopsForRoute, type StopRow } from '@/db/queries';
import { useStaticGtfs } from '@/hooks/useStaticGtfs';
import {
  CLOCK_FORMATS,
  NOTIF_BUFFER_CHOICES_MIN,
  TRAFFIC_PROVIDERS,
  useSettings,
  type ClockFormat,
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

const clockFormatLabel: Record<ClockFormat, string> = {
  '24h': '24-hour (14:30)',
  '12h': '12-hour (2:30 PM)',
};

export default function SettingsScreen() {
  const settings = useSettings();
  // Re-fires the stops query once the static bundle finishes bootstrapping,
  // so a fresh install that mounts Settings before the first fetch completes
  // populates the pickers instead of getting stuck on an empty DB.
  const gtfs = useStaticGtfs();
  const [stopsByRoute, setStopsByRoute] = useState<Record<string, StopRow[]>>(
    {},
  );
  const favoritesKey = settings.favoritedRoutes.join(',');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = await openDb();
        const entries = await Promise.all(
          settings.favoritedRoutes.map(
            async (code) => [code, await getStopsForRoute(db, code)] as const,
          ),
        );
        if (cancelled) return;
        const next: Record<string, StopRow[]> = {};
        for (const [code, rows] of entries) next[code] = rows;
        setStopsByRoute(next);
      } catch (err) {
        console.warn('[settings] failed to load stops', err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gtfs.ready, gtfs.result?.generatedAt, favoritesKey]);

  if (!settings.ready) {
    return <View style={{ flex: 1 }} />;
  }

  const notifBufferIndex = NOTIF_BUFFER_CHOICES_MIN.indexOf(
    settings.notifBufferMin,
  );
  const providerIndex = TRAFFIC_PROVIDERS.indexOf(settings.trafficProvider);
  const clockFormatIndex = CLOCK_FORMATS.indexOf(settings.clockFormat);

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
          header={<Text>Time format</Text>}
          footer={
            <Text>
              Used for arrival and ETA times on the Tracker and Map pages.
            </Text>
          }
        >
          <Picker
            label="Clock"
            selection={clockFormatIndex < 0 ? 0 : clockFormatIndex}
            onSelectionChange={(i) => {
              const idx = typeof i === 'number' ? i : Number(i);
              const choice = CLOCK_FORMATS[idx];
              if (choice) settings.setClockFormat(choice);
            }}
          >
            {CLOCK_FORMATS.map((cf, i) => (
              <Text key={cf} modifiers={[tag(i)]}>
                {clockFormatLabel[cf]}
              </Text>
            ))}
          </Picker>
        </Section>

        {/* Notifications lead time — temporarily hidden; notifications are
            not wired up yet. Restore this Section when the push pipeline ships.
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
        */}

        <Section
          header={<Text>Preferred stops</Text>}
          footer={
            <Text>Boarding stop used for ETA on each route.</Text>
          }
        >
          {settings.favoritedRoutes.map((code) => {
            const routeStops = stopsByRoute[code] ?? [];
            // Pre-bootstrap, the JOIN returns 0 rows; render a disabled
            // placeholder so the Form still paints instead of feeding the
            // SwiftUI Picker zero children with selection=0.
            if (routeStops.length === 0) {
              return (
                <HStack
                  key={code}
                  spacing={12}
                  modifiers={[padding({ vertical: 6 })]}
                >
                  <Text>{code}</Text>
                  <Text
                    modifiers={[
                      foregroundStyle({
                        type: 'hierarchical',
                        style: 'secondary',
                      }),
                    ]}
                  >
                    Loading…
                  </Text>
                </HStack>
              );
            }
            const selectedStopId = settings.preferredStopByRoute[code];
            const selection = Math.max(
              0,
              routeStops.findIndex((s) => s.stop_id === selectedStopId),
            );
            return (
              <Picker
                key={code}
                label={code}
                selection={selection}
                onSelectionChange={(i) => {
                  const idx = typeof i === 'number' ? i : Number(i);
                  const stop = routeStops[idx];
                  if (stop) {
                    settings.setPreferredStopForRoute(code, stop.stop_id);
                  }
                }}
              >
                {routeStops.map((s, i) => (
                  <Text key={s.stop_id} modifiers={[tag(i)]}>
                    {formatStopName(s.stop_name)}
                  </Text>
                ))}
              </Picker>
            );
          })}
        </Section>

        {/* Traffic provider — temporarily hidden; HERE is the only provider
            in use. TomTom remains wired through `useSettings` / `useEta` so
            this Section can be restored without a data migration once we're
            ready to offer the choice again.
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
        */}

        {/* Quiet hours — temporarily hidden; notifications aren't wired up
            yet so silencing them has no effect. Restore this Section when the
            push pipeline ships.
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
        */}

        <Section
          header={<Text>About</Text>}
          footer={
            <Text>
              Traffic signal locations © OpenStreetMap contributors.
            </Text>
          }
        >
          <HStack spacing={8} modifiers={[padding({ vertical: 4 })]}>
            <Image systemName="map" size={16} color="#8E8E93" />
            <Text
              modifiers={[
                foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
              ]}
            >
              Map data credits
            </Text>
          </HStack>
        </Section>
      </Form>
    </Host>
  );
}
