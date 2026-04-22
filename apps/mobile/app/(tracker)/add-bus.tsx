import type { GtfsStop, RouteSearchHit, T816Bundle } from '@bus-tracker/shared';
import { SymbolView } from 'expo-symbols';
import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  PlatformColor,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItemInfo,
} from 'react-native';

import { formatStopName } from '@/components/map/format';
import { surfaceColor, trackerSpacing } from '@/components/tracker/tokens';
import { useSettings } from '@/hooks/useSettings';
import { useRouteSearch } from '@/hooks/useRouteSearch';
import { fetchRouteBundle } from '@/services/routeBundle';

type Step =
  | { kind: 'search' }
  | { kind: 'pickStop'; route: RouteSearchHit };

export default function AddBusScreen() {
  const settings = useSettings();
  const [step, setStep] = useState<Step>({ kind: 'search' });

  const handleSelectRoute = (hit: RouteSearchHit) => {
    Keyboard.dismiss();
    // Already favorited: just activate and dismiss. No second step.
    if (settings.favoritedRoutes.includes(hit.code)) {
      settings.setPreferredRouteCode(hit.code);
      router.back();
      return;
    }
    setStep({ kind: 'pickStop', route: hit });
  };

  const handlePickStop = (stop: GtfsStop) => {
    if (step.kind !== 'pickStop') return;
    settings.addFavorite(step.route.code, stop.stop_id);
    settings.setPreferredRouteCode(step.route.code);
    router.back();
  };

  const handleBack = () => {
    setStep({ kind: 'search' });
  };

  return (
    <View style={styles.root}>
      <Stack.Screen
        options={{
          title: step.kind === 'search' ? 'Add bus' : step.route.code,
          headerBackTitle: 'Search',
          headerLeft:
            step.kind === 'pickStop'
              ? () => (
                  <Pressable onPress={handleBack} hitSlop={12}>
                    <Text style={styles.headerAction}>Back</Text>
                  </Pressable>
                )
              : undefined,
        }}
      />
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
  // iOS sheets eat autoFocus unless it fires a frame after mount.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, []);

  return (
    <View style={styles.flex}>
      <View style={styles.searchBar}>
        <SymbolView
          name="magnifyingglass"
          size={17}
          tintColor={PLATFORM_SECONDARY}
        />
        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={setQuery}
          placeholder="Route code or stop name"
          placeholderTextColor={PLATFORM_SECONDARY}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="characters"
          clearButtonMode="while-editing"
          style={styles.searchInput}
        />
      </View>

      <FlatList<RouteSearchHit>
        data={search.results}
        keyExtractor={(item) => item.code}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={HairlineSeparator}
        renderItem={({ item }: ListRenderItemInfo<RouteSearchHit>) => (
          <ResultRow
            hit={item}
            isFavorited={favorited.includes(item.code)}
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
  onPress,
}: {
  hit: RouteSearchHit;
  isFavorited: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && styles.rowPressed,
      ]}
    >
      <View style={styles.rowMain}>
        <Text style={styles.code} selectable>
          {hit.code}
        </Text>
        {hit.long_name ? (
          <Text style={styles.longName} numberOfLines={2} selectable>
            {hit.long_name}
          </Text>
        ) : null}
        {hit.matchedStops && hit.matchedStops.length > 0 ? (
          <View style={styles.chipRow}>
            {hit.matchedStops.slice(0, 2).map((s) => (
              <View key={s.stop_id} style={styles.chip}>
                <SymbolView
                  name="mappin.circle"
                  size={11}
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
      <View style={styles.rowTrail}>
        {isFavorited ? (
          <Text style={styles.favoritedBadge}>Favorited</Text>
        ) : null}
        <SymbolView
          name="chevron.right"
          size={13}
          tintColor={PLATFORM_TERTIARY}
        />
      </View>
    </Pressable>
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
        <Text style={styles.hintText}>
          Couldn't reach server — try again.
        </Text>
      </View>
    );
  }
  if (query.length === 0) {
    return (
      <View style={styles.hintBlock}>
        <Text style={styles.hintText}>
          Search routes by code or stop name.
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

interface StopSection {
  title: string;
  data: GtfsStop[];
}

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

  const sections: StopSection[] = useMemo(() => {
    if (!bundle) return [];
    const matchedIds = new Set(
      (route.matchedStops ?? []).map((s) => s.stop_id),
    );
    const matched: GtfsStop[] = [];
    const rest: GtfsStop[] = [];
    for (const s of bundle.stops) {
      (matchedIds.has(s.stop_id) ? matched : rest).push(s);
    }
    const sortByName = (a: GtfsStop, b: GtfsStop) =>
      a.stop_name.localeCompare(b.stop_name);
    matched.sort(sortByName);
    rest.sort(sortByName);
    const out: StopSection[] = [];
    if (matched.length > 0) out.push({ title: 'Matched', data: matched });
    if (rest.length > 0) out.push({ title: 'All stops', data: rest });
    return out;
  }, [bundle, route.matchedStops]);

  if (error) {
    return (
      <View style={styles.hintBlock}>
        <Text style={styles.hintText}>
          Couldn't load stops — {error.message}
        </Text>
      </View>
    );
  }

  if (!bundle) {
    return (
      <View style={styles.hintBlock}>
        <ActivityIndicator size="small" />
        <Text style={styles.hintText}>Loading stops…</Text>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <View style={styles.routeHeader}>
        <Text style={styles.routeHeaderCode}>{route.code}</Text>
        {route.long_name ? (
          <Text style={styles.routeHeaderName} numberOfLines={2}>
            {route.long_name}
          </Text>
        ) : null}
      </View>
      <SectionList<GtfsStop, StopSection>
        sections={sections}
        keyExtractor={(item) => item.stop_id}
        ItemSeparatorComponent={HairlineSeparator}
        contentContainerStyle={styles.listContent}
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionHeader}>{section.title}</Text>
        )}
        renderItem={({ item, section }) => (
          <Pressable
            onPress={() => onPickStop(item)}
            style={({ pressed }) => [
              styles.stopRow,
              pressed && styles.rowPressed,
            ]}
          >
            <SymbolView
              name={
                section.title === 'Matched'
                  ? 'mappin.circle.fill'
                  : 'mappin.circle'
              }
              size={20}
              tintColor={
                section.title === 'Matched'
                  ? tokensAccent()
                  : PLATFORM_SECONDARY
              }
            />
            <Text style={styles.stopName} numberOfLines={2} selectable>
              {formatStopName(item.stop_name)}
            </Text>
          </Pressable>
        )}
        stickySectionHeadersEnabled={false}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

function HairlineSeparator() {
  return <View style={styles.hairline} />;
}

// Read the accent once — avoids spreading `tokens` import into this big file
// and keeps the SF Symbol tint matching the app palette.
function tokensAccent(): string {
  // Lazy-required to sidestep a potential cycle with theme/tokens in a sheet.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { tokens } = require('@/theme/tokens');
  return tokens.color.accent as string;
}

// PlatformColor doesn't survive JS operations like spreading, so keep direct references.
const PLATFORM_SECONDARY = PlatformColor('secondaryLabel');
const PLATFORM_TERTIARY = PlatformColor('tertiaryLabel');

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: PlatformColor('systemGroupedBackground'),
  },
  flex: { flex: 1 },
  headerAction: {
    fontSize: 16,
    color: PlatformColor('link'),
    paddingHorizontal: 4,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: surfaceColor.grouped,
    borderColor: surfaceColor.hairline,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: PlatformColor('label'),
    paddingVertical: 2,
  },
  listContent: {
    paddingBottom: 48,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: trackerSpacing.rowH,
    paddingVertical: 12,
    gap: 10,
    backgroundColor: surfaceColor.grouped,
  },
  rowPressed: {
    opacity: 0.6,
  },
  rowMain: { flex: 1, gap: 4 },
  rowTrail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  code: {
    fontSize: 17,
    fontWeight: '600',
    color: PlatformColor('label'),
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.2,
  },
  longName: {
    fontSize: 13,
    color: PlatformColor('secondaryLabel'),
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: surfaceColor.inset,
  },
  chipLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: PlatformColor('secondaryLabel'),
    maxWidth: 180,
  },
  favoritedBadge: {
    fontSize: 11,
    fontWeight: '600',
    color: PlatformColor('secondaryLabel'),
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: surfaceColor.inset,
  },
  hairline: {
    height: StyleSheet.hairlineWidth,
    marginLeft: trackerSpacing.rowH,
    backgroundColor: surfaceColor.hairline,
  },
  hintBlock: {
    alignItems: 'center',
    gap: 8,
    padding: 32,
  },
  hintText: {
    fontSize: 14,
    color: PlatformColor('secondaryLabel'),
    textAlign: 'center',
  },
  routeHeader: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    gap: 4,
  },
  routeHeaderCode: {
    fontSize: 28,
    fontWeight: '700',
    color: PlatformColor('label'),
    letterSpacing: 0.3,
  },
  routeHeaderName: {
    fontSize: 13,
    color: PlatformColor('secondaryLabel'),
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '500',
    color: PlatformColor('secondaryLabel'),
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 18,
    marginBottom: 6,
    marginLeft: 20,
  },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: trackerSpacing.rowH,
    paddingVertical: 14,
    gap: 12,
    backgroundColor: surfaceColor.grouped,
  },
  stopName: {
    flex: 1,
    fontSize: 15,
    color: PlatformColor('label'),
  },
});
