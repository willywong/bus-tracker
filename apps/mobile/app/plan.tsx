import { ContentUnavailableView, Host } from '@expo/ui/swift-ui';
import * as Location from 'expo-location';
import { Stack, useNavigation, useRouter } from 'expo-router';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { SearchBarCommands } from 'react-native-screens';

import { FromWhen } from '@/components/plan/FromWhen';
import {
  localRow,
  placeFromLocal,
  placeFromResolved,
  searchSections,
  type PickTarget,
  type SearchView,
} from '@/components/plan/model';
import { PlanResults } from '@/components/plan/PlanResults';
import {
  localIndexFor,
  lookupLocal,
  searchLocal,
  searchRoutes,
  type LocalHit,
  type RouteHit,
} from '@/components/plan/searchIndex';
import { NoteRow, SuggestionRow, SUGGESTION_INSET, THUMB_INSET } from '@/components/plan/SuggestionRow';
import { useNear } from '@/components/plan/useNear';
import { Hairline, SectionLabel } from '@/components/trip/Rows';
import { usePlaceSearch } from '@/hooks/usePlaceSearch';
import { useOpenRoutePreview } from '@/hooks/useOpenRoutePreview';
import { useSettings } from '@/hooks/useSettings';
import { useTransitNetwork } from '@/hooks/useTransitNetwork';
import { mapsErrorCode, resolve, type ResolvedPlace } from '@/modules/transit-maps';
import { mergeRecent, type RecentPlace } from '@/services/places/recents';
import { loadRecents, saveRecents } from '@/services/places/recentsStore';
import { HERE, usePlanner, type Place } from '@/state/PlannerContext';
import { MARGIN, space } from '@/theme/design';
import { haptics } from '@/utils/haptics';

/** What the search bar is choosing; null shows the results state. */
type Editing = 'to' | 'from' | null;

type TransitionListener = (
  event: 'transitionEnd',
  cb: (e: { data: { closing: boolean } }) => void,
) => () => void;

/** Focus anyway if the sheet's `transitionEnd` hasn't come by then. */
const FOCUS_FALLBACK_MS = 700;

const sameSpot = (a: Place, b: Place) =>
  (a.ref != null && a.ref === b.ref) || (a.lat.toFixed(4) === b.lat.toFixed(4) && a.lng.toFixed(4) === b.lng.toFixed(4));

/** A journey end without the display-only fields recents carry. */
const journeyEnd = (p: Place): Place => ({
  kind: p.kind,
  name: p.name,
  lat: p.lat,
  lng: p.lng,
  ...(p.ref != null ? { ref: p.ref } : {}),
});

/**
 * "Where to?" (spec §6.2): search, then results. The native header search
 * bar picks the destination (or, after a tap on From, the start); local
 * stations and stops show at once and offline, Apple places follow. Once a
 * destination is picked the sheet shows the results state (15/04). While
 * it's up the trip sheet behind stays pinned at peek.
 */
export default function PlanScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const planner = usePlanner();
  const { setPresented } = planner;
  const settings = useSettings();
  const { network } = useTransitNetwork();
  const [permission, requestPermission] = Location.useForegroundPermissions();
  const locationOff = permission != null && !permission.granted;
  const gps = useNear(permission?.granted ?? false);

  const searchRef = useRef<SearchBarCommands>(null);
  const [query, setQuery] = useState('');
  const [editing, setEditingState] = useState<Editing>(() => (planner.to == null ? 'to' : null));
  // Mirrors for native callbacks, which can fire between renders.
  const editingRef = useRef<Editing>(editing);
  const setEditing = useCallback((e: Editing) => {
    editingRef.current = e;
    setEditingState(e);
  }, []);
  const toRef = useRef(planner.to);
  toRef.current = planner.to;
  /** The destination cleared by tapping the search bar, restored on Cancel. */
  const restoreTo = useRef<Place | null>(null);
  const [recents, setRecents] = useState<RecentPlace[]>([]);

  useEffect(() => {
    setPresented(true);
    return () => setPresented(false);
  }, [setPresented]);

  useEffect(() => {
    let cancelled = false;
    void loadRecents().then((r) => {
      if (!cancelled) setRecents(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Ranking and distances measure from the start: GPS for My location.
  const from = planner.from;
  const near = useMemo(
    () => (editing !== 'from' && from.kind !== 'here' ? { lat: from.lat, lng: from.lng } : gps),
    [editing, from, gps],
  );

  // Built once per network blob and cached; ~6.5k stops, < 30 ms. Usually
  // already warm: `_layout`'s LocalIndexWarmer builds it in idle time.
  const ix = useMemo(() => (network ? localIndexFor(network) : null), [network]);
  const searching = editing != null;
  const localHits = useMemo(
    () => (ix && searching ? searchLocal(ix, query, near) : null),
    [ix, query, near, searching],
  );
  // A route code ("T816") is something to look at, not somewhere to go:
  // offered for the destination only.
  const routeHits = useMemo(
    () => (network && editing === 'to' ? searchRoutes(network, query, near) : []),
    [network, query, near, editing],
  );
  const places = usePlaceSearch(searching ? query : '', near);

  // Opened without a destination: the keyboard comes up for it. The bar's
  // `autoFocus` is Android-only in react-native-screens, so on iOS it's
  // focused once the sheet has presented (focus mid-presentation is lost).
  // With a destination (a shortcut) the sheet goes straight to the results.
  useEffect(() => {
    if (toRef.current != null) return;
    let done = false;
    let tries = 0;
    let frame = 0;
    // Runs on the fallback and again on `transitionEnd`: a focus lost to a
    // slow presentation is retried, and a second one is a no-op.
    const focus = () => {
      // Already picked something (a saved row) or tapped From: leave it.
      if (done || editingRef.current !== 'to' || toRef.current != null) return;
      if (searchRef.current) searchRef.current.focus();
      else if (tries++ < 30) frame = requestAnimationFrame(focus);
    };
    const addListener = (navigation as unknown as { addListener: TransitionListener }).addListener;
    const unsubscribe = addListener.call(navigation, 'transitionEnd', (e) => {
      if (!e.data.closing) focus();
    });
    const timer = setTimeout(focus, FOCUS_FALLBACK_MS);
    return () => {
      done = true;
      unsubscribe();
      clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
    // Mount only: the first presentation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // With a destination and nothing being edited, the bar shows its name.
  useEffect(() => {
    const to = planner.to;
    if (editing != null || !to) return;
    let tries = 0;
    let frame = 0;
    // The header's search bar mounts a frame or two after the screen.
    const apply = () => {
      if (searchRef.current) searchRef.current.setText(to.name);
      else if (tries++ < 30) frame = requestAnimationFrame(apply);
    };
    apply();
    return () => cancelAnimationFrame(frame);
  }, [editing, planner.to]);

  const recentsWithLocal = useMemo(
    () =>
      recents.map((recent) => ({
        recent,
        local:
          ix && recent.ref != null && (recent.kind === 'station' || recent.kind === 'stop')
            ? lookupLocal(ix, recent.kind, recent.ref)
            : null,
      })),
    [recents, ix],
  );

  const view: SearchView = searchSections({
    query,
    local: ix ? (localHits ?? []) : null,
    routes: routeHits,
    places: places.places,
    placesOffline: places.offline,
    placesLoading: places.loading,
    recents: recentsWithLocal,
    saved: settings.savedPlaces,
    offerHere: editing === 'from' && from.kind !== 'here',
  });

  const commit = (picked: Place & { address?: string }) => {
    haptics.selection();
    restoreTo.current = null;
    const end = journeyEnd(picked);
    if (end.kind !== 'here') {
      const next = mergeRecent(recents, picked, Date.now());
      setRecents(next);
      void saveRecents(next);
    }
    setQuery('');
    if (editingRef.current === 'from') {
      planner.setFrom(end);
      const to = toRef.current;
      if (to) {
        setEditing(null);
        searchRef.current?.setText(to.name);
        searchRef.current?.blur();
      } else {
        // Still no destination: the bar goes back to choosing one.
        setEditing('to');
        searchRef.current?.setText('');
      }
      return;
    }
    planner.setTo(end);
    setEditing(null);
    searchRef.current?.setText(end.name);
    searchRef.current?.blur();
  };

  // The route's preview from its nearest stop, in Nearby; back returns to the list.
  const openRoutePreview = useOpenRoutePreview();
  const openRoute = (hit: RouteHit) =>
    openRoutePreview({ route: hit.route, pattern: hit.pattern, fromStopIndex: hit.fromStopIndex });

  const pick = async (target: PickTarget) => {
    switch (target.kind) {
      case 'route':
        return openRoute(target.hit);
      case 'here':
        return commit(HERE);
      case 'local':
        return commit(placeFromLocal(target.hit));
      case 'ready':
        return commit(target.place);
      case 'place': {
        let resolved: ResolvedPlace | undefined = target.hit.resolved;
        if (!resolved) {
          try {
            resolved = await resolve(target.hit.id);
          } catch (e) {
            // Offline: keep the sheet, and the Places section says why.
            if (mapsErrorCode(e) === 'ERR_OFFLINE') places.reportOffline();
            else haptics.error();
            return;
          }
        }
        return commit(placeFromResolved(resolved, target.hit.subtitle || null));
      }
    }
  };

  const pickFirst = () => {
    if (view.kind !== 'sections') return;
    for (const s of view.sections) {
      if (s.key === 'here') continue;
      const first = s.items.find((i) => i.kind === 'row');
      if (first?.kind === 'row') return void pick(first.target);
    }
  };

  // Tapping the bar from the results state searches again (spec step 11).
  const onFocus = () => {
    if (editingRef.current != null) return;
    restoreTo.current = toRef.current;
    planner.setTo(null);
    setEditing('to');
    setQuery('');
    searchRef.current?.setText('');
  };

  const onCancel = () => {
    const restore = restoreTo.current;
    restoreTo.current = null;
    if (restore) planner.setTo(restore);
    const to = restore ?? toRef.current;
    setQuery('');
    if (to) {
      setEditing(null);
      // Cancel clears the field itself after this callback.
      requestAnimationFrame(() => searchRef.current?.setText(to.name));
    } else {
      setEditing('to');
    }
  };

  const onFromPress = async () => {
    if (editingRef.current === 'from') {
      // A second tap stops choosing a start.
      const to = toRef.current;
      setEditing(to ? null : 'to');
      setQuery('');
      searchRef.current?.setText(to?.name ?? '');
      if (to) searchRef.current?.blur();
      return;
    }
    // Ask for location in context, only when My location needs it.
    if (from.kind === 'here' && permission && !permission.granted && permission.canAskAgain) {
      const res = await requestPermission();
      if (res.granted) return;
    }
    setEditing('from');
    setQuery('');
    searchRef.current?.setText('');
    searchRef.current?.focus();
  };

  // No location for My location: the search bar picks the start (15/04).
  const onChooseStart = () => {
    setEditing('from');
    setQuery('');
    searchRef.current?.setText('');
    searchRef.current?.focus();
  };

  const to = planner.to;
  const showResults = to != null && editing == null;

  return (
    <>
      <Stack.SearchBar
        ref={searchRef}
        placeholder={editing === 'from' ? 'Search for a starting point' : 'Search places, stations, stops'}
        placement="stacked"
        // Android only; iOS focuses after presenting (above).
        autoFocus={planner.to == null}
        hideWhenScrolling={false}
        autoCapitalize="none"
        onChangeText={(e) => {
          // Programmatic text (a picked name) isn't a query.
          if (editingRef.current != null) setQuery(e.nativeEvent.text);
        }}
        onSearchButtonPress={pickFirst}
        onFocus={onFocus}
        onCancelButtonPress={onCancel}
      />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="xmark" accessibilityLabel="Close" onPress={() => router.back()} />
      </Stack.Toolbar>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.content}
      >
        <FromWhen
          from={from}
          canSwap={to != null}
          editingFrom={editing === 'from'}
          locationOff={locationOff}
          when={planner.when}
          onFromPress={() => void onFromPress()}
          onSwap={planner.swap}
          onWhen={planner.setWhen}
        />
        {showResults ? (
          <PlanResults
            to={to}
            subtitle={destinationDetail(to, ix, recents, settings.savedPlaces)}
            onChooseStart={onChooseStart}
          />
        ) : (
          <SearchBody view={view} onPick={(t) => void pick(t)} />
        )}
      </ScrollView>
    </>
  );
}

/** The line under the destination: lines or routes for local ends, else its address. */
function destinationDetail(
  to: Place,
  ix: ReturnType<typeof localIndexFor> | null,
  recents: readonly RecentPlace[],
  saved: ReturnType<typeof useSettings>['savedPlaces'],
): string | null {
  if (to.kind === 'here') return null;
  if (ix && to.ref != null && (to.kind === 'station' || to.kind === 'stop')) {
    const hit: LocalHit | null = lookupLocal(ix, to.kind, to.ref);
    if (hit) return localRow(hit).subtitle;
  }
  return (
    recents.find((r) => sameSpot(r, to))?.address ??
    saved.find((p) => sameSpot({ ...p, kind: 'place', ref: p.ref?.id }, to))?.address ??
    null
  );
}

function SearchBody({ view, onPick }: { view: SearchView; onPick: (t: PickTarget) => void }) {
  if (view.kind === 'no-results') {
    return (
      <Host style={styles.empty}>
        <ContentUnavailableView
          systemImage="magnifyingglass"
          title={`No results for “${view.query}”`}
          description="Try a station, a stop or a place name."
        />
      </Host>
    );
  }
  return (
    <>
      {view.sections.map((section) => (
        <View key={section.key} style={styles.section}>
          {section.title ? <SectionLabel>{section.title}</SectionLabel> : null}
          {section.items.map((item, i) => (
            <Fragment key={item.kind === 'row' ? item.row.key : `note-${i}`}>
              {i > 0 ? <Hairline inset={item.kind === 'row' && item.row.thumb ? THUMB_INSET : SUGGESTION_INSET} /> : null}
              {item.kind === 'row' ? (
                <SuggestionRow row={item.row} onPress={() => onPick(item.target)} />
              ) : (
                <NoteRow symbol={item.symbol} text={item.text} />
              )}
            </Fragment>
          ))}
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: space.xs,
    paddingHorizontal: MARGIN,
    paddingBottom: space.xxl,
  },
  section: {
    marginTop: space.lg,
  },
  empty: {
    height: 280,
    marginTop: space.lg,
  },
});
