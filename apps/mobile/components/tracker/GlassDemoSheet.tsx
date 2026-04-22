import type { GtfsStop, RouteSearchHit, T816Bundle } from '@bus-tracker/shared';
import {
  BottomSheet,
  Button,
  Group,
  HStack,
  Host,
  Image,
  ProgressView,
  ScrollView,
  Spacer,
  Text,
  TextField,
  VStack,
} from '@expo/ui/swift-ui';
import {
  background,
  buttonStyle,
  disabled as disabledMod,
  font,
  foregroundStyle,
  frame,
  onTapGesture,
  padding,
  presentationBackgroundInteraction,
  presentationDetents,
  presentationDragIndicator,
  shapes,
  textFieldStyle,
  type PresentationDetent,
} from '@expo/ui/swift-ui/modifiers';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useWindowDimensions } from 'react-native';

import { formatStopName } from '@/components/map/format';
import { MAX_FAVORITES, useSettings } from '@/hooks/useSettings';
import { useRouteSearch } from '@/hooks/useRouteSearch';
import { fetchRouteBundle } from '@/services/routeBundle';

/**
 * Throwaway demo of the @expo/ui/swift-ui BottomSheet (beta). Mirrors the
 * full Add Bus flow — multi-select search, then chain through a stop picker
 * per newly-added route — with SwiftUI primitives so we can eyeball the
 * liquid-glass presentation. Mounted inline on the Tracker screen as an
 * overlay so the tracker UI stays visible behind the sheet.
 */
interface GlassDemoSheetProps {
  isPresented: boolean;
  onDismiss: () => void;
}

type Step =
  | { kind: 'search' }
  | {
      kind: 'pickStops';
      queue: RouteSearchHit[];
      index: number;
      picks: Record<string, string>;
    };

export function GlassDemoSheet({
  isPresented,
  onDismiss,
}: GlassDemoSheetProps) {
  const { width } = useWindowDimensions();
  const [detent, setDetent] = useState<PresentationDetent>('medium');

  // Reset to medium every time the sheet is reopened so the user always
  // lands at half height first, regardless of where they left the previous
  // session.
  useEffect(() => {
    if (isPresented) setDetent('medium');
  }, [isPresented]);

  const expandToLarge = useCallback(() => setDetent('large'), []);

  return (
    <Host matchContents style={[{ position: 'absolute', width }]}>
      <BottomSheet
        isPresented={isPresented}
        onIsPresentedChange={(next) => {
          if (!next) onDismiss();
        }}
      >
        <Group
          modifiers={[
            presentationDetents(['medium', 'large'], {
              selection: detent,
              onSelectionChange: setDetent,
            }),
            presentationDragIndicator('visible'),
            presentationBackgroundInteraction('enabled'),
          ]}
        >
          <ScrollView>
            <AddBusFlow
              // Reset flow state every time the sheet is reopened.
              key={isPresented ? 'open' : 'closed'}
              onDismiss={onDismiss}
              onExpand={expandToLarge}
            />
          </ScrollView>
        </Group>
      </BottomSheet>
    </Host>
  );
}

function AddBusFlow({
  onDismiss,
  onExpand,
}: {
  onDismiss: () => void;
  onExpand: () => void;
}) {
  const settings = useSettings();
  const [step, setStep] = useState<Step>({ kind: 'search' });
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Map<string, RouteSearchHit>>(
    () => new Map(),
  );
  const search = useRouteSearch(query);

  const alreadyFavorited = useMemo(
    () => new Set(settings.favoritedRoutes),
    [settings.favoritedRoutes],
  );
  const spaceLeft = MAX_FAVORITES - alreadyFavorited.size;
  const overCap = selected.size > spaceLeft;

  const toggleSelect = useCallback((hit: RouteSearchHit) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(hit.code)) next.delete(hit.code);
      else next.set(hit.code, hit);
      return next;
    });
  }, []);

  const removeSelected = useCallback((code: string) => {
    setSelected((prev) => {
      if (!prev.has(code)) return prev;
      const next = new Map(prev);
      next.delete(code);
      return next;
    });
  }, []);

  const handleDone = () => {
    if (selected.size === 0 || overCap) return;
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
        if (!result.ok && result.reason === 'cap-reached') break;
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

  if (step.kind === 'pickStops') {
    const current = step.queue[step.index];
    if (!current) return null;
    return (
      <VStack
        spacing={16}
        alignment="leading"
        modifiers={[padding({ horizontal: 20, top: 18, bottom: 28 })]}
      >
        <PickerHeader
          index={step.index}
          total={step.queue.length}
          onBack={() => setStep({ kind: 'search' })}
          onDismiss={onDismiss}
        />
        <RouteBanner route={current} />
        <StopPickerStep route={current} onPick={handlePickStop} />
      </VStack>
    );
  }

  return (
    <VStack
      spacing={16}
      alignment="leading"
      modifiers={[padding({ horizontal: 20, top: 22, bottom: 28 })]}
    >
      <SearchHeader
        routeCount={search.results.length}
        selectedCount={selected.size}
        spaceLeft={spaceLeft}
        overCap={overCap}
        doneActive={selected.size > 0 && !overCap}
        onDone={handleDone}
      />

      <HStack
        spacing={8}
        modifiers={[
          padding({ horizontal: 12, vertical: 10 }),
          background('#2C2C2E', shapes.roundedRectangle({ cornerRadius: 12 })),
        ]}
      >
        <Image systemName="magnifyingglass" size={15} color="#8E8E93" />
        <TextField
          placeholder="Route code or stop name"
          defaultValue=""
          onValueChange={setQuery}
          onFocusChange={(focused) => {
            if (focused) onExpand();
          }}
          modifiers={[textFieldStyle('plain')]}
        />
      </HStack>

      {selected.size > 0 ? (
        <SelectedChipStrip
          selected={Array.from(selected.values())}
          onRemove={removeSelected}
        />
      ) : null}

      <SearchResults
        query={query.trim()}
        results={search.results}
        loading={search.loading}
        error={search.error}
        selected={selected}
        alreadyFavorited={alreadyFavorited}
        onToggle={toggleSelect}
      />
    </VStack>
  );
}

// ---------------------------------------------------------------------------
// Search step — header + chip strip + results + route row
// ---------------------------------------------------------------------------

function SearchHeader({
  routeCount,
  selectedCount,
  spaceLeft,
  overCap,
  doneActive,
  onDone,
}: {
  routeCount: number;
  selectedCount: number;
  spaceLeft: number;
  overCap: boolean;
  doneActive: boolean;
  onDone: () => void;
}) {
  const overage = Math.max(0, selectedCount - spaceLeft);
  return (
    <VStack spacing={4} alignment="leading">
      <HStack spacing={12}>
        <Image systemName="bus.fill" size={20} />
        <Text modifiers={[font({ size: 24, weight: 'bold' })]}>Add Bus</Text>
        <Spacer />
        <Button
          onPress={onDone}
          modifiers={doneActive ? [] : [disabledMod(true)]}
        >
          <Text modifiers={[font({ size: 16, weight: 'semibold' })]}>Done</Text>
        </Button>
      </HStack>
      <Text
        modifiers={[
          foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
          font({ size: 13 }),
        ]}
      >
        {`${routeCount} route${routeCount === 1 ? '' : 's'} · ${selectedCount} selected`}
      </Text>
      {overCap ? (
        <Text modifiers={[foregroundStyle('#FF6B6B'), font({ size: 12 })]}>
          {spaceLeft > 0
            ? `Remove ${overage} to stay under ${MAX_FAVORITES} favourites.`
            : `You've reached ${MAX_FAVORITES} favourites — remove some in Settings.`}
        </Text>
      ) : null}
    </VStack>
  );
}

function SelectedChipStrip({
  selected,
  onRemove,
}: {
  selected: RouteSearchHit[];
  onRemove: (code: string) => void;
}) {
  return (
    <ScrollView axes="horizontal" showsIndicators={false}>
      <HStack spacing={6}>
        {selected.map((hit) => (
          <HStack
            key={hit.code}
            spacing={6}
            modifiers={[
              padding({ leading: 10, trailing: 8, vertical: 5 }),
              background(
                '#1F3A63',
                shapes.capsule({ roundedCornerStyle: 'continuous' }),
              ),
            ]}
          >
            <Image systemName="bus.fill" size={11} color="#0A84FF" />
            <Text
              modifiers={[
                foregroundStyle('#0A84FF'),
                font({ size: 12, weight: 'semibold' }),
              ]}
            >
              {hit.code}
            </Text>
            <Image
              systemName="xmark.circle.fill"
              size={13}
              color="#0A84FF"
              onPress={() => onRemove(hit.code)}
            />
          </HStack>
        ))}
      </HStack>
    </ScrollView>
  );
}

function SearchResults({
  query,
  results,
  loading,
  error,
  selected,
  alreadyFavorited,
  onToggle,
}: {
  query: string;
  results: RouteSearchHit[];
  loading: boolean;
  error: Error | null;
  selected: Map<string, RouteSearchHit>;
  alreadyFavorited: Set<string>;
  onToggle: (hit: RouteSearchHit) => void;
}) {
  if (query.length === 0) {
    return (
      <VStack
        spacing={12}
        alignment="center"
        modifiers={[
          frame({
            maxWidth: Number.POSITIVE_INFINITY,
            minHeight: 200,
            alignment: 'center',
          }),
          padding({ vertical: 24 }),
        ]}
      >
        <Image systemName="bus.fill" size={32} color="#8E8E93" />
        <Text
          modifiers={[
            foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
            font({ size: 14 }),
          ]}
        >
          Search for a bus by code or stop name.
        </Text>
      </VStack>
    );
  }
  if (loading && results.length === 0) {
    return (
      <HStack spacing={10}>
        <ProgressView />
        <Text
          modifiers={[
            foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
            font({ size: 13 }),
          ]}
        >
          Searching…
        </Text>
      </HStack>
    );
  }
  if (error) {
    return (
      <Text
        modifiers={[
          foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
          font({ size: 13 }),
        ]}
      >
        Couldn't search — {error.message}
      </Text>
    );
  }
  if (results.length === 0) {
    return (
      <Text
        modifiers={[
          foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
          font({ size: 13 }),
        ]}
      >
        No routes match "{query}".
      </Text>
    );
  }
  return (
    <VStack spacing={10} alignment="leading">
      {results.map((hit) => (
        <RouteRow
          key={hit.code}
          hit={hit}
          isSelected={selected.has(hit.code)}
          isAlreadyAdded={alreadyFavorited.has(hit.code)}
          onToggle={() => onToggle(hit)}
        />
      ))}
    </VStack>
  );
}

function RouteRow({
  hit,
  isSelected,
  isAlreadyAdded,
  onToggle,
}: {
  hit: RouteSearchHit;
  isSelected: boolean;
  isAlreadyAdded: boolean;
  onToggle: () => void;
}) {
  const origin = hit.origin ? formatStopName(hit.origin) : null;
  const destination = hit.destination ? formatStopName(hit.destination) : null;
  const hasTrip = origin != null && destination != null;
  const isLoop = hasTrip && origin === destination;
  const name =
    hasTrip && isLoop
      ? (origin as string)
      : hasTrip
        ? `${origin} → ${destination}`
        : (hit.long_name?.trim() ?? hit.code);
  const matched = hit.matchedStops?.[0]?.stop_name
    ? formatStopName(hit.matchedStops[0].stop_name)
    : null;
  const subtitle = matched
    ? `Matches ${matched}`
    : isLoop
      ? 'Loop'
      : hasTrip
        ? 'One-way'
        : null;

  const isTappable = !isAlreadyAdded || isSelected;
  const rowBg = isSelected ? '#1F3A63' : '#2C2C2E';

  const row = (
    <HStack
      spacing={12}
      modifiers={[
        padding({ horizontal: 14, vertical: 12 }),
        background(rowBg, shapes.roundedRectangle({ cornerRadius: 12 })),
      ]}
    >
      <HStack
        spacing={4}
        modifiers={[
          padding({ horizontal: 8, vertical: 4 }),
          background(
            isSelected ? '#0A84FF' : '#3A3A3C',
            shapes.roundedRectangle({ cornerRadius: 8 }),
          ),
        ]}
      >
        <Image
          systemName="bus.fill"
          size={11}
          color={isSelected ? '#FFFFFF' : '#8E8E93'}
        />
        <Text
          modifiers={[
            foregroundStyle('#FFFFFF'),
            font({ size: 13, weight: 'bold' }),
          ]}
        >
          {hit.code}
        </Text>
      </HStack>
      <VStack spacing={2} alignment="leading">
        <Text modifiers={[font({ size: 13 })]}>{name}</Text>
        {subtitle ? (
          <Text
            modifiers={[
              foregroundStyle({ type: 'hierarchical', style: 'tertiary' }),
              font({ size: 11 }),
            ]}
          >
            {subtitle}
          </Text>
        ) : null}
      </VStack>
      <Spacer />
      {isAlreadyAdded && !isSelected ? (
        <Text
          modifiers={[
            foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
            font({ size: 11, weight: 'semibold' }),
          ]}
        >
          Added
        </Text>
      ) : isSelected ? (
        <Image systemName="checkmark.circle.fill" size={20} color="#0A84FF" />
      ) : (
        <Image systemName="circle" size={20} color="#48484A" />
      )}
    </HStack>
  );

  if (!isTappable) return row;
  return (
    <Button onPress={onToggle} modifiers={[buttonStyle('plain')]}>
      {row}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Pick-stops step
// ---------------------------------------------------------------------------

function PickerHeader({
  index,
  total,
  onBack,
  onDismiss,
}: {
  index: number;
  total: number;
  onBack: () => void;
  onDismiss: () => void;
}) {
  return (
    <HStack spacing={12}>
      <HStack spacing={2} modifiers={[onTapGesture(onBack)]}>
        <Image systemName="chevron.left" size={15} color="#0A84FF" />
        <Text modifiers={[foregroundStyle('#0A84FF'), font({ size: 16 })]}>
          Back
        </Text>
      </HStack>
      <Spacer />
      <VStack spacing={1}>
        <Text modifiers={[font({ size: 17, weight: 'semibold' })]}>
          Pick a stop
        </Text>
        {total > 1 ? (
          <Text
            modifiers={[
              foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
              font({ size: 12 }),
            ]}
          >
            {`Bus ${index + 1} of ${total}`}
          </Text>
        ) : null}
      </VStack>
      <Spacer />
      <Image
        systemName="xmark.circle.fill"
        size={24}
        color="#636366"
        onPress={onDismiss}
      />
    </HStack>
  );
}

function RouteBanner({ route }: { route: RouteSearchHit }) {
  const showLongName =
    !!route.long_name &&
    route.long_name.trim().toUpperCase() !== route.code.trim().toUpperCase();
  return (
    <HStack spacing={14}>
      <HStack
        modifiers={[
          padding({ all: 14 }),
          background('#0A84FF', shapes.circle()),
        ]}
      >
        <Image systemName="bus.fill" size={22} color="#FFFFFF" />
      </HStack>
      <VStack spacing={2} alignment="leading">
        <Text modifiers={[font({ size: 28, weight: 'bold' })]}>
          {route.code}
        </Text>
        {showLongName ? (
          <Text
            modifiers={[
              foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
              font({ size: 14 }),
            ]}
          >
            {route.long_name ?? ''}
          </Text>
        ) : null}
      </VStack>
      <Spacer />
    </HStack>
  );
}

function StopPickerStep({
  route,
  onPick,
}: {
  route: RouteSearchHit;
  onPick: (stop: GtfsStop) => void;
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
    // Loop routes revisit the same stop multiple times; dedupe by stop_id so
    // the list renders each stop once and avoids duplicate React keys.
    const seen = new Set<string>();
    const m: GtfsStop[] = [];
    const r: GtfsStop[] = [];
    for (const s of bundle.stops) {
      if (seen.has(s.stop_id)) continue;
      seen.add(s.stop_id);
      (matchedIds.has(s.stop_id) ? m : r).push(s);
    }
    const byName = (a: GtfsStop, b: GtfsStop) =>
      a.stop_name.localeCompare(b.stop_name);
    m.sort(byName);
    r.sort(byName);
    return { matched: m, rest: r };
  }, [bundle, route.matchedStops]);

  if (error) {
    return (
      <HStack spacing={10}>
        <Image
          systemName="exclamationmark.triangle"
          size={16}
          color="#8E8E93"
        />
        <Text
          modifiers={[
            foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
            font({ size: 13 }),
          ]}
        >
          Couldn't load stops — {error.message}
        </Text>
      </HStack>
    );
  }
  if (!bundle) {
    return (
      <HStack spacing={10}>
        <ProgressView />
        <Text
          modifiers={[
            foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
            font({ size: 13 }),
          ]}
        >
          Loading stops…
        </Text>
      </HStack>
    );
  }
  return (
    <VStack spacing={14} alignment="leading">
      {matched.length > 0 ? (
        <StopSection
          title="Matched stops"
          stops={matched}
          variant="matched"
          onPick={onPick}
        />
      ) : null}
      {rest.length > 0 ? (
        <StopSection
          title={matched.length > 0 ? 'All stops' : 'Stops'}
          stops={rest}
          variant="default"
          onPick={onPick}
        />
      ) : null}
    </VStack>
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
    <VStack spacing={6} alignment="leading">
      <Text
        modifiers={[
          foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
          font({ size: 12, weight: 'semibold' }),
        ]}
      >
        {title.toUpperCase()}
      </Text>
      <VStack
        spacing={0}
        alignment="leading"
        modifiers={[
          background('#2C2C2E', shapes.roundedRectangle({ cornerRadius: 14 })),
        ]}
      >
        {stops.map((s, i) => (
          <StopRow
            key={s.stop_id}
            stop={s}
            variant={variant}
            isLast={i === stops.length - 1}
            onPress={() => onPick(s)}
          />
        ))}
      </VStack>
    </VStack>
  );
}

function StopRow({
  stop,
  variant,
  isLast,
  onPress,
}: {
  stop: GtfsStop;
  variant: 'matched' | 'default';
  isLast: boolean;
  onPress: () => void;
}) {
  return (
    <Button onPress={onPress} modifiers={[buttonStyle('plain')]}>
      <VStack spacing={0} alignment="leading">
        <HStack
          spacing={12}
          modifiers={[padding({ horizontal: 14, vertical: 12 })]}
        >
          <Image
            systemName={variant === 'matched' ? 'circle.fill' : 'circle'}
            size={10}
            color={variant === 'matched' ? '#0A84FF' : '#636366'}
          />
          <Text modifiers={[font({ size: 15 })]}>
            {formatStopName(stop.stop_name)}
          </Text>
          <Spacer />
          <Image systemName="chevron.right" size={12} color="#8E8E93" />
        </HStack>
        {!isLast ? (
          <HStack
            spacing={0}
            modifiers={[
              padding({ leading: 40 }),
              background('#3A3A3C', shapes.rectangle()),
            ]}
          >
            <Spacer />
          </HStack>
        ) : null}
      </VStack>
    </Button>
  );
}
