import {
  Button,
  GlassEffectContainer,
  Host,
  HStack,
  Image,
  Text,
  useNativeState,
} from '@expo/ui/swift-ui';
import {
  accessibilityHint,
  accessibilityLabel,
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  glassEffect,
  padding,
  symbolEffect,
} from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'expo-symbols';
import { StyleSheet, useColorScheme } from 'react-native';

import type { SavedPlace } from '@/hooks/useSettings';
import { hex, MARGIN, pick } from '@/theme/design';
import { haptics } from '@/utils/haptics';

/** The capsule and the circles. The row below adds 8pt (`WHERE_TO_ROW_HEIGHT`). */
const ROW_HEIGHT = 44;

/**
 * The peek's "Where to?" row (spec §6.1): a Liquid Glass search capsule,
 * then a glass circle for Home and for Work once they're set. Glass is
 * allowed here because search is chrome, as in Apple Maps; it shows at every
 * detent, so nothing reflows when the sheet moves.
 */
export function WhereToRow({
  onOpen,
  home,
  work,
  onPlace,
}: {
  onOpen: () => void;
  home: SavedPlace | null;
  work: SavedPlace | null;
  onPlace: (p: SavedPlace) => void;
}) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const bounce = useNativeState(0);

  const tap = () => {
    bounce.set(bounce.get() + 1);
    haptics.selection();
    onOpen();
  };

  return (
    <Host matchContents={{ vertical: true }} style={styles.host}>
      <GlassEffectContainer spacing={8}>
        <HStack spacing={8}>
          <Button
            onPress={tap}
            modifiers={[
              buttonStyle('plain'),
              accessibilityLabel('Where to?'),
              accessibilityHint('Search for a place and plan a trip'),
            ]}
          >
            <HStack
              spacing={8}
              modifiers={[
                padding({ horizontal: 16 }),
                frame({
                  maxWidth: Number.POSITIVE_INFINITY,
                  minHeight: ROW_HEIGHT,
                  alignment: 'leading',
                }),
                // The magnifier and the placeholder both read as secondary ink.
                foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
                glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'capsule' }),
              ]}
            >
              <Image
                systemName="magnifyingglass"
                size={17}
                modifiers={[symbolEffect({ effect: 'bounce' }, { value: bounce })]}
              />
              <Text modifiers={[font({ size: 17 })]}>Where to?</Text>
            </HStack>
          </Button>
          {home ? (
            <PlaceCircle
              symbol="house.fill"
              label="Directions home"
              ink={pick(hex.ink, scheme)}
              onPress={() => onPlace(home)}
            />
          ) : null}
          {work ? (
            <PlaceCircle
              symbol="briefcase.fill"
              label="Directions to work"
              ink={pick(hex.ink, scheme)}
              onPress={() => onPlace(work)}
            />
          ) : null}
        </HStack>
      </GlassEffectContainer>
    </Host>
  );
}

/** A 44pt glass circle that plans straight to a saved place. */
function PlaceCircle({
  symbol,
  label,
  ink,
  onPress,
}: {
  symbol: SFSymbol;
  label: string;
  ink: string;
  onPress: () => void;
}) {
  return (
    <Button
      onPress={() => {
        haptics.selection();
        onPress();
      }}
      modifiers={[buttonStyle('plain'), accessibilityLabel(label)]}
    >
      <Image
        systemName={symbol}
        size={17}
        color={ink}
        modifiers={[
          frame({ width: ROW_HEIGHT, height: ROW_HEIGHT }),
          glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'circle' }),
        ]}
      />
    </Button>
  );
}

const styles = StyleSheet.create({
  host: {
    height: ROW_HEIGHT,
    marginHorizontal: MARGIN,
    marginBottom: 8,
  },
});
