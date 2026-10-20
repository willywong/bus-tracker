import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassGuard } from '@/components/GlassGuard';
import { color, type } from '@/theme/design';

export interface BannerContent {
  title: string;
  body: string;
}

export interface ForegroundBannerProps {
  banner: BannerContent | null;
  onDismiss: () => void;
  /** Milliseconds to hold the banner before auto-dismiss. */
  durationMs?: number;
}

/**
 * Floating banner rendered over the active screen when an Expo push arrives
 * while the app is foregrounded. Auto-dismisses after `durationMs` (default 6s).
 */
export function ForegroundBanner({
  banner,
  onDismiss,
  durationMs = 6_000,
}: ForegroundBannerProps) {
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!banner) return;
    const timer = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(timer);
  }, [banner, durationMs, onDismiss]);

  if (!banner) return null;

  return (
    <View
      pointerEvents="none"
      style={[styles.overlay, { paddingTop: insets.top + 8 }]}
    >
      <GlassGuard style={styles.card}>
        <View style={styles.content} accessibilityRole="alert">
          <Text style={styles.title} numberOfLines={1}>
            {banner.title}
          </Text>
          <Text style={styles.body} numberOfLines={2}>
            {banner.body}
          </Text>
        </View>
      </GlassGuard>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 16,
    zIndex: 1000,
  },
  card: {
    width: '100%',
    maxWidth: 480,
    borderRadius: 24,
    borderCurve: 'continuous',
  },
  content: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  title: {
    ...type.headline,
    fontSize: 15,
    color: color.label,
    marginBottom: 2,
  },
  body: {
    ...type.status,
    fontSize: 14,
    color: color.secondaryLabel,
  },
});
