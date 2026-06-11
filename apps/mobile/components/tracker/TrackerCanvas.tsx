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
  /** Render with a transparent background so a backdrop (e.g. AuroraBackdrop) shows through. */
  transparent?: boolean;
}

export function TrackerCanvas({
  children,
  onRefresh,
  refreshing = false,
  transparent = false,
}: TrackerCanvasProps) {
  return (
    <View style={[styles.root, transparent && styles.transparent]}>
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
  transparent: {
    backgroundColor: 'transparent',
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: trackerSpacing.screenH,
    paddingTop: 12,
    paddingBottom: 48,
  },
});
