import { DatePicker, Picker, Section, Text, Toggle } from '@expo/ui/swift-ui';
import { tag } from '@expo/ui/swift-ui/modifiers';
import { useEffect, useState } from 'react';
import { Alert, Linking } from 'react-native';

import {
  disableArrivalAlert,
  enableArrivalAlert,
  isArrivalAlertEnabled,
  type GeofenceTarget,
} from '@/services/arrival/geofence';
import {
  registerBackgroundRefresh,
  unregisterBackgroundRefresh,
} from '@/services/reminders/backgroundRefresh';
import { useCommuteSettings } from '@/services/reminders/commuteSettings';
import { ensureNotificationPermission } from '@/services/reminders/notifications';

const DAY_SETS: { label: string; days: number[] }[] = [
  { label: 'Weekdays', days: [1, 2, 3, 4, 5] },
  { label: 'Every day', days: [0, 1, 2, 3, 4, 5, 6] },
  { label: 'Weekends', days: [0, 6] },
];

function sameDays(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && [...a].sort().every((d, i) => d === [...b].sort()[i]);
}

/**
 * Opt-in alerts, all scheduled on the phone: a daily "leave now" for your
 * commute bus, and a nudge when you walk up to your stop. Off by default;
 * each asks for its permission only when switched on.
 */
export function RemindersSection({
  routeCode,
  arrivalTargets,
}: {
  routeCode: string | null;
  arrivalTargets: readonly GeofenceTarget[];
}) {
  const commute = useCommuteSettings();
  const [arrival, setArrival] = useState(false);

  useEffect(() => {
    void isArrivalAlertEnabled().then(setArrival);
  }, []);

  const denied = (what: string) =>
    Alert.alert(`${what} is off`, `Allow it for BusBuddy in Settings to use this.`, [
      { text: 'Not Now', style: 'cancel' },
      { text: 'Open Settings', onPress: () => void Linking.openSettings() },
    ]);

  const setCommute = async (on: boolean) => {
    if (!on) {
      commute.setEnabled(false);
      await unregisterBackgroundRefresh().catch(() => {});
      return;
    }
    if (!(await ensureNotificationPermission())) {
      denied('Notifications');
      return;
    }
    commute.setEnabled(true);
    await registerBackgroundRefresh().catch(() => false);
  };

  const setArrivalOn = async (on: boolean) => {
    if (!on) {
      setArrival(false);
      await disableArrivalAlert();
      return;
    }
    await ensureNotificationPermission().catch(() => false);
    const ok = await enableArrivalAlert(arrivalTargets).catch(() => false);
    setArrival(ok);
    if (!ok) denied('“Always” location');
  };

  const target = new Date();
  target.setHours(Math.floor(commute.targetMinuteOfDay / 60), commute.targetMinuteOfDay % 60, 0, 0);
  const dayIndex = Math.max(0, DAY_SETS.findIndex((d) => sameDays(d.days, commute.weekdays)));

  return (
    <>
      <Section
        title="Commute reminder"
        footer={
          <Text>
            {routeCode
              ? `A time-sensitive notification when it’s time to walk to your stop for the first ${routeCode} at or after this time. Planned from the timetable on your phone.`
              : 'Add a route first.'}
          </Text>
        }
      >
        <Toggle
          label="Remind me to leave"
          systemImage="bell.badge"
          isOn={commute.enabled}
          onIsOnChange={(on) => void setCommute(on)}
        />
        {commute.enabled ? (
          <>
            <DatePicker
              title="Bus around"
              selection={target}
              displayedComponents={['hourAndMinute']}
              onDateChange={(d) => commute.setTargetMinuteOfDay(d.getHours() * 60 + d.getMinutes())}
            />
            <Picker
              label="Days"
              selection={dayIndex}
              onSelectionChange={(i) => {
                const set = DAY_SETS[Number(i)];
                if (set) commute.setWeekdays(set.days);
              }}
            >
              {DAY_SETS.map((d, i) => (
                <Text key={d.label} modifiers={[tag(i)]}>
                  {d.label}
                </Text>
              ))}
            </Picker>
          </>
        ) : null}
      </Section>

      <Section
        title="At your stop"
        footer={
          <Text>
            When you walk up to your boarding stop, BusBuddy tells you when the next bus is due;
            tap it to follow the bus on your Lock Screen. Needs “Always” location, used only to
            notice you arriving at your saved stops.
          </Text>
        }
      >
        <Toggle
          label="Notify me at my stop"
          systemImage="location.circle"
          isOn={arrival}
          onIsOnChange={(on) => void setArrivalOn(on)}
        />
      </Section>
    </>
  );
}
