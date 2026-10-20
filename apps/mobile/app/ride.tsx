import { Button, HStack, Host, Image, List, Section, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  listStyle,
  padding,
  scrollContentBackground,
} from '@expo/ui/swift-ui/modifiers';
import { Stack, useRouter } from 'expo-router';
import { useColorScheme } from 'react-native';

import { useRide } from '@/state/RideContext';
import { useTrip } from '@/state/TripContext';
import { color, hex, pick } from '@/theme/design';

/**
 * Pick where you're getting off. Stops are listed in the order the bus
 * reaches them from your boarding stop, with how many stops away each is.
 */
export default function RideScreen() {
  const router = useRouter();
  const trip = useTrip();
  const ride = useRide();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const accent = pick(hex.accent, scheme);

  return (
    <>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="xmark" accessibilityLabel="Close" onPress={() => router.back()} />
      </Stack.Toolbar>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <List modifiers={[listStyle('insetGrouped'), scrollContentBackground('hidden')]}>
          <Section
            title={trip.stopName ? `From ${trip.stopName}` : undefined}
            footer={
              <Text>
                BusBuddy counts the stops down and buzzes when yours is next. Your location is
                used only while the app is open; a notification covers you if the screen is off.
              </Text>
            }
          >
            {ride.destinations.length === 0 ? (
              <Text modifiers={[foregroundStyle({ type: 'hierarchical', style: 'secondary' })]}>
                No stops after yours on this route.
              </Text>
            ) : (
              ride.destinations.map((s, i) => (
                <Button
                  key={`${s.stopId}-${i}`}
                  onPress={() => {
                    ride.start(s.stopId);
                    router.back();
                  }}
                  modifiers={[buttonStyle('plain')]}
                >
                  <HStack spacing={12} modifiers={[padding({ vertical: 4 })]}>
                    <Image
                      systemName="circle"
                      size={10}
                      color={color.tertiaryLabel}
                      modifiers={[frame({ width: 20 })]}
                    />
                    <VStack spacing={2} alignment="leading">
                      <Text modifiers={[font({ size: 17 })]}>{s.name}</Text>
                      <Text
                        modifiers={[
                          font({ size: 13 }),
                          foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
                        ]}
                      >
                        {i === 0 ? 'Next stop' : `${i + 1} stops`}
                      </Text>
                    </VStack>
                    <Spacer />
                    <Image systemName="bell" size={14} color={accent} />
                  </HStack>
                </Button>
              ))
            )}
          </Section>
        </List>
      </Host>
    </>
  );
}
