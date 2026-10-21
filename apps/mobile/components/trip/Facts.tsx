import { View } from 'react-native';

import { Hairline, KeyValueRow } from '@/components/trip/Rows';

/** One fact under the hero: what it is, the value, and one line of context. */
export interface FactTile {
  id: string;
  /** "Your bus", "Next bus". */
  label: string;
  /** "2 stops away", "11:14 AM". */
  value: string;
  /** "Near Jejantas SS2/24", "in 33 mins". */
  caption: string | null;
}

/**
 * Facts as the sheet's plain key-value rows, one line each:
 * "Next bus  ·····  3:47 PM │ in 33 mins". The label sits left in grey,
 * the value right in ink, its context after a short rule. Rows split by a
 * hairline, the same as the notes further down.
 */
export function Facts({ facts }: { facts: readonly FactTile[] }) {
  if (facts.length === 0) return null;
  return (
    <View>
      {facts.map((f, i) => (
        <View key={f.id}>
          {i > 0 ? <Hairline /> : null}
          <KeyValueRow label={f.label} value={f.value} trailing={f.caption} />
        </View>
      ))}
    </View>
  );
}
