import type { Itinerary, Place } from '@bus-tracker/shared';
import { ContentUnavailableView, Host } from '@expo/ui/swift-ui';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';

import { Hairline, NoteRow } from '@/components/trip/Rows';
import { RowButton } from '@/components/ui/RowButton';
import { queryKey } from '@/services/planner/session';
import { usePlanner } from '@/state/PlannerContext';
import { color, EASE_OUT, motion, radius, space, type } from '@/theme/design';
import { devNow } from '@/utils/devClock';

import { PlaceBanner } from './PlaceBanner';
import { ResultRow } from './ResultRow';
import { feedNotes, LIVE_PAUSED_NOTE, RESULTS_FOOTER, routeInfoOf, type RouteInfo } from './results';
import { RouteLoader } from './RouteLoader';

/** "Leave in 4 mins" counts down on this beat. */
const NOW_TICK_MS = 15_000;
const STAGGER_MS = 40;
const ENTER_MS = 220;
const ENTER_SHIFT = 8;

/**
 * The newest results generation whose rows have played their entrance.
 * Module scope, so reopening the sheet on the same results doesn't replay
 * the stagger, and a retime (same generation) never does.
 */
let enteredGeneration = 0;

/**
 * The plan sheet's results state (spec §6.2), shown once a destination is
 * picked and the search bar isn't editing: the destination and its photo,
 * feed notes, the loader, up to five itinerary rows and the footer, or an
 * empty state. The rows come from `usePlanner().run` (`usePlannerEngine`).
 */
export function PlanResults({
  to,
  subtitle,
  onChooseStart,
}: {
  to: Place;
  subtitle: string | null;
  /** "Choose a starting point" when My location isn't available. */
  onChooseStart: () => void;
}) {
  const router = useRouter();
  const planner = usePlanner();
  const { run, setOpenId } = planner;
  const now = useNow(NOW_TICK_MS);
  const reduceMotion = useReducedMotion();

  // Rows and empty states only for this query: never a previous one's for a frame.
  const current = run.key === queryKey(planner.from, to, planner.when);
  const its = current ? run.itineraries : [];
  const done = current && run.status === 'done';
  const notes = done ? feedNotes(run.excludedFeeds) : [];
  const routes = useMemo<RouteInfo | null>(() => (run.network ? routeInfoOf(run.network) : null), [run.network]);

  const animateIn = done && run.generation > enteredGeneration;
  useEffect(() => {
    if (animateIn) enteredGeneration = run.generation;
  }, [animateIn, run.generation]);

  useEffect(() => {
    if (__DEV__ && done && run.firstResultMs != null) console.log(`[planner] firstResultMs ${run.firstResultMs}`);
  }, [done, run.firstResultMs]);

  const open = (it: Itinerary) => {
    setOpenId(it.id);
    router.replace({ pathname: '/itinerary', params: { id: it.id } });
  };

  const entering = (index: number) => {
    if (!animateIn) return undefined;
    if (reduceMotion) return FadeIn.duration(motion.crossfade);
    return FadeInDown.duration(ENTER_MS)
      .delay(index * STAGGER_MS)
      .easing(EASE_OUT)
      .withInitialValues({ opacity: 0, transform: [{ translateY: ENTER_SHIFT }] });
  };

  return (
    <>
      <View style={styles.header} accessible accessibilityLabel={[to.name, subtitle].filter(Boolean).join(', ')}>
        <Text style={styles.title} numberOfLines={2}>
          {to.name}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {to.kind !== 'here' ? <PlaceBanner lat={to.lat} lng={to.lng} name={to.name} /> : null}

      {notes.length > 0 || (done && run.liveSkipped) ? (
        <View style={styles.notes}>
          {notes.map((n) => (
            <NoteRow key={n} icon="exclamationmark.triangle" text={n} />
          ))}
          {done && run.liveSkipped ? <NoteRow icon="clock" text={LIVE_PAUSED_NOTE} /> : null}
        </View>
      ) : null}

      {run.showLoader ? <RouteLoader /> : null}

      {its.length > 0 && routes ? (
        <View style={styles.list}>
          {its.map((it, i) => (
            // Keyed by position within a generation: a retime (even one that
            // renames a row) updates in place, a new query mounts fresh rows.
            <Animated.View key={`${run.generation}:${i}`} entering={entering(i)}>
              {i > 0 ? <Hairline /> : null}
              <ResultRow it={it} now={now} routes={routes} updated={run.updatedIds.has(it.id)} onPress={() => open(it)} />
            </Animated.View>
          ))}
          <Text style={styles.footer}>{RESULTS_FOOTER}</Text>
        </View>
      ) : (
        <EmptyState status={current ? run.status : 'planning'} count={its.length} onChooseStart={onChooseStart} />
      )}
    </>
  );
}

function EmptyState({
  status,
  count,
  onChooseStart,
}: {
  status: ReturnType<typeof usePlanner>['run']['status'];
  count: number;
  onChooseStart: () => void;
}) {
  let content: { systemImage: 'tram.fill' | 'arrow.down.circle' | 'location.slash' | 'exclamationmark.triangle'; title: string; description: string } | null = null;
  if (status === 'done' && count === 0) {
    content = {
      systemImage: 'tram.fill',
      title: 'No routes found',
      description: 'Nothing runs within a 1 km walk of both ends at this time. Try a later time or a nearby station.',
    };
  } else if (status === 'no-network') {
    content = { systemImage: 'arrow.down.circle', title: "Routes need today's timetable", description: 'Connect once to download it.' };
  } else if (status === 'no-location') {
    content = {
      systemImage: 'location.slash',
      title: 'Where are you starting?',
      description: 'Your location isn’t available. Choose where the trip starts.',
    };
  } else if (status === 'error') {
    content = {
      systemImage: 'exclamationmark.triangle',
      title: 'Couldn’t plan this trip',
      description: 'Try a different time or place.',
    };
  }
  if (!content) return null;
  return (
    <View>
      <Host style={styles.empty}>
        <ContentUnavailableView systemImage={content.systemImage} title={content.title} description={content.description} />
      </Host>
      {status === 'no-location' ? (
        <View style={styles.emptyAction}>
          <RowButton onPress={onChooseStart} style={styles.button} accessibilityLabel="Choose a starting point">
            <Text style={styles.buttonText}>Choose a starting point</Text>
          </RowButton>
        </View>
      ) : null}
    </View>
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
  header: {
    paddingTop: space.md,
    gap: space.xxs,
  },
  title: {
    ...type.title,
    fontWeight: '500',
    color: color.label,
  },
  subtitle: {
    ...type.status,
    color: color.secondaryLabel,
  },
  notes: {
    marginTop: space.sm,
  },
  list: {
    marginTop: space.sm,
  },
  footer: {
    ...type.footnote,
    color: color.secondaryLabel,
    marginTop: space.md,
  },
  empty: {
    height: 260,
    marginTop: space.md,
  },
  emptyAction: {
    alignItems: 'center',
  },
  button: {
    minHeight: 44,
    paddingHorizontal: space.lg,
    borderRadius: radius.group,
    borderCurve: 'continuous',
    backgroundColor: color.ink,
    justifyContent: 'center',
  },
  buttonText: {
    ...type.headline,
    color: color.onAccent,
  },
});
