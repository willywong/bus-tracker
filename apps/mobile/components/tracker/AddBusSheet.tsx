import type { GtfsStop, RouteSearchHit, T816Bundle } from '@bus-tracker/shared';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Modal,
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
import { tokens } from '@/theme/tokens';
import { MAX_FAVORITES, useSettings } from '@/hooks/useSettings';
import { useRouteSearch } from '@/hooks/useRouteSearch';
import { fetchRouteBundle } from '@/services/routeBundle';

interface AddBusSheetProps {
  visible: boolean;
  onDismiss: () => void;
}

/**
 * Inline iOS page-sheet that presents the Add Bus flow without a route change.
 * Mounts content only when `visible` so step state resets on every open.
 */
export function AddBusSheet({ visible, onDismiss }: AddBusSheetProps) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onDismiss}
      onDismiss={onDismiss}
    >
      {visible ? <AddBusSheetBody onDismiss={onDismiss} /> : null}
    </Modal>
  );
}

type Step =
  | { kind: 'search' }
  | { kind: 'pickStop'; route: RouteSearchHit };

function AddBusSheetBody({ onDismiss }: { onDismiss: () => void }) {
  const settings = useSettings();
  const [step, setStep] = useState<Step>({ kind: 'search' });

  const handleSelectRoute = (hit: RouteSearchHit) => {
    Keyboard.dismiss();
    if (settings.favoritedRoutes.includes(hit.code)) {
      settings.setPreferredRouteCode(hit.code);
      onDismiss();
      return;
    }
    if (settings.favoritedRoutes.length >= MAX_FAVORITES) {
      Alert.alert(
        'Favorite limit reached',
        `You've reached ${MAX_FAVORITES} favorite buses. Remove one in Settings to add a new bus.`,
      );
      return;
    }
    setStep({ kind: 'pickStop', route: hit });
  };

  const handlePickStop = (stop: GtfsStop) => {
    if (step.kind !== 'pickStop') return;
    const result = settings.addFavorite(step.route.code, stop.stop_id);
    if (!result.ok && result.reason === 'cap-reached') {
      Alert.alert(
        'Favorite limit reached',
        `You've reached ${MAX_FAVORITES} favorite buses. Remove one in Settings to add a new bus.`,
      );
      return;
    }
    settings.setPreferredRouteCode(step.route.code);
    onDismiss();
  };

  const handleBack = () => setStep({ kind: 'search' });

  const title = step.kind === 'search' ? 'Add bus' : step.route.code;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerSide}>
          {step.kind === 'pickStop' ? (
            <Pressable
              onPress={handleBack}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Back to search"
              style={({ pressed }) => [
                styles.headerButton,
                pressed && { opacity: 0.55 },
              ]}
            >
              <SymbolView
                name="chevron.left"
                size={17}
                tintColor={tokens.platform.accent}
              />
              <Text style={styles.headerButtonText}>Search</Text>
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        <View style={[styles.headerSide, styles.headerSideRight]}>
          <Pressable
            onPress={onDismiss}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={({ pressed }) => pressed && { opacity: 0.55 }}
          >
            <SymbolView
              name="xmark.circle.fill"
              size={26}
              tintColor={PLATFORM_TERTIARY}
            />
          </Pressable>
        </View>
      </View>

      {step.kind === 'search' ? (
        <SearchStep
          favorited={settings.favoritedRoutes}
          onSelect={handleSelectRoute}
        />
      ) : (
        <StopPickerStep route={step.route} onPickStop={handlePickStop} />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — search
// ---------------------------------------------------------------------------

function SearchStep({
  favorited,
  onSelect,
}: {
  favorited: readonly string[];
  onSelect: (hit: RouteSearchHit) => void;
}) {
  const [query, setQuery] = useState('');
  const search = useRouteSearch(query);
  const trimmed = query.trim();

  const inputRef = useRef<TextInput | null>(null);
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 180);
    return () => clearTimeout(t);
  }, []);

  const resultCount = search.results.length;

  return (
    <View style={styles.flex}>
      <View style={styles.searchBar}>
        <SymbolView
          name="magnifyingglass"
          size={16}
          tintColor={PLATFORM_SECONDARY}
        />
        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={setQuery}
          placeholder="Route code or stop name"
          placeholderTextColor={PLATFORM_TERTIARY}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="characters"
          clearButtonMode="while-editing"
          accessibilityLabel="Search routes"
          style={styles.searchInput}
        />
      </View>

      <FlatList<RouteSearchHit>
        data={search.results}
        keyExtractor={(item) => item.code}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.listContent}
        renderItem={({ item, index }: ListRenderItemInfo<RouteSearchHit>) => (
          <ResultRow
            hit={item}
            isFavorited={favorited.includes(item.code)}
            isFirst={index === 0}
            isLast={index === resultCount - 1}
            onPress={() => onSelect(item)}
          />
        )}
        ListEmptyComponent={
          <EmptyHint
            query={trimmed}
            loading={search.loading}
            error={search.error}
          />
        }
      />
    </View>
  );
}

function ResultRow({
  hit,
  isFavorited,
  isFirst,
  isLast,
  onPress,
}: {
  hit: RouteSearchHit;
  isFavorited: boolean;
  isFirst: boolean;
  isLast: boolean;
  onPress: () => void;
}) {
  const showLongName =
    hit.long_name != null &&
    hit.long_name.trim().toUpperCase() !== hit.code.trim().toUpperCase();

  return (
    <View
      style={[
        styles.cardSlice,
        isFirst && styles.cardTop,
        isLast && styles.cardBottom,
      ]}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={
          isFavorited
            ? `Select ${hit.code}${showLongName ? ', ' + hit.long_name : ''}, already favorited`
            : `Add ${hit.code}${showLongName ? ', ' + hit.long_name : ''}`
        }
        style={({ pressed }) => [
          styles.resultRow,
          pressed && styles.rowPressed,
        ]}
      >
        <View style={styles.routeAvatar}>
          <SymbolView name="bus.fill" size={16} tintColor="#FFFFFF" />
        </View>

        <View style={styles.resultMain}>
          <Text style={styles.resultCode} numberOfLines={1} selectable>
            {hit.code}
          </Text>
          {showLongName ? (
            <Text style={styles.resultLong} numberOfLines={2} selectable>
              {hit.long_name}
            </Text>
          ) : null}
          {hit.matchedStops && hit.matchedStops.length > 0 ? (
            <View style={styles.chipRow}>
              {hit.matchedStops.slice(0, 2).map((s) => (
                <View key={s.stop_id} style={styles.chip}>
                  <SymbolView
                    name="mappin"
                    size={9}
                    tintColor={PLATFORM_SECONDARY}
                  />
                  <Text style={styles.chipLabel} numberOfLines={1}>
                    {formatStopName(s.stop_name)}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.resultTrail}>
          {isFavorited ? (
            <View style={styles.addedPill}>
              <SymbolView
                name="checkmark"
                size={10}
                tintColor={tokens.platform.accent}
              />
              <Text style={styles.addedPillLabel}>Added</Text>
            </View>
          ) : null}
          <SymbolView
            name="chevron.right"
            size={13}
            tintColor={PLATFORM_TERTIARY}
          />
        </View>
      </Pressable>
      {!isLast ? <View style={styles.innerHairline} /> : null}
    </View>
  );
}

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
          tintColor={PLATFORM_TERTIARY}
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
          tintColor={PLATFORM_TERTIARY}
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
// Step 2 — stop picker
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
    const matchedIds = new Set(
      (route.matchedStops ?? []).map((s) => s.stop_id),
    );
    const m: GtfsStop[] = [];
    const r: GtfsStop[] = [];
    for (const s of bundle.stops) {
      (matchedIds.has(s.stop_id) ? m : r).push(s);
    }
    const byName = (a: GtfsStop, b: GtfsStop) =>
      a.stop_name.localeCompare(b.stop_name);
    m.sort(byName);
    r.sort(byName);
    return { matched: m, rest: r };
  }, [bundle, route.matchedStops]);

  const showSubtitle =
    route.long_name != null &&
    route.long_name.trim().toUpperCase() !== route.code.trim().toUpperCase();

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.stopsContent}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.routeHeader}>
        <View style={styles.routeHeaderAvatar}>
          <SymbolView name="bus.fill" size={22} tintColor="#FFFFFF" />
        </View>
        <View style={styles.routeHeaderText}>
          <Text style={styles.routeHeaderCode}>{route.code}</Text>
          {showSubtitle ? (
            <Text style={styles.routeHeaderName} numberOfLines={2}>
              {route.long_name}
            </Text>
          ) : null}
        </View>
      </View>

      {error ? (
        <View style={styles.hintBlock}>
          <SymbolView
            name="exclamationmark.triangle"
            size={24}
            tintColor={PLATFORM_TERTIARY}
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
      <View style={styles.card}>
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
  const dotColor =
    variant === 'matched' ? tokens.platform.accent : PLATFORM_SEPARATOR_STRONG;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Pick stop ${formatStopName(stop.stop_name)}`}
      style={({ pressed }) => [styles.stopRow, pressed && styles.rowPressed]}
    >
      <View style={styles.rail}>
        {!isFirst ? (
          <View style={[styles.railLine, styles.railLineUpper]} />
        ) : null}
        {!isLast ? (
          <View style={[styles.railLine, styles.railLineLower]} />
        ) : null}
        <View
          style={[
            styles.railDot,
            variant === 'matched' && styles.railDotMatched,
            { backgroundColor: dotColor },
          ]}
        />
      </View>
      <Text style={styles.stopName} numberOfLines={2} selectable>
        {formatStopName(stop.stop_name)}
      </Text>
      <SymbolView
        name="chevron.right"
        size={12}
        tintColor={PLATFORM_TERTIARY}
      />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Styles + constants
// ---------------------------------------------------------------------------

const PLATFORM_SECONDARY = PlatformColor('secondaryLabel');
const PLATFORM_TERTIARY = PlatformColor('tertiaryLabel');
const PLATFORM_SEPARATOR = PlatformColor('separator');
const PLATFORM_SEPARATOR_STRONG = PlatformColor('opaqueSeparator');
const CARD_RADIUS = 14;
const CARD_MARGIN = 16;
const RAIL_WIDTH = 34;
const RAIL_CENTER = RAIL_WIDTH / 2;
const RAIL_LINE_WIDTH = 2;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: PlatformColor('systemGroupedBackground'),
  },
  flex: { flex: 1 },

  // Sheet header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: PLATFORM_SEPARATOR,
  },
  headerSide: {
    position: 'absolute',
    top: 12,
    bottom: 8,
    left: 12,
    minWidth: 44,
    justifyContent: 'center',
  },
  headerSideRight: {
    left: undefined,
    right: 12,
    alignItems: 'flex-end',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: PlatformColor('label'),
    textAlign: 'center',
    maxWidth: '60%',
  },
  headerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  headerButtonText: {
    fontSize: 16,
    color: tokens.platform.accent,
  },

  // Search bar
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: CARD_MARGIN,
    marginTop: 14,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: surfaceColor.grouped,
    borderColor: PLATFORM_SEPARATOR,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: PlatformColor('label'),
    paddingVertical: 2,
  },

  // Search results list
  listContent: {
    paddingBottom: 48,
  },

  // Card slices — stack of rows collectively rendering one rounded card
  cardSlice: {
    marginHorizontal: CARD_MARGIN,
    backgroundColor: surfaceColor.grouped,
    overflow: 'hidden',
  },
  cardTop: {
    borderTopLeftRadius: CARD_RADIUS,
    borderTopRightRadius: CARD_RADIUS,
  },
  cardBottom: {
    borderBottomLeftRadius: CARD_RADIUS,
    borderBottomRightRadius: CARD_RADIUS,
  },

  // Search result row
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  rowPressed: {
    opacity: 0.55,
  },
  routeAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: tokens.platform.accent,
  },
  resultMain: { flex: 1, gap: 3 },
  resultCode: {
    fontSize: 17,
    fontWeight: '600',
    color: PlatformColor('label'),
    letterSpacing: 0.2,
  },
  resultLong: {
    fontSize: 13,
    color: PlatformColor('secondaryLabel'),
  },
  resultTrail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: surfaceColor.inset,
  },
  chipLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: PlatformColor('secondaryLabel'),
    maxWidth: 160,
  },
  addedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: surfaceColor.inset,
  },
  addedPillLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: tokens.platform.accent,
    letterSpacing: 0.3,
  },

  innerHairline: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 14 + 38 + 12,
    backgroundColor: PLATFORM_SEPARATOR,
  },

  // Hint block
  hintBlock: {
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 32,
    paddingVertical: 48,
  },
  hintText: {
    fontSize: 14,
    color: PlatformColor('secondaryLabel'),
    textAlign: 'center',
  },

  // Stop picker
  stopsContent: {
    paddingBottom: 48,
  },
  routeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  routeHeaderAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: tokens.platform.accent,
  },
  routeHeaderText: { flex: 1, gap: 2 },
  routeHeaderCode: {
    fontSize: 28,
    fontWeight: '700',
    color: PlatformColor('label'),
    letterSpacing: 0.3,
  },
  routeHeaderName: {
    fontSize: 14,
    color: PlatformColor('secondaryLabel'),
  },

  section: {
    marginTop: 16,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '500',
    color: PlatformColor('secondaryLabel'),
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
    marginHorizontal: CARD_MARGIN + 8,
  },
  card: {
    marginHorizontal: CARD_MARGIN,
    backgroundColor: surfaceColor.grouped,
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
  },

  // Stop row + rail
  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 14,
    paddingVertical: 12,
    minHeight: 52,
    gap: 8,
  },
  rail: {
    width: RAIL_WIDTH,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
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
  railDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: surfaceColor.grouped,
  },
  railDotMatched: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  stopName: {
    flex: 1,
    fontSize: 15,
    color: PlatformColor('label'),
  },
});
