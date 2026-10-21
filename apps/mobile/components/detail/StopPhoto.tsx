import { useEffect, useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { color, space } from '@/theme/design';

/**
 * Google Street View Static API key. Optional: without it the sheet shows
 * no photo, only the Street View link row. It ships in the app bundle, so
 * restrict it to the Street View Static API and cap its daily quota.
 */
const KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ?? '';
const BUNDLE_ID = 'com.willywong.bustracker';
const BASE = 'https://maps.googleapis.com/maps/api/streetview';
/** Panoramas further than this from the stop wouldn't show it. */
const RADIUS_M = 40;
// Lets the key be restricted to this iOS app where Google supports it.
const HEADERS = { 'X-Ios-Bundle-Identifier': BUNDLE_ID };

export const hasStopPhotos = KEY.length > 0;

interface Pano {
  lat: number;
  lng: number;
  date: string | null;
}

/**
 * A Street View photo of the stop: the nearest outdoor panorama, turned to
 * face the stop. Looked up first through the metadata endpoint (no image
 * is requested unless one exists), and tapping it opens the full Street
 * View. Nothing renders without a key or without imagery here.
 */
export function StopPhoto({ lat, lng, onOpen }: { lat: number; lng: number; onOpen: () => void }) {
  const [pano, setPano] = useState<Pano | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!KEY) return;
    let cancelled = false;
    setPano(null);
    setFailed(false);
    fetch(`${BASE}/metadata?location=${lat},${lng}&radius=${RADIUS_M}&source=outdoor&key=${KEY}`, {
      headers: HEADERS,
    })
      .then((r) => r.json())
      .then((m: { status: string; location?: { lat: number; lng: number }; date?: string }) => {
        if (cancelled || m.status !== 'OK' || !m.location) return;
        setPano({ lat: m.location.lat, lng: m.location.lng, date: m.date ?? null });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [lat, lng]);

  if (!KEY || !pano || failed) return null;

  const heading = Math.round(bearing(pano, { lat, lng }));
  const uri =
    `${BASE}?size=640x320&scale=2&location=${pano.lat},${pano.lng}` +
    `&heading=${heading}&fov=75&pitch=0&source=outdoor&key=${KEY}`;

  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="imagebutton"
      accessibilityLabel="Street View photo of this stop"
      accessibilityHint="Opens Street View in Google Maps"
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <Image
        source={{ uri, headers: HEADERS }}
        style={styles.image}
        resizeMode="cover"
        onError={() => setFailed(true)}
      />
      <View style={styles.caption}>
        <Text style={styles.captionText}>
          Street View{pano.date ? ` · ${formatMonth(pano.date)}` : ''}
        </Text>
      </View>
    </Pressable>
  );
}

/** Opens the interactive Street View at the stop (keyless Maps URLs API). */
export function openStreetView({ lat, lng }: { lat: number; lng: number }) {
  void Linking.openURL(`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat}%2C${lng}`);
}

/** Initial compass bearing from a to b, in degrees. */
function bearing(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const φ1 = a.lat * rad;
  const φ2 = b.lat * rad;
  const Δλ = (b.lng - a.lng) * rad;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) / rad) + 360) % 360;
}

/** "2024-03" → "Mar 2024": how old the imagery is. */
function formatMonth(date: string): string {
  const [y, m] = date.split('-').map(Number);
  if (!y || !m) return date;
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: color.fill,
  },
  pressed: {
    opacity: 0.85,
  },
  image: {
    width: '100%',
    aspectRatio: 2,
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
