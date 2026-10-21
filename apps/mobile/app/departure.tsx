import { HStack, Host, Text as SwiftText, useNativeState } from '@expo/ui/swift-ui';
import {
  animation,
  Animation,
  contentTransition,
  font,
  foregroundStyle,
  glassEffect,
  monospacedDigit,
  padding,
} from '@expo/ui/swift-ui/modifiers';
import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, useColorScheme, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatClockHHMM } from '@/components/tracker/logic';
import { formatIn } from '@/components/trip/model';
import { GlassCapsuleButton } from '@/components/trip/PrimaryAction';
import { Hairline, InfoRow, ROW_ICON_INSET } from '@/components/trip/Rows';
import { useSettings } from '@/hooks/useSettings';
import {
  cancelDepartureReminder,
  ensureNotificationPermission,
  getDepartureReminder,
  scheduleDepartureReminder,
} from '@/services/reminders/notifications';
import { useTrip } from '@/state/TripContext';
import { color, MARGIN, space, type } from '@/theme/design';

/** Room on the right for the close button, level with the time. */
const CLOSE_CLEARANCE = 64;
const SYSTEM_BLUE = '#007AFF';

/**
 * One departure from the Today grid, in a small sheet over the trip.
 *
 *   3:47 PM                         ⨉
 *   [Your bus]  in 49 mins
 *   ─────────────────────────────────
 *   🚌  T816 · Hotel Lisa De Inn     Scheduled
 *   🚶  Leave by 3:37 PM           10 min walk
 *   [ 🔔 Remind me at 3:37 PM ]
 *
 * The time is the headline, as the minutes are on the trip sheet. The
 * countdown rolls its digits as minutes pass; setting the reminder bounces
 * the bell, crossfades the label and taps a success haptic.
 */
export default function DepartureScreen() {
  const router = useRouter();
  const trip = useTrip();
  const settings = useSettings();
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const { tripId, at } = useLocalSearchParams<{ tripId: string; at: string }>();

  const busAt = Number(at);
  const away = Math.round((busAt - trip.now) / 60_000);
  const yours = tripId != null && trip.eta.primaryArrival?.sched?.tripId === tripId;
  const leaveAt = busAt - settings.walkMinutes * 60_000;
  const canRemind = leaveAt > trip.now;
  const leaveClock = formatClockHHMM(leaveAt);

  // Whether this bus already has the reminder (it outlives the sheet).
  const [reminded, setReminded] = useState(false);
  const [denied, setDenied] = useState(false);
  const bell = useNativeState(0);
  useEffect(() => {
    let live = true;
    void getDepartureReminder().then((r) => {
      if (live) setReminded(r?.tripId === tripId);
    });
    return () => {
      live = false;
    };
  }, [tripId]);

  const toggleReminder = async () => {
    if (reminded) {
      setReminded(false);
      await cancelDepartureReminder();
      return;
    }
    if (!(await ensureNotificationPermission())) {
      setDenied(true);
      return;
    }
    const set = await scheduleDepartureReminder({
      tripId: tripId ?? '',
      routeCode: trip.routeCode,
      stopName: trip.stopName ?? 'your stop',
      leaveAtMs: leaveAt,
      busAtMs: busAt,
    });
    setReminded(set);
    if (set) {
      bell.set(bell.get() + 1);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const when = away < 0 ? 'Gone' : away < 1 ? 'Due now' : formatIn(away);
  const where = [trip.routeCode, trip.stopName].filter(Boolean).join(' · ');

  return (
    <>
      <Stack.Screen options={{ title: '' }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon="xmark"
          accessibilityLabel="Close"
          onPress={() => router.back()}
        />
      </Stack.Toolbar>
      <View style={[styles.content, { paddingBottom: Math.max(insets.bottom, space.md) }]}>
        <Text style={styles.time} accessibilityRole="header">
          {Number.isFinite(busAt) ? formatClockHHMM(busAt) : ''}
        </Text>
        <Host matchContents style={styles.whenHost}>
          <HStack spacing={8} alignment="center">
            {yours ? (
              <SwiftText
                modifiers={[
                  font({ size: 13, weight: 'semibold' }),
                  foregroundStyle('#FFFFFF'),
                  padding({ horizontal: 8, vertical: 3 }),
                  glassEffect({
                    glass: { variant: 'regular', tint: SYSTEM_BLUE },
                    shape: 'capsule',
                  }),
                ]}
              >
                Your bus
              </SwiftText>
            ) : null}
            <SwiftText
              modifiers={[
                font({ size: type.body.fontSize }),
                monospacedDigit(),
                foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
                // Minutes roll down in place as the bus gets closer.
                contentTransition('numericText', { countsDown: true }),
                animation(Animation.smooth({ duration: 0.35 }), away),
              ]}
            >
              {when}
            </SwiftText>
          </HStack>
        </Host>

        <View style={styles.rows}>
          <Hairline />
          <InfoRow icon="bus" title={where} value="Scheduled" />
          {away >= 1 ? (
            <>
              <Hairline inset={ROW_ICON_INSET} />
              <InfoRow
                icon="figure.walk"
                title={canRemind ? `Leave by ${leaveClock}` : 'Leave now'}
                value={`${settings.walkMinutes}-min walk`}
              />
            </>
          ) : null}
        </View>

        {canRemind ? (
          <View style={styles.action}>
            {/* The sheet fits its content as first laid out, before the native
                button reports its height, so the button's room is reserved. */}
            <View style={styles.buttonSlot}>
              <GlassCapsuleButton
                label={reminded ? `Reminder set · ${leaveClock}` : `Remind me at ${leaveClock}`}
                icon={reminded ? 'bell.fill' : 'bell'}
                prominent={!reminded}
                hint={
                  reminded
                    ? 'Cancels the reminder'
                    : `Notifies you when it's time to walk to the stop for this bus`
                }
                scheme={scheme}
                bounce={bell}
                onPress={() => void toggleReminder()}
              />
            </View>
            {denied ? (
              <Text style={styles.denied}>Turn on notifications for BusBuddy in Settings.</Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: space.lg,
    paddingHorizontal: MARGIN,
  },
  time: {
    fontSize: 40,
    lineHeight: 46,
    fontWeight: '300',
    color: color.label,
    fontVariant: ['tabular-nums'],
    marginRight: CLOSE_CLEARANCE,
  },
  whenHost: {
    marginTop: space.xxs,
  },
  rows: {
    marginTop: space.md,
  },
  action: {
    marginTop: space.sm,
    gap: space.xs,
  },
  buttonSlot: {
    minHeight: 56,
    justifyContent: 'center',
  },
  denied: {
    ...type.footnote,
    color: color.secondaryLabel,
    textAlign: 'center',
  },
});
