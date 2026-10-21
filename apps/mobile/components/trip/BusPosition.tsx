import { SymbolView } from 'expo-symbols';
import { StyleSheet, Text, View } from 'react-native';

import { Hairline } from '@/components/trip/Rows';
import { color, space, type } from '@/theme/design';

const DISC = 32;

/**
 * Where your live bus is, under the hero, set off by a hairline:
 *
 *   ─────────────────────────────────
 *   (🚌)  2 stops away
 *         Near Jejantas SS2/24 (utara)
 *
 * The ink disc is the bus as the map and "On the way" draw it, so the row
 * needs no "Your bus" label. Left-aligned and stacked, so a long stop name
 * gets the full width instead of being squeezed beside the count.
 */
export function BusPosition({ title, caption }: { title: string; caption: string | null }) {
  return (
    <View>
      <Hairline />
      <View
        style={styles.row}
        accessible
        accessibilityLabel={['Your bus', title, caption].filter(Boolean).join(', ')}
      >
        <View style={styles.disc}>
          <SymbolView name="bus.fill" size={15} tintColor={color.paper} />
        </View>
        <View style={styles.text}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {caption ? (
            <Text style={styles.caption} numberOfLines={1}>
              {caption}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingTop: space.md,
  },
  disc: {
    width: DISC,
    height: DISC,
    borderRadius: DISC / 2,
    backgroundColor: color.label,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    gap: 1,
  },
  title: {
    ...type.body,
    fontWeight: '600',
    color: color.label,
  },
  caption: {
    ...type.status,
    color: color.secondaryLabel,
  },
});
