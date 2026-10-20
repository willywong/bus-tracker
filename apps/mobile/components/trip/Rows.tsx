import { SymbolView, type SFSymbol } from 'expo-symbols';
import { StyleSheet, Switch, Text, useColorScheme, View } from 'react-native';

import { RowButton } from '@/components/ui/RowButton';
import { color, hex, pick, space, type } from '@/theme/design';

/**
 * The Calm Mono list vocabulary: plain rows on paper separated by hairlines.
 * No cards, no fills, no icon tiles. Type and spacing carry the structure.
 */

export function SectionLabel({ children }: { children: string }) {
  return (
    <Text style={styles.section} accessibilityRole="header">
      {children}
    </Text>
  );
}

export function Hairline({ inset = 0 }: { inset?: number }) {
  return <View style={[styles.hairline, inset > 0 && { marginLeft: inset }]} />;
}

/** "Then · 21:41 · +39 min": a label, a value and an optional trailing note. */
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
  return (
    <View
      style={styles.kvRow}
      accessible
      accessibilityLabel={accessibilityLabel ?? `${label}, ${value}${trailing ? `, ${trailing}` : ''}`}
    >
      <Text style={styles.kvLabel}>{label}</Text>
      <Text style={styles.kvValue}>{value}</Text>
      <Text style={styles.kvTrailing}>{trailing ?? ''}</Text>
    </View>
  );
}

/** A sentence with a small glyph; orange glyph for warnings. */
export function NoteRow({
  icon,
  text,
  warning,
}: {
  icon: SFSymbol;
  text: string;
  warning?: boolean;
}) {
  return (
    <View style={styles.noteRow} accessible accessibilityLabel={text}>
      <SymbolView
        name={icon}
        size={15}
        weight="regular"
        tintColor={warning ? color.warning : color.secondaryLabel}
        style={styles.noteIcon}
      />
      <Text style={styles.noteText}>{text}</Text>
    </View>
  );
}

/** Ink switch: on is an ink track with a paper knob. */
export function ToggleRow({
  title,
  caption,
  value,
  onValueChange,
  accessibilityLabel,
}: {
  title: string;
  caption?: string;
  value: boolean;
  onValueChange: (on: boolean) => void;
  accessibilityLabel?: string;
}) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return (
    <View style={styles.actionRow}>
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

/** A tappable row: title, optional value, chevron or "opens elsewhere" arrow. */
export function LinkRow({
  title,
  value,
  external,
  onPress,
  accessibilityHint,
}: {
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
    alignItems: 'center',
    minHeight: 44,
  },
  kvLabel: {
    ...type.body,
    flex: 1,
    color: color.secondaryLabel,
  },
  kvValue: {
    ...type.body,
    minWidth: 72,
    color: color.label,
    fontVariant: ['tabular-nums'],
  },
  kvTrailing: {
    ...type.body,
    minWidth: 76,
    textAlign: 'right',
    color: color.secondaryLabel,
    fontVariant: ['tabular-nums'],
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
});
