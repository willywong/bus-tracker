import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useRef, useState } from 'react';
import { StyleSheet, Switch, Text, useColorScheme, View } from 'react-native';

import { RowButton } from '@/components/ui/RowButton';
import { color, hex, pick, radius, space, type } from '@/theme/design';

/**
 * The Calm Mono list vocabulary: plain rows on paper separated by hairlines.
 * No cards, no fills, no icon tiles: a row's icon is a plain ink glyph.
 * Type and spacing carry the structure.
 */

export function SectionLabel({ children }: { children: string }) {
  return (
    <Text style={styles.section} accessibilityRole="header">
      {children}
    </Text>
  );
}

/** Leading icon column: a row's icon box plus its gap, so hairlines can align to the title. */
const ROW_ICON = 24;
export const ROW_ICON_INSET = ROW_ICON + space.sm;

/** A row's leading glyph: ink, regular weight, centred in a fixed box. */
function RowIcon({ name }: { name: SFSymbol }) {
  return (
    <View style={styles.rowIcon}>
      <SymbolView
        name={name}
        size={19}
        weight="regular"
        tintColor={color.label}
        resizeMode="scaleAspectFit"
      />
    </View>
  );
}

export function Hairline({ inset = 0 }: { inset?: number }) {
  return <View style={[styles.hairline, inset > 0 && { marginLeft: inset }]} />;
}

/**
 * "Then │ 21:41 │ +39 min": the label on the left; the value and its trailing
 * note right-aligned, split by a short vertical hairline. When the note
 * doesn't fit on the line ("Near Pusat Perniagaan SS2"), it moves under the
 * value, right-aligned and whole, rather than being squeezed or cut.
 */
export function KeyValueRow({
  label,
  value,
  trailing,
  accessibilityLabel,
}: {
  label: string;
  value: string;
  trailing?: string | null;
  accessibilityLabel?: string;
}) {
  // Which note was seen to wrap, at which row width. Latched (dropping the
  // rule could otherwise let it fit again and flip back and forth) but only
  // for that note at that width; a zero-width first pass never counts.
  const [wrap, setWrap] = useState<{ text: string; width: number } | null>(null);
  const rowWidth = useRef(0);
  const noteY = useRef(0);
  const valueY = useRef(0);
  const wrapped = trailing != null && wrap?.text === trailing && wrap.width === rowWidth.current;
  const check = () => {
    // Below the value's line means flex-wrap moved it down (the row centres
    // its content, so a plain y offset says nothing on its own).
    if (trailing == null || wrapped || rowWidth.current <= 0) return;
    if (noteY.current <= valueY.current + 8) return;
    setWrap({ text: trailing, width: rowWidth.current });
  };
  return (
    <View
      style={[styles.kvRow, wrapped && styles.kvRowWrapped]}
      onLayout={(e) => {
        const w = Math.round(e.nativeEvent.layout.width);
        if (w === rowWidth.current) return;
        rowWidth.current = w;
        if (wrap) setWrap(null);
        else check();
      }}
      accessible
      accessibilityLabel={accessibilityLabel ?? `${label}, ${value}${trailing ? `, ${trailing}` : ''}`}
    >
      <Text style={styles.kvLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text
        style={styles.kvValue}
        numberOfLines={1}
        onLayout={(e) => {
          valueY.current = e.nativeEvent.layout.y;
          check();
        }}
      >
        {value}
      </Text>
      {trailing ? (
        <View
          style={[styles.kvNote, wrapped && styles.kvNoteWrapped]}
          onLayout={(e) => {
            noteY.current = e.nativeEvent.layout.y;
            check();
          }}
        >
          {wrapped ? null : <View style={styles.kvDivider} />}
          <Text style={[styles.kvTrailing, wrapped && styles.kvTrailingWrapped]} numberOfLines={wrapped ? 2 : 1}>
            {trailing}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** A sentence with a small grey glyph. */
export function NoteRow({ icon, text }: { icon: SFSymbol; text: string }) {
  return (
    <View style={styles.noteRow} accessible accessibilityLabel={text}>
      <SymbolView name={icon} size={15} tintColor={color.secondaryLabel} style={styles.noteIcon} />
      <Text style={styles.noteText}>{text}</Text>
    </View>
  );
}

/** Ink switch: on is an ink track with a paper knob. */
export function ToggleRow({
  icon,
  title,
  caption,
  value,
  onValueChange,
  accessibilityLabel,
}: {
  icon?: SFSymbol;
  title: string;
  caption?: string;
  value: boolean;
  onValueChange: (on: boolean) => void;
  accessibilityLabel?: string;
}) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return (
    <View style={styles.actionRow}>
      {icon ? <RowIcon name={icon} /> : null}
      <View style={styles.actionText}>
        <Text style={styles.actionTitle}>{title}</Text>
        {caption ? <Text style={styles.actionCaption}>{caption}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ true: pick(hex.ink, scheme) }}
        thumbColor={value ? pick(hex.paper, scheme) : '#FFFFFF'}
        accessibilityLabel={accessibilityLabel ?? title}
      />
    </View>
  );
}

/** A plain row: glyph, title, and a grey value at the end. Not tappable. */
export function InfoRow({ icon, title, value }: { icon: SFSymbol; title: string; value?: string }) {
  return (
    <View style={styles.actionRow} accessible accessibilityLabel={value ? `${title}, ${value}` : title}>
      <RowIcon name={icon} />
      <Text style={[styles.actionTitle, styles.flex]} numberOfLines={1}>
        {title}
      </Text>
      {value ? <Text style={styles.actionValue}>{value}</Text> : null}
    </View>
  );
}

/** A tappable row: title, optional value, chevron or "opens elsewhere" arrow. */
export function LinkRow({
  icon,
  title,
  value,
  external,
  onPress,
  accessibilityHint,
}: {
  icon?: SFSymbol;
  title: string;
  value?: string;
  external?: boolean;
  onPress: () => void;
  accessibilityHint?: string;
}) {
  return (
    <RowButton
      onPress={onPress}
      style={styles.actionRow}
      accessibilityLabel={value ? `${title}, ${value}` : title}
      accessibilityHint={accessibilityHint}
    >
      {icon ? <RowIcon name={icon} /> : null}
      <Text style={[styles.actionTitle, styles.flex]}>{title}</Text>
      {value ? <Text style={styles.actionValue}>{value}</Text> : null}
      <SymbolView
        name={external ? 'arrow.up.right' : 'chevron.right'}
        size={13}
        weight="medium"
        tintColor={color.tertiaryLabel}
      />
    </RowButton>
  );
}

const styles = StyleSheet.create({
  section: {
    ...type.section,
    color: color.secondaryLabel,
    marginBottom: space.xxs,
  },
  hairline: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.hairline,
  },
  kvRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    alignContent: 'center',
    minHeight: 44,
  },
  kvRowWrapped: {
    paddingVertical: space.xs,
  },
  kvLabel: {
    ...type.body,
    // Grows to push the value right, never squeezed, and always clear of it.
    flexGrow: 1,
    flexShrink: 0,
    marginRight: space.md,
    color: color.secondaryLabel,
  },
  kvValue: {
    ...type.body,
    flexShrink: 0,
    fontWeight: '500',
    color: color.label,
    fontVariant: ['tabular-nums'],
  },
  kvNote: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    maxWidth: '100%',
  },
  kvNoteWrapped: {
    // Its own line, under the value.
    width: '100%',
    justifyContent: 'flex-end',
    marginTop: 2,
  },
  kvDivider: {
    width: StyleSheet.hairlineWidth,
    height: 16,
    marginHorizontal: space.sm,
    backgroundColor: color.hairline,
  },
  kvTrailing: {
    ...type.body,
    flexShrink: 1,
    textAlign: 'right',
    color: color.secondaryLabel,
    fontVariant: ['tabular-nums'],
  },
  kvTrailingWrapped: {
    ...type.status,
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    paddingVertical: space.sm,
  },
  noteIcon: {
    width: 18,
    height: 18,
    marginTop: 1,
  },
  noteText: {
    ...type.status,
    flex: 1,
    color: color.label,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 52,
    paddingVertical: space.xs,
  },
  actionText: {
    flex: 1,
    gap: 2,
  },
  actionTitle: {
    ...type.body,
    color: color.label,
  },
  actionCaption: {
    ...type.footnote,
    color: color.secondaryLabel,
  },
  actionValue: {
    ...type.body,
    color: color.secondaryLabel,
    fontVariant: ['tabular-nums'],
  },
  flex: {
    flex: 1,
  },
  rowIcon: {
    width: ROW_ICON,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
