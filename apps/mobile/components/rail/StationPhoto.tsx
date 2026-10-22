import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, useColorScheme, View } from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';

import { openStreetView, StopPhoto } from '@/components/detail/StopPhoto';
import { lookAroundUri, snapshotUri } from '@/services/stationImage';
import { color, EASE_OUT, motion, radius, space } from '@/theme/design';

const ASPECT = 16 / 9;
/** Look Around gets this long before the banner moves on to Street View. */
const LOOK_AROUND_TIMEOUT_MS = 1_500;
const IMAGE_W = 640;
const IMAGE_H = 360;

/** Which source the banner is on. */
type Phase =
  | { kind: 'lookAround' }
  | { kind: 'streetView' }
  | { kind: 'snapshot' }
  | { kind: 'image'; uri: string; source: 'lookAround' | 'snapshot' }
  | { kind: 'none' };

/** The image fades in once (spec §7.4); Reduce Motion shows it at once. */
const FADE = FadeIn.duration(motion.state).easing(EASE_OUT).reduceMotion(ReduceMotion.System);

/**
 * The station's photo banner, 16:9 at the top of the sheet (spec §7.4).
 * Sources in order: a Look Around photo, the Street View `StopPhoto`, a
 * muted map snapshot, then nothing. While a source is being looked up a
 * plain `color.fill` block holds the space (the RN stand-in for SwiftUI's
 * `.redacted(.placeholder)`); with no source at all it collapses.
 */
export function StationPhoto({ lat, lng, name }: { lat: number; lng: number; name: string }) {
  const dark = useColorScheme() === 'dark';
  const [phase, setPhase] = useState<Phase>({ kind: 'lookAround' });

  // A new station (the sheet swaps in place) starts over.
  useEffect(() => {
    let live = true;
    setPhase({ kind: 'lookAround' });
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), LOOK_AROUND_TIMEOUT_MS));
    void Promise.race([lookAroundUri(lat, lng, IMAGE_W, IMAGE_H), timeout]).then((uri) => {
      if (!live) return;
      setPhase(uri ? { kind: 'image', uri, source: 'lookAround' } : { kind: 'streetView' });
    });
    return () => {
      live = false;
    };
  }, [lat, lng]);

  const snapshotting = phase.kind === 'snapshot';
  useEffect(() => {
    if (!snapshotting) return;
    let live = true;
    void snapshotUri(lat, lng, IMAGE_W, IMAGE_H, dark).then((uri) => {
      if (live) setPhase(uri ? { kind: 'image', uri, source: 'snapshot' } : { kind: 'none' });
    });
    return () => {
      live = false;
    };
    // The snapshot's palette is fixed once drawn; a scheme change mid-lookup restarts it.
  }, [snapshotting, lat, lng, dark]);

  if (phase.kind === 'none') return null;

  if (phase.kind === 'streetView') {
    // The placeholder stays behind StopPhoto while it looks for a panorama.
    return (
      <View style={styles.frame}>
        <StopPhoto
          lat={lat}
          lng={lng}
          aspectRatio={ASPECT}
          onOpen={() => openStreetView({ lat, lng })}
          onUnavailable={() => setPhase((p) => (p.kind === 'streetView' ? { kind: 'snapshot' } : p))}
        />
      </View>
    );
  }

  if (phase.kind === 'image') {
    const lookAround = phase.source === 'lookAround';
    return (
      <View style={styles.frame}>
        <Animated.View entering={FADE} style={StyleSheet.absoluteFill}>
          <Image
            source={{ uri: phase.uri }}
            style={styles.image}
            resizeMode="cover"
            accessible={lookAround}
            accessibilityRole="image"
            accessibilityLabel={lookAround ? `Look Around photo of ${name}` : undefined}
            accessibilityElementsHidden={!lookAround}
            importantForAccessibility={lookAround ? 'auto' : 'no-hide-descendants'}
            onError={() => setPhase((p) => (p.kind === 'image' && !lookAround ? { kind: 'none' } : { kind: 'streetView' }))}
          />
          {lookAround ? (
            <View style={styles.caption}>
              <Text style={styles.captionText}>Look Around</Text>
            </View>
          ) : null}
        </Animated.View>
      </View>
    );
  }

  // Look Around or the snapshot is still being looked up.
  return <View style={styles.frame} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    aspectRatio: ASPECT,
    borderRadius: radius.group,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: color.fill,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  caption: {
    position: 'absolute',
    left: space.sm,
    bottom: space.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  captionText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
