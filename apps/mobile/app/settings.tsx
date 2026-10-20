import {
  Button,
  DatePicker,
  Form,
  Host,
  HStack,
  Image,
  Picker,
  Section,
  Slider,
  Spacer,
  Text,
} from '@expo/ui/swift-ui';
import {
  buttonStyle,
  font,
  foregroundStyle,
  padding,
  tag,
} from '@expo/ui/swift-ui/modifiers';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { MapModesSheet } from '@/components/map/MapModesSheet';
import { FavoritesSection } from '@/components/settings/FavoritesSection';
import {
  StopPickerSheet,
  type StopPickerRoute,
} from '@/components/stops/StopPickerSheet';
import {
  CLOCK_FORMATS,
  NOTIF_BUFFER_CHOICES_MIN,
  useSettings,
  type ClockFormat,
  type MapType,
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

const clockFormatLabel: Record<ClockFormat, string> = {
  '24h': '24-hour (14:30)',
  '12h': '12-hour (2:30 PM)',
};

const mapTypeLabel: Record<MapType, string> = {
  standard: 'Standard',
  satellite: 'Satellite',
};

export default function SettingsScreen() {
  const settings = useSettings();
  const [activeChangeStopCode, setActiveChangeStopCode] = useState<
    string | null
  >(null);
  const [showMapModes, setShowMapModes] = useState(false);

  const changeStopRoute = useMemo<StopPickerRoute | null>(
    () => (activeChangeStopCode ? { code: activeChangeStopCode } : null),
    [activeChangeStopCode],
  );

  if (!settings.ready) {
    return <View style={{ flex: 1 }} />;
  }

  const notifBufferIndex = NOTIF_BUFFER_CHOICES_MIN.indexOf(
    settings.notifBufferMin,
  );
  const clockFormatIndex = CLOCK_FORMATS.indexOf(settings.clockFormat);

  return (
    <View style={{ flex: 1 }}>
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
            label={
              <HStack spacing={12}>
                <Image systemName="clock" size={18} color="#8E8E93" />
                <Text>Clock</Text>
              </HStack>
            }
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

        <Section
          header={<Text>Map</Text>}
          footer={
            <Text>
              Choose between Standard and Satellite views, and toggle traffic.
            </Text>
          }
        >
          <Button
            onPress={() => setShowMapModes(true)}
            modifiers={[buttonStyle('plain')]}
          >
            <HStack spacing={12} modifiers={[padding({ vertical: 6 })]}>
              <Image systemName="map" size={18} color="#8E8E93" />
              <Text>Map mode</Text>
              <Spacer />
              <Text
                modifiers={[
                  foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
                ]}
              >
                {mapTypeLabel[settings.mapType]}
              </Text>
              <Image systemName="chevron.right" size={12} color="#8E8E93" />
            </HStack>
          </Button>
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

        <FavoritesSection onRequestChangeStop={setActiveChangeStopCode} />

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
      <StopPickerSheet
        isPresented={activeChangeStopCode !== null}
        route={changeStopRoute}
        title="Change boarding stop"
        onDismiss={() => setActiveChangeStopCode(null)}
        onPick={(stop) => {
          if (activeChangeStopCode) {
            settings.setPreferredStopForRoute(
              activeChangeStopCode,
              stop.stop_id,
            );
          }
          setActiveChangeStopCode(null);
        }}
      />
      <MapModesSheet
        isPresented={showMapModes}
        onDismiss={() => setShowMapModes(false)}
      />
    </View>
  );
}
