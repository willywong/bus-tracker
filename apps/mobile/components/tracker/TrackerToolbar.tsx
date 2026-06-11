import { View, StyleSheet } from 'react-native';

import { RouteSwitcher } from './RouteSwitcher';
import { TrackButton } from './TrackButton';
import { WalkCta } from './WalkCta';

interface TrackerToolbarProps {
  selectedRoute: string | null;
  routeOptions: readonly string[];
  onSelectRoute: (code: string) => void;
  onAddBus: () => void;
  /** Show the Track (Live Activity) button. */
  showTrack: boolean;
  isTracking: boolean;
  onTrackToggle: (next: boolean) => void;
  /** Show the Walk button. */
  showWalk: boolean;
  isWalking: boolean;
  isLeaveNow: boolean;
  onWalkStart: () => void;
  onWalkCancel: () => void;
}

/**
 * Compact glass command bar at the top of the Tracker — the route switcher on
 * the left, and the Walk / Track circular glass buttons flush right. Replaces
 * the old hero's switcher row now that the big countdown is gone.
 */
export function TrackerToolbar({
  selectedRoute,
  routeOptions,
  onSelectRoute,
  onAddBus,
  showTrack,
  isTracking,
  onTrackToggle,
  showWalk,
  isWalking,
  isLeaveNow,
  onWalkStart,
  onWalkCancel,
}: TrackerToolbarProps) {
  return (
    <View style={styles.row}>
      <RouteSwitcher
        selected={selectedRoute}
        options={routeOptions}
        onSelect={onSelectRoute}
        onAddBus={onAddBus}
      />
      <View style={styles.actions}>
        {showTrack ? (
          <TrackButton isTracking={isTracking} onToggle={onTrackToggle} />
        ) : null}
        {showWalk ? (
          <WalkCta
            isWalking={isWalking}
            isLeaveNow={isLeaveNow}
            onStart={onWalkStart}
            onCancel={onWalkCancel}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingLeft: 4,
    paddingRight: 4,
    marginBottom: 16,
    minHeight: 40,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: 8,
  },
});
