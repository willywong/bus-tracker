import { Link } from 'expo-router';
import { useRef, useState } from 'react';
import {
  Pressable,
  type StyleProp,
  StyleSheet,
  useColorScheme,
  type ViewStyle,
} from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';

import { type BusKind, BusModelView } from '@/modules/bus-model';
import { CSS_EASE_OUT, hex, MARGIN, pick } from '@/theme/design';

/**
 * The bus itself, in 3D: the route's bus (MRT feeder or rapidKL) on a slow
 * turntable with this trip's
 * route and destination on its LED headsign. A sideways drag turns it. It
 * bleeds to the sheet's edges so the turn isn't boxed in, and sits on the
 * sheet's paper. Nothing where the native view isn't built (Android, or a dev
 * client from before the module).
 */
export function Bus3D({
  kind,
  routeCode,
  destination,
  style,
  still = false,
  opens,
}: {
  kind: BusKind;
  routeCode: string;
  destination: string | null;
  /** In place of the full-width, 220 pt stage. */
  style?: StyleProp<ViewStyle>;
  /** Comes to rest from its idle turn, e.g. while the real bus is stopped. */
  still?: boolean;
  /**
   * A tap zooms it open full screen (app/bus.tsx), for this bus when it's
   * live (null for the route's bus in general).
   */
  opens?: { vehicleId: string | null };
}) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const reduceMotion = useReducedMotion();
  const [pressed, setPressed] = useState(false);
  // Where the touch began, and whether it has since turned into a drag.
  const touch = useRef({ x: 0, dragged: false });
  if (!BusModelView) return null;
  const label = `RapidKL bus showing ${routeCode}${destination ? ` to ${destination}` : ''}`;
  const bus = (
    <BusModelView
      style={opens ? styles.fill : (style ?? styles.bus)}
      kind={kind}
      routeCode={routeCode}
      destination={destination}
      paper={pick(hex.paper, scheme)}
      spins={!reduceMotion && !still}
      accessible={!opens}
      accessibilityRole="image"
      accessibilityLabel={label}
    />
  );
  if (!opens) return bus;
  return (
    <Link
      href={{
        pathname: '/bus',
        params: {
          kind,
          ...(opens.vehicleId ? { vehicleId: opens.vehicleId } : null),
          ...(destination ? { destination } : null),
        },
      }}
      // The native pan turning the bus doesn't cancel React's touch, so a
      // drag that ends over the bus would still open it: not after a drag.
      onPress={(e) => {
        if (touch.current.dragged) e.preventDefault();
      }}
      asChild
    >
      <Link.AppleZoom>
        <Pressable
          style={style ?? styles.bus}
          onTouchStart={(e) => {
            touch.current = { x: e.nativeEvent.pageX, dragged: false };
          }}
          onTouchMove={(e) => {
            if (touch.current.dragged) return;
            if (Math.abs(e.nativeEvent.pageX - touch.current.x) < DRAG_SLOP) return;
            touch.current.dragged = true;
            setPressed(false);
          }}
          onPressIn={() => setPressed(true)}
          onPressOut={() => setPressed(false)}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint="Opens the bus full screen"
        >
          <Animated.View style={[styles.fill, pressed ? PRESSED : RESTING]}>{bus}</Animated.View>
        </Pressable>
      </Link.AppleZoom>
    </Link>
  );
}

/** False where the 3D bus draws nothing, so layouts built around it can fall back. */
export const hasBus3D = BusModelView != null;

/** Sideways travel, in points, past which a touch is a turn, not a tap. */
const DRAG_SLOP = 10;

/** It gives a little under the finger, so the tap is felt before the zoom. */
const PRESS = {
  transitionProperty: 'transform',
  transitionDuration: 120,
  transitionTimingFunction: CSS_EASE_OUT,
} as const;
const RESTING = { ...PRESS, transform: [{ scale: 1 }] };
const PRESSED = { ...PRESS, transform: [{ scale: 0.97 }] };

const styles = StyleSheet.create({
  bus: {
    marginHorizontal: -MARGIN,
    height: 220,
  },
  fill: {
    flex: 1,
  },
});
