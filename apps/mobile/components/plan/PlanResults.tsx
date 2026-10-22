import type { Place } from '@bus-tracker/shared';
import { StyleSheet, Text, View } from 'react-native';

import { color, space, type } from '@/theme/design';

/**
 * The plan sheet's results state (spec §6.2), shown once a destination is
 * picked and the search bar isn't editing. 15/03 renders only the header
 * (name and address); 15/04 adds the itinerary list, loader and footer here.
 */
export function PlanResults({ to, subtitle }: { to: Place; subtitle: string | null }) {
  return (
    <View style={styles.header} accessible accessibilityLabel={[to.name, subtitle].filter(Boolean).join(', ')}>
      <Text style={styles.title} numberOfLines={2}>
        {to.name}
      </Text>
      {subtitle ? (
        <Text style={styles.subtitle} numberOfLines={2}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingTop: space.md,
    gap: space.xxs,
  },
  title: {
    ...type.title,
    color: color.label,
  },
  subtitle: {
    ...type.status,
    color: color.secondaryLabel,
  },
});
