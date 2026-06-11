import { Link } from 'expo-router';
import {
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from 'expo-glass-effect';
import { type ReactNode } from 'react';
import {
  Platform,
  PlatformColor,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

export type Availability = {
  glassEffectAPI: boolean;
  liquidGlass: boolean;
};

export function getGlassAvailability(): Availability {
  try {
    return {
      glassEffectAPI: isGlassEffectAPIAvailable(),
      liquidGlass: isLiquidGlassAvailable(),
    };
  } catch {
    return {
      glassEffectAPI: false,
      liquidGlass: false,
    };
  }
}

export function DemoScroll({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      style={styles.screen}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
    >
      {children}
    </ScrollView>
  );
}

export function DemoSection({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {note ? <Text style={styles.note}>{note}</Text> : null}
      </View>
      {children}
    </View>
  );
}

export function DemoCard({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.card}>
      {title ? <Text style={styles.cardTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}

export function InfoText({ children }: { children: ReactNode }) {
  return <Text style={styles.body}>{children}</Text>;
}

export function StatusPill({
  label,
  enabled,
}: {
  label: string;
  enabled: boolean;
}) {
  return (
    <View
      style={[
        styles.statusPill,
        enabled ? styles.statusPillEnabled : styles.statusPillDisabled,
      ]}
    >
      <Text style={styles.statusText}>
        {label}: {enabled ? 'available' : 'unavailable'}
      </Text>
    </View>
  );
}

export function PlatformFallback({ feature }: { feature: string }) {
  return (
    <DemoCard title="Fallback">
      <InfoText>
        {feature} is shown with a React Native fallback on this platform or OS.
        True Liquid Glass requires iOS 26+ and the native API surface.
      </InfoText>
    </DemoCard>
  );
}

export function DemoLink({
  href,
  title,
  subtitle,
}: {
  href: string;
  title: string;
  subtitle: string;
}) {
  return (
    <Link href={href} asChild>
      <Pressable style={styles.linkRow}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={styles.linkTitle}>{title}</Text>
          <Text style={styles.linkSubtitle}>{subtitle}</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>
    </Link>
  );
}

export function isIOS() {
  return Platform.OS === 'ios';
}

export const demoColors = {
  background:
    Platform.OS === 'ios' ? PlatformColor('systemGroupedBackground') : '#f3f4f6',
  grouped:
    Platform.OS === 'ios'
      ? PlatformColor('secondarySystemGroupedBackground')
      : '#ffffff',
  label: Platform.OS === 'ios' ? PlatformColor('label') : '#111827',
  secondaryLabel:
    Platform.OS === 'ios' ? PlatformColor('secondaryLabel') : '#4b5563',
  blue: Platform.OS === 'ios' ? PlatformColor('systemBlue') : '#2563eb',
};

export const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: demoColors.background,
  },
  content: {
    gap: 18,
    padding: 16,
    paddingBottom: 40,
  },
  section: {
    gap: 10,
  },
  sectionHeader: {
    gap: 4,
  },
  sectionTitle: {
    color: demoColors.label,
    fontSize: 18,
    fontWeight: '700',
  },
  card: {
    gap: 10,
    padding: 14,
    borderRadius: 14,
    backgroundColor: demoColors.grouped,
  },
  cardTitle: {
    color: demoColors.label,
    fontSize: 15,
    fontWeight: '700',
  },
  body: {
    color: demoColors.secondaryLabel,
    fontSize: 14,
    lineHeight: 20,
  },
  note: {
    color: demoColors.secondaryLabel,
    fontSize: 13,
    lineHeight: 18,
  },
  linkRow: {
    minHeight: 68,
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: demoColors.grouped,
  },
  linkTitle: {
    color: demoColors.label,
    fontSize: 16,
    fontWeight: '700',
  },
  linkSubtitle: {
    color: demoColors.secondaryLabel,
    fontSize: 13,
    lineHeight: 18,
  },
  chevron: {
    color: demoColors.secondaryLabel,
    fontSize: 28,
    fontWeight: '300',
  },
  statusPill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusPillEnabled: {
    backgroundColor: 'rgba(52, 199, 89, 0.18)',
  },
  statusPillDisabled: {
    backgroundColor: 'rgba(255, 149, 0, 0.18)',
  },
  statusText: {
    color: demoColors.label,
    fontSize: 12,
    fontWeight: '600',
  },
});
