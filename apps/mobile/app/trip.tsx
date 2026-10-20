import { Button, Host, Text as SwiftText } from '@expo/ui/swift-ui';
import {
  buttonBorderShape,
  buttonStyle,
  controlSize,
  font,
} from '@expo/ui/swift-ui/modifiers';
import { nearbyRailStations } from '@bus-tracker/shared';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useNavigation, useRouter } from 'expo-router';
import { useEffect, useMemo, type ReactNode } from 'react';
import {
  Linking,
  Pressable,
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
import { RideBody } from '@/components/ride/RideBody';
import { Connections } from '@/components/trip/Connections';
import { Hero, StatusLine } from '@/components/trip/Hero';
import { Notes } from '@/components/trip/Notes';
import { OnTheWay } from '@/components/trip/OnTheWay';
import { PrimaryAction } from '@/components/trip/PrimaryAction';
import { SheetHeader } from '@/components/trip/SheetHeader';
import { Timetable } from '@/components/trip/Timetable';
import { useSettings } from '@/hooks/useSettings';
import { ensureNotificationPermission } from '@/services/reminders/notifications';
import { useRide } from '@/state/RideContext';
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
  const ride = useRide();
  const { model } = trip;
  const userStop = trip.route?.userStop ?? null;
  const stopPoint = useMemo(
    () => (userStop ? { lat: userStop.stop_lat, lng: userStop.stop_lon } : null),
    [userStop],
  );
  const hasRail = useMemo(
    () => (stopPoint ? nearbyRailStations(stopPoint).length > 0 : false),
    [stopPoint],
  );

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

  if (ride.active) {
    const p = ride.progress;
    return (
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + space.xl }]}
        showsVerticalScrollIndicator={false}
      >
        <SheetHeader
          routeCode={trip.routeCode}
          stopName={ride.destination ? `To ${ride.destination.name}` : trip.stopName}
          subtitle={trip.route?.longName ?? null}
          compact={
            p == null
              ? null
              : p.phase === 'arrived'
                ? 'Here'
                : p.phase === 'next-is-yours'
                  ? 'Next stop'
                  : `${p.stopsToGo} stops`
          }
          showCompact={trip.detent === 0}
          compactIsLive
        />
        <View style={styles.body}>
          <RideBody ride={ride} base={model} />
        </View>
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

        <Notes notes={model.notes} />

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

        {stopPoint ? (
          <Section title="Getting there">
            <Pressable
              onPress={() => openWalkingDirections(stopPoint)}
              accessibilityRole="button"
              accessibilityHint="Opens Apple Maps"
              style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
            >
              <SymbolView name="figure.walk" size={18} tintColor={color.accent} />
              <Text style={styles.linkText}>Walking directions to your stop</Text>
              <SymbolView name="arrow.up.right" size={13} tintColor={color.tertiaryLabel} />
            </Pressable>
            {ride.destinations.length > 0 ? (
              <Pressable
                onPress={() => router.push('/ride')}
                accessibilityRole="button"
                style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
              >
                <SymbolView name="bell.badge" size={18} tintColor={color.accent} />
                <Text style={styles.linkText}>On the bus? Alert me before my stop</Text>
                <SymbolView name="chevron.right" size={13} tintColor={color.tertiaryLabel} />
              </Pressable>
            ) : null}
          </Section>
        ) : null}

        {stopPoint && hasRail ? (
          <Section title="Rail nearby">
            <Connections stop={stopPoint} />
          </Section>
        ) : null}

        {model.notes.some((n) => n.id === 'last-bus') ? (
          <Section title="Last bus">
            <View style={styles.toggleRow}>
              <View style={styles.toggleText}>
                <Text style={styles.toggleTitle}>Remind me to leave</Text>
                <Text style={styles.toggleCaption}>
                  A notification {10 + settings.walkMinutes} min before the last bus, from the timetable.
                </Text>
              </View>
              <Switch
                value={trip.lastBusReminder}
                onValueChange={(on) => {
                  trip.setLastBusReminder(on);
                  if (on) void ensureNotificationPermission().catch(() => {});
                }}
                accessibilityLabel="Remind me to leave for the last bus"
              />
            </View>
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

/** Hands off to Apple Maps in walking mode (Look Around included there). */
function openWalkingDirections(stop: { lat: number; lng: number }) {
  void Linking.openURL(`https://maps.apple.com/?daddr=${stop.lat},${stop.lng}&dirflg=w`);
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
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: 20,
    borderCurve: 'continuous',
    backgroundColor: color.fill,
  },
  pressed: {
    opacity: 0.6,
  },
  linkText: {
    ...type.body,
    color: color.accent,
    flex: 1,
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
