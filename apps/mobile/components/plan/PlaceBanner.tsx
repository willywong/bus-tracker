import { StyleSheet, View } from 'react-native';

import { StationPhoto } from '@/components/rail/StationPhoto';
import { space } from '@/theme/design';

/**
 * The destination's 16:9 photo above the results (spec §6.2, §7.4). The
 * chain is the station sheet's, so it is that component rather than a
 * second copy: Look Around, then Street View (`StopPhoto`, with a key), then
 * a map snapshot, each fading in over 180 ms on a `color.fill` placeholder,
 * collapsing when all three fail. Remounts per destination.
 */
export function PlaceBanner({ lat, lng, name }: { lat: number; lng: number; name: string }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return (
    <View style={styles.wrap}>
      <StationPhoto key={`${lat.toFixed(5)},${lng.toFixed(5)}`} lat={lat} lng={lng} name={name} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: space.md,
  },
});
