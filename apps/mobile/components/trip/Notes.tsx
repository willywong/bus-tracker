import type { SFSymbol } from 'expo-symbols';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import type { TripModel } from '@/components/trip/model';
import { Hairline, KeyValueRow, NoteRow } from '@/components/trip/Rows';
import { tripWarnings, WarningList } from '@/components/trip/Warnings';
import { space } from '@/theme/design';

/**
 * Under the hero: the supporting notes as hairline rows. Key/value notes
 * (last bus) line up with the "Then" row; sentences get a small grey glyph.
 * Warnings live in the glass badge beside the hero number; only when there's
 * no hero to sit beside (`inlineWarnings`) are they listed here instead.
 */
export function TripRows({
  model,
  walkMinutes,
  inlineWarnings = false,
}: {
  model: TripModel;
  walkMinutes: number;
  inlineWarnings?: boolean;
}) {
  const warnings = inlineWarnings ? tripWarnings(model, walkMinutes) : [];
  const rows: ReactNode[] = [];
  for (const n of model.notes) {
    if (n.label && n.value) {
      rows.push(<KeyValueRow key={n.id} label={n.label} value={n.value} accessibilityLabel={n.text} />);
    } else if (n.tone !== 'warning') {
      rows.push(<NoteRow key={n.id} icon={n.icon as SFSymbol} text={n.text} />);
    }
  }
  if (warnings.length === 0 && rows.length === 0) return null;
  return (
    <View style={styles.gap}>
      {warnings.length > 0 ? <WarningList items={warnings} /> : null}
      {rows.length > 0 ? (
        <View>
          {rows.map((r, i) => (
            <View key={i}>
              {r}
              {/* The section rule below closes the list; no hairline under the last row. */}
              {i < rows.length - 1 ? <Hairline /> : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  gap: {
    gap: space.xs,
  },
});
