import { Button, Host, Text as SwiftText } from '@expo/ui/swift-ui';
import { buttonBorderShape, buttonStyle, controlSize, font, tint } from '@expo/ui/swift-ui/modifiers';
import { StyleSheet, Text, useColorScheme, View } from 'react-native';

import { Hero, SourceMark } from '@/components/trip/Hero';
import type { HeroValue, TripModel } from '@/components/trip/model';
import { Hairline, KeyValueRow, ToggleRow } from '@/components/trip/Rows';
import type { RideContextValue } from '@/state/RideContext';
import { color, hex, pick, space, type } from '@/theme/design';

/**
 * The trip sheet while you're on the bus: stops left as the one number, the
 * next stop by name, the rough time left and where the position comes from,
 * and a way to end the ride.
 */
export function RideBody({ ride, base }: { ride: RideContextValue; base: TripModel }) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
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

  const tracking =
    ride.positionSource === 'phone'
      ? 'Using your location'
      : ride.positionSource === 'bus'
        ? 'Using the bus’s live position'
        : 'Waiting for a location…';

  return (
    <View style={styles.wrap}>
      <View style={styles.heroBlock}>
        <Hero model={model} />
        {p?.phase !== 'arrived' ? (
          <View style={styles.statusRow}>
            <SourceMark source={ride.positionSource ? 'live' : 'scheduled'} />
            <Text style={styles.status}>
              {p?.phase === 'next-is-yours' ? 'Get ready to get off' : tracking}
            </Text>
          </View>
        ) : null}
      </View>

      <View>
        <Hairline />
        {p?.nextStop && p.phase === 'riding' ? (
          <>
            <KeyValueRow label="Next stop" value={p.nextStop.name} />
            <Hairline />
          </>
        ) : null}
        {ride.minutesLeft != null && p?.phase === 'riding' ? (
          <>
            <KeyValueRow label="Time left" value={`about ${ride.minutesLeft} min`} />
            <Hairline />
          </>
        ) : null}
        <ToggleRow
          title="Announce my stop"
          caption="Speaks when yours is next. Best with headphones."
          value={ride.speak}
          onValueChange={ride.setSpeak}
          accessibilityLabel="Announce my stop out loud"
        />
        <Hairline />
      </View>

      <Host matchContents style={styles.end}>
        <Button
          onPress={ride.end}
          modifiers={[
            buttonStyle('bordered'),
            buttonBorderShape('capsule'),
            controlSize('large'),
            tint(pick(hex.ink, scheme)),
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
    gap: space.lg,
  },
  heroBlock: {
    gap: space.xs,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  status: {
    ...type.status,
    color: color.label,
  },
  end: {
    alignSelf: 'center',
  },
});
