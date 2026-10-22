import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { usePlanner } from '@/state/PlannerContext';
import { color, MARGIN, space, type } from '@/theme/design';

/**
 * "Where to?": search, then results. A stub until 15/03 (search) and 15/04
 * (results). While it's up the trip sheet behind stays pinned at peek.
 */
export default function PlanScreen() {
  const router = useRouter();
  const planner = usePlanner();
  const { setPresented } = planner;

  useEffect(() => {
    setPresented(true);
    return () => setPresented(false);
  }, [setPresented]);

  return (
    <>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="xmark" accessibilityLabel="Close" onPress={() => router.back()} />
      </Stack.Toolbar>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
        <Text style={styles.title}>{planner.to ? `To ${planner.to.name}` : 'Where to?'}</Text>
        <Text style={styles.muted}>From {planner.from.name}</Text>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: space.sm,
    paddingHorizontal: MARGIN,
    gap: space.xxs,
  },
  title: {
    ...type.headline,
    color: color.label,
  },
  muted: {
    ...type.status,
    color: color.secondaryLabel,
  },
});
