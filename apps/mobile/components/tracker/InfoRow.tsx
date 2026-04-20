import { type ReactNode } from 'react';
import {
  PlatformColor,
  StyleSheet,
  Text,
  View,
  type ColorValue,
} from 'react-native';

import { trackerSpacing } from './tokens';

interface InfoRowProps {
  label: string;
  value: string;
  /** Color override for the value text (e.g. amber for delayed). */
  valueColor?: ColorValue;
  /** Optional leading icon (e.g. a small colored status dot) rendered before value. */
  trailing?: ReactNode;
  /** Small muted note shown under the label. */
  caption?: string;
}

export function InfoRow({
  label,
  value,
  valueColor,
  trailing,
  caption,
}: InfoRowProps) {
  return (
    <View style={styles.row}>
      <View style={styles.labelWrap}>
        <Text style={styles.label} selectable>
          {label}
        </Text>
        {caption ? (
          <Text style={styles.caption} selectable>
            {caption}
          </Text>
        ) : null}
      </View>
      <View style={styles.trailing}>
        {trailing}
        <Text
          style={[styles.value, valueColor ? { color: valueColor } : undefined]}
          selectable
          allowFontScaling={false}
        >
          {value}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: trackerSpacing.rowH,
    paddingVertical: trackerSpacing.rowV,
    minHeight: 48,
    gap: 12,
  },
  labelWrap: {
    flex: 1,
    gap: 2,
  },
  label: {
    fontSize: 16,
    fontWeight: '500',
    color: PlatformColor('label'),
  },
  caption: {
    fontSize: 12,
    fontWeight: '400',
    color: PlatformColor('secondaryLabel'),
  },
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  value: {
    fontSize: 16,
    fontWeight: '600',
    color: PlatformColor('label'),
    fontVariant: ['tabular-nums'],
  },
});
