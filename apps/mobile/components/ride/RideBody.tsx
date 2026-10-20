import { Button, Host, Text as SwiftText } from '@expo/ui/swift-ui';
import { buttonBorderShape, buttonStyle, controlSize, font, tint } from '@expo/ui/swift-ui/modifiers';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { Hero } from '@/components/trip/Hero';
import type { HeroValue, TripModel } from '@/components/trip/model';
import type { RideContextValue } from '@/state/RideContext';
import { color, radius, space, type } from '@/theme/design';

/**
 * The trip sheet while you're on the bus: stops left as the one number,
 * the next stop by name, and a way to end the ride.
 */
export function RideBody({ ride, base }: { ride: RideContextValue; base: TripModel }) {
  const p = ride.progress;
  const dest = ride.destination;
  if (!dest) return null;

  let hero: HeroValue;
  let label: string;
  if (!p) {
    hero = { text: '–', unit: null, kind: 'word' };
    label = `Riding to ${dest.name}`;
  } else if (p.phase === 'arrived') {
    hero = { text: 'You’re here', unit: null, kind: 'word' };
    label = `You've reached ${dest.name}`;
  } else if (p.phase === 'next-is-yours') {
    hero = { text: 'Next stop', unit: null, kind: 'word' };
    label = `Your stop, ${dest.name}, is next`;
  } else {
    hero = { text: String(p.stopsToGo), unit: 'stops', kind: 'minutes' };
    label = `${p.stopsToGo} stops to ${dest.name}`;
  }

  const model: TripModel = {
    ...base,
    hero,
    heroEyebrow: `To ${dest.name}`,
    source: 'live',
    accessibilityLabel: label,
  };

  const status =
    p == null || p.phase === 'arrived'
      ? null
      : p.phase === 'next-is-yours'
        ? 'Get ready to get off'
        : p.nextStop
          ? `Next: ${p.nextStop.name}`
          : null;
  const tracking =
    ride.positionSource === 'phone'
      ? 'Using your location'
      : ride.positionSource === 'bus'
        ? 'Using the bus’s live position'
        : 'Waiting for a location…';
  const minutes =
    ride.minutesLeft != null && p?.phase === 'riding' ? `About ${ride.minutesLeft} min · ` : '';

  return (
    <View style={styles.wrap}>
      <Hero model={model} />
      {status ? (
        <View style={styles.statusRow}>
          <SymbolView name="bell.fill" size={14} tintColor={color.accent} />
          <Text style={styles.status} numberOfLines={2}>
            {status}
          </Text>
        </View>
      ) : null}
      {p?.phase !== 'arrived' ? (
        <Text style={styles.detail}>
          {minutes}
          {tracking}
        </Text>
      ) : null}

      <View style={styles.toggleRow}>
        <View style={styles.toggleText}>
          <Text style={styles.toggleTitle}>Announce my stop</Text>
          <Text style={styles.toggleCaption}>Speaks when yours is next. Best with headphones.</Text>
        </View>
        <Switch
          value={ride.speak}
          onValueChange={ride.setSpeak}
          accessibilityLabel="Announce my stop out loud"
        />
      </View>

      <Host matchContents style={styles.end}>
        <Button
          onPress={ride.end}
          modifiers={[
            buttonStyle('bordered'),
            buttonBorderShape('capsule'),
            controlSize('large'),
            tint(p?.phase === 'arrived' ? '#007AFF' : '#FF3B30'),
          ]}
        >
          <SwiftText modifiers={[font({ size: 17, weight: 'semibold' })]}>
            {p?.phase === 'arrived' ? 'Done' : 'End Ride'}
          </SwiftText>
        </Button>
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space.xs,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  status: {
    ...type.status,
    color: color.label,
    fontWeight: '500',
    flexShrink: 1,
  },
  detail: {
    ...type.status,
    color: color.secondaryLabel,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    marginTop: space.md,
    borderRadius: radius.group,
    borderCurve: 'continuous',
    backgroundColor: color.fill,
  },
  toggleText: {
    flex: 1,
    gap: 2,
  },
  toggleTitle: {
    ...type.body,
    color: color.label,
  },
  toggleCaption: {
    ...type.footnote,
    color: color.secondaryLabel,
  },
  end: {
    marginTop: space.sm,
    alignSelf: 'center',
  },
});
