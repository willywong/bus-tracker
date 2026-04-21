import * as Location from 'expo-location';
import { useEffect } from 'react';

export interface LocationPermissionState {
  granted: boolean;
  /** True only when the OS will still surface a prompt (i.e. not "denied"). */
  canAskAgain: boolean;
  ready: boolean;
}

/**
 * Requests foreground location permission once on mount. The OS sheet only
 * appears the first time; subsequent mounts read the cached status. We never
 * re-prompt after a denial — `<MapView>` quietly hides the user dot in that
 * case.
 */
export function useLocationPermission(): LocationPermissionState {
  const [status, request] = Location.useForegroundPermissions();

  useEffect(() => {
    if (!status) return;
    if (status.granted) return;
    if (!status.canAskAgain) return;
    void request();
  }, [status?.granted, status?.canAskAgain, request]);

  return {
    granted: !!status?.granted,
    canAskAgain: !!status?.canAskAgain,
    ready: status != null,
  };
}
