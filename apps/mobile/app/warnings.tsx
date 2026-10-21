import { Stack, useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tripStatusItem, tripWarnings, WarningList } from '@/components/trip/Warnings';
import { useSettings } from '@/hooks/useSettings';
import { useTrip } from '@/state/TripContext';
import { color, MARGIN, space, type } from '@/theme/design';

/** Clears the transparent header (grabber, title and close button). */
const HEADER = 64;

/**
 * The full text behind the glass capsule beside the hero number, over the
 * trip sheet: whether the bus is live first, then one row per heads-up,
 * glyph, title and detail. Closes itself
 * once nothing is left to warn about.
 */
export default function WarningsScreen() {
  const router = useRouter();
  const trip = useTrip();
  const settings = useSettings();
  const insets = useSafeAreaInsets();
  const status = tripStatusItem(trip.model);
  const warnings = tripWarnings(trip.model, settings.walkMinutes);
  const items = [...(status ? [status] : []), ...warnings];
  const weather = items.some((w) => w.key === 'rain');

  return (
    <>
      <Stack.Screen options={{ title: warnings.length > 0 ? 'Heads-up' : 'Status' }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="xmark" accessibilityLabel="Close" onPress={() => router.back()} />
      </Stack.Toolbar>
      <View style={[styles.content, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
        {items.length > 0 ? (
          <WarningList items={items} />
        ) : (
          <Text style={styles.empty}>Nothing to flag right now.</Text>
        )}
        {weather ? <Text style={styles.source}>Weather from MET Malaysia</Text> : null}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: HEADER,
    paddingHorizontal: MARGIN,
  },
  empty: {
    ...type.body,
    color: color.secondaryLabel,
    paddingVertical: space.md,
  },
  source: {
    ...type.footnote,
    color: color.tertiaryLabel,
    marginTop: space.xs,
  },
});
