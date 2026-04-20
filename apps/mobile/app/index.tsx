import { PlatformColor, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useEffect, useMemo, useState } from 'react';

import { HeroCountdown } from '@/components/tracker/HeroCountdown';
import { InfoGroup } from '@/components/tracker/InfoGroup';
import { InfoRow } from '@/components/tracker/InfoRow';
import { NotifDeniedChip } from '@/components/tracker/NotifDeniedChip';
import { StatusDot } from '@/components/tracker/StatusDot';
import { TrackerCanvas } from '@/components/tracker/TrackerCanvas';
import { WalkCta } from '@/components/tracker/WalkCta';
import {
  computeDelay,
  formatMinutes,
  formatWalkRemaining,
  resolveHeroState,
  statusLabel,
  useLastUpdatedLabel,
} from '@/components/tracker/logic';
import { delayStatusColor, trackerSpacing } from '@/components/tracker/tokens';
import { openDb } from '@/db/database';
import { getStops, type StopRow } from '@/db/queries';
import { useBusPosition } from '@/hooks/useBusPosition';
import { useEta } from '@/hooks/useEta';
import { usePushRegistrationState } from '@/hooks/PushRegistrationContext';
import { useSettings } from '@/hooks/useSettings';
import { useWalkTimer } from '@/hooks/useWalkTimer';

const ROUTE_CODE = 'T816';

export default function TrackerScreen() {
  const settings = useSettings();
  const push = usePushRegistrationState();
  const { current, next, minutesToStop } = useEta({
    stopId: settings.preferredStopId,
    trafficProvider: settings.trafficProvider,
  });
  const { lastUpdated } = useBusPosition();
  const updated = useLastUpdatedLabel(lastUpdated);
  const walk = useWalkTimer(settings.walkMinutes);
  const [stopName, setStopName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = await openDb();
        const stops = await getStops(db);
        if (cancelled) return;
        const match = stops.find(
          (s: StopRow) => s.stop_id === settings.preferredStopId,
        );
        setStopName(match?.stop_name ?? null);
      } catch (err) {
        console.warn('[tracker] failed to load stop name', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settings.preferredStopId]);

  const leaveIn =
    minutesToStop == null
      ? null
      : Math.max(0, minutesToStop - settings.walkMinutes);
  const heroState = resolveHeroState({
    isWalking: walk.isWalking,
    leaveIn,
  });
  const isLeaveNow = heroState === 'leaveNow';

  const hero = useMemo(() => {
    if (walk.isWalking) {
      return {
        eyebrow: 'Walking to stop',
        value: formatWalkRemaining(walk.remainingSeconds ?? 0),
        unit: 'remaining',
      };
    }
    if (leaveIn == null) {
      return {
        eyebrow: 'Waiting for bus',
        value: '—',
        unit: '',
      };
    }
    if (leaveIn === 0) {
      return {
        eyebrow: 'Leave now',
        value: '0',
        unit: 'minutes',
      };
    }
    return {
      eyebrow: isLeaveNow ? 'Leave soon' : 'Leave in',
      value: `${leaveIn}`,
      unit: leaveIn === 1 ? 'minute' : 'minutes',
    };
  }, [walk.isWalking, walk.remainingSeconds, leaveIn, isLeaveNow]);

  const subtitle = stopName ? `to ${stopName}` : 'to your stop';
  const delay = computeDelay(current);

  return (
    <TrackerCanvas>
      <HeroCountdown
        state={heroState}
        routeCode={ROUTE_CODE}
        eyebrow={hero.eyebrow}
        value={hero.value}
        unit={hero.unit}
        subtitle={subtitle}
        meta={updated.label}
        isStale={updated.isStale}
      />

      {push.permission === 'denied' ? (
        <Animated.View
          entering={FadeIn.duration(220)}
          style={{ marginBottom: 16 }}
        >
          <NotifDeniedChip />
        </Animated.View>
      ) : null}

      <SectionLabel>Buses</SectionLabel>
      <InfoGroup>
        <InfoRow label="Current" value={`${formatMinutes(current)} min`} />
        <InfoRow
          label="Next"
          value={`${formatMinutes(next)} min`}
          valueColor={PlatformColor('secondaryLabel')}
        />
        {delay ? (
          <InfoRow
            label={statusLabel[delay.status]}
            caption="vs. free-flow baseline"
            value={delay.deltaMin <= 0 ? 'on time' : `+${Math.round(delay.deltaMin)}m`}
            valueColor={delayStatusColor[delay.status]}
            trailing={<StatusDot color={delayStatusColor[delay.status]} />}
          />
        ) : null}
      </InfoGroup>

      <View style={{ height: trackerSpacing.sectionGap }} />

      <WalkCta
        isWalking={walk.isWalking}
        isLeaveNow={isLeaveNow}
        onStart={() => {
          void walk.start();
        }}
        onCancel={() => {
          void walk.cancel();
        }}
      />
    </TrackerCanvas>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text style={labelStyles.text} selectable>
      {children}
    </Text>
  );
}

const labelStyles = StyleSheet.create({
  text: {
    fontSize: 13,
    fontWeight: '500',
    color: PlatformColor('secondaryLabel'),
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginLeft: 4,
  },
});
