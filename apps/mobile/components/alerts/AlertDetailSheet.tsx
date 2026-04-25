import type {
  AlertCause,
  AlertEffect,
  AlertSeverity,
  ServiceAlert,
} from '@bus-tracker/shared';
import {
  BottomSheet,
  Button,
  Group,
  HStack,
  Host,
  Image,
  ScrollView,
  Spacer,
  Text,
  VStack,
} from '@expo/ui/swift-ui';
import {
  background,
  font,
  foregroundStyle,
  padding,
  presentationBackgroundInteraction,
  presentationDetents,
  presentationDragIndicator,
  shapes,
  type PresentationDetent,
} from '@expo/ui/swift-ui/modifiers';
import { useEffect, useState } from 'react';
import { Linking, useWindowDimensions } from 'react-native';

export interface AlertDetailSheetProps {
  alert: ServiceAlert | null;
  onDismiss: () => void;
}

export function AlertDetailSheet({ alert, onDismiss }: AlertDetailSheetProps) {
  const { width } = useWindowDimensions();
  const [detent, setDetent] = useState<PresentationDetent>('medium');
  const isPresented = alert != null;

  useEffect(() => {
    if (isPresented) setDetent('medium');
  }, [isPresented]);

  return (
    <Host matchContents style={[{ position: 'absolute', width }]}>
      <BottomSheet
        isPresented={isPresented}
        onIsPresentedChange={(next) => {
          if (!next) onDismiss();
        }}
      >
        <Group
          modifiers={[
            presentationDetents(['medium', 'large'], {
              selection: detent,
              onSelectionChange: setDetent,
            }),
            presentationDragIndicator('visible'),
            presentationBackgroundInteraction('enabled'),
          ]}
        >
          <ScrollView>
            <VStack
              spacing={16}
              alignment="leading"
              modifiers={[padding({ horizontal: 20, top: 18, bottom: 28 })]}
            >
              <HStack spacing={12}>
                <Text modifiers={[font({ size: 20, weight: 'bold' })]}>
                  Service alert
                </Text>
                <Spacer />
                <Image
                  systemName="xmark.circle.fill"
                  size={24}
                  color="#636366"
                  onPress={onDismiss}
                />
              </HStack>
              {alert ? <AlertBody alert={alert} /> : null}
            </VStack>
          </ScrollView>
        </Group>
      </BottomSheet>
    </Host>
  );
}

function AlertBody({ alert }: { alert: ServiceAlert }) {
  const severityBadge = severityTag(alert.severity);
  const causeBadge = causeLabel(alert.cause);
  const effectBadge = effectLabel(alert.effect);
  const periods = alert.activePeriod.filter(
    (p) => p.startMs != null || p.endMs != null,
  );

  return (
    <VStack spacing={14} alignment="leading">
      {alert.headerText ? (
        <Text modifiers={[font({ size: 17, weight: 'semibold' })]}>
          {alert.headerText}
        </Text>
      ) : null}

      <HStack spacing={8}>
        {severityBadge ? (
          <Badge
            label={severityBadge.label}
            fg={severityBadge.fg}
            bg={severityBadge.bg}
          />
        ) : null}
        {effectBadge ? <Badge label={effectBadge} fg="#1C1C1E" bg="#E5E5EA" /> : null}
        {causeBadge ? <Badge label={causeBadge} fg="#1C1C1E" bg="#E5E5EA" /> : null}
        <Spacer />
      </HStack>

      {alert.descriptionText ? (
        <Text
          modifiers={[font({ size: 14 })]}
        >
          {alert.descriptionText}
        </Text>
      ) : null}

      {periods.length > 0 ? (
        <Section title="Active">
          <VStack spacing={4} alignment="leading">
            {periods.map((p, i) => (
              <Text key={i} modifiers={[font({ size: 13 })]}>
                {formatActivePeriod(p.startMs, p.endMs)}
              </Text>
            ))}
          </VStack>
        </Section>
      ) : null}

      {alert.affectedRouteIds.length > 0 ? (
        <Section title="Affected routes">
          <Text modifiers={[font({ size: 13 })]}>
            {alert.affectedRouteIds.join(', ')}
          </Text>
        </Section>
      ) : null}

      {alert.affectedStopIds.length > 0 ? (
        <Section title="Affected stops">
          <Text modifiers={[font({ size: 13 })]}>
            {alert.affectedStopIds.join(', ')}
          </Text>
        </Section>
      ) : null}

      {alert.url ? (
        <Button
          systemImage="arrow.up.right.square"
          onPress={() => {
            void Linking.openURL(alert.url!).catch(() => {});
          }}
        >
          <Text>Open full details</Text>
        </Button>
      ) : null}
    </VStack>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <VStack spacing={4} alignment="leading">
      <Text
        modifiers={[
          foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
          font({ size: 11, weight: 'semibold' }),
        ]}
      >
        {title.toUpperCase()}
      </Text>
      {children}
    </VStack>
  );
}

function Badge({ label, fg, bg }: { label: string; fg: string; bg: string }) {
  return (
    <HStack
      modifiers={[
        padding({ horizontal: 10, vertical: 4 }),
        background(bg, shapes.roundedRectangle({ cornerRadius: 6 })),
      ]}
    >
      <Text modifiers={[font({ size: 11, weight: 'semibold' }), foregroundStyle(fg)]}>
        {label}
      </Text>
    </HStack>
  );
}

function severityTag(
  s: AlertSeverity | null,
): { label: string; fg: string; bg: string } | null {
  switch (s) {
    case 'SEVERE':
      return { label: 'Severe', fg: '#FFFFFF', bg: '#B30D0D' };
    case 'WARNING':
      return { label: 'Warning', fg: '#FFFFFF', bg: '#B76C0A' };
    case 'INFO':
      return { label: 'Info', fg: '#FFFFFF', bg: '#0A5FB3' };
    default:
      return null;
  }
}

function causeLabel(c: AlertCause | null): string | null {
  switch (c) {
    case 'TECHNICAL_PROBLEM':
      return 'Technical issue';
    case 'STRIKE':
      return 'Strike';
    case 'DEMONSTRATION':
      return 'Demonstration';
    case 'ACCIDENT':
      return 'Accident';
    case 'HOLIDAY':
      return 'Holiday';
    case 'WEATHER':
      return 'Weather';
    case 'MAINTENANCE':
      return 'Maintenance';
    case 'CONSTRUCTION':
      return 'Construction';
    case 'POLICE_ACTIVITY':
      return 'Police activity';
    case 'MEDICAL_EMERGENCY':
      return 'Medical emergency';
    default:
      return null;
  }
}

function effectLabel(e: AlertEffect | null): string | null {
  switch (e) {
    case 'NO_SERVICE':
      return 'No service';
    case 'REDUCED_SERVICE':
      return 'Reduced service';
    case 'SIGNIFICANT_DELAYS':
      return 'Significant delays';
    case 'DETOUR':
      return 'Detour';
    case 'ADDITIONAL_SERVICE':
      return 'Additional service';
    case 'MODIFIED_SERVICE':
      return 'Modified service';
    case 'STOP_MOVED':
      return 'Stop moved';
    case 'ACCESSIBILITY_ISSUE':
      return 'Accessibility issue';
    default:
      return null;
  }
}

function formatActivePeriod(
  startMs: number | null,
  endMs: number | null,
): string {
  const start = startMs != null ? formatDateTime(startMs) : null;
  const end = endMs != null ? formatDateTime(endMs) : null;
  if (start && end) return `${start} – ${end}`;
  if (start) return `From ${start}`;
  if (end) return `Until ${end}`;
  return 'Ongoing';
}

function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
