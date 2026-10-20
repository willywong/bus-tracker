import {
  BottomSheet,
  Button,
  Group,
  Host,
  HStack,
  Image,
  Spacer,
  Text,
  VStack,
} from '@expo/ui/swift-ui';
import {
  Animation,
  animation,
  background,
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  padding,
  presentationBackgroundInteraction,
  presentationDetents,
  presentationDragIndicator,
  shapes,
} from '@expo/ui/swift-ui/modifiers';
import { useWindowDimensions } from 'react-native';

import { useSettings, type MapType } from '@/hooks/useSettings';

interface MapModesSheetProps {
  isPresented: boolean;
  onDismiss: () => void;
}

/**
 * Apple-Maps-style sheet that lets the user pick the map base layer
 * (Standard / Satellite). Uses @expo/ui's native SwiftUI BottomSheet so
 * the medium detent comes for free and the sheet renders with the
 * correct iOS look. Mounted inline from both the Map screen (FAB) and
 * the Settings screen (row).
 */
export function MapModesSheet({ isPresented, onDismiss }: MapModesSheetProps) {
  const settings = useSettings();
  const { width } = useWindowDimensions();
  return (
    <Host matchContents style={[{ position: 'absolute', width }]}>
      <BottomSheet
        isPresented={isPresented}
        onIsPresentedChange={(next) => {
          if (!next) onDismiss();
        }}
      >
        <Group
          modifiers={[
            presentationDetents(['medium']),
            presentationDragIndicator('visible'),
            presentationBackgroundInteraction('enabled'),
          ]}
        >
          <VStack
            spacing={16}
            alignment="leading"
            modifiers={[padding({ horizontal: 20, top: 16, bottom: 24 })]}
          >
            <HStack>
              <Text modifiers={[font({ size: 22, weight: 'bold' })]}>
                Map Modes
              </Text>
              <Spacer />
              <Image
                systemName="xmark.circle.fill"
                size={24}
                color="#8E8E93"
                onPress={onDismiss}
              />
            </HStack>

            <HStack spacing={12}>
              <MapTypeCard
                kind="standard"
                selected={settings.mapType === 'standard'}
                onSelect={() => settings.setMapType('standard')}
              />
              <MapTypeCard
                kind="satellite"
                selected={settings.mapType === 'satellite'}
                onSelect={() => settings.setMapType('satellite')}
              />
            </HStack>
            <Spacer />
          </VStack>
        </Group>
      </BottomSheet>
    </Host>
  );
}

interface MapTypeCardProps {
  kind: MapType;
  selected: boolean;
  onSelect: () => void;
}

const SELECT_BLUE = '#0A84FF';
// Opaque fill for the 2pt gap between the inner card and the selection
// ring. SwiftUI sheets use a translucent material background, so a true
// "transparent gap" would just show the blue ring through. Using an
// opaque tint one shade lighter than the iOS dark-mode sheet base
// (`#1C1C1E`) reads as an intentional inset rather than a hard border.
const GAP_FILL = '#2C2C2E';
// Distinct dark tints so the cards read against the sheet background
// without needing real preview imagery.
const STANDARD_FILL = '#48484A';
const SATELLITE_FILL = '#2E5C3A';

function MapTypeCard({ kind, selected, onSelect }: MapTypeCardProps) {
  const isStandard = kind === 'standard';
  const fillColor = isStandard ? STANDARD_FILL : SATELLITE_FILL;
  const iconName = isStandard ? 'map.fill' : 'globe.americas.fill';
  const label = isStandard ? 'Standard' : 'Satellite';

  // Three stacked backgrounds give a thin selection ring with a 2pt
  // gap between it and the card fill. From inside out:
  //   1. inner fill (rounded 11)
  //   2. 2pt gap layer in sheet-bg color (rounded 13)
  //   3. 2pt ring layer in blue (rounded 15) — transparent when unselected
  // Padding is symmetric whether selected or not, so the label below
  // doesn't shift when toggling. The `animation` modifier ties the
  // ring's color change to `selected` so SwiftUI eases between states.
  return (
    <Button
      onPress={onSelect}
      modifiers={[
        buttonStyle('plain'),
        frame({ maxWidth: Number.POSITIVE_INFINITY }),
      ]}
    >
      <VStack
        spacing={8}
        modifiers={[frame({ maxWidth: Number.POSITIVE_INFINITY })]}
      >
        <HStack
          modifiers={[
            // @expo/ui 58 splits fixed vs flexible frame; pin height via min/max.
            frame({
              minHeight: 76,
              maxHeight: 76,
              maxWidth: Number.POSITIVE_INFINITY,
            }),
            background(
              fillColor,
              shapes.roundedRectangle({ cornerRadius: 11 }),
            ),
            padding({ all: 2 }),
            background(
              GAP_FILL,
              shapes.roundedRectangle({ cornerRadius: 13 }),
            ),
            padding({ all: 2 }),
            background(
              selected ? SELECT_BLUE : '#00000000',
              shapes.roundedRectangle({ cornerRadius: 15 }),
            ),
            animation(Animation.easeInOut({ duration: 0.2 }), selected),
          ]}
        >
          <Spacer />
          <Image systemName={iconName} size={28} color="#FFFFFF" />
          <Spacer />
        </HStack>
        <Text
          modifiers={[
            font({ size: 13, weight: 'medium' }),
            foregroundStyle({
              type: 'hierarchical',
              style: selected ? 'primary' : 'secondary',
            }),
          ]}
        >
          {label}
        </Text>
      </VStack>
    </Button>
  );
}
