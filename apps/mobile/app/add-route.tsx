import type { GtfsStop, RouteSearchHit, T816Bundle } from '@bus-tracker/shared';
import { orderStopsByTrip, pickRepresentativeTrip } from '@bus-tracker/shared';
import {
  Button,
  HStack,
  Host,
  Image,
  List,
  ProgressView,
  Section,
  Spacer,
  Text,
  VStack,
} from '@expo/ui/swift-ui';
import {
  background,
  buttonStyle,
  disabled,
  font,
  foregroundStyle,
  frame,
  listStyle,
  padding,
  scrollContentBackground,
  shapes,
} from '@expo/ui/swift-ui/modifiers';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, useColorScheme } from 'react-native';

import { formatStopName } from '@/components/map/format';
import { useRouteSearch } from '@/hooks/useRouteSearch';
import { MAX_FAVORITES, useSettings } from '@/hooks/useSettings';
import { fetchRouteBundle } from '@/services/routeBundle';
import { color, hex, pick } from '@/theme/design';
import { haptics } from '@/utils/haptics';

type Params = { code?: string; mode?: 'change' };

/**
 * Add a route (search → boarding stop → saved), or with `?code=X&mode=change`
 * change the boarding stop of an existing favourite. Native search bar, inset
 * grouped SwiftUI list, one tap per step — the sheet is the system glass.
 */
export default function AddRouteScreen() {
  const router = useRouter();
  const settings = useSettings();
  const params = useLocalSearchParams<Params>();
  const changeMode = params.mode === 'change' && !!params.code;
  const [query, setQuery] = useState('');
  const [route, setRoute] = useState<{ code: string; longName?: string; matched?: string[] } | null>(
    params.code ? { code: params.code } : null,
  );
  const search = useRouteSearch(route ? '' : query);
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const accent = pick(hex.accent, scheme);

  const favorites = useMemo(() => new Set(settings.favoritedRoutes), [settings.favoritedRoutes]);

  const pickStop = (stop: GtfsStop) => {
    if (!route) return;
    if (changeMode) {
      settings.setPreferredStopForRoute(route.code, stop.stop_id);
      haptics.success();
      router.back();
      return;
    }
    const result = settings.addFavorite(route.code, stop.stop_id);
    if (!result.ok && result.reason === 'cap-reached') {
      haptics.error();
      Alert.alert(
        'Too many routes',
        `You can follow up to ${MAX_FAVORITES} routes. Remove one in Settings first.`,
      );
      return;
    }
    if (!result.ok && result.reason === 'already-favorited') {
      settings.setPreferredStopForRoute(route.code, stop.stop_id);
    }
    settings.setPreferredRouteCode(route.code);
    haptics.success();
    router.back();
  };

  const title = route ? (changeMode ? 'Change Stop' : `Route ${route.code}`) : 'Add Route';

  return (
    <>
      <Stack.Screen options={{ title }} />
      {route && !changeMode && !params.code ? (
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button icon="chevron.left" accessibilityLabel="Back" onPress={() => {
              setQuery('');
              setRoute(null);
            }}
          />
        </Stack.Toolbar>
      ) : null}
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="xmark" accessibilityLabel="Close" onPress={() => router.back()} />
      </Stack.Toolbar>
      {!route ? (
        <Stack.SearchBar
          placeholder="Route number or stop name"
          autoFocus
          hideWhenScrolling={false}
          onChangeText={(e) => setQuery(e.nativeEvent.text)}
        />
      ) : null}

      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <List modifiers={[listStyle('insetGrouped'), scrollContentBackground('hidden')]}>
          {route ? (
            <StopSections
              code={route.code}
              matchedStopIds={route.matched}
              selectedStopId={settings.preferredStopByRoute[route.code] ?? null}
              accent={accent}
              onPick={pickStop}
            />
          ) : (
            <SearchSections
              query={query.trim()}
              results={search.results}
              loading={search.loading}
              error={search.error}
              favorites={favorites}
              accent={accent}
              onPick={(hit) =>
                setRoute({
                  code: hit.code,
                  longName: hit.long_name,
                  matched: hit.matchedStops?.map((s) => s.stop_id),
                })
              }
            />
          )}
        </List>
      </Host>
    </>
  );
}

function SearchSections({
  query,
  results,
  loading,
  error,
  favorites,
  accent,
  onPick,
}: {
  query: string;
  results: RouteSearchHit[];
  loading: boolean;
  error: Error | null;
  favorites: ReadonlySet<string>;
  accent: string;
  onPick: (hit: RouteSearchHit) => void;
}) {
  if (query.length === 0) {
    return (
      <Section footer={<Text>Try a route like T816, or a stop such as “Phileo Damansara”.</Text>}>
        <HStack spacing={12} modifiers={[padding({ vertical: 6 })]}>
          <Image systemName="magnifyingglass" size={17} color={color.secondaryLabel} />
          <Text modifiers={[foregroundStyle({ type: 'hierarchical', style: 'secondary' })]}>
            Search Rapid KL feeder routes
          </Text>
        </HStack>
      </Section>
    );
  }
  if (error) {
    return (
      <Section>
        <Text modifiers={[foregroundStyle({ type: 'hierarchical', style: 'secondary' })]}>
          Couldn’t search right now. Check your connection and try again.
        </Text>
      </Section>
    );
  }
  if (loading && results.length === 0) {
    return (
      <Section>
        <HStack spacing={10}>
          <ProgressView />
          <Text modifiers={[foregroundStyle({ type: 'hierarchical', style: 'secondary' })]}>
            Searching…
          </Text>
        </HStack>
      </Section>
    );
  }
  if (results.length === 0) {
    return (
      <Section>
        <Text modifiers={[foregroundStyle({ type: 'hierarchical', style: 'secondary' })]}>
          {`No routes match “${query}”.`}
        </Text>
      </Section>
    );
  }
  return (
    <Section title="Routes">
      {results.map((hit) => {
        const added = favorites.has(hit.code);
        const via = describeRoute(hit);
        return (
          <Button
            key={hit.code}
            onPress={() => onPick(hit)}
            modifiers={[buttonStyle('plain')]}
          >
            <HStack spacing={12} modifiers={[padding({ vertical: 4 })]}>
              <Text
                modifiers={[
                  font({ size: 15, weight: 'bold', design: 'rounded' }),
                  foregroundStyle('#FFFFFF'),
                  padding({ horizontal: 10, vertical: 5 }),
                  frame({ minWidth: 56 }),
                  background(accent, shapes.capsule()),
                ]}
              >
                {hit.code}
              </Text>
              <VStack spacing={2} alignment="leading">
                <Text modifiers={[font({ size: 17 })]}>
                  {hit.long_name && hit.long_name !== hit.code ? hit.long_name : `Route ${hit.code}`}
                </Text>
                {via ? (
                  <Text
                    modifiers={[
                      font({ size: 13 }),
                      foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
                    ]}
                  >
                    {via}
                  </Text>
                ) : null}
              </VStack>
              <Spacer />
              {added ? (
                <Image systemName="checkmark.circle.fill" size={18} color={accent} />
              ) : (
                <Image systemName="chevron.right" size={13} color={color.tertiaryLabel} />
              )}
            </HStack>
          </Button>
        );
      })}
    </Section>
  );
}

function describeRoute(hit: RouteSearchHit): string | null {
  if (hit.matchedStops && hit.matchedStops.length > 0) {
    return `Stops at ${formatStopName(hit.matchedStops[0].stop_name)}`;
  }
  if (hit.origin && hit.destination && hit.origin !== hit.destination) {
    return `${formatStopName(hit.origin)} → ${formatStopName(hit.destination)}`;
  }
  if (hit.midpoint) return `Loop via ${formatStopName(hit.midpoint)}`;
  return null;
}

function StopSections({
  code,
  matchedStopIds,
  selectedStopId,
  accent,
  onPick,
}: {
  code: string;
  matchedStopIds?: readonly string[];
  selectedStopId: string | null;
  accent: string;
  onPick: (stop: GtfsStop) => void;
}) {
  const [bundle, setBundle] = useState<T816Bundle | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setBundle(null);
    setError(null);
    fetchRouteBundle(code, ctrl.signal)
      .then(setBundle)
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(err instanceof Error ? err : new Error(String(err)));
      });
    return () => ctrl.abort();
  }, [code]);

  const { matched, rest } = useMemo(() => {
    if (!bundle) return { matched: [] as GtfsStop[], rest: [] as GtfsStop[] };
    const ordered = orderStopsByTrip(bundle, pickRepresentativeTrip(bundle)?.tripId ?? null);
    const ids = new Set(matchedStopIds ?? []);
    return {
      matched: ordered.filter((s) => ids.has(s.stop_id)),
      rest: ordered.filter((s) => !ids.has(s.stop_id)),
    };
  }, [bundle, matchedStopIds]);

  if (error) {
    return (
      <Section>
        <Text modifiers={[foregroundStyle({ type: 'hierarchical', style: 'secondary' })]}>
          Couldn’t load stops for this route. Check your connection and try again.
        </Text>
      </Section>
    );
  }
  if (!bundle) {
    return (
      <Section>
        <HStack spacing={10}>
          <ProgressView />
          <Text modifiers={[foregroundStyle({ type: 'hierarchical', style: 'secondary' })]}>
            Loading stops…
          </Text>
        </HStack>
      </Section>
    );
  }

  const row = (s: GtfsStop) => {
    const selected = s.stop_id === selectedStopId;
    return (
      <Button key={s.stop_id} onPress={() => onPick(s)} modifiers={[buttonStyle('plain')]}>
        <HStack spacing={12} modifiers={[padding({ vertical: 4 })]}>
          <Image
            systemName={selected ? 'mappin.circle.fill' : 'circle'}
            size={selected ? 18 : 10}
            color={selected ? accent : color.tertiaryLabel}
            modifiers={[frame({ width: 20 })]}
          />
          <Text modifiers={[font({ size: 17, weight: selected ? 'semibold' : 'regular' })]}>
            {formatStopName(s.stop_name)}
          </Text>
          {s.wheelchair_boarding === 1 ? (
            <Image systemName="figure.roll" size={13} color={color.secondaryLabel} />
          ) : null}
          <Spacer />
        </HStack>
      </Button>
    );
  };

  return (
    <>
      {matched.length > 0 ? (
        <Section title="Matching your search">{matched.map(row)}</Section>
      ) : null}
      <Section
        title="Where do you board?"
        footer={<Text>Stops are listed in the order the bus serves them.</Text>}
      >
        {rest.map(row)}
      </Section>
      {rest.length === 0 && matched.length === 0 ? (
        <Section>
          <Text modifiers={[disabled(true)]}>No stops found for this route.</Text>
        </Section>
      ) : null}
    </>
  );
}
