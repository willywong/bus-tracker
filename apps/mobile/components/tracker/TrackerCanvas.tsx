import { type ReactNode } from 'react';
import {
  PlatformColor,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { surfaceColor, trackerSpacing } from './tokens';

interface TrackerCanvasProps {
  children: ReactNode;
  /** Pull-to-refresh handler. Omit to disable the gesture. */
  onRefresh?: () => void;
  refreshing?: boolean;
}

export function TrackerCanvas({
  children,
  onRefresh,
  refreshing = false,
}: TrackerCanvasProps) {
  return (
    <View style={styles.root}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={PlatformColor('secondaryLabel')}
            />
          ) : undefined
        }
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
