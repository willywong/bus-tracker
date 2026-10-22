import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GoButton } from '@/components/itinerary/GoButton';
import { detailNotes, headerSubtitle, railRouteIds, timelineRows } from '@/components/itinerary/model';
import { Timeline } from '@/components/itinerary/Timeline';
import { ResultRow } from '@/components/plan/ResultRow';
import { feedNotes, LIVE_PAUSED_NOTE, RESULTS_FOOTER, routeInfoOf } from '@/components/plan/results';
import type { RailFocus } from '@/components/rail/railFocus';
import { formatClockHHMM } from '@/components/tracker/logic';
import { NoteRow } from '@/components/trip/Rows';
import { SheetBody } from '@/components/trip/SheetBody';
import { DetailHeader } from '@/components/trip/SheetHeader';
import { useRailFocus } from '@/hooks/useRailFocus';
import { useWalkPaths } from '@/hooks/useWalkPaths';
import { useOpenItinerary, usePlanner } from '@/state/PlannerContext';
import { color, MARGIN, PEEK_TOP, space, type } from '@/theme/design';
import { devNow } from '@/utils/devClock';
import { haptics } from '@/utils/haptics';

type DetentListener = (
  event: 'sheetDetentChange',
  cb: (e: { data: { index: number } }) => void,
) => () => void;

/** "Leave in N mins" in the peek row counts down on this beat. */
const NOW_TICK_MS = 15_000;

/**
 * One itinerary over its legs on the map (spec §6.3, 15/05). The peek is
 * its result row and a glass Go; from the half detent up, the timeline.
 * The map (`index.tsx`) draws the legs and fits them above this sheet;
 * tapping a leg here fits that leg, tapping a station opens it.
 *
 * Back returns to the results (`plan`), which show at once from
 * `planner.run`. Swiping down closes it and the trip sheet comes back. While
 * it's up the trip sheet behind stays pinned at peek, and the rail lines it
 * rides are focused on the map.
 */
export default function ItineraryScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const planner = usePlanner();
  const { setPresented, setOpenId, setItineraryDetent, focus, run } = planner;
  const it = useOpenItinerary();
  const net = run.network;
  const now = useNow(NOW_TICK_MS);
  const peek = planner.itineraryDetent === 0;

  useEffect(() => {
    setPresented(true);
    return () => {
      setPresented(false);
      setOpenId(null);
    };
  }, [setPresented, setOpenId]);

  // Opened without the results having set it (a reload): take the route's id.
  const { id: idParam } = useLocalSearchParams<{ id?: string }>();
  useEffect(() => {
    if (planner.openId == null && typeof idParam === 'string') setOpenId(idParam);
    // Mount only: afterwards the open id follows `run`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const addListener = (navigation as unknown as { addListener: DetentListener }).addListener;
    return addListener.call(navigation, 'sheetDetentChange', (e) => {
      setItineraryDetent(Math.max(0, Math.min(2, e.data.index)) as 0 | 1 | 2);
    });
  }, [navigation, setItineraryDetent]);

  // The rail lines this journey rides, at full strength; the rest at 15%.
  const railFocus = useMemo<RailFocus | null>(() => {
    if (!it || !net) return null;
    const routeIds = railRouteIds(it, net);
    return routeIds.length > 0 ? { stationId: null, routeIds, point: null } : null;
  }, [it, net]);
  useRailFocus(railFocus);

  useWalkPaths(it);

  const routes = useMemo(() => (net ? routeInfoOf(net) : null), [net]);
  const rows = useMemo(() => (it && net ? timelineRows(it, net, formatClockHHMM) : []), [it, net]);

  const back = useCallback(() => router.replace('/plan'), [router]);
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
  // 06 makes this `ride.startJourney(it)`; until then Go goes nowhere.
  const go = useCallback(() => {}, []);

  const scrollStyle = [styles.scroll, { paddingBottom: insets.bottom + space.xl }];

  if (!it || !routes) {
    return (
      <ScrollView contentContainerStyle={scrollStyle} showsVerticalScrollIndicator={false}>
        <DetailHeader title="Route" subtitle={null} peek={false} onBack={back} backLabel="Back to routes" />
        <View style={styles.missing}>
          <Text style={styles.missingText}>This route is no longer available. Go back to see the latest routes.</Text>
        </View>
      </ScrollView>
    );
  }

  const to = planner.to?.name ?? it.legs[it.legs.length - 1]?.to.name ?? '';
  const updated = run.updatedIds.has(it.id);
  const notes = feedNotes(run.excludedFeeds);
  const itNotes = detailNotes(it, formatClockHHMM);

  return (
    <ScrollView contentContainerStyle={scrollStyle} showsVerticalScrollIndicator={false}>
      <DetailHeader
        title={`To ${to}`}
        subtitle={headerSubtitle(it, formatClockHHMM)}
        peek={peek}
        onBack={back}
        backLabel="Back to routes"
        peekContent={
          <View>
            <ResultRow it={it} now={now} routes={routes} updated={updated} />
            <GoButton scheme={scheme} onPress={go} />
          </View>
        }
      />
      <SheetBody peek={peek}>
        <GoButton scheme={scheme} onPress={go} />
        {notes.length > 0 || run.liveSkipped || itNotes.length > 0 ? (
          <View>
            {notes.map((n) => (
              <NoteRow key={n} icon="exclamationmark.triangle" text={n} />
            ))}
            {run.liveSkipped ? <NoteRow icon="clock" text={LIVE_PAUSED_NOTE} /> : null}
            {itNotes.map((n) => (
              <Text key={n.text} style={[styles.note, n.urgent && styles.noteUrgent]}>
                {n.text}
              </Text>
            ))}
          </View>
        ) : null}
        <Timeline rows={rows} onLegPress={onLegPress} onStationPress={onStationPress} />
        <Text style={styles.footer}>{RESULTS_FOOTER}</Text>
      </SheetBody>
    </ScrollView>
  );
}

/** `devNow()`, refreshed every `everyMs` while mounted. */
function useNow(everyMs: number): number {
  const [now, setNow] = useState(devNow);
  useEffect(() => {
    const id = setInterval(() => setNow(devNow()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

const styles = StyleSheet.create({
  scroll: {
    paddingTop: PEEK_TOP,
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
  footer: {
    ...type.footnote,
    color: color.secondaryLabel,
  },
  missing: {
    paddingHorizontal: MARGIN,
    paddingTop: space.lg,
  },
  missingText: {
    ...type.status,
    color: color.secondaryLabel,
  },
});
