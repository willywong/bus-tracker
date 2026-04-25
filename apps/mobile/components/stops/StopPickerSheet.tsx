import type { GtfsStop, T816Bundle } from '@bus-tracker/shared';
import {
  orderStopsByTrip,
  pickRepresentativeTrip,
} from '@bus-tracker/shared';
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
  Toggle,
  VStack,
} from '@expo/ui/swift-ui';
import {
  background,
  buttonStyle,
  font,
  foregroundStyle,
  padding,
  presentationBackgroundInteraction,
  presentationDetents,
  presentationDragIndicator,
  shapes,
  type PresentationDetent,
} from '@expo/ui/swift-ui/modifiers';
import { useEffect, useMemo, useState } from 'react';
import { useWindowDimensions } from 'react-native';

import { formatStopName } from '@/components/map/format';
import { fetchRouteBundle } from '@/services/routeBundle';

/**
 * Minimal route descriptor consumed by the stop picker. Does not reference
 * `RouteSearchHit` so non-search callers (Settings) can construct one from a
 * plain route code.
 */
export interface StopPickerRoute {
  code: string;
  long_name?: string;
  /**
   * Stop IDs that should be surfaced in a "Matched stops" section at the top.
   * Pass `[]` (or omit) when there's no search context — all stops will land
   * in a single "Stops" section.
   */
  matchedStopIds?: readonly string[];
}

// ---------------------------------------------------------------------------
// Full sheet wrapper — used when the caller needs the bottom-sheet chrome too
// (Settings "Change boarding stop"). AddBusSheet / GlassDemoSheet render
// their own chrome and just embed <StopPickerContent/> inside.
// ---------------------------------------------------------------------------

export interface StopPickerSheetProps {
  isPresented: boolean;
  route: StopPickerRoute | null;
  title?: string;
  onPick: (stop: GtfsStop) => void;
  onDismiss: () => void;
}

export function StopPickerSheet({
  isPresented,
  route,
  title = 'Pick a stop',
  onPick,
  onDismiss,
}: StopPickerSheetProps) {
  const { width } = useWindowDimensions();
  const [detent, setDetent] = useState<PresentationDetent>('medium');

  useEffect(() => {
    if (isPresented) setDetent('medium');
  }, [isPresented]);

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
            <VStack
              spacing={16}
              alignment="leading"
              modifiers={[padding({ horizontal: 20, top: 18, bottom: 28 })]}
            >
              <PickerHeader title={title} onDismiss={onDismiss} />
              {route ? (
                <>
                  <RouteBanner route={route} />
                  <StopPickerContent route={route} onPick={onPick} />
                </>
              ) : null}
            </VStack>
          </ScrollView>
        </Group>
      </BottomSheet>
    </Host>
  );
}

function PickerHeader({
  title,
  onDismiss,
}: {
  title: string;
  onDismiss: () => void;
}) {
  return (
    <HStack spacing={12}>
      <Text modifiers={[font({ size: 20, weight: 'bold' })]}>{title}</Text>
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

export function RouteBanner({ route }: { route: StopPickerRoute }) {
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

// ---------------------------------------------------------------------------
// Inner content — fetches the bundle, orders stops by route sequence, and
// renders the sectioned list. Re-used by Add Bus's multi-step flow.
// ---------------------------------------------------------------------------

export interface StopPickerContentProps {
  route: StopPickerRoute;
  onPick: (stop: GtfsStop) => void;
}

export function StopPickerContent({ route, onPick }: StopPickerContentProps) {
  const [bundle, setBundle] = useState<T816Bundle | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [accessibleOnly, setAccessibleOnly] = useState(false);

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

  const hasAnyAccessible = useMemo(
    () => (bundle?.stops ?? []).some((s) => s.wheelchair_boarding === 1),
    [bundle],
  );

  const { matched, rest } = useMemo(() => {
    if (!bundle) return { matched: [] as GtfsStop[], rest: [] as GtfsStop[] };
    const repTrip = pickRepresentativeTrip(bundle);
    const ordered = orderStopsByTrip(bundle, repTrip?.tripId ?? null);
    const matchedIds = new Set(route.matchedStopIds ?? []);
    const filtered = accessibleOnly
      ? ordered.filter((s) => s.wheelchair_boarding === 1)
      : ordered;
    const m: GtfsStop[] = [];
    const r: GtfsStop[] = [];
    for (const s of filtered) {
      (matchedIds.has(s.stop_id) ? m : r).push(s);
    }
    return { matched: m, rest: r };
  }, [bundle, route.matchedStopIds, accessibleOnly]);

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
  const emptyFiltered =
    accessibleOnly && matched.length === 0 && rest.length === 0;

  return (
    <VStack spacing={14} alignment="leading">
      {hasAnyAccessible ? (
        <HStack spacing={10}>
          <Image systemName="figure.roll" size={16} color="#0A84FF" />
          <Text modifiers={[font({ size: 14 })]}>Accessible stops only</Text>
          <Spacer />
          <Toggle
            isOn={accessibleOnly}
            onIsOnChange={setAccessibleOnly}
          />
        </HStack>
      ) : null}
      {emptyFiltered ? (
        <HStack spacing={10}>
          <Image systemName="info.circle" size={16} color="#8E8E93" />
          <Text
            modifiers={[
              foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
              font({ size: 13 }),
            ]}
          >
            No accessible stops on this route.
          </Text>
        </HStack>
      ) : null}
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
  const accessible = stop.wheelchair_boarding === 1;
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
          {accessible ? (
            <Image systemName="figure.roll" size={13} color="#0A84FF" />
          ) : null}
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
