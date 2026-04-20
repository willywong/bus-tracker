import { type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { surfaceColor, trackerSpacing } from './tokens';

interface TrackerCanvasProps {
  children: ReactNode;
}

export function TrackerCanvas({ children }: TrackerCanvasProps) {
  return (
    <View style={styles.root}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: surfaceColor.canvas,
  },
  content: {
    paddingHorizontal: trackerSpacing.screenH,
    paddingBottom: 48,
  },
});
