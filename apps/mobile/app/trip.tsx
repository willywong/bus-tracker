import { Button, Host, Text as SwiftText } from '@expo/ui/swift-ui';
import {
  buttonBorderShape,
  buttonStyle,
  controlSize,
  font,
} from '@expo/ui/swift-ui/modifiers';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useNavigation, useRouter } from 'expo-router';
import { useEffect, type ReactNode } from 'react';
import {
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatClockHHMM } from '@/components/tracker/logic';
import { Hero, StatusLine } from '@/components/trip/Hero';
import { OnTheWay } from '@/components/trip/OnTheWay';
import { PrimaryAction } from '@/components/trip/PrimaryAction';
import { SheetHeader } from '@/components/trip/SheetHeader';
import { Timetable } from '@/components/trip/Timetable';
import { useSettings } from '@/hooks/useSettings';
import { useTrip } from '@/state/TripContext';
import { color, MARGIN, motion, space, type, type DetentIndex } from '@/theme/design';

type DetentListener = (
  event: 'sheetDetentChange',
  cb: (e: { data: { index: number } }) => void,
) => () => void;

/**
 * The persistent trip sheet over the map. Peek shows the header row, glance
 * the hero + one action, large adds the approach timeline and timetable.
 * Content only — the sheet itself is the (system) glass.
 */
export default function TripSheet() {
  const trip = useTrip();
  const settings = useSettings();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const { model } = trip;

  useEffect(() => {
    const addListener = (navigation as unknown as { addListener: DetentListener })
      .addListener;
    return addListener.call(navigation, 'sheetDetentChange', (e) => {
      const i = Math.max(0, Math.min(2, e.data.index)) as DetentIndex;
      trip.setDetent(i);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation]);

  if (model.state === 'empty') {
    return (
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + space.xl }]}>
        <EmptyState
          icon="bus.fill"
          title="Track your bus"
          message="Pick a route and the stop you board at. Live buses and your countdown appear here."
          actionLabel="Choose Route"
          onAction={() => router.push('/add-route')}
        />
      </ScrollView>
    );
  }

  const isLive = model.source !== 'scheduled';
  const liveTripId = trip.eta.primaryArrival?.sched?.tripId ?? null;
  const showJourney =
    model.state === 'arrival' && trip.eta.primaryArrival?.kind === 'live';

  return (
    <ScrollView
      contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + space.xl }]}
      showsVerticalScrollIndicator={false}
    >
      <SheetHeader
        routeCode={trip.routeCode}
        stopName={trip.stopName}
        subtitle={trip.route?.longName ?? null}
        compact={model.compact}
        showCompact={trip.detent === 0}
        compactIsLive={isLive}
      />

      <View style={styles.body}>
        <StateBody />

        {model.state === 'arrival' || model.action.kind === 'walking' ? (
          <PrimaryAction
            action={model.action}
            walkMinutes={settings.walkMinutes}
            scheme={scheme}
            onFollow={trip.follow}
            onUnfollow={trip.unfollow}
            onStartWalking={trip.startWalking}
            onCancelWalking={trip.cancelWalking}
          />
        ) : null}

        {showJourney && trip.journey.ready ? (
          <Section title="On the way">
            <OnTheWay journey={trip.journey} arrivalLabel={model.compact} />
          </Section>
        ) : null}

        {trip.eta.scheduledUpcoming.length > 0 && model.state !== 'service-ended' ? (
          <Section title={trip.stopName ? `Today at ${trip.stopName}` : 'Today'}>
            <Timetable
              departures={trip.eta.scheduledUpcoming}
              formatClock={formatClockHHMM}
              liveTripId={isLive ? liveTripId : null}
              firstBusToday={trip.eta.firstBusToday}
              lastBusToday={trip.eta.lastBusToday}
            />
          </Section>
        ) : null}

        {model.state === 'arrival' ? (
          <Section title="Lock Screen">
            <View style={styles.toggleRow}>
              <View style={styles.toggleText}>
                <Text style={styles.toggleTitle}>Follow this bus</Text>
                <Text style={styles.toggleCaption}>
                  Countdown and stops away in a Live Activity.
                </Text>
              </View>
              <Switch
                value={trip.isFollowing}
                onValueChange={(on) => (on ? trip.follow() : trip.unfollow())}
                accessibilityLabel="Follow this bus on the Lock Screen"
              />
            </View>
          </Section>
        ) : null}

        <Text style={styles.about}>
          Live bus positions from data.gov.my GTFS Realtime. Live times are
          estimated from each bus’s position; scheduled times come from the
          timetable.
        </Text>
      </View>
    </ScrollView>
  );
}

/** Hero area for the current state — the map above never changes. */
function StateBody() {
  const trip = useTrip();
  const { model } = trip;
  const reduceMotion = useReducedMotion();

  switch (model.state) {
    case 'loading':
      if (trip.routeLoadFailed) {
        return (
          <EmptyState
            icon="wifi.exclamationmark"
            title="Couldn’t load this route"
            message="The timetable didn’t download. Check your connection and try again."
            actionLabel="Try Again"
            onAction={trip.retryRouteLoad}
            compact
          />
        );
      }
      return (
        <View style={styles.heroBlock}>
          <View style={styles.placeholderNumber} />
          <Text style={styles.muted}>{model.status}</Text>
        </View>
      );
    case 'service-ended':
      return (
        <EmptyState
          icon="moon.zzz.fill"
          title="No more buses today"
          message={model.detail ?? 'Check back in the morning for the first bus.'}
          compact
        />
      );
    case 'no-service':
      return (
        <EmptyState
          icon="bus"
          title={model.status}
          message="Scheduled times will appear here as soon as the next run is due."
          compact
        />
      );
    default:
      return (
        <Animated.View
          key={model.state}
          entering={reduceMotion ? undefined : FadeIn.duration(motion.crossfade)}
          style={styles.heroBlock}
        >
          <Hero model={model} />
          <StatusLine model={model} />
        </Animated.View>
      );
  }
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header" numberOfLines={1}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function EmptyState({
  icon,
  title,
  message,
  actionLabel,
  onAction,
  compact = false,
}: {
  icon: SFSymbol;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
}) {
  return (
    <View style={[styles.empty, compact && styles.emptyCompact]}>
      <SymbolView
        name={icon}
        size={compact ? 32 : 44}
        type="hierarchical"
        tintColor={color.secondaryLabel}
      />
      <Text style={styles.emptyTitle} accessibilityRole="header">
        {title}
      </Text>
      <Text style={styles.emptyMessage}>{message}</Text>
      {actionLabel && onAction ? (
        <Host matchContents style={styles.emptyAction}>
          <Button
            onPress={onAction}
            modifiers={[
              buttonStyle('borderedProminent'),
              buttonBorderShape('capsule'),
              controlSize('large'),
            ]}
          >
            <SwiftText modifiers={[font({ size: 17, weight: 'semibold' })]}>
              {actionLabel}
            </SwiftText>
          </Button>
        </Host>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingTop: space.lg,
  },
  body: {
    paddingHorizontal: MARGIN,
    paddingTop: space.md,
    gap: space.lg,
  },
  heroBlock: {
    gap: space.xs,
  },
  placeholderNumber: {
    width: 120,
    height: 72,
    borderRadius: 16,
    borderCurve: 'continuous',
    backgroundColor: color.fill,
  },
  muted: {
    ...type.status,
    color: color.secondaryLabel,
  },
  section: {
    gap: space.sm,
    marginTop: space.sm,
  },
  sectionTitle: {
    ...type.headline,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '700',
    color: color.label,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: 20,
    borderCurve: 'continuous',
    backgroundColor: color.fill,
  },
  toggleText: {
    flex: 1,
    gap: 2,
  },
  toggleTitle: {
    ...type.body,
    color: color.label,
  },
  toggleCaption: {
    ...type.footnote,
    color: color.secondaryLabel,
  },
  about: {
    ...type.footnote,
    color: color.tertiaryLabel,
    marginTop: space.xs,
  },
  empty: {
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.xl,
    paddingTop: space.xxl,
  },
  emptyCompact: {
    paddingTop: space.xs,
    paddingHorizontal: 0,
  },
  emptyTitle: {
    ...type.title,
    color: color.label,
    textAlign: 'center',
    marginTop: space.xs,
  },
  emptyMessage: {
    ...type.status,
    color: color.secondaryLabel,
    textAlign: 'center',
  },
  emptyAction: {
    marginTop: space.md,
  },
});
