import { Button, DatePicker, Host, HStack, Image, Menu, Text as SwiftText } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  datePickerStyle,
  disabled,
  font,
  glassEffect,
  padding,
} from '@expo/ui/swift-ui/modifiers';
import type { Place } from '@bus-tracker/shared';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Hairline } from '@/components/trip/Rows';
import { formatClockHHMM } from '@/components/tracker/logic';
import { RowButton } from '@/components/ui/RowButton';
import type { When } from '@/state/PlannerContext';
import { color, space, type } from '@/theme/design';
import { haptics } from '@/utils/haptics';

import { defaultDepartAt, networkEndMs } from './model';
import { SUGGESTION_INSET } from './SuggestionRow';

const SWAP_SIZE = 44;

/**
 * The plan sheet's From and When rows (spec §6.2). From reads "My location"
 * (or the chosen start) with a ⇅ swap on the trailing edge; When is a Liquid
 * Glass menu: Leave now, Depart at… (an inline compact date picker) and a
 * disabled Arrive by… · Soon.
 */
export function FromWhen({
  from,
  canSwap,
  editingFrom,
  locationOff,
  when,
  onFromPress,
  onSwap,
  onWhen,
}: {
  from: Place;
  /** A destination is set, so swapping does something. */
  canSwap: boolean;
  /** The search bar is editing the start point. */
  editingFrom: boolean;
  /** From is My location but location permission isn't granted. */
  locationOff: boolean;
  when: When;
  onFromPress: () => void;
  onSwap: () => void;
  onWhen: (w: When) => void;
}) {
  const here = from.kind === 'here';
  const value = editingFrom
    ? 'Search for a starting point'
    : here && locationOff
      ? 'Choose a starting point'
      : from.name;
  const muted = editingFrom || (here && locationOff);

  return (
    <View>
      <View style={styles.fromRow}>
        <View style={styles.fromTap}>
          <RowButton
            onPress={onFromPress}
            style={styles.fromInner}
            accessibilityLabel={`From, ${value}`}
            accessibilityHint="Changes the starting point"
          >
            <View style={styles.lead}>
              <SymbolView
                name={here ? 'location.fill' : 'mappin'}
                size={17}
                tintColor={color.label}
                resizeMode="scaleAspectFit"
              />
            </View>
            <Text style={styles.fromLabel}>From</Text>
            <Text style={[styles.fromValue, muted && styles.muted]} numberOfLines={1}>
              {value}
            </Text>
          </RowButton>
        </View>
        <Pressable
          onPress={() => {
            if (!canSwap) return;
            haptics.selection();
            onSwap();
          }}
          accessibilityRole="button"
          accessibilityLabel="Swap start and destination"
          accessibilityState={{ disabled: !canSwap }}
          hitSlop={4}
          style={styles.swap}
        >
          <SymbolView
            name="arrow.up.arrow.down"
            size={17}
            tintColor={canSwap ? color.label : color.tertiaryLabel}
            resizeMode="scaleAspectFit"
          />
        </Pressable>
      </View>
      <Hairline inset={SUGGESTION_INSET} />
      <WhenRow when={when} onWhen={onWhen} />
    </View>
  );
}

function WhenRow({ when, onWhen }: { when: When; onWhen: (w: When) => void }) {
  // The picker's lower bound; refreshed whenever Depart at… is chosen.
  const [now, setNow] = useState(() => Date.now());
  const label = when.kind === 'depart' ? `Depart ${formatClockHHMM(when.at)}` : 'Leave now';

  const depart = () => {
    const t = Date.now();
    setNow(t);
    haptics.selection();
    onWhen({ kind: 'depart', at: when.kind === 'depart' && when.at > t ? when.at : defaultDepartAt(t) });
  };

  return (
    <View style={styles.when}>
      <Host matchContents style={styles.menuHost}>
        <Menu
          label={
            <HStack
              spacing={6}
              modifiers={[
                padding({ horizontal: 14, vertical: 8 }),
                glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'capsule' }),
                accessibilityLabel(label),
              ]}
            >
              <Image systemName="clock" size={14} />
              <SwiftText modifiers={[font({ size: 15, weight: 'semibold' })]}>{label}</SwiftText>
              <Image systemName="chevron.down" size={11} />
            </HStack>
          }
        >
          <Button
            label="Leave now"
            systemImage={when.kind === 'now' ? 'checkmark' : undefined}
            onPress={() => {
              haptics.selection();
              onWhen({ kind: 'now' });
            }}
          />
          <Button
            label="Depart at…"
            systemImage={when.kind === 'depart' ? 'checkmark' : undefined}
            onPress={depart}
          />
          <Button label="Arrive by… · Soon" modifiers={[disabled()]} />
        </Menu>
      </Host>
      {when.kind === 'depart' ? (
        <Host matchContents={{ vertical: true }} style={styles.pickerHost}>
          <DatePicker
            title="Depart at"
            selection={new Date(when.at)}
            range={{ start: new Date(Math.min(now, when.at)), end: new Date(networkEndMs(now)) }}
            displayedComponents={['date', 'hourAndMinute']}
            onDateChange={(d) => onWhen({ kind: 'depart', at: d.getTime() })}
            modifiers={[datePickerStyle('compact')]}
          />
        </Host>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fromRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fromTap: {
    flex: 1,
    minWidth: 0,
  },
  fromInner: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  lead: {
    width: 24,
    alignItems: 'center',
  },
  fromLabel: {
    ...type.body,
    color: color.secondaryLabel,
  },
  fromValue: {
    ...type.body,
    color: color.label,
    flexShrink: 1,
  },
  muted: {
    color: color.secondaryLabel,
  },
  swap: {
    width: SWAP_SIZE,
    height: SWAP_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -space.sm,
  },
  when: {
    paddingVertical: space.sm,
    gap: space.sm,
  },
  menuHost: {
    alignSelf: 'flex-start',
  },
  pickerHost: {
    alignSelf: 'stretch',
  },
});
