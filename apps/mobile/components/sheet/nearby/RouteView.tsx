import { haversineMeters, type TransitNetwork, type VehiclePosition } from '@bus-tracker/shared';
import { Button, HStack, Host, Image as SwiftImage, Text as SwiftText } from '@expo/ui/swift-ui';
import {
  accessibilityHint,
  accessibilityLabel,
  buttonBorderShape,
  buttonStyle,
  controlSize,
  font,
  foregroundStyle,
  frame,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { SymbolView } from 'expo-symbols';
import { useRouter } from 'expo-router';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';

import { EmptyState } from '@/components/sheet/EmptyState';
import { distanceText, isTomorrow, routePreview, type RoutePreview, type RoutePreviewStop } from '@/components/sheet/nearby/model';
import { AX_FONT_SCALE } from '@/components/sheet/nearby/PlaceRow';
import { openWalkingDirections } from '@/components/sheet/nearby/TripView';
import { trackPlan } from '@/components/sheet/nearby/track';
import { formatClockHHMM } from '@/components/tracker/logic';
import { HeroNumber, SourceMark, StatusLine } from '@/components/trip/Hero';
import { formatDuration, stopsAwayLabel, type HeroValue } from '@/components/trip/model';
import { nearestStopIds } from '@/components/trip/OnTheWay';
import { RowButton } from '@/components/ui/RowButton';
import { Section, SheetBody } from '@/components/trip/SheetBody';
import { DetailHeader, RouteBadge } from '@/components/trip/SheetHeader';
import type { StopRow } from '@/db/queries';
import { MAX_FAVORITES, useSettings } from '@/hooks/useSettings';
import { useTransitNetwork } from '@/hooks/useTransitNetwork';
import { useNearby, type NearbyView } from '@/state/NearbyContext';
import { color, hex, MARGIN, motion, pick, space, type } from '@/theme/design';
import { devNow } from '@/utils/devClock';
import { haptics } from '@/utils/haptics';

/** The countdown re-reads the clock this often. */
const TICK_MS = 15_000;
/** Collapsed, the stops onward show this many from yours, then the last. */
const HEAD_STOPS = 4;
/** The rail column the stop rings sit on. */
const RAIL = 20;
const RING = 10;
const RING_YOURS = 14;

/**
 * One route from a stop around you, previewed (plan 17/04): the scheduled
 * countdown at your stop, live when one of its buses is on the way, then
 * Track this route and Walk there, and its stops from yours onward. Every
 * detent shows the whole column, cut by the sheet's edge.
 */
export function RouteView({
  view,
  scheme,
}: {
  view: Extract<NearbyView, { kind: 'route' }>;
  scheme: 'light' | 'dark';
}) {
  const nearby = useNearby();
  const settings = useSettings();
  const router = useRouter();
  // At accessibility sizes the two buttons stack, full width, so their labels fit.
  const stacked = useWindowDimensions().fontScale >= AX_FONT_SCALE;
  const { network } = useTransitNetwork();
  const now = useNow();

  const preview = useMemo(
    () => {
      if (!network) return null;
      const p = routePreview(network, view.pattern, view.fromStopIndex, now, { clock: formatClockHHMM });
      // A pattern that now belongs to another route is as stale as a missing one.
      return p && p.route === view.route ? p : null;
    },
    [network, view.route, view.pattern, view.fromStopIndex, now],
  );
  const stopsAway = useMemo(
    () => (network ? upstreamStopsAway(network, view.pattern, view.fromStopIndex, nearby.previewPositions) : null),
    [network, view.pattern, view.fromStopIndex, nearby.previewPositions],
  );

  if (!network || !preview) {
    return (
      <>
        <DetailHeader title="Route" subtitle={null} peek={false} onBack={nearby.pop} backLabel="Back to the stop" />
        <View style={styles.body}>
          {network ? (
            <EmptyState
              icon="arrow.triangle.branch"
              title="This route isn’t here any more"
              message="The timetable changed since you opened it. Go back to see the stop’s routes again."
              scheme={scheme}
              compact
            />
          ) : (
            <EmptyState
              icon="arrow.down.circle"
              title="Loading the network…"
              message="The route’s stops and times appear once it’s on your phone."
              scheme={scheme}
              compact
            />
          )}
        </View>
      </>
    );
  }

  const yours = preview.stops[0];
  const distanceM = nearby.here ? haversineMeters(nearby.here, { lat: yours.lat, lng: yours.lng }) : null;

  const track = () => {
    const plan = trackPlan(preview.label, network.stops.id[preview.fromStopIndex], settings.favoritedRoutes, MAX_FAVORITES);
    if (plan.kind === 'full') {
      haptics.error();
      Alert.alert(
        `You’re tracking ${MAX_FAVORITES} routes`,
        `Remove one in Settings to add ${preview.label}.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => router.push('/settings') },
        ],
      );
      return;
    }
    // `addFavorite` sets the stop for a new route; an existing one switches.
    if (plan.kind === 'add') settings.addFavorite(plan.code, plan.stopId);
    settings.setPreferredStopForRoute(plan.code, plan.stopId);
    settings.setPreferredRouteCode(plan.code);
    haptics.success();
    nearby.reset();
    nearby.push({ kind: 'trip' });
  };

  return (
    <View>
      <Header preview={preview} distanceM={distanceM} scheme={scheme} onBack={nearby.pop} />
      <View style={styles.countdown}>
        <Countdown preview={preview} now={now} stopsAway={stopsAway} />
      </View>
      <SheetBody peek={false}>
        <View style={stacked ? styles.actionsStacked : styles.actions}>
          <ActionButton
            label="Track this route"
            icon="plus"
            filled
            hint={`Makes this your route at ${preview.fromStopName}`}
            scheme={scheme}
            stacked={stacked}
            onPress={track}
          />
          <ActionButton
            label="Walk there"
            icon="figure.walk"
            filled={false}
            hint={`Opens walking directions to ${preview.fromStopName} in Apple Maps`}
            scheme={scheme}
            stacked={stacked}
            onPress={() => openWalkingDirections({ lat: yours.lat, lng: yours.lng })}
          />
        </View>
        <Section title="Your stop onwards">
          <StopsOnward stops={preview.stops} />
        </Section>
      </SheetBody>
    </View>
  );
}

/** The clock, re-read every few seconds while the preview is open. */
function useNow(): number {
  const [now, setNow] = useState(devNow);
  useEffect(() => {
    const t = setInterval(() => setNow(devNow()), TICK_MS);
    return () => clearInterval(t);
  }, []);
  return now;
}

/**
 * How many stops before yours the nearest live bus of this route is, from
 * the stop each bus is nearest to on the whole pattern; buses nearest your
 * stop or past it don't count. Null when none is on the way.
 */
function upstreamStopsAway(
  net: TransitNetwork,
  pattern: number,
  fromStopIndex: number,
  buses: readonly VehiclePosition[],
): number | null {
  if (buses.length === 0 || pattern < 0 || pattern >= net.patterns.count) return null;
  const start = net.patterns.stopStart[pattern];
  const len = net.patterns.stopLen[pattern];
  let pos = -1;
  // Positions stand in for stop ids, so a loop's repeated stop stays two stops.
  const rows: StopRow[] = [];
  for (let k = 0; k < len; k++) {
    const s = net.patterns.stops[start + k];
    if (pos < 0 && s === fromStopIndex) pos = k;
    rows.push({ stop_id: String(k), stop_name: '', stop_lat: net.stops.lat[s], stop_lon: net.stops.lon[s], wheelchair_boarding: null });
  }
  if (pos <= 0) return null;
  let best: number | null = null;
  for (const id of nearestStopIds(buses, rows)) {
    const k = Number(id);
    if (k < pos && (best == null || pos - k < best)) best = pos - k;
  }
  return best;
}

/**
 * Back to the stop, the route chip and where it's going, and the stop you'd
 * board at with how far it is from you.
 */
function Header({
  preview,
  distanceM,
  scheme,
  onBack,
}: {
  preview: RoutePreview;
  distanceM: number | null;
  scheme: 'light' | 'dark';
  onBack: () => void;
}) {
  const from = distanceM == null ? `From ${preview.fromStopName}` : `From ${preview.fromStopName} · ${distanceText(distanceM)}`;
  return (
    <View style={styles.header}>
      <Host matchContents>
        <Button
          onPress={onBack}
          modifiers={[
            buttonStyle('glass'),
            buttonBorderShape('circle'),
            controlSize('large'),
            tint(pick(hex.ink, scheme)),
            accessibilityLabel(`Back to ${preview.fromStopName}`),
          ]}
        >
          <SwiftImage systemName="chevron.left" size={17} />
        </Button>
      </Host>
      <View
        style={styles.titles}
        accessible
        accessibilityRole="header"
        accessibilityLabel={`Route ${preview.label} to ${preview.towards}. ${from}`}
      >
        <View style={styles.titleRow}>
          <RouteBadge code={preview.label} />
          <Text style={styles.title} numberOfLines={2}>
            to {preview.towards}
          </Text>
        </View>
        <Text style={styles.subtitle} numberOfLines={2}>
          {from}
        </Text>
      </View>
    </View>
  );
}

/**
 * The next bus at your stop in the trip view's hero style: thin minutes,
 * then "Scheduled · Arrives 7:41". A bus of this route on its way to your
 * stop adds the live dot and how far off it is; the number stays the
 * timetable's. After the last trip: "No more today · first 6:05 tomorrow".
 * One VoiceOver element.
 */
function Countdown({ preview, now, stopsAway }: { preview: RoutePreview; now: number; stopsAway: number | null }) {
  const lead = `Route ${preview.label} to ${preview.towards}`;
  if (preview.nextAt == null) {
    // After midnight the first bus is later today, not tomorrow.
    const first =
      preview.firstAt == null
        ? null
        : `${formatClockHHMM(preview.firstAt)}${isTomorrow(preview.firstAt, now) ? ' tomorrow' : ''}`;
    return (
      <View accessible accessibilityLabel={`${lead}, no more today${first ? `, first bus at ${first}` : ''}`}>
        <StatusLine source="scheduled" lead="No more today" rest={first ? [`first ${first}`] : []} />
      </View>
    );
  }

  const at = formatClockHHMM(preview.nextAt);
  const minutes = Math.max(0, Math.floor((preview.nextAt - now) / 60_000));
  const hero: HeroValue =
    minutes < 1
      ? { text: 'Due', unit: null, kind: 'word' }
      : minutes >= 60
        ? { text: at, unit: null, kind: 'clock' }
        : { text: String(minutes), unit: minutes === 1 ? 'min' : 'mins', kind: 'minutes' };
  const when =
    hero.kind === 'word'
      ? `due now, at ${at}`
      : hero.kind === 'clock'
        ? `at ${at}, in ${formatDuration(minutes)}`
        : `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}, arrives ${at}`;
  const live = stopsAway != null;
  const spoken = `${lead}, ${when}, scheduled${live ? `. A live bus is ${stopsAwayLabel(stopsAway)}` : ''}`;
  const arrives = hero.kind === 'clock' ? `In ${formatDuration(minutes)}` : `Arrives ${at}`;

  return (
    <View style={styles.hero} accessible accessibilityLabel={spoken}>
      <HeroNumber hero={hero} source="scheduled" mark={false} accessibilityLabel={spoken} />
      {live ? (
        <View style={styles.liveLine}>
          <SourceMark source="live" size={11} />
          <StatusLine source="live" lead="Live" rest={[stopsAwayLabel(stopsAway), `Scheduled ${at}`]} />
        </View>
      ) : (
        <StatusLine source="scheduled" lead="Scheduled" rest={[arrives]} />
      )}
    </View>
  );
}

/**
 * One of the two actions, side by side and equal width: filled ink for the
 * decision (Track this route), outlined for the errand (Walk there).
 */
function ActionButton({
  label,
  icon,
  filled,
  hint,
  scheme,
  stacked,
  onPress,
}: {
  label: string;
  icon: 'plus' | 'figure.walk';
  filled: boolean;
  hint: string;
  scheme: 'light' | 'dark';
  stacked: boolean;
  onPress: () => void;
}) {
  const ink = pick(hex.ink, scheme);
  return (
    <Host matchContents={{ vertical: true }} style={stacked ? styles.actionStacked : styles.action}>
      <Button
        onPress={onPress}
        modifiers={[
          buttonStyle(filled ? 'borderedProminent' : 'bordered'),
          buttonBorderShape('capsule'),
          controlSize('large'),
          tint(ink),
          accessibilityLabel(label),
          accessibilityHint(hint),
        ]}
      >
        <HStack
          spacing={6}
          modifiers={[
            frame({ maxWidth: Number.POSITIVE_INFINITY, minHeight: 26 }),
            foregroundStyle(filled ? pick(hex.paper, scheme) : ink),
          ]}
        >
          <SwiftImage systemName={icon} size={15} />
          <SwiftText modifiers={[font({ textStyle: 'body', weight: filled ? 'semibold' : 'regular' })]}>{label}</SwiftText>
        </HStack>
      </Button>
    </Host>
  );
}

/**
 * The stops from yours onward on a thin ink rail: a ring, the name and the
 * scheduled time, yours in bold. Long routes show the first few and the
 * last; "Show all N stops" opens the rest in place.
 */
function StopsOnward({ stops }: { stops: RoutePreviewStop[] }) {
  const reduceMotion = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  // Hiding one stop saves nothing: collapse only when two or more would go.
  const collapsible = stops.length > HEAD_STOPS + 2;
  const collapsed = collapsible && !expanded;
  const last = stops.length - 1;
  const fade = reduceMotion ? undefined : FadeIn.duration(motion.crossfade);

  return (
    <View>
      {stops.map((stop, i) => {
        if (collapsed && i >= HEAD_STOPS && i < last) {
          return i === HEAD_STOPS ? (
            <RowButton
              key="more"
              onPress={() => setExpanded(true)}
              style={styles.stopRow}
              accessibilityLabel={`Show all ${stops.length} stops`}
              accessibilityHint="Lists every stop from yours to the end of the route"
            >
              <Rail first={false} last={false} ring={null} />
              <Text style={styles.more}>Show all {stops.length} stops</Text>
              <SymbolView name="chevron.down" size={12} weight="semibold" tintColor={color.secondaryLabel} />
            </RowButton>
          ) : null;
        }
        const row = <StopLine stop={stop} first={i === 0} last={i === last} />;
        // Rows revealed by "Show all" fade in where they open.
        return collapsible && expanded && i >= HEAD_STOPS && i < last ? (
          <Animated.View key={`${stop.index}-${i}`} entering={fade}>
            {row}
          </Animated.View>
        ) : (
          <Fragment key={`${stop.index}-${i}`}>{row}</Fragment>
        );
      })}
    </View>
  );
}

function StopLine({ stop, first, last }: { stop: RoutePreviewStop; first: boolean; last: boolean }) {
  return (
    <View
      style={styles.stopRow}
      accessible
      accessibilityLabel={`${stop.yours ? 'Your stop, ' : ''}${stop.name}${stop.time ? `, ${stop.time}, scheduled` : ''}`}
    >
      <Rail first={first} last={last} ring={stop.yours ? 'yours' : 'stop'} />
      <Text style={[styles.stopName, stop.yours && styles.bold]} numberOfLines={2}>
        {stop.name}
      </Text>
      {stop.time ? <Text style={[styles.stopTime, stop.yours && styles.bold]}>{stop.time}</Text> : null}
    </View>
  );
}

/**
 * The rail's piece for one row: the line above and below (none above the
 * first, none below the last) and the ring. It stretches with the row, so a
 * name wrapped at a large text size never breaks the line.
 */
function Rail({ first, last, ring }: { first: boolean; last: boolean; ring: 'yours' | 'stop' | null }) {
  return (
    <View style={styles.rail}>
      <View style={[styles.line, first && styles.hidden]} />
      {ring ? <View style={ring === 'yours' ? styles.ringYours : styles.ring} /> : <View style={styles.gap} />}
      <View style={[styles.line, last && styles.hidden]} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: MARGIN,
    minHeight: 44,
  },
  titles: {
    flex: 1,
    gap: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  title: {
    ...type.body,
    fontWeight: '500',
    color: color.label,
    flexShrink: 1,
  },
  subtitle: {
    ...type.footnote,
    color: color.secondaryLabel,
  },
  countdown: {
    paddingHorizontal: MARGIN,
    paddingTop: space.xs,
    paddingBottom: space.xs,
  },
  hero: {
    gap: 2,
  },
  liveLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  body: {
    paddingHorizontal: MARGIN,
  },
  actions: {
    flexDirection: 'row',
    gap: space.sm,
    minHeight: 48,
    alignItems: 'center',
  },
  action: {
    flex: 1,
  },
  actionsStacked: {
    gap: space.sm,
  },
  actionStacked: {
    alignSelf: 'stretch',
  },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 40,
  },
  rail: {
    width: RAIL,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  line: {
    flex: 1,
    width: 2,
    backgroundColor: color.label,
  },
  hidden: {
    opacity: 0,
  },
  ring: {
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: 1.5,
    borderColor: color.label,
    backgroundColor: color.paper,
  },
  ringYours: {
    width: RING_YOURS,
    height: RING_YOURS,
    borderRadius: RING_YOURS / 2,
    borderWidth: 4,
    borderColor: color.label,
    backgroundColor: color.paper,
  },
  gap: {
    height: RING,
  },
  stopName: {
    ...type.status,
    flex: 1,
    color: color.label,
    paddingVertical: space.xxs,
  },
  stopTime: {
    ...type.status,
    color: color.secondaryLabel,
    fontVariant: ['tabular-nums'],
  },
  bold: {
    fontWeight: '600',
    color: color.label,
  },
  more: {
    ...type.status,
    flex: 1,
    color: color.label,
    paddingVertical: space.xxs,
  },
});
