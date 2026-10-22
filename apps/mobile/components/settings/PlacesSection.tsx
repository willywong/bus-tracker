import { HStack, Image, List, Section, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  accessibilityElement,
  accessibilityLabel,
  background,
  clipShape,
  font,
  foregroundStyle,
  frame,
  layoutPriority,
  lineLimit,
  padding,
  resizable,
  aspectRatio,
  shapes,
  truncationMode,
} from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'expo-symbols';

import { savedInOrder, savedRow } from '@/components/plan/model';
import { usePlaceThumbUri } from '@/components/plan/PlaceThumb';
import { useSettings, type SavedPlace } from '@/hooks/useSettings';
import { removePlace } from '@/services/places/saved';
import { haptics } from '@/utils/haptics';

const THUMB = 44;
const secondary = foregroundStyle({ type: 'hierarchical', style: 'secondary' });
const oneLine = [lineLimit(1), truncationMode('tail')];

const GLYPH: Record<SavedPlace['kind'], SFSymbol> = { home: 'house.fill', work: 'briefcase.fill', pin: 'mappin' };

/**
 * Settings → Places (plan 15/07): Home, Work, then your pins, each with its
 * map thumbnail. Swipe left to remove one (Edit's ⊖ in Your routes shows
 * here too). Places are saved from a destination's results with Save.
 */
export function PlacesSection() {
  const { savedPlaces, setSavedPlaces } = useSettings();
  const places = savedInOrder(savedPlaces);

  return (
    <Section
      title="Places"
      footer={<Text>Home and Work appear in Plan and Saved, and under the app icon.</Text>}
    >
      {places.length === 0 ? (
        <Text modifiers={[secondary]}>Save a place from its results with Save.</Text>
      ) : (
        <List.ForEach
          data={places}
          keyExtractor={(p) => p.id}
          recycling={false}
          onDelete={(indices) => {
            let next = savedPlaces;
            for (const i of indices) {
              const p = places[i];
              if (p) next = removePlace(next, p.id);
            }
            haptics.selection();
            setSavedPlaces(next);
          }}
        >
          {({ item }) => <PlaceRow place={item} />}
        </List.ForEach>
      )}
    </Section>
  );
}

function PlaceRow({ place }: { place: SavedPlace }) {
  const uri = usePlaceThumbUri(place.lat, place.lng);
  const row = savedRow(place);
  const subtitle =
    row.subtitle ?? (place.ref?.kind === 'station' ? 'Station' : place.ref?.kind === 'stop' ? 'Bus stop' : null);
  const box = frame({ width: THUMB, height: THUMB });

  return (
    // One VoiceOver element per row, read as the planner's Saved row is.
    <HStack
      spacing={12}
      alignment="center"
      modifiers={[padding({ vertical: 2 }), accessibilityElement('ignore'), accessibilityLabel(row.accessibilityLabel)]}
    >
      {uri ? (
        // A local file, read on the main thread: the tile is only 88 × 88 px.
        <Image
          uiImage={uri}
          modifiers={[resizable(), aspectRatio({ contentMode: 'fill' }), box, clipShape('roundedRectangle', 8)]}
        />
      ) : (
        // Being drawn, or no tile (offline): the kind's glyph on a fill.
        <Image
          systemName={GLYPH[place.kind]}
          size={17}
          modifiers={[
            secondary,
            box,
            background({ type: 'hierarchical', style: 'quaternary' }, shapes.roundedRectangle({ cornerRadius: 8 })),
          ]}
        />
      )}
      <VStack spacing={2} alignment="leading" modifiers={[layoutPriority(1)]}>
        <Text modifiers={[font({ size: 17 }), ...oneLine]}>{row.title}</Text>
        {subtitle ? <Text modifiers={[font({ size: 13 }), secondary, ...oneLine]}>{subtitle}</Text> : null}
      </VStack>
      <Spacer />
    </HStack>
  );
}
