import type { SFSymbol } from 'expo-symbols';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import type { TripModel } from '@/components/trip/model';
import { Hairline, KeyValueRow, NoteRow } from '@/components/trip/Rows';

/**
 * Under the hero: the following bus ("Then · 21:41 · +39 min", the cost of
 * missing this one) and the supporting notes, as hairline rows. Key/value
 * notes (last bus) line up with the "Then" row; sentences get a small glyph,
 * orange for warnings.
 */
export function TripRows({ model }: { model: TripModel }) {
  const rows: ReactNode[] = [];
  if (model.next) {
    rows.push(
      <KeyValueRow
        key="then"
        label="Then"
        value={model.next.clock}
        trailing={model.next.wait}
        accessibilityLabel={`Then ${model.next.clock}, ${model.next.wait.replace('+', '')} later`}
      />,
    );
  }
  for (const n of model.notes) {
    rows.push(
      n.label && n.value ? (
        <KeyValueRow key={n.id} label={n.label} value={n.value} accessibilityLabel={n.text} />
      ) : (
        <NoteRow key={n.id} icon={n.icon as SFSymbol} text={n.text} warning={n.tone === 'warning'} />
      ),
    );
  }
  if (rows.length === 0) return null;
  return (
    <View>
      <Hairline />
      {rows.map((r, i) => (
        <View key={i}>
          {r}
          <Hairline />
        </View>
      ))}
    </View>
  );
}
