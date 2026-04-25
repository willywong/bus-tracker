import type { ServiceAlert } from '@bus-tracker/shared';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AlertDetailSheet } from './AlertDetailSheet';

interface AlertBannerProps {
  alerts: readonly ServiceAlert[];
  /** Show at most this many, collapsing the rest into a "+N more" tag. */
  maxVisible?: number;
}

/**
 * Stack of severity-colored alert cards. Rendered atop the Map/Tracker
 * screens. Taps open a detail sheet with full text, active period, affected
 * entities, and a link to the agency URL if any. Empty list → renders null.
 */
export function AlertBanner({ alerts, maxVisible = 2 }: AlertBannerProps) {
  const [selected, setSelected] = useState<ServiceAlert | null>(null);
  if (alerts.length === 0) return null;
  const visible = alerts.slice(0, maxVisible);
  const hidden = alerts.length - visible.length;
  return (
    <>
      <View style={styles.stack}>
        {visible.map((a) => (
          <AlertRow key={a.id} alert={a} onPress={() => setSelected(a)} />
        ))}
        {hidden > 0 ? (
          <Pressable onPress={() => setSelected(alerts[maxVisible])}>
            <Text style={styles.more} selectable>
              +{hidden} more alert{hidden > 1 ? 's' : ''}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <AlertDetailSheet alert={selected} onDismiss={() => setSelected(null)} />
    </>
  );
}

function AlertRow({
  alert,
  onPress,
}: {
  alert: ServiceAlert;
  onPress: () => void;
}) {
  const tone = severityTone(alert.severity, alert.effect);
  const title = alert.headerText ?? humanizeEffect(alert.effect) ?? 'Service alert';
  const description = alert.descriptionText;

  return (
    <Pressable onPress={onPress}>
      <View style={[styles.card, { backgroundColor: tone.bg, borderColor: tone.border }]}>
        <SymbolView
          name={tone.icon as Parameters<typeof SymbolView>[0]['name']}
          size={16}
          tintColor={tone.fg}
          weight="semibold"
          style={styles.icon}
        />
        <View style={styles.body}>
          <Text
            style={[styles.title, { color: tone.fg }]}
            selectable
            numberOfLines={2}
          >
            {title}
          </Text>
          {description ? (
            <Text style={styles.description} selectable numberOfLines={3}>
              {description}
            </Text>
          ) : null}
        </View>
        <SymbolView
          name="chevron.right"
          size={12}
          tintColor={tone.fg}
          weight="semibold"
        />
      </View>
    </Pressable>
  );
}

function humanizeEffect(effect: ServiceAlert['effect']): string | null {
  switch (effect) {
    case 'NO_SERVICE':
      return 'Service suspended';
    case 'REDUCED_SERVICE':
      return 'Reduced service';
    case 'SIGNIFICANT_DELAYS':
      return 'Significant delays';
    case 'DETOUR':
      return 'Detour in effect';
    case 'STOP_MOVED':
      return 'Stop relocated';
    case 'MODIFIED_SERVICE':
      return 'Modified service';
    case 'ACCESSIBILITY_ISSUE':
      return 'Accessibility notice';
    default:
      return null;
  }
}

interface Tone {
  bg: string;
  border: string;
  fg: string;
  icon: string;
}

function severityTone(
  severity: ServiceAlert['severity'],
  effect: ServiceAlert['effect'],
): Tone {
  const severe =
    severity === 'SEVERE' ||
    effect === 'NO_SERVICE' ||
    effect === 'SIGNIFICANT_DELAYS';
  const warn =
    severity === 'WARNING' ||
    effect === 'DETOUR' ||
    effect === 'REDUCED_SERVICE' ||
    effect === 'STOP_MOVED';
  if (severe) {
    return {
      bg: 'rgba(255,69,58,0.14)',
      border: 'rgba(255,69,58,0.35)',
      fg: '#B30D0D',
      icon: 'exclamationmark.octagon.fill',
    };
  }
  if (warn) {
    return {
      bg: 'rgba(255,159,10,0.14)',
      border: 'rgba(255,159,10,0.35)',
      fg: '#B76C0A',
      icon: 'exclamationmark.triangle.fill',
    };
  }
  return {
    bg: 'rgba(10,132,255,0.14)',
    border: 'rgba(10,132,255,0.35)',
    fg: '#0A5FB3',
    icon: 'info.circle.fill',
  };
}

const styles = StyleSheet.create({
  stack: {
    gap: 8,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  icon: {
    marginTop: 1,
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  description: {
    fontSize: 12,
    fontWeight: '500',
    color: '#1C1C1E',
    letterSpacing: 0.05,
  },
  more: {
    fontSize: 11,
    fontWeight: '600',
    color: '#8E8E93',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    paddingHorizontal: 4,
  },
});
