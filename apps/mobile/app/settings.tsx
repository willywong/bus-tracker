import {
  Button,
  Form,
  Host,
  HStack,
  Image,
  LabeledContent,
  Picker,
  Section,
  Slider,
  Text,
} from '@expo/ui/swift-ui';
import {
  animation,
  Animation,
  environment,
  foregroundStyle,
  monospacedDigit,
  padding,
  frame,
  tag,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import Constants from 'expo-constants';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { useColorScheme } from 'react-native';

import { FavoritesSection } from '@/components/settings/FavoritesSection';
import { RemindersSection } from '@/components/settings/RemindersSection';
import {
  CLOCK_FORMATS,
  MAP_TYPES,
  useSettings,
  type ClockFormat,
  type MapType,
} from '@/hooks/useSettings';
import { useTrip } from '@/state/TripContext';
import { hex, pick } from '@/theme/design';
import { haptics } from '@/utils/haptics';
import { mins } from '@/components/trip/model';
import {
  complete,
  lookAround,
  mapsErrorCode,
  resolve,
  snapshot,
  walk,
} from '@/modules/transit-maps';

const clockFormatLabel: Record<ClockFormat, string> = {
  '24h': '24-hour',
  '12h': '12-hour',
};

const mapTypeLabel: Record<MapType, string> = {
  standard: 'Standard',
  satellite: 'Satellite',
};

/**
 * Settings as a native SwiftUI Form in a form sheet. System controls carry
 * their own haptics and Dynamic Type; the only custom touch is the Done button.
 */
export default function SettingsScreen() {
  const router = useRouter();
  const settings = useSettings();
  const trip = useTrip();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const [editing, setEditing] = useState(false);

  if (!settings.ready) return null;

  const clockIndex = Math.max(0, CLOCK_FORMATS.indexOf(settings.clockFormat));
  const mapIndex = Math.max(0, MAP_TYPES.indexOf(settings.mapType));
  const version = Constants.expoConfig?.version ?? '';

  return (
    <>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button variant="done" onPress={() => router.back()}>
          Done
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form
          modifiers={[
            tint(pick(hex.ink, scheme)),
            // Edit (in Your routes) shows the system ⊖ and ≡ on each route.
            environment('editMode', editing ? 'active' : 'inactive'),
            animation(Animation.default, editing ? 1 : 0),
          ]}
        >
          <FavoritesSection
            onRequestChangeStop={(code) =>
              router.push({
                pathname: '/add-route',
                params: { code, mode: 'change' },
              })
            }
            onAddRoute={() => router.push('/add-route')}
            editing={editing}
            onToggleEditing={() => setEditing((e) => !e)}
          />

          <Section
            title="Walking"
            footer={
              <Text>
                How long it takes you to walk to your stop. “Leave in…” counts down from this.
              </Text>
            }
          >
            <HStack spacing={12} modifiers={[padding({ vertical: 6 })]}>
              <Image
                systemName="figure.walk"
                size={17}
                modifiers={[foregroundStyle({ type: 'hierarchical', style: 'secondary' })]}
              />
              <Slider
                value={settings.walkMinutes}
                min={1}
                max={20}
                step={1}
                onValueChange={(v) => settings.setWalkMinutes(Math.round(v))}
              />
              <Text modifiers={[monospacedDigit(), frame({ minWidth: 64, alignment: 'trailing' })]}>
                {mins(settings.walkMinutes)}
              </Text>
            </HStack>
          </Section>

          <RemindersSection
            routeCode={settings.preferredRouteCode}
            arrivalTargets={trip.favoriteStops}
          />

          <Section title="Display">
            <Picker
              label="Clock"
              selection={clockIndex}
              onSelectionChange={(i) => {
                const choice = CLOCK_FORMATS[Number(i)];
                if (choice) settings.setClockFormat(choice);
              }}
            >
              {CLOCK_FORMATS.map((cf, i) => (
                <Text key={cf} modifiers={[tag(i)]}>
                  {clockFormatLabel[cf]}
                </Text>
              ))}
            </Picker>
            <Picker
              label="Map"
              selection={mapIndex}
              onSelectionChange={(i) => {
                const choice = MAP_TYPES[Number(i)];
                if (choice) {
                  haptics.selection();
                  settings.setMapType(choice);
                }
              }}
            >
              {MAP_TYPES.map((mt, i) => (
                <Text key={mt} modifiers={[tag(i)]}>
                  {mapTypeLabel[mt]}
                </Text>
              ))}
            </Picker>
          </Section>

          <Section
            title="About"
            footer={
              <Text>
                Live bus positions and timetables from data.gov.my (Prasarana). Traffic signal
                locations © OpenStreetMap contributors. BusBuddy is not affiliated with Rapid KL.
              </Text>
            }
          >
            <LabeledContent label="Version">
              <Text modifiers={[foregroundStyle({ type: 'hierarchical', style: 'secondary' })]}>
                {version}
              </Text>
            </LabeledContent>
            {/* Temporary (plan 12/00): network build timing harness. */}
            {(__DEV__ || process.env.EXPO_PUBLIC_DEV_TOOLS === '1') && (
              <Button label="Network build timing" onPress={() => router.push('/dev-network')} />
            )}
            {/* Temporary (plan 15/01): MapKit probe. Remove before 15/02 merges. */}
            {__DEV__ && <Button label="MapKit probe" onPress={() => void runMapsProbe()} />}
          </Section>
        </Form>
      </Host>
    </>
  );
}

/**
 * Temporary (plan 15/01): runs each `transit-maps` call once and logs the
 * result to the Metro console under `[maps-probe]`. Remove before 15/02 merges.
 */
async function runMapsProbe() {
  const log = (label: string, value: unknown) =>
    console.log(`[maps-probe] ${label}`, JSON.stringify(value));
  const fail = (label: string) => (e: unknown) => {
    log(`${label} failed`, { code: mapsErrorCode(e), message: String(e) });
    return null;
  };
  const KLCC = { lat: 3.1579, lng: 101.7116 };
  const PAVILION = { lat: 3.149, lng: 101.7134 };
  const BUKIT_BINTANG = { lat: 3.1466, lng: 101.7108 };

  // Fast typing: every call but the last should come back superseded.
  const burst = await Promise.all(['k', 'kl', 'klc', 'klcc'].map((q) => complete(q).catch(fail(`complete(${q})`))));
  log('complete burst superseded', burst.map((b) => b?.superseded ?? 'error'));
  const klcc = burst[burst.length - 1];
  if (klcc) {
    log(`complete("klcc") ${klcc.results.length} results`, klcc.results);
    const first = klcc.results[0];
    if (first) log('resolve(first)', await resolve(first.id).catch(fail('resolve')));
  }

  const path = await walk(KLCC, PAVILION).catch(fail('walk'));
  if (path) {
    log('walk KLCC → Pavilion', {
      minutes: Math.round(path.seconds / 6) / 10,
      meters: Math.round(path.meters),
      points: path.coords.length,
    });
  }

  for (const pass of [1, 2]) {
    const t0 = performance.now();
    const uri = await lookAround(BUKIT_BINTANG.lat, BUKIT_BINTANG.lng, 640, 360).catch(fail('lookAround'));
    log(`lookAround Bukit Bintang pass ${pass} (${Math.round(performance.now() - t0)} ms)`, uri);
  }

  for (const pass of [1, 2]) {
    const t0 = performance.now();
    const uri = await snapshot({ ...KLCC, latDelta: 0.0054, lngDelta: 0.0054 }, 320, 180, false).catch(
      fail('snapshot'),
    );
    log(`snapshot KLCC pass ${pass} (${Math.round(performance.now() - t0)} ms)`, uri);
  }
}
