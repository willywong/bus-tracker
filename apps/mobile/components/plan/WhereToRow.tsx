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
import { StyleSheet, useColorScheme } from 'react-native';

import { hex, MARGIN, pick } from '@/theme/design';
import { haptics } from '@/utils/haptics';

/** The capsule and the circle. The row below adds 8pt (`WHERE_TO_ROW_HEIGHT`). */
const ROW_HEIGHT = 44;

/**
 * The peek's "Where to?" row (spec §6.1): a Liquid Glass search capsule,
 * then a glass profile circle that opens Settings. Home and Work live in the
 * Plan and Saved sections. Glass is allowed here because search is chrome,
 * as in Apple Maps; it shows at every detent, so nothing reflows when the
 * sheet moves.
 */
export function WhereToRow({ onOpen, onProfile }: { onOpen: () => void; onProfile: () => void }) {
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
          <ProfileCircle ink={pick(hex.ink, scheme)} onPress={onProfile} />
        </HStack>
      </GlassEffectContainer>
    </Host>
  );
}

/** A 44pt glass circle; it merges with the capsule in the glass container. */
function ProfileCircle({ ink, onPress }: { ink: string; onPress: () => void }) {
  return (
    <Button
      onPress={() => {
        haptics.selection();
        onPress();
      }}
      modifiers={[
        buttonStyle('plain'),
        accessibilityLabel('Settings'),
        accessibilityHint('Saved places, routes and preferences'),
      ]}
    >
      <Image
        systemName="person.crop.circle"
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
