import { StyleSheet, View } from 'react-native';

import { GlassCapsuleButton } from '@/components/trip/PrimaryAction';
import { space } from '@/theme/design';

/**
 * The itinerary's one action: a full-width glass "Go" that follows the
 * journey (06: alerts and the Live Activity).
 */
export function GoButton({ scheme, onPress }: { scheme: 'light' | 'dark'; onPress: () => void }) {
  return (
    <View style={styles.wrap}>
      <GlassCapsuleButton
        label="Go"
        icon="location.north.fill"
        prominent
        hint="Follows this journey with alerts and the Live Activity"
        scheme={scheme}
        onPress={onPress}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingTop: space.xxs,
  },
});
