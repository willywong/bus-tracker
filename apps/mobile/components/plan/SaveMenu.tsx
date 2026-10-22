import { Button, Host, HStack, Image, Menu, Text as SwiftText } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  animation,
  Animation,
  contentTransition,
  disabled,
  font,
  glassEffect,
  padding,
} from '@expo/ui/swift-ui/modifiers';
import type { Place } from '@bus-tracker/shared';
import { StyleSheet } from 'react-native';

import { hashText } from '@/components/trip/Hero';
import { useSettings, type SavedPlace } from '@/hooks/useSettings';
import { addPin, draftFromPlannerPlace, findSaved, MAX_PINS, setHome, setWork } from '@/services/places/saved';
import { haptics } from '@/utils/haptics';

const SAVED_WORD: Record<SavedPlace['kind'], string> = { home: 'Home', work: 'Work', pin: 'Pinned' };

/**
 * The results header's Save menu (plan 15/07): a Liquid Glass pill,
 * "Save" until the destination is saved, then "Saved · Home". Set as Home,
 * Set as Work, or Pin this place (disabled, "· 6 max", once six are
 * pinned). The glass sits on the label's HStack, not the Menu, or SwiftUI
 * collapses the label to its icon.
 */
export function SaveMenu({ to, address }: { to: Place; address: string | null }) {
  const { savedPlaces, setSavedPlaces } = useSettings();
  const draft = draftFromPlannerPlace(to, address);
  const saved = findSaved(savedPlaces, draft);
  const label = saved ? `Saved · ${SAVED_WORD[saved.kind]}` : 'Save';
  const pin = addPin(savedPlaces, draft, Date.now());
  const pinsFull = !pin.ok && pin.reason === 'pins-full';

  const save = (next: SavedPlace[]) => {
    haptics.success();
    setSavedPlaces(next);
  };

  return (
    <Host matchContents style={styles.host}>
      <Menu
        label={
          <HStack
            spacing={6}
            modifiers={[
              padding({ horizontal: 14, vertical: 8 }),
              glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'capsule' }),
              accessibilityLabel(saved ? `Saved as ${SAVED_WORD[saved.kind]}` : 'Save this place'),
            ]}
          >
            <Image systemName={saved ? 'bookmark.fill' : 'bookmark'} size={14} />
            <SwiftText
              modifiers={[
                font({ size: 15, weight: 'semibold' }),
                // "Save" crossfades to "Saved · Home" rather than snapping.
                contentTransition('opacity'),
                animation(Animation.smooth({ duration: 0.2 }), hashText(label)),
              ]}
            >
              {label}
            </SwiftText>
            <Image systemName="chevron.down" size={11} />
          </HStack>
        }
      >
        <Button
          label="Set as Home"
          systemImage="house"
          onPress={() => save(setHome(savedPlaces, draft, Date.now()))}
        />
        <Button
          label="Set as Work"
          systemImage="briefcase"
          onPress={() => save(setWork(savedPlaces, draft, Date.now()))}
        />
        <Button
          label={pinsFull ? `Pin this place · ${MAX_PINS} max` : 'Pin this place'}
          systemImage="mappin"
          // Full, or already saved (as a pin, Home or Work).
          modifiers={pin.ok ? [] : [disabled()]}
          onPress={() => {
            // Re-checked against the list as it is now.
            const r = addPin(savedPlaces, draft, Date.now());
            if (r.ok) save(r.list);
            else haptics.error();
          }}
        />
      </Menu>
    </Host>
  );
}

const styles = StyleSheet.create({
  host: {
    alignSelf: 'flex-start',
  },
});
