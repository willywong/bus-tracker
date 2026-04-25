import type { GtfsStop, RouteSearchHit, T816Bundle } from '@bus-tracker/shared';
import {
  orderStopsByTrip,
  pickRepresentativeTrip,
} from '@bus-tracker/shared';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  PlatformColor,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItemInfo,
} from 'react-native';

import { formatStopName } from '@/components/map/format';
import { surfaceColor } from '@/components/tracker/tokens';
import { MAX_FAVORITES, useSettings } from '@/hooks/useSettings';
import { useRouteSearch } from '@/hooks/useRouteSearch';
import { fetchRouteBundle } from '@/services/routeBundle';

type Step =
  | { kind: 'search' }
  | {
      kind: 'pickStops';
      queue: RouteSearchHit[];
      index: number;
      picks: Record<string, string>;
    };

/**
 * Derive the human-readable title + subtitle for a route. Shared by the
 * search-step row and the stop-picker header so the description is consistent
 * across the whole flow. See the subtitle cascade for fallback details.
 */
function describeRoute(hit: RouteSearchHit): {
  title: string;
  subtitle: string | null;
} {
  const origin = hit.origin ? formatStopName(hit.origin) : null;
  const destination = hit.destination ? formatStopName(hit.destination) : null;
  const midpoint = hit.midpoint ? formatStopName(hit.midpoint) : null;

  const longNameCleaned = (() => {
    if (!hit.long_name) return '';
    const trimmed = hit.long_name.trim();
    if (!trimmed || trimmed.toUpperCase() === hit.code.trim().toUpperCase()) {
      return '';
    }
    const stripped = trimmed
      .replace(new RegExp(`^${hit.code}\\s*[-–—]\\s*`, 'i'), '')
      .replace(/^Loop via\s*/i, '')
      .trim();
    return stripped ? formatStopName(stripped) : '';
  })();

  const loopVia = (() => {
    if (!hit.long_name) return null;
    const match = hit.long_name.trim().match(/^Loop via\s+(.+)$/i);
    return match?.[1] ? formatStopName(match[1].trim()) : null;
  })();

  const title = origin || longNameCleaned || hit.code;

  const subtitle = (() => {
    if (origin && destination && origin !== destination) {
      return `to ${destination}`;
    }
    if (midpoint) return `via ${midpoint}`;
    if (loopVia) return `via ${loopVia}`;
    if (!origin && longNameCleaned) return longNameCleaned;
    const matchedStop = hit.matchedStops?.[0]?.stop_name
      ? formatStopName(hit.matchedStops[0].stop_name)
      : null;
    if (matchedStop && matchedStop !== title) return `Stops at ${matchedStop}`;
    return null;
  })();

  return { title, subtitle };
}

/**
 * Add Bus flow rendered as a native iOS form-sheet. The sheet itself
 * (presentation, detents, grabber) is configured at the route level in
 * `app/(tracker)/_layout.tsx`. Multi-select routes, then chain through the
 * stop picker once per newly-added route before committing.
 */
export function AddBusSheet() {
  const router = useRouter();
  const onDismiss = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tracker)');
  }, [router]);
  return <AddBusSheetBody onDismiss={onDismiss} />;
}

function AddBusSheetBody({ onDismiss }: { onDismiss: () => void }) {
  const settings = useSettings();
  const [step, setStep] = useState<Step>({ kind: 'search' });
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Map<string, RouteSearchHit>>(
    () => new Map(),
  );
  // Track keyboard height so the list's bottom content inset grows to cover
  // it — without this, the final rows scroll behind the keyboard and are
  // unreachable while the search input is focused.
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      setKbHeight(e.endCoordinates.height);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      setKbHeight(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const search = useRouteSearch(query);

  const alreadyFavorited = useMemo(
    () => new Set(settings.favoritedRoutes),
    [settings.favoritedRoutes],
  );

  const toggleSelect = (hit: RouteSearchHit) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(hit.code)) next.delete(hit.code);
      else next.set(hit.code, hit);
      return next;
    });
  };

  const removeSelected = (code: string) => {
    setSelected((prev) => {
      if (!prev.has(code)) return prev;
      const next = new Map(prev);
      next.delete(code);
      return next;
    });
  };

  const handleDone = () => {
    if (selected.size === 0) return;
    Keyboard.dismiss();
    const spaceLeft = MAX_FAVORITES - alreadyFavorited.size;
    if (selected.size > spaceLeft) {
      Alert.alert(
        'Favorite limit reached',
        spaceLeft > 0
          ? `You can add up to ${spaceLeft} more favourite${spaceLeft === 1 ? '' : 's'} before reaching ${MAX_FAVORITES}.`
          : `You've reached ${MAX_FAVORITES} favourite buses. Remove one in Settings to add a new bus.`,
      );
      return;
    }
    setStep({
      kind: 'pickStops',
      queue: Array.from(selected.values()),
      index: 0,
      picks: {},
    });
  };

  const handlePickStop = (stop: GtfsStop) => {
    if (step.kind !== 'pickStops') return;
    const current = step.queue[step.index];
    if (!current) return;
    const nextPicks = { ...step.picks, [current.code]: stop.stop_id };
    const nextIndex = step.index + 1;

    if (nextIndex >= step.queue.length) {
      let preferredSet = false;
      for (const hit of step.queue) {
        const stopId = nextPicks[hit.code];
        if (!stopId) continue;
        const result = settings.addFavorite(hit.code, stopId);
        if (!result.ok && result.reason === 'cap-reached') {
          Alert.alert(
            'Favorite limit reached',
            `You've reached ${MAX_FAVORITES} favourite buses. Remove one in Settings to add a new bus.`,
          );
          break;
        }
        if (!preferredSet) {
          settings.setPreferredRouteCode(hit.code);
          preferredSet = true;
        }
      }
      onDismiss();
      return;
    }

    setStep({
      kind: 'pickStops',
      queue: step.queue,
      index: nextIndex,
      picks: nextPicks,
    });
  };

  const handleBackToSearch = () => {
    setStep({ kind: 'search' });
  };

  if (step.kind === 'pickStops') {
    const current = step.queue[step.index];
    if (!current) return null;
    return (
      <View style={styles.root}>
        <View style={styles.chrome}>
          <PickerHeader
            progress={{ index: step.index, total: step.queue.length }}
            onBack={handleBackToSearch}
            onDismiss={onDismiss}
          />
        </View>
        <View style={styles.listWrap}>
          <StopPickerStep route={current} onPickStop={handlePickStop} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.chrome}>
        <SearchHeader
          routeCount={search.results.length}
          selectedCount={selected.size}
          onDone={handleDone}
        />
        <SearchBar value={query} onChange={setQuery} />
        {selected.size > 0 ? (
          <SelectedChipStrip
            selected={Array.from(selected.values())}
            onRemove={removeSelected}
          />
        ) : null}
        <View style={styles.listDivider} />
      </View>
      <View style={styles.listWrap}>
        {search.results.length === 0 ? (
          <View style={styles.hintFill}>
            <EmptyHint
              query={query.trim()}
              loading={search.loading}
              error={search.error}
            />
          </View>
        ) : (
          <FlatList<RouteSearchHit>
            style={styles.flex}
            data={search.results}
            keyExtractor={(item) => item.code}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={[
              styles.listContent,
              { paddingBottom: LIST_BOTTOM_PAD + kbHeight },
            ]}
            renderItem={({ item }: ListRenderItemInfo<RouteSearchHit>) => (
              <RouteRow
                hit={item}
                selected={selected.has(item.code)}
                alreadyAdded={alreadyFavorited.has(item.code)}
                onToggle={() => toggleSelect(item)}
              />
            )}
          />
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Search-step header (title + "N routes · M selected" + Done)
// ---------------------------------------------------------------------------

function SearchHeader({
  routeCount,
  selectedCount,
  onDone,
}: {
  routeCount: number;
  selectedCount: number;
  onDone: () => void;
}) {
  const doneActive = selectedCount > 0;
  return (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        <Text style={styles.headerTitle}>Add Bus</Text>
        <Text style={styles.headerSubtitle}>
          {`${routeCount} route${routeCount === 1 ? '' : 's'} · ${selectedCount} selected`}
        </Text>
      </View>
      <Pressable
        onPress={onDone}
        disabled={!doneActive}
        accessibilityRole="button"
        accessibilityState={{ disabled: !doneActive }}
        accessibilityLabel={
          doneActive
            ? `Done, add ${selectedCount} bus${selectedCount === 1 ? '' : 'es'}`
            : 'Done, no buses selected'
        }
        style={({ pressed }) => [
          styles.doneButton,
          doneActive ? styles.doneButtonActive : styles.doneButtonMuted,
          pressed && doneActive ? styles.doneButtonPressed : null,
        ]}
      >
        <Text
          style={[
            styles.doneLabel,
            doneActive ? styles.doneLabelActive : styles.doneLabelMuted,
          ]}
        >
          Done
        </Text>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Search bar
// ---------------------------------------------------------------------------

function SearchBar({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const inputRef = useRef<TextInput | null>(null);
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 180);
    return () => clearTimeout(t);
  }, []);

  return (
    <View style={styles.searchBar}>
      <SymbolView
        name="magnifyingglass"
        size={15}
        tintColor={COLOR_LABEL_TERTIARY_P}
      />
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChange}
        placeholder="Route code or stop name"
        placeholderTextColor={COLOR_LABEL_TERTIARY_P}
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="characters"
        accessibilityLabel="Search routes"
        style={styles.searchInput}
      />
      {value.length > 0 ? (
        <Pressable
          onPress={() => onChange('')}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
        >
          <SymbolView
            name="xmark.circle.fill"
            size={16}
            tintColor={COLOR_LABEL_TERTIARY_P}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Selected-routes chip strip
// ---------------------------------------------------------------------------

function SelectedChipStrip({
  selected,
  onRemove,
}: {
  selected: RouteSearchHit[];
  onRemove: (code: string) => void;
}) {
  return (
    <View style={styles.chipStrip}>
      {selected.map((hit) => (
        <View key={hit.code} style={styles.chip}>
          <SymbolView name="bus.fill" size={10} tintColor={COLOR_ACCENT} />
          <Text style={styles.chipLabel}>{hit.code}</Text>
          <Pressable
            onPress={() => onRemove(hit.code)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${hit.code}`}
            style={({ pressed }) => [
              styles.chipRemove,
              pressed && { opacity: 0.55 },
            ]}
          >
            <SymbolView name="xmark" size={9} tintColor={COLOR_ACCENT} />
          </Pressable>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Route row + inset separator
// ---------------------------------------------------------------------------

function RouteRow({
  hit,
  selected,
  alreadyAdded,
  onToggle,
}: {
  hit: RouteSearchHit;
  selected: boolean;
  alreadyAdded: boolean;
  onToggle: () => void;
}) {
  const { title: name, subtitle } = describeRoute(hit);
  const disabled = alreadyAdded && !selected;

  return (
    <Pressable
      onPress={disabled ? undefined : onToggle}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={`${hit.code}, ${name}${subtitle ? `, ${subtitle}` : ''}${alreadyAdded ? ', already added' : ''}`}
      style={({ pressed }) => [
        styles.card,
        selected && styles.cardSelected,
        disabled && styles.cardDisabled,
        pressed && !disabled && styles.cardPressed,
      ]}
    >
      <View style={styles.cardInner}>
        <View
          style={[
            styles.badge,
            selected ? styles.badgeSelected : styles.badgeIdle,
          ]}
        >
          <SymbolView
            name="bus.fill"
            size={11}
            tintColor={selected ? '#FFFFFF' : COLOR_LABEL_TERTIARY_P}
          />
          <Text style={styles.badgeCode} numberOfLines={1}>
            {hit.code}
          </Text>
        </View>

        <View style={styles.rowText}>
          <Text
            style={[
              styles.rowName,
              selected && styles.rowNameSelected,
              disabled && styles.rowNameDisabled,
            ]}
            numberOfLines={1}
          >
            {name}
          </Text>
          {subtitle ? (
            <Text style={styles.rowSubtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>

        {alreadyAdded && !selected ? (
          <View style={styles.addedLabel}>
            <Text style={styles.addedLabelText}>Added</Text>
          </View>
        ) : selected ? (
          <View style={styles.toggleSelected}>
            <SymbolView name="checkmark" size={12} tintColor="#FFFFFF" />
          </View>
        ) : (
          <View style={styles.toggleIdle} />
        )}
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyHint({
  query,
  loading,
  error,
}: {
  query: string;
  loading: boolean;
  error: Error | null;
}) {
  if (loading) {
    return (
      <View style={styles.hintBlock}>
        <ActivityIndicator size="small" />
        <Text style={styles.hintText}>Searching…</Text>
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.hintBlock}>
        <SymbolView
          name="wifi.slash"
          size={28}
          tintColor={COLOR_LABEL_TERTIARY_P}
        />
        <Text style={styles.hintText}>
          Couldn't reach server — try again.
        </Text>
      </View>
    );
  }
  if (query.length === 0) {
    return (
      <View style={styles.hintBlock}>
        <SymbolView
          name="bus.fill"
          size={28}
          tintColor={COLOR_LABEL_TERTIARY_P}
        />
        <Text style={styles.hintText}>
          Search for a bus by code or stop name.
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.hintBlock}>
      <Text style={styles.hintText}>No routes match "{query}".</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Stop-picker step header (shown while chaining through selected routes)
// ---------------------------------------------------------------------------

function PickerHeader({
  progress,
  onBack,
  onDismiss,
}: {
  progress: { index: number; total: number };
  onBack: () => void;
  onDismiss: () => void;
}) {
  return (
    <View style={styles.pickerHeader}>
      <Pressable
        onPress={onBack}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Back to search"
        style={({ pressed }) => [
          styles.pickerHeaderBack,
          pressed && { opacity: 0.55 },
        ]}
      >
        <SymbolView
          name="chevron.left"
          size={17}
          tintColor={COLOR_ACCENT}
        />
        <Text style={styles.pickerHeaderBackLabel}>Back</Text>
      </Pressable>
      <View style={styles.pickerHeaderCenter} pointerEvents="none">
        <Text style={styles.pickerHeaderTitle}>Pick a stop</Text>
        {progress.total > 1 ? (
          <Text style={styles.pickerHeaderSubtitle}>
            {`Bus ${progress.index + 1} of ${progress.total}`}
          </Text>
        ) : null}
      </View>
      <Pressable
        onPress={onDismiss}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={({ pressed }) => [
          styles.pickerHeaderClose,
          pressed && { opacity: 0.55 },
        ]}
      >
        <SymbolView
          name="xmark.circle.fill"
          size={26}
          tintColor={COLOR_LABEL_QUATERNARY_P}
        />
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Stop picker (unchanged behaviour — reused per queued route)
// ---------------------------------------------------------------------------

function StopPickerStep({
  route,
  onPickStop,
}: {
  route: RouteSearchHit;
  onPickStop: (stop: GtfsStop) => void;
}) {
  const [bundle, setBundle] = useState<T816Bundle | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    let cancelled = false;
    setBundle(null);
    setError(null);
    (async () => {
      try {
        const b = await fetchRouteBundle(route.code, ctrl.signal);
        if (cancelled) return;
        setBundle(b);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [route.code]);

  const { matched, rest } = useMemo(() => {
    if (!bundle) return { matched: [] as GtfsStop[], rest: [] as GtfsStop[] };
    const repTrip = pickRepresentativeTrip(bundle);
    const ordered = orderStopsByTrip(bundle, repTrip?.tripId ?? null);
    const matchedIds = new Set(
      (route.matchedStops ?? []).map((s) => s.stop_id),
    );
    const m: GtfsStop[] = [];
    const r: GtfsStop[] = [];
    for (const s of ordered) {
      (matchedIds.has(s.stop_id) ? m : r).push(s);
    }
    return { matched: m, rest: r };
  }, [bundle, route.matchedStops]);

  const { title: routeTitle, subtitle: routeSubtitle } = describeRoute(route);

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.stopsContent}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.pickerRouteHeader}>
        <View style={[styles.badge, styles.badgeSelected, styles.pickerBadge]}>
          <SymbolView name="bus.fill" size={13} tintColor="#FFFFFF" />
          <Text style={styles.badgeCode} numberOfLines={1}>
            {route.code}
          </Text>
        </View>
        <View style={styles.pickerRouteText}>
          <Text style={styles.pickerRouteTitle} numberOfLines={1}>
            {routeTitle}
          </Text>
          {routeSubtitle ? (
            <Text style={styles.pickerRouteSubtitle} numberOfLines={1}>
              {routeSubtitle}
            </Text>
          ) : null}
        </View>
      </View>

      {error ? (
        <View style={styles.hintBlock}>
          <SymbolView
            name="exclamationmark.triangle"
            size={24}
            tintColor={COLOR_LABEL_TERTIARY_P}
          />
          <Text style={styles.hintText}>
            Couldn't load stops — {error.message}
          </Text>
        </View>
      ) : !bundle ? (
        <View style={styles.hintBlock}>
          <ActivityIndicator size="small" />
          <Text style={styles.hintText}>Loading stops…</Text>
        </View>
      ) : (
        <>
          {matched.length > 0 ? (
            <StopSection
              title="Matched stops"
              stops={matched}
              variant="matched"
              onPick={onPickStop}
            />
          ) : null}
          {rest.length > 0 ? (
            <StopSection
              title={matched.length > 0 ? 'All stops' : 'Stops'}
              stops={rest}
              variant="default"
              onPick={onPickStop}
            />
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

function StopSection({
  title,
  stops,
  variant,
  onPick,
}: {
  title: string;
  stops: GtfsStop[];
  variant: 'matched' | 'default';
  onPick: (stop: GtfsStop) => void;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionHeader}>{title}</Text>
      <View style={styles.stopSectionCard}>
        {stops.map((s, i) => (
          <StopRow
            key={s.stop_id}
            stop={s}
            variant={variant}
            isFirst={i === 0}
            isLast={i === stops.length - 1}
            onPress={() => onPick(s)}
          />
        ))}
      </View>
    </View>
  );
}

function StopRow({
  stop,
  variant,
  isFirst,
  isLast,
  onPress,
}: {
  stop: GtfsStop;
  variant: 'matched' | 'default';
  isFirst: boolean;
  isLast: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Pick stop ${formatStopName(stop.stop_name)}`}
      style={({ pressed }) => [styles.stopRow, pressed && { opacity: 0.55 }]}
    >
      <View style={styles.rail}>
        <View
          style={[
            styles.railLine,
            styles.railLineUpper,
            isFirst && styles.railLineHidden,
          ]}
        />
        <View
          style={[
            styles.railLine,
            styles.railLineLower,
            isLast && styles.railLineHidden,
          ]}
        />
        <View
          style={[
            styles.railDot,
            variant === 'matched'
              ? styles.railDotMatched
              : styles.railDotDefault,
          ]}
        />
      </View>
      <View style={styles.stopTextCol}>
        <Text style={styles.stopName} numberOfLines={2} selectable>
          {formatStopName(stop.stop_name)}
        </Text>
      </View>
      <SymbolView
        name="chevron.right"
        size={13}
        tintColor={COLOR_LABEL_TERTIARY_P}
      />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Styles + constants
// ---------------------------------------------------------------------------

const PLATFORM_SEPARATOR_STRONG = PlatformColor('opaqueSeparator');

// Design handoff palette (dark-mode only per spec)
const COLOR_SHEET_BG = '#1C1C1E';
const COLOR_ELEVATED = '#2C2C2E';
const COLOR_RAISED = '#3A3A3C';
const COLOR_LABEL_PRIMARY = '#FFFFFF';
const COLOR_LABEL_SECONDARY = '#EBEBF5';
const COLOR_LABEL_TERTIARY = '#8E8E93';
const COLOR_LABEL_QUATERNARY = '#636366';
const COLOR_LABEL_DISABLED = '#48484A';
const COLOR_ACCENT = '#0A84FF';
const COLOR_CHIP_BG = 'rgba(10,132,255,0.15)';
const COLOR_CHIP_BORDER = 'rgba(10,132,255,0.35)';
const COLOR_ROW_TINT = 'rgba(10,132,255,0.07)';
const COLOR_INSET_DIVIDER = '#2C2C2E';

// PlatformColor tints for SF Symbols (can't pass hex strings on iOS consistently
// for tintColor in some RN versions — use a ref to PlatformColor where useful)
const COLOR_LABEL_TERTIARY_P = COLOR_LABEL_TERTIARY;
const COLOR_LABEL_QUATERNARY_P = COLOR_LABEL_QUATERNARY;

const BADGE_MIN_WIDTH = 62;
const RAIL_WIDTH = 34;
const RAIL_CENTER = RAIL_WIDTH / 2;
const RAIL_LINE_WIDTH = 2;
const CARD_MARGIN = 16;
// Base bottom padding for the results list — enough to clear the home
// indicator. At runtime we add the keyboard height on top of this so the
// final row remains reachable with the keyboard up.
const LIST_BOTTOM_PAD = 64;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLOR_SHEET_BG,
    overflow: 'hidden',
  },
  flex: { flex: 1 },
  // Sticky top chrome (header + search + chips + divider). Opaque bg and
  // higher zIndex so the scroll list can't visually bleed into this area
  // during iOS form-sheet detent transitions.
  chrome: {
    zIndex: 1,
    backgroundColor: COLOR_SHEET_BG,
  },
  // Clips any list bleed that tries to render outside the list's flex area.
  listWrap: {
    flex: 1,
    overflow: 'hidden',
  },

  // Search-step header ------------------------------------------------------
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 14,
    gap: 16,
  },
  headerLeft: {
    flexShrink: 1,
  },
  headerTitle: {
    color: COLOR_LABEL_PRIMARY,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    color: COLOR_LABEL_QUATERNARY,
    fontSize: 13,
    marginTop: 4,
  },
  doneButton: {
    borderRadius: 22,
    paddingHorizontal: 22,
    paddingVertical: 11,
    minWidth: 88,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneButtonActive: {
    backgroundColor: COLOR_ACCENT,
  },
  doneButtonMuted: {
    backgroundColor: COLOR_ELEVATED,
  },
  doneButtonPressed: {
    opacity: 0.82,
  },
  doneLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  doneLabelActive: {
    color: '#FFFFFF',
  },
  doneLabelMuted: {
    color: COLOR_LABEL_QUATERNARY,
  },

  // Search bar --------------------------------------------------------------
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: CARD_MARGIN,
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: COLOR_ELEVATED,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: COLOR_LABEL_PRIMARY,
    paddingVertical: 0,
  },

  // Chip strip (selected routes) -------------------------------------------
  chipStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: CARD_MARGIN,
    paddingTop: 10,
    paddingBottom: 2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingLeft: 10,
    paddingRight: 6,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: COLOR_CHIP_BG,
    borderWidth: 1,
    borderColor: COLOR_CHIP_BORDER,
  },
  chipLabel: {
    color: COLOR_ACCENT,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  chipRemove: {
    paddingHorizontal: 3,
    marginLeft: 1,
  },

  // Full-width divider between chrome and list -----------------------------
  listDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLOR_RAISED,
    marginTop: 12,
    marginBottom: 4,
  },

  listContent: {
    paddingTop: 4,
    // paddingBottom is applied dynamically at render time via LIST_BOTTOM_PAD
    // plus the live keyboard height — keeps the final row reachable whether
    // or not the search input is focused.
  },

  // Bus card (outer Pressable) ---------------------------------------------
  card: {
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 14,
    borderCurve: 'continuous',
    backgroundColor: COLOR_ELEVATED,
    borderWidth: 1,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  cardSelected: {
    backgroundColor: 'rgba(10,132,255,0.12)',
    borderColor: 'rgba(10,132,255,0.35)',
  },
  cardPressed: {
    opacity: 0.7,
  },
  cardDisabled: {
    opacity: 0.5,
  },

  // Row content inside the card (inner View — decoupled from Pressable style)
  cardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
    minHeight: 60,
  },

  // Route badge (code pill) -----------------------------------------------
  badge: {
    minWidth: BADGE_MIN_WIDTH,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  badgeIdle: {
    backgroundColor: COLOR_ELEVATED,
  },
  badgeSelected: {
    backgroundColor: COLOR_ACCENT,
  },
  badgeCode: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  // Row text ---------------------------------------------------------------
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    color: COLOR_LABEL_SECONDARY,
    fontSize: 16,
    lineHeight: 20,
  },
  rowNameSelected: {
    color: COLOR_LABEL_PRIMARY,
    fontWeight: '500',
  },
  rowNameDisabled: {
    color: COLOR_LABEL_TERTIARY,
  },
  rowSubtitle: {
    color: COLOR_LABEL_DISABLED,
    fontSize: 13,
    marginTop: 3,
  },

  // Toggle circle ---------------------------------------------------------
  toggleIdle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: COLOR_RAISED,
    flexShrink: 0,
  },
  toggleSelected: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLOR_ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  // "Added" label (when route already in user's favorites) ----------------
  addedLabel: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: COLOR_ELEVATED,
  },
  addedLabelText: {
    color: COLOR_LABEL_TERTIARY,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
  },

  // Empty/loading hint block ----------------------------------------------
  hintBlock: {
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 32,
    paddingVertical: 48,
  },
  // Wrapper that fills the empty FlatList area so the hint centers vertically
  hintFill: {
    flex: 1,
    justifyContent: 'center',
  },
  hintText: {
    fontSize: 14,
    color: COLOR_LABEL_QUATERNARY,
    textAlign: 'center',
  },

  // Pick-stop step header -------------------------------------------------
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    minHeight: 44,
  },
  pickerHeaderBack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingRight: 8,
    minWidth: 72,
  },
  pickerHeaderBackLabel: {
    color: COLOR_ACCENT,
    fontSize: 16,
  },
  pickerHeaderCenter: {
    flex: 1,
    alignItems: 'center',
  },
  pickerHeaderTitle: {
    color: COLOR_LABEL_PRIMARY,
    fontSize: 17,
    fontWeight: '600',
  },
  pickerHeaderSubtitle: {
    color: COLOR_LABEL_QUATERNARY,
    fontSize: 12,
    marginTop: 2,
  },
  pickerHeaderClose: {
    paddingLeft: 8,
    minWidth: 72,
    alignItems: 'flex-end',
  },

  // Stop picker body -------------------------------------------------------
  stopsContent: {
    paddingBottom: 64,
  },
  // Compact route header shown at the top of the stop picker — reuses the
  // pill badge from RouteRow so the flow feels continuous from search.
  pickerRouteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: CARD_MARGIN,
    paddingTop: 6,
    paddingBottom: 16,
  },
  pickerBadge: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 70,
  },
  pickerRouteText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  pickerRouteTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLOR_LABEL_PRIMARY,
    letterSpacing: -0.1,
  },
  pickerRouteSubtitle: {
    fontSize: 13,
    color: COLOR_LABEL_TERTIARY,
  },

  section: {
    marginTop: 18,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '600',
    color: COLOR_LABEL_QUATERNARY,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginHorizontal: CARD_MARGIN + 8,
  },
  stopSectionCard: {
    marginHorizontal: CARD_MARGIN,
    backgroundColor: surfaceColor.grouped,
    borderRadius: 14,
    overflow: 'hidden',
  },

  // Stop row + rail --------------------------------------------------------
  // `alignItems: stretch` makes the rail column fill the row height so the
  // vertical line can continue seamlessly between adjacent rows.
  stopRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingRight: 14,
    gap: 2,
    minHeight: 56,
  },
  rail: {
    width: RAIL_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  railLine: {
    position: 'absolute',
    left: RAIL_CENTER - RAIL_LINE_WIDTH / 2,
    width: RAIL_LINE_WIDTH,
    backgroundColor: PLATFORM_SEPARATOR_STRONG,
  },
  railLineUpper: {
    top: 0,
    height: '50%',
  },
  railLineLower: {
    top: '50%',
    bottom: 0,
  },
  // Preserve rail geometry for first/last stops but hide the line — the dot
  // still aligns with its neighbours in the section.
  railLineHidden: {
    opacity: 0,
  },
  railDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: surfaceColor.grouped,
  },
  railDotDefault: {
    backgroundColor: COLOR_LABEL_QUATERNARY,
  },
  railDotMatched: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLOR_ACCENT,
  },
  stopTextCol: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    paddingVertical: 14,
  },
  stopName: {
    fontSize: 16,
    fontWeight: '500',
    color: COLOR_LABEL_PRIMARY,
    letterSpacing: -0.1,
    lineHeight: 20,
  },
});
