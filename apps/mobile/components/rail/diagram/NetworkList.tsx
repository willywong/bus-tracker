import { Fragment, useMemo } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { Hairline, LinkRow } from '@/components/trip/Rows';
import { Section } from '@/components/trip/SheetBody';
import { MARGIN, space } from '@/theme/design';

import { linesByStation } from './geometry';
import { DIAGRAM_LINES, DIAGRAM_LINKS, DIAGRAM_STATIONS } from './klRailDiagram';

/** "Kelana Jaya Line" → "Kelana Jaya"; either KTM line → "KTM Komuter". */
function changeName(code: string, name: string): string {
  return code.startsWith('KTM') ? 'KTM Komuter' : name.replace(/ Line$/, '');
}

interface Row {
  id: string;
  name: string;
  /** Other lines here or a short walk away, e.g. "KL Monorail, KTM Komuter". */
  changes: string | undefined;
}

/** One section per line, its stations in order, each with the other lines it meets. */
function networkSections(): { code: string; title: string; rows: Row[] }[] {
  const served = linesByStation(DIAGRAM_LINES);
  const names = new Map(DIAGRAM_STATIONS.map((s) => [s.id, s.name]));
  const lineName = new Map(DIAGRAM_LINES.map((l) => [l.code, changeName(l.code, l.name)]));
  const linked = new Map<string, string[]>();
  for (const [a, b] of DIAGRAM_LINKS) {
    linked.set(a, [...(linked.get(a) ?? []), b]);
    linked.set(b, [...(linked.get(b) ?? []), a]);
  }
  return DIAGRAM_LINES.map((line) => {
    const own = lineName.get(line.code)!;
    const seen = new Set<string>();
    const rows: Row[] = [];
    for (const id of line.branches.flat()) {
      if (seen.has(id)) continue;
      seen.add(id);
      const codes = [id, ...(linked.get(id) ?? [])].flatMap((s) => served.get(s) ?? []);
      const other = [...new Set(codes.map((c) => lineName.get(c)!))].filter((n) => n !== own);
      rows.push({ id, name: names.get(id) ?? id, changes: other.length ? other.join(', ') : undefined });
    }
    return { code: line.code, title: line.name, rows };
  });
}

/**
 * The rail map as a list, for VoiceOver (plan 13/06 step 8): a section per
 * line, a row per station in line order with the lines you can change to,
 * each opening its station sheet: "KL Sentral, KL Monorail, KTM Komuter".
 * It scales with Dynamic Type, which the diagram's fixed labels don't.
 */
export function NetworkList({ onOpenStation }: { onOpenStation: (id: string) => void }) {
  const sections = useMemo(networkSections, []);
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
      {sections.map((section) => (
        <Section key={section.code} title={section.title}>
          {section.rows.map((row, i) => (
            <Fragment key={row.id}>
              {i > 0 ? <Hairline /> : null}
              <LinkRow
                title={row.name}
                value={row.changes}
                onPress={() => onOpenStation(row.id)}
                accessibilityHint="Shows departures"
              />
            </Fragment>
          ))}
        </Section>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: MARGIN,
    paddingTop: space.xs,
    paddingBottom: space.xxl,
    gap: space.lg,
  },
});
