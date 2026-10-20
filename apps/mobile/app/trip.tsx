import { Button, Host, Text as SwiftText } from '@expo/ui/swift-ui';
import {
  buttonBorderShape,
  buttonStyle,
  controlSize,
  font,
  foregroundStyle,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { nearbyRailStations } from '@bus-tracker/shared';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useNavigation, useRouter } from 'expo-router';
import { useEffect, useMemo, type ReactNode } from 'react';
import { Linking, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatClockHHMM } from '@/components/tracker/logic';
import { RideBody } from '@/components/ride/RideBody';
import { Connections } from '@/components/trip/Connections';
import { Hero, StatusLine } from '@/components/trip/Hero';
import { TripRows } from '@/components/trip/Notes';
import { OnTheWay } from '@/components/trip/OnTheWay';
import { PrimaryAction } from '@/components/trip/PrimaryAction';
import { Hairline, LinkRow, SectionLabel, ToggleRow } from '@/components/trip/Rows';
import { SheetHeader } from '@/components/trip/SheetHeader';
import { Timetable } from '@/components/trip/Timetable';
import { useSettings } from '@/hooks/useSettings';
import { ensureNotificationPermission } from '@/services/reminders/notifications';
import { useRide } from '@/state/RideContext';
import { useTrip } from '@/state/TripContext';
import {
  color,
  hex,
  MARGIN,
  motion,
  pick,
  space,
  type,
  type DetentIndex,
} from '@/theme/design';

type DetentListener = (
  event: 'sheetDetentChange',
  cb: (e: { data: { index: number } }) => void,
) => () => void;

/**
 * The persistent trip sheet over the map, in Calm Mono: opaque paper, ink
 * type, hairline rows. Peek shows the header row; glance the thin hero
 * number, the status line, "Then" and notes, and one action; large adds the
 * approach, today's times, rail nearby and the trip options.
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
  const peek = trip.detent === 0;
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

  const scrollStyle = [styles.scroll, { paddingBottom: insets.bottom + space.xl }];

  if (model.state === 'empty') {
    return (
      <ScrollView contentContainerStyle={scrollStyle}>
        <EmptyState
          icon="bus"
          title="Track your bus"
          message="Pick a route and the stop you board at. Live buses and your countdown appear here."
          actionLabel="Choose Route"
          onAction={() => router.push('/add-route')}
          scheme={scheme}
        />
      </ScrollView>
    );
  }

  if (ride.active) {
    const p = ride.progress;
    return (
      <ScrollView contentContainerStyle={scrollStyle} showsVerticalScrollIndicator={false}>
        <SheetHeader
          routeCode={trip.routeCode}
          title={ride.destination ? `To ${ride.destination.name}` : trip.stopName}
          peek={peek}
          status={p?.nextStop ? `Next: ${p.nextStop.name}` : null}
          source="live"
          compact={
            p == null
              ? null
              : p.phase === 'arrived'
                ? { text: 'Here', unit: null, kind: 'word' }
                : p.phase === 'next-is-yours'
                  ? { text: 'Next', unit: null, kind: 'word' }
                  : { text: String(p.stopsToGo), unit: 'stops', kind: 'minutes' }
          }
        />
        <View style={[styles.body, peek && styles.hidden]} accessibilityElementsHidden={peek}>
          <RideBody ride={ride} base={model} />
        </View>
      </ScrollView>
    );
  }

  const isLive = model.source !== 'scheduled';
  const liveTripId = trip.eta.primaryArrival?.sched?.tripId ?? null;
  const showJourney = model.state === 'arrival' && trip.eta.primaryArrival?.kind === 'live';
  const hasLastBus = model.notes.some((n) => n.id === 'last-bus');

  return (
    <ScrollView contentContainerStyle={scrollStyle} showsVerticalScrollIndicator={false}>
      <SheetHeader
        routeCode={trip.routeCode}
        title={trip.stopName}
        peek={peek}
        status={model.state === 'arrival' || model.state === 'before-service' ? model.status : null}
        source={model.source}
        compact={model.hero}
      />

      {/* The peek detent shows the header row only; the body stays mounted
          (no SwiftUI host re-creation) but invisible so nothing peeks out
          clipped under it. */}
      <View style={[styles.body, peek && styles.hidden]} accessibilityElementsHidden={peek}>
        <StateBody scheme={scheme} />

        <TripRows model={model} />

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
          <Section title="Today">
            <Timetable
              departures={trip.eta.scheduledUpcoming}
              formatClock={formatClockHHMM}
              liveTripId={isLive ? liveTripId : null}
              firstBusToday={trip.eta.firstBusToday}
              lastBusToday={trip.eta.lastBusToday}
            />
          </Section>
        ) : null}

        {stopPoint && hasRail ? (
          <Section title="Rail nearby">
            <Connections stop={stopPoint} />
          </Section>
        ) : null}

        <View style={styles.options}>
          <Hairline />
          {model.state === 'arrival' ? (
            <>
              <ToggleRow
                title="Follow on Lock Screen"
                value={trip.isFollowing}
                onValueChange={(on) => (on ? trip.follow() : trip.unfollow())}
                accessibilityLabel="Follow this bus on the Lock Screen"
              />
              <Hairline />
            </>
          ) : null}
          {hasLastBus ? (
            <>
              <ToggleRow
                title="Remind me before the last bus"
                caption={`${10 + settings.walkMinutes} min before it leaves, from the timetable`}
                value={trip.lastBusReminder}
                onValueChange={(on) => {
                  trip.setLastBusReminder(on);
                  if (on) void ensureNotificationPermission().catch(() => {});
                }}
              />
              <Hairline />
            </>
          ) : null}
          {ride.destinations.length > 0 ? (
            <>
              <LinkRow title="Alert me before my stop" onPress={() => router.push('/ride')} />
              <Hairline />
            </>
          ) : null}
          {stopPoint ? (
            <>
              <LinkRow
                title="Walking directions"
                value={`${settings.walkMinutes} min`}
                external
                onPress={() => openWalkingDirections(stopPoint)}
                accessibilityHint="Opens Apple Maps"
              />
              <Hairline />
            </>
          ) : null}
        </View>

        <Text style={styles.about}>
          Live bus positions from data.gov.my. Live times are estimated from
          each bus’s position; scheduled times come from the timetable.
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
function StateBody({ scheme }: { scheme: 'light' | 'dark' }) {
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
            scheme={scheme}
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
          icon="moon.zzz"
          title="No more buses tonight"
          message={model.detail ?? 'Check back in the morning for the first bus.'}
          scheme={scheme}
          compact
        />
      );
    case 'no-service':
      return (
        <EmptyState
          icon="bus"
          title={model.status}
          message="Scheduled times appear here as soon as the next run is due."
          scheme={scheme}
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
      <SectionLabel>{title}</SectionLabel>
      {children}
    </View>
  );
}

/** Thin SF Symbol, plain type, one ink button. No illustration chrome. */
function EmptyState({
  icon,
  title,
  message,
  actionLabel,
  onAction,
  scheme,
  compact = false,
}: {
  icon: SFSymbol;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  scheme: 'light' | 'dark';
  compact?: boolean;
}) {
  return (
    <View style={[styles.empty, compact && styles.emptyCompact]}>
      <SymbolView
        name={icon}
        size={compact ? 36 : 56}
        weight="ultraLight"
        tintColor={color.label}
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
              tint(pick(hex.ink, scheme)),
            ]}
          >
            <SwiftText
              modifiers={[
                font({ size: 17, weight: 'semibold' }),
                foregroundStyle(pick(hex.paper, scheme)),
              ]}
            >
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
    paddingTop: space.xxs,
    gap: space.lg,
  },
  hidden: {
    opacity: 0,
  },
  heroBlock: {
    gap: space.xs,
  },
  placeholderNumber: {
    width: 120,
    height: 96,
    borderRadius: 16,
    borderCurve: 'continuous',
    backgroundColor: color.fill,
  },
  muted: {
    ...type.status,
    color: color.secondaryLabel,
  },
  section: {
    gap: space.xxs,
    marginTop: space.sm,
  },
  options: {
    marginTop: space.sm,
  },
  about: {
    ...type.footnote,
    color: color.secondaryLabel,
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
    fontWeight: '500',
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
