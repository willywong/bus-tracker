import { SymbolView } from 'expo-symbols';
import { Fragment } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { LineBadge } from '@/components/rail/LineBadge';
import { RouteBadge } from '@/components/trip/SheetHeader';
import { color, type } from '@/theme/design';

import type { Chip } from './results';

const CHIP_HEIGHT = 20;

/**
 * The itinerary's legs as chips, left to right (spec §6.2): a walk is
 * `figure.walk` and its minutes, a bus the outlined route chip, rail a
 * filled chip in the line colour. A turn-up-and-go leg says "every 4" under
 * its chip. Chevrons separate them. Decorative for VoiceOver: the row's
 * label reads the legs.
 */
export function LegChips({ chips }: { chips: readonly Chip[] }) {
  return (
    <View style={styles.row} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {chips.map((c, i) => (
        <Fragment key={i}>
          {i > 0 ? (
            <View style={styles.sep}>
              <SymbolView name="chevron.right" size={9} weight="semibold" tintColor={color.tertiaryLabel} />
            </View>
          ) : null}
          <View style={styles.cell}>
            <ChipView chip={c} />
            {c.kind !== 'walk' && c.every != null ? <Text style={styles.every}>{`every ${c.every}`}</Text> : null}
          </View>
        </Fragment>
      ))}
    </View>
  );
}

function ChipView({ chip }: { chip: Chip }) {
  switch (chip.kind) {
    case 'walk':
      return (
        <View style={styles.walk}>
          <SymbolView name="figure.walk" size={12} weight="regular" tintColor={color.label} />
          <Text style={styles.walkText}>{chip.minutes}</Text>
        </View>
      );
    case 'bus':
      return <RouteBadge code={chip.label} size="small" />;
    case 'rail':
      return (
        <LineBadge
          size="small"
          line={{ code: chip.label, name: chip.name, color: chip.color, textColor: chip.textColor }}
        />
      );
  }
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    flexShrink: 1,
    rowGap: 4,
  },
  cell: {
    alignItems: 'center',
    gap: 2,
  },
  sep: {
    height: CHIP_HEIGHT,
    paddingHorizontal: 4,
    justifyContent: 'center',
  },
  walk: {
    height: CHIP_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  walkText: {
    ...type.footnote,
    fontWeight: '500',
    color: color.label,
    fontVariant: ['tabular-nums'],
  },
  every: {
    ...type.caption,
    fontWeight: '400',
    color: color.secondaryLabel,
  },
});
