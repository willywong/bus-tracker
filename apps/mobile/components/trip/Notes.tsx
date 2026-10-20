import { SymbolView, type SFSymbol } from 'expo-symbols';
import { StyleSheet, Text, View } from 'react-native';

import type { TripNote } from '@/components/trip/model';
import { color, space, type } from '@/theme/design';

/**
 * Supporting facts under the hero ("Miss it and the next is at 08:42…").
 * Plain rows with a glyph, not cards: they're content, and the hero stays
 * the one thing that shouts. Warnings tint the glyph, never the text alone.
 */
export function Notes({ notes }: { notes: readonly TripNote[] }) {
  if (notes.length === 0) return null;
  return (
    <View style={styles.list}>
      {notes.map((n) => (
        <View key={n.id} style={styles.row} accessible accessibilityLabel={n.text}>
          <SymbolView
            name={n.icon as SFSymbol}
            size={15}
            weight="medium"
            type="hierarchical"
            tintColor={n.tone === 'warning' ? color.warning : color.secondaryLabel}
            style={styles.icon}
          />
          <Text style={[styles.text, n.tone === 'warning' && styles.warning]}>{n.text}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: space.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.xs,
  },
  icon: {
    width: 18,
    height: 18,
    marginTop: 1,
  },
  text: {
    ...type.status,
    color: color.secondaryLabel,
    flex: 1,
  },
  warning: {
    color: color.label,
  },
});
