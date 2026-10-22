import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Image, StyleSheet, useColorScheme, View } from 'react-native';

import { snapshotUri } from '@/services/stationImage';
import { color, radius } from '@/theme/design';

/** The thumbnail's map: a 400 m box, drawn at 88 × 88 (`Image uiImage` reads it on the main thread). */
const THUMB_BOX_M = 400;
const THUMB_PX = 88;

/** Snapshot URIs by place and scheme, so a list re-render never asks again. */
const uris = new Map<string, string | null>();
const keyOf = (lat: number, lng: number, dark: boolean) => `${lat.toFixed(5)},${lng.toFixed(5)},${dark ? 'dark' : 'light'}`;

/**
 * A saved place's map snapshot as a `file://` URI: `undefined` while it's
 * drawn, `null` when it can't be (offline on first use, Android). Follows
 * the colour scheme; each scheme's tile is cached on disk by the native
 * module and here for the session.
 */
export function usePlaceThumbUri(lat: number, lng: number): string | null | undefined {
  const dark = useColorScheme() === 'dark';
  const key = keyOf(lat, lng, dark);
  const [, setLoaded] = useState(0);
  const known = uris.has(key);
  useEffect(() => {
    if (known || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
    let live = true;
    void snapshotUri(lat, lng, THUMB_PX, THUMB_PX, dark, THUMB_BOX_M).then((uri) => {
      uris.set(key, uri);
      if (live) setLoaded((n) => n + 1);
    });
    return () => {
      live = false;
    };
  }, [known, key, lat, lng, dark]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return uris.get(key);
}

/**
 * A small map snapshot of a saved place (plan 15/07) for the plan sheet's
 * Saved rows: a `color.fill` square while it's drawn, a map pin if it
 * can't be, then the tile. Decorative: the row's label names the place.
 */
export function PlaceThumb({ lat, lng, size = 44 }: { lat: number; lng: number; size?: number }) {
  const uri = usePlaceThumbUri(lat, lng);
  const box = { width: size, height: size };
  return (
    <View style={[styles.frame, box]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {uri ? (
        <Image source={{ uri }} style={box} resizeMode="cover" />
      ) : uri === null ? (
        <SymbolView name="mappin" size={size * 0.4} tintColor={color.secondaryLabel} resizeMode="scaleAspectFit" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderRadius: radius.row,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: color.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
