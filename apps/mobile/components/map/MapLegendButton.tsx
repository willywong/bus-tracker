import { Host, HStack, Image } from '@expo/ui/swift-ui';
import {
  frame,
  glassEffect,
} from '@expo/ui/swift-ui/modifiers';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import {
  DynamicColorIOS,
  PlatformColor,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { GlassGuard } from '@/components/GlassGuard';
import { safeImpact } from '@/components/tracker/haptics';

/**
 * Liquid-glass FAB that toggles an inline legend panel explaining what each
 * marker on the map means (bus, stop, traffic signal, route).
 */
export function MapLegendButton() {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => {
          safeImpact(Haptics.ImpactFeedbackStyle.Light);
          setOpen((v) => !v);
        }}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={open ? 'Hide map legend' : 'Show map legend'}
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
      >
        <Host matchContents>
          <HStack
            modifiers={[
              frame({ width: 44, height: 44 }),
              glassEffect({
                glass: { variant: 'regular', interactive: true },
                shape: 'circle',
              }),
            ]}
          >
            <Image
              systemName={open ? 'xmark' : 'info.circle'}
              size={20}
            />
          </HStack>
        </Host>
      </Pressable>

      {open ? <LegendPanel /> : null}
    </View>
  );
}

function LegendPanel() {
  return (
    <Animated.View
      entering={FadeIn.duration(160)}
      exiting={FadeOut.duration(120)}
      style={styles.panelWrap}
      pointerEvents="box-none"
    >
      <GlassGuard
        style={styles.panel}
        glassEffectStyle="regular"
        blurIntensity={60}
      >
        <View style={styles.scrim} />
        <View style={styles.inner}>
          <Text style={styles.title} selectable>
            LEGEND
          </Text>
          <LegendRow glyph={<BusGlyph />} label="Live bus" />
          <LegendRow glyph={<StopGlyph />} label="Your stop" />
          <LegendRow glyph={<SignalGlyph />} label="Traffic signal" />
          <LegendRow glyph={<RouteGlyph />} label="Route" />
        </View>
      </GlassGuard>
    </Animated.View>
  );
}

function LegendRow({
  glyph,
  label,
}: {
  glyph: React.ReactNode;
  label: string;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.glyphSlot}>{glyph}</View>
      <Text style={styles.rowText} selectable>
        {label}
      </Text>
    </View>
  );
}

// --- Glyphs: scaled-down versions of the actual map symbols -----------------

const ROUTE_BLUE = '#0A84FF';
const STOP_GREEN = '#34C759';
const SIGNAL_RED = '#D0021B';

function BusGlyph() {
  return (
    <View style={styles.busCircle}>
      <SymbolView
        name="bus.fill"
        size={13}
        tintColor="#FFFFFF"
        resizeMode="scaleAspectFit"
      />
    </View>
  );
}

function StopGlyph() {
  return (
    <View style={styles.stopCircle}>
      <SymbolView
        name="signpost.right.fill"
        size={13}
        tintColor="#FFFFFF"
        weight="bold"
        resizeMode="scaleAspectFit"
      />
    </View>
  );
}

function SignalGlyph() {
  return <View style={styles.signalDot} />;
}

function RouteGlyph() {
  return <View style={styles.routeLine} />;
}

// ---------------------------------------------------------------------------

// Match MapStatusCard's scrim so the legend reads as the same surface family.
const SCRIM_COLOR = DynamicColorIOS({
  light: 'rgba(255, 255, 255, 0.5)',
  dark: 'rgba(0, 0, 0, 0.45)',
});

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'flex-end',
  },
  panelWrap: {
    marginTop: 10,
    alignItems: 'flex-end',
  },
  // Same glass recipe as MapStatusCard — radius 24, identical border +
  // shadow — so the two surfaces read as peers.
  panel: {
    borderRadius: 24,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    overflow: 'hidden',
    boxShadow: '0 10px 28px rgba(0, 0, 0, 0.28)',
  },
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: SCRIM_COLOR,
  },
  inner: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 10,
    minWidth: 168,
  },
  title: {
    fontSize: 10,
    fontWeight: '700',
    color: PlatformColor('tertiaryLabel'),
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  glyphSlot: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    fontSize: 13,
    fontWeight: '500',
    color: PlatformColor('label'),
    flexShrink: 1,
  },
  busCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    backgroundColor: ROUTE_BLUE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: STOP_GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signalDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: SIGNAL_RED,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  routeLine: {
    width: 22,
    height: 3,
    borderRadius: 2,
    backgroundColor: ROUTE_BLUE,
  },
});
