import { StyleSheet, useColorScheme } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { BusModelView } from '@/modules/bus-model';
import { hex, MARGIN, pick } from '@/theme/design';

/**
 * The bus itself, in 3D: a RapidKL bus on a slow turntable with this trip's
 * route and destination on its LED headsign. A sideways drag turns it. It
 * bleeds to the sheet's edges so the turn isn't boxed in, and sits on the
 * sheet's paper. Nothing where the native view isn't built (Android, or a dev
 * client from before the module).
 */
export function Bus3D({
  routeCode,
  destination,
}: {
  routeCode: string;
  destination: string | null;
}) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const reduceMotion = useReducedMotion();
  if (!BusModelView) return null;
  return (
    <BusModelView
      style={styles.bus}
      routeCode={routeCode}
      destination={destination}
      paper={pick(hex.paper, scheme)}
      spins={!reduceMotion}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`RapidKL bus showing ${routeCode}${destination ? ` to ${destination}` : ''}`}
    />
  );
}

const styles = StyleSheet.create({
  bus: {
    marginHorizontal: -MARGIN,
    height: 220,
  },
});
