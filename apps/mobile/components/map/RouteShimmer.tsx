import type { LatLng } from '@bus-tracker/shared';
import { useEffect, useMemo, useState, type RefObject } from 'react';
import { StyleSheet, View } from 'react-native';
import type MapView from 'react-native-maps';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

interface RouteShimmerProps {
  mapRef: RefObject<MapView | null>;
  /** The bus's way to your stop, bus first. Empty when nothing is live. */
  path: LatLng[];
  /** False while the camera moves: the glint hides, then re-projects. */
  settled: boolean;
  /** Bumped each time the camera comes to rest. */
  cameraTick: number;
  color: string;
}

/** Glint length and thickness, in points (the route line is 4pt). */
const GLINT = 56;
const GLINT_H = 6;
/** Points per second the glint travels, and its bounds in ms. */
const SPEED = 170;
const MIN_MS = 1100;
const MAX_MS = 3200;
/** Pause between passes, so it reads as a pulse of life, not a loader. */
const REST_MS = 1300;
/** It fades in clear of the bus marker and out before your stop's pin. */
const CLEAR = 20;
const FADE = 18;
/** Projection is one async call per point; long stretches are thinned. */
const MAX_POINTS = 64;

/**
 * A soft light travelling along the route from the live bus to your stop:
 * the stretch that's "on the way". MapKit overlays can't be animated (every
 * prop change re-adds the overlay), so this is a React Native layer over the
 * map: the path is projected to screen points once the camera settles, and
 * the glint runs along it on the UI thread. Hidden while the map moves and
 * under Reduce Motion; the ink line beneath always tells the same story.
 */
export function RouteShimmer({ mapRef, path, settled, cameraTick, color }: RouteShimmerProps) {
  const reduceMotion = useReducedMotion();
  const [points, setPoints] = useState<{ x: number[]; y: number[] } | null>(null);
  const active = !reduceMotion && settled && path.length >= 2;

  useEffect(() => {
    if (!active) {
      setPoints(null);
      return;
    }
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;
    const sample = thin(path, MAX_POINTS);
    Promise.all(sample.map((p) => map.pointForCoordinate({ latitude: p.lat, longitude: p.lng })))
      .then((pts) => {
        if (cancelled) return;
        setPoints({ x: pts.map((p) => p.x), y: pts.map((p) => p.y) });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [active, path, cameraTick, mapRef]);

  const geometry = useMemo(() => {
    if (!points) return null;
    const cum = [0];
    for (let i = 1; i < points.x.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(points.x[i] - points.x[i - 1], points.y[i] - points.y[i - 1]));
    }
    const total = cum[cum.length - 1];
    if (total < 2 * (CLEAR + FADE) + GLINT / 2) return null;
    return { ...points, cum, total };
  }, [points]);

  const progress = useSharedValue(0);
  const duration = geometry
    ? Math.min(MAX_MS, Math.max(MIN_MS, (geometry.total / SPEED) * 1000))
    : 0;
  useEffect(() => {
    if (!geometry) return;
    progress.set(0);
    progress.set(
      withRepeat(
        withSequence(
          withTiming(1, { duration, easing: Easing.inOut(Easing.quad) }),
          withTiming(1, { duration: REST_MS }),
          withTiming(0, { duration: 0 }),
        ),
        -1,
      ),
    );
    return () => cancelAnimation(progress);
  }, [geometry, duration, progress]);

  const glintStyle = useAnimatedStyle(() => {
    if (!geometry) return { opacity: 0 };
    const { x, y, cum, total } = geometry;
    const d = progress.get() * total;
    let i = 0;
    while (i < cum.length - 2 && cum[i + 1] < d) i++;
    const seg = cum[i + 1] - cum[i] || 1;
    const f = Math.min(1, Math.max(0, (d - cum[i]) / seg));
    const px = x[i] + (x[i + 1] - x[i]) * f;
    const py = y[i] + (y[i + 1] - y[i]) * f;
    const angle = Math.atan2(y[i + 1] - y[i], x[i + 1] - x[i]);
    const edge = Math.min(d, total - d);
    return {
      opacity: Math.min(1, Math.max(0, (edge - CLEAR) / FADE)),
      transform: [
        { translateX: px - GLINT / 2 },
        { translateY: py - GLINT_H / 2 },
        { rotate: `${angle}rad` },
      ],
    };
  }, [geometry]);

  if (!geometry) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View
        style={[
          styles.glint,
          {
            backgroundImage: `linear-gradient(90deg, ${color}00 0%, ${color} 50%, ${color}00 100%)`,
          },
          glintStyle,
        ]}
      />
    </View>
  );
}

/** Keeps the first and last points and an even spread between. */
function thin(path: LatLng[], max: number): LatLng[] {
  if (path.length <= max) return path;
  const step = (path.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => path[Math.round(i * step)]);
}

const styles = StyleSheet.create({
  glint: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: GLINT,
    height: GLINT_H,
    borderRadius: GLINT_H / 2,
  },
});
