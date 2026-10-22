import { Button, Host, Text as SwiftText } from '@expo/ui/swift-ui';
import {
  buttonBorderShape,
  buttonStyle,
  controlSize,
  font,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import type { Itinerary, Leg } from '@bus-tracker/shared';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { detailNotes, timelineRows } from '@/components/itinerary/model';
import { Timeline } from '@/components/itinerary/Timeline';
import { LIVE_PAUSED_NOTE, lineName, routeInfoOf } from '@/components/plan/results';
import { LineBadge } from '@/components/rail/LineBadge';
import {
  arrivalIsApproximate,
  goCompact,
  goInstruction,
  type JourneyProgress,
} from '@/components/ride/journey';
import { formatClockHHMM } from '@/components/tracker/logic';
import type { HeroValue, SourceKind } from '@/components/trip/model';
import { Hairline, NoteRow, ToggleRow } from '@/components/trip/Rows';
import { GlassCapsuleButton } from '@/components/trip/PrimaryAction';
import { RouteBadge, type PeekStripProps } from '@/components/trip/SheetHeader';
import { HERE, usePlanner } from '@/state/PlannerContext';
import type { RideContextValue } from '@/state/RideContext';
import { color, hex, pick, space, type } from '@/theme/design';
import { haptics } from '@/utils/haptics';

type Ride = Extract<Leg, { kind: 'ride' }>;

const isBus = (l: Ride) => l.mode === 'bus' || l.mode === 'feeder';

/** What the trip sheet's header shows in Go: the leg's chip, its value and the peek strip. */
export interface GoHeader {
  title: string;
  badge: ReactNode;
  compact: HeroValue;
  status: string;
  source: SourceKind;
  strip: PeekStripProps;
}

/** The header for the current leg ("To KLCC", "On T816 · 4 stops", "Arrive 9:52"). */
export function goHeader(
  it: Itinerary,
  p: JourneyProgress,
  now: number,
  routes: ReturnType<typeof routeInfoOf>,
  destination: string,
): GoHeader {
  const leg = it.legs[p.legIndex];
  const name = (l: Ride) => (isBus(l) ? l.label : lineName(routes.longName(l.route) || l.label));
  const instruction = goInstruction(it, p, now, name);
  const live = leg?.kind === 'ride' && leg.timing.kind === 'live';
  const arrive = `Arrive ${arrivalIsApproximate(it, p.legIndex) ? 'about ' : ''}${formatClockHHMM(it.arriveAt)}`;
  const icon: SFSymbol = !leg || leg.kind === 'walk' ? 'figure.walk' : isBus(leg) ? 'bus' : 'tram.fill';
  return {
    title: `To ${destination}`,
    badge: <LegBadge leg={leg ?? null} routes={routes} />,
    compact: goCompact(it, p, now),
    status: p.phase === 'arrived' ? 'You’ve arrived' : live ? 'Live' : p.approximate ? 'About · from the timetable' : 'Scheduled',
    source: live ? 'live' : 'scheduled',
    strip: { left: { icon, text: instruction }, right: p.phase === 'arrived' ? null : { text: arrive } },
  };
}

/** The current leg's chip: the bus route, the rail line, or a walker. */
export function LegBadge({ leg, routes }: { leg: Leg | null; routes: ReturnType<typeof routeInfoOf> }) {
  if (leg?.kind === 'ride' && isBus(leg)) return <RouteBadge code={leg.label} />;
  if (leg?.kind === 'ride') {
    return (
      <LineBadge
        line={{
          code: leg.mode === 'ktm' ? 'KTM' : leg.label,
          name: lineName(routes.longName(leg.route) || leg.label),
          color: /^[0-9a-f]{6}$/i.test(leg.color) ? `#${leg.color}` : leg.color,
          textColor: routes.textColor(leg.route),
        }}
      />
    );
  }
  return (
    <View style={styles.walkBadge} accessible accessibilityLabel="Walk">
      <SymbolView name="figure.walk" size={13} tintColor={color.label} />
    </View>
  );
}

/**
 * The trip sheet in Go (spec §8, 15/06): the journey's timeline with where
 * you are on it, any note (a missed connection, live times paused), the
 * off-route offer, "Announce my stop", and End (Done once you've arrived).
 * Re-planning is only ever the rider's choice: "Re-plan from here" opens
 * the planner from your location; this journey carries on until Go is
 * tapped on another.
 */
export function GoBody({ ride, scheme }: { ride: RideContextValue; scheme: 'light' | 'dark' }) {
  const router = useRouter();
  const planner = usePlanner();
  const it = ride.itinerary;
  const net = ride.journeyNetwork;
  const p = ride.journey;
  const rows = useMemo(() => (it && net ? timelineRows(it, net, formatClockHHMM) : []), [it, net]);
  const { focus, setFrom, setTo, setWhen } = planner;

  const onLegPress = useCallback(
    (legIndex: number) => {
      haptics.light();
      focus(legIndex);
    },
    [focus],
  );
  const onStationPress = useCallback(
    (station: string) => router.push({ pathname: '/station', params: { station } }),
    [router],
  );
  const destination = ride.journeyDestination;
  const replan = useCallback(() => {
    if (!destination) return;
    haptics.selection();
    setFrom(HERE);
    setTo(destination);
    setWhen({ kind: 'now' });
    router.push('/plan');
  }, [destination, setFrom, setTo, setWhen, router]);

  if (!it || !net || !p) return null;
  const arrived = p.phase === 'arrived';
  const notes = detailNotes(it, formatClockHHMM);

  return (
    <View style={styles.wrap}>
      {notes.length > 0 || ride.journeyLiveSkipped ? (
        <View>
          {notes.map((n) => (
            <Text key={n.text} style={[styles.note, n.urgent && styles.noteUrgent]}>
              {n.text}
            </Text>
          ))}
          {ride.journeyLiveSkipped ? <NoteRow icon="clock" text={LIVE_PAUSED_NOTE} /> : null}
        </View>
      ) : null}

      {ride.offRoute && !arrived ? <OffRouteRow scheme={scheme} onReplan={replan} onDismiss={ride.dismissOffRoute} /> : null}

      <Timeline
        rows={rows}
        onLegPress={onLegPress}
        onStationPress={onStationPress}
        currentLeg={p.legIndex}
        progress={p.phase}
      />

      <View>
        <Hairline />
        <ToggleRow
          title="Announce my stop"
          caption="Speaks when yours is next. Best with headphones."
          value={ride.speak}
          onValueChange={ride.setSpeak}
          accessibilityLabel="Announce my stop out loud"
        />
        <Hairline />
      </View>

      <Host matchContents style={styles.end}>
        <Button
          onPress={ride.end}
          modifiers={[
            buttonStyle('bordered'),
            buttonBorderShape('capsule'),
            controlSize('large'),
            tint(pick(hex.ink, scheme)),
          ]}
        >
          <SwiftText modifiers={[font({ size: 17, weight: 'semibold' })]}>{arrived ? 'Done' : 'End'}</SwiftText>
        </Button>
      </Host>
    </View>
  );
}

/** "Off route?" and a glass "Re-plan from here"; "Not now" hides it for 5 minutes. */
function OffRouteRow({
  scheme,
  onReplan,
  onDismiss,
}: {
  scheme: 'light' | 'dark';
  onReplan: () => void;
  onDismiss: () => void;
}) {
  return (
    <View style={styles.offRoute}>
      {/* The title rides on the button's label, so "Not now" stays its own element. */}
      <View style={styles.offRouteHead}>
        <SymbolView
          name="arrow.triangle.branch"
          size={17}
          tintColor={color.label}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        <Text style={styles.offRouteTitle} accessibilityElementsHidden importantForAccessibility="no">
          Off route?
        </Text>
        <Pressable
          onPress={onDismiss}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Not now"
          accessibilityHint="Hides this for five minutes"
        >
          {({ pressed }) => <Text style={[styles.notNow, pressed && styles.pressed]}>Not now</Text>}
        </Pressable>
      </View>
      <GlassCapsuleButton
        label="Re-plan from here"
        accessibilityLabel="Off route? Re-plan from here"
        icon="arrow.triangle.branch"
        prominent={false}
        hint="Finds routes from where you are now. This journey carries on until you pick one."
        scheme={scheme}
        onPress={onReplan}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space.lg,
  },
  note: {
    ...type.footnote,
    color: color.secondaryLabel,
    paddingVertical: space.xxs,
  },
  noteUrgent: {
    color: color.warning,
    fontWeight: '500',
  },
  offRoute: {
    gap: space.sm,
  },
  offRouteHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  offRouteTitle: {
    ...type.status,
    flex: 1,
    fontWeight: '600',
    color: color.label,
  },
  notNow: {
    ...type.status,
    color: color.secondaryLabel,
  },
  pressed: {
    opacity: 0.55,
  },
  // RouteBadge's outline, with a walker for the label.
  walkBadge: {
    height: 24,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: color.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  end: {
    alignSelf: 'center',
  },
});
