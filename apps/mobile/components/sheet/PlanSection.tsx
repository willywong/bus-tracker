import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useRouter } from 'expo-router';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '@/components/sheet/EmptyState';
import { planRows, recentToPlace, type PlanRow } from '@/components/sheet/planModel';
import { formatClockHHMM } from '@/components/tracker/logic';
import { Hairline } from '@/components/trip/Rows';
import { RowButton } from '@/components/ui/RowButton';
import { useHomeWidgetLine } from '@/hooks/useHomeWidgetPlan';
import { useSettings } from '@/hooks/useSettings';
import type { RecentPlace } from '@/services/places/recents';
import { loadRecents } from '@/services/places/recentsStore';
import { toPlace, usePlanner } from '@/state/PlannerContext';
import { color, MARGIN, space, type } from '@/theme/design';
import { haptics } from '@/utils/haptics';

/** The leading circle; hairlines start at the title beside it. */
const CIRCLE = 34;
const ROW_INSET = CIRCLE + space.sm;

/**
 * The Plan section: Home and Work (with the last-planned "Leave 08:40" while
 * it's ahead), then recent destinations. Any row plans to it; a missing Home
 * or Work opens the search, whose Save menu sets it. Recents are read here,
 * never written: `plan` is their one writer, so they're re-read when it closes.
 * Every detent lists them all, cut by the sheet's edge.
 */
export function PlanSection({ scheme }: { scheme: 'light' | 'dark' }) {
  const settings = useSettings();
  const planner = usePlanner();
  const router = useRouter();
  const homeLine = useHomeWidgetLine();
  const recents = useRecents(planner.presented);

  // The leave time lapses on its own: re-check the rows when it does.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!homeLine) return;
    const wait = homeLine.leaveMs - Date.now();
    if (wait <= 0) return;
    const t = setTimeout(() => setTick((n) => n + 1), wait + 50);
    return () => clearTimeout(t);
  }, [homeLine]);

  const rows = useMemo(
    () => planRows(settings.savedPlaces, recents, homeLine, Date.now(), formatClockHHMM),
    // `tick` and the clock format change what the rows say, not their inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.savedPlaces, recents, homeLine, tick, settings.clockFormat],
  );

  if (rows.every((r) => r.kind === 'set')) {
    return (
      <View style={styles.body}>
        <EmptyState
          icon="magnifyingglass"
          title="Plan a trip"
          message="Search a place above. Your trips and saved places show up here."
          scheme={scheme}
          compact
        />
      </View>
    );
  }

  const open = (row: PlanRow) => {
    haptics.selection();
    // "Add Home" searches afresh; the results' Save menu sets it.
    planner.setTo(
      row.kind === 'saved' ? toPlace(row.place) : row.kind === 'recent' ? recentToPlace(row.recent) : null,
    );
    router.push('/plan');
  };

  return (
    <View style={styles.body}>
      {rows.map((row, i) => (
        <Fragment key={row.id}>
          {i > 0 ? <Hairline inset={ROW_INSET} /> : null}
          <PlanRowView row={row} onPress={() => open(row)} />
        </Fragment>
      ))}
    </View>
  );
}

/** Recents as `plan` last saved them: read on mount and each time a planner sheet closes. */
function useRecents(presented: boolean): RecentPlace[] {
  const [recents, setRecents] = useState<RecentPlace[]>([]);
  const wasPresented = useRef(presented);
  const [loads, setLoads] = useState(0);
  useEffect(() => {
    if (wasPresented.current && !presented) setLoads((n) => n + 1);
    wasPresented.current = presented;
  }, [presented]);
  useEffect(() => {
    let live = true;
    void loadRecents().then((list) => {
      if (live) setRecents(list);
    });
    return () => {
      live = false;
    };
  }, [loads]);
  return recents;
}

function symbolOf(row: PlanRow): SFSymbol {
  if (row.kind === 'recent') return 'clock';
  const kind = row.kind === 'saved' ? row.place.kind : row.id === 'set-home' ? 'home' : 'work';
  return kind === 'home' ? 'house.fill' : kind === 'work' ? 'briefcase.fill' : 'mappin';
}

/** One Plan row, at `SuggestionRow`'s metrics: a 34pt circle, the title, one secondary line. */
function PlanRowView({ row, onPress }: { row: PlanRow; onPress: () => void }) {
  const detail = row.kind === 'set' ? null : row.detail;
  return (
    <RowButton
      onPress={onPress}
      style={styles.row}
      // "Home, Leave 08:40, 24 mins": the dot is for the eye.
      accessibilityLabel={detail ? `${row.title}, ${detail.replace(' · ', ', ')}` : row.title}
      accessibilityHint={row.kind === 'set' ? 'Search for a place to save' : 'Plans a trip here'}
    >
      <View style={styles.circle}>
        <SymbolView
          name={symbolOf(row)}
          size={15}
          weight="regular"
          tintColor={row.kind === 'set' ? color.secondaryLabel : color.label}
          resizeMode="scaleAspectFit"
        />
      </View>
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>
          {row.title}
        </Text>
        {detail ? (
          <Text style={styles.detail} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
    </RowButton>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: MARGIN,
  },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.xs,
  },
  circle: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.fill,
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    ...type.body,
    color: color.label,
  },
  detail: {
    ...type.footnote,
    color: color.secondaryLabel,
    fontVariant: ['tabular-nums'],
  },
});
