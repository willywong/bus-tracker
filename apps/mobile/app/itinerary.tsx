import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { usePlanner } from '@/state/PlannerContext';
import { color, MARGIN, PEEK_TOP, type } from '@/theme/design';

/**
 * One itinerary's timeline over its legs on the map. A stub until 15/05; the
 * sheet has no header, so it closes by swiping down. While it's up the trip
 * sheet behind stays pinned at peek.
 */
export default function ItineraryScreen() {
  const { setPresented, to } = usePlanner();

  useEffect(() => {
    setPresented(true);
    return () => setPresented(false);
  }, [setPresented]);

  return (
    <View style={styles.content}>
      <Text style={styles.title} accessibilityRole="header">
        {to ? `To ${to.name}` : 'Itinerary'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    paddingTop: PEEK_TOP,
    paddingHorizontal: MARGIN,
  },
  title: {
    ...type.headline,
    color: color.label,
  },
});
