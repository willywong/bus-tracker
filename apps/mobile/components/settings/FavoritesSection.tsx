import {
  Button,
  ContextMenu,
  HStack,
  Image,
  List,
  Section,
  Spacer,
  Text,
  VStack,
} from '@expo/ui/swift-ui';
import {
  accessibilityHint,
  font,
  foregroundStyle,
  frame,
  layoutPriority,
  lineLimit,
  padding,
  truncationMode,
} from '@expo/ui/swift-ui/modifiers';
import { useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';

import { formatStopName } from '@/components/map/format';
import { openDb } from '@/db/database';
import { getRoutes, getStopsForRouteOrdered, type StopRow } from '@/db/queries';
import { useSettings } from '@/hooks/useSettings';
import { useStaticGtfs } from '@/hooks/useStaticGtfs';
import { hex, pick } from '@/theme/design';
import { haptics } from '@/utils/haptics';

import { moveItems } from './reorder';

interface RouteMeta {
  longName: string | null;
  stops: StopRow[];
}

function useFavoritesData(): Map<string, RouteMeta> {
  const { favoritedRoutes } = useSettings();
  const gtfs = useStaticGtfs();
  const [data, setData] = useState<Map<string, RouteMeta>>(new Map());
  const key = favoritedRoutes.join(',');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = await openDb();
        const routes = await getRoutes(db);
        const byCode = new Map<string, string | null>();
        for (const r of routes) byCode.set(r.code, r.long_name ?? null);

        const entries = await Promise.all(
          favoritedRoutes.map(
            async (code) => [code, await getStopsForRouteOrdered(db, code)] as const,
          ),
        );
        if (cancelled) return;
        const next = new Map<string, RouteMeta>();
        for (const [code, stops] of entries) {
          next.set(code, { longName: byCode.get(code) ?? null, stops });
        }
        setData(next);
      } catch (err) {
        console.warn('[settings/favorites] load failed', err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, gtfs.ready, gtfs.result?.generatedAt, gtfs.lastSettledAt]);

  return data;
}

export interface FavoritesSectionProps {
  /** Opens the boarding-stop picker for a route. */
  onRequestChangeStop: (code: string) => void;
  /** The section's last row: add another route. */
  onAddRoute: () => void;
  /** Edit mode (reorder and delete controls); the form owns it. */
  editing: boolean;
  onToggleEditing: () => void;
}

const secondary = foregroundStyle({ type: 'hierarchical', style: 'secondary' });
const tertiary = foregroundStyle({ type: 'hierarchical', style: 'tertiary' });

/** Leading glyph column, so every row's text starts on the same line. */
const ICON_COLUMN = frame({ width: 28 });

/**
 * Your routes, as the system's own lists do it (Health's Pinned, Weather's
 * locations):
 *
 *   Your routes                            Edit
 *   🚌  T786                                  ›
 *       Board at MRT Phileo Damansara Pintu A
 *       Stesen LRT Asia Jaya – Stesen MRT Phileo…
 *   ＋  Add Route
 *
 * Tap a route to change its stop (the chevron says it opens something).
 * Swipe left to remove; long-press for both actions. Edit shows ⊖ to remove
 * and ≡ to reorder. Each line is one line: a long route name truncates
 * rather than wrapping. Colour comes from the form's ink tint.
 */
export function FavoritesSection({
  onRequestChangeStop,
  onAddRoute,
  editing,
  onToggleEditing,
}: FavoritesSectionProps) {
  const settings = useSettings();
  const data = useFavoritesData();
  const routes = settings.favoritedRoutes;
  const empty = routes.length === 0;

  let footer: string;
  if (empty) footer = 'Add a route to see its buses and times on the map.';
  else if (editing)
    footer = 'Drag ≡ to reorder, or tap ⊖ to remove. The route menu on the map follows this order.';
  else footer = 'Tap a route to change your stop. Swipe left to remove it.';

  return (
    <Section
      header={
        <HStack>
          <Text>Your routes</Text>
          <Spacer />
          {empty ? null : (
            <Button onPress={onToggleEditing}>
              <Text modifiers={[font({ size: 15, weight: editing ? 'semibold' : 'regular' })]}>
                {editing ? 'Done' : 'Edit'}
              </Text>
            </Button>
          )}
        </HStack>
      }
      footer={<Text>{footer}</Text>}
    >
      <List.ForEach
        data={routes}
        keyExtractor={(code) => code}
        recycling={false}
        onMove={(from, to) => {
          haptics.selection();
          settings.reorderFavorites(moveItems(routes, from, to));
        }}
        onDelete={(indices) => {
          for (const i of indices) {
            const code = routes[i];
            if (code) settings.removeFavorite(code);
          }
        }}
      >
        {({ item: code }) => (
          <FavoriteRow
            code={code}
            meta={data.get(code) ?? null}
            editing={editing}
            onChangeStop={() => onRequestChangeStop(code)}
          />
        )}
      </List.ForEach>
      <Button onPress={onAddRoute}>
        <HStack spacing={12} modifiers={[padding({ vertical: 4 })]}>
          <Image systemName="plus" size={17} modifiers={[ICON_COLUMN]} />
          <Text>Add Route</Text>
          <Spacer />
        </HStack>
      </Button>
    </Section>
  );
}

interface FavoriteRowProps {
  code: string;
  meta: RouteMeta | null;
  editing: boolean;
  onChangeStop: () => void;
}

/** "Stesen A ~ Stesen B" → "Stesen A – Stesen B". */
function routeName(longName: string): string {
  return longName
    .split('~')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' – ');
}

function FavoriteRow({ code, meta, editing, onChangeStop }: FavoriteRowProps) {
  const settings = useSettings();
  const gtfs = useStaticGtfs();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const stops = meta?.stops ?? [];
  const selectedStopId = settings.preferredStopByRoute[code];
  const selectedStop = useMemo(
    () => stops.find((s) => s.stop_id === selectedStopId) ?? null,
    [stops, selectedStopId],
  );
  const bootstrapFailed = gtfs.failed.has(code);
  const isRefreshing = gtfs.refreshing.has(code);
  let stopLabel: string;
  if (isRefreshing) {
    stopLabel = 'Retrying…';
  } else if (bootstrapFailed) {
    stopLabel = "Couldn't load stops. Tap to try again.";
  } else if (meta == null) {
    stopLabel = 'Loading…';
  } else if (selectedStop) {
    stopLabel = `Board at ${formatStopName(selectedStop.stop_name)}`;
  } else {
    stopLabel = 'Choose where you board';
  }
  const longName =
    meta?.longName && meta.longName.trim() !== code ? routeName(meta.longName) : null;

  const remove = () => settings.removeFavorite(code);
  const retry = () => void gtfs.retry(code);
  const onPress = bootstrapFailed ? retry : onChangeStop;

  const oneLine = [lineLimit(1), truncationMode('tail')];

  const row = (
    <Button
      onPress={onPress}
      modifiers={[
        accessibilityHint(
          bootstrapFailed ? 'Tries loading the stops again' : 'Changes where you board',
        ),
      ]}
    >
      <HStack spacing={12} alignment="center" modifiers={[padding({ vertical: 4 })]}>
        <Image systemName="bus.fill" size={17} modifiers={[ICON_COLUMN]} />
        <VStack spacing={2} alignment="leading" modifiers={[layoutPriority(1)]}>
          <Text modifiers={[font({ size: 17, weight: 'semibold' })]}>{code}</Text>
          <Text
            modifiers={[
              font({ size: 15 }),
              bootstrapFailed ? foregroundStyle(pick(hex.warning, scheme)) : secondary,
              ...oneLine,
            ]}
          >
            {stopLabel}
          </Text>
          {longName ? (
            <Text modifiers={[font({ size: 13 }), tertiary, ...oneLine]}>{longName}</Text>
          ) : null}
        </VStack>
        <Spacer />
        {editing ? null : (
          <Image
            systemName={bootstrapFailed ? 'arrow.clockwise' : 'chevron.right'}
            size={13}
            modifiers={[font({ size: 13, weight: 'semibold' }), tertiary]}
          />
        )}
      </HStack>
    </Button>
  );

  // The long-press menu's lift gesture fights the list's drag-to-reorder
  // (the dragged row detaches and never drops), so edit mode gets the bare
  // row: ⊖ and ≡ cover what the menu does.
  if (editing) return row;

  return (
    <ContextMenu>
      <ContextMenu.Trigger>{row}</ContextMenu.Trigger>
      <ContextMenu.Items>
        {bootstrapFailed ? (
          <Button systemImage="arrow.clockwise" label="Try Again" onPress={retry} />
        ) : null}
        <Button systemImage="mappin.and.ellipse" label="Change Stop" onPress={onChangeStop} />
        <Button systemImage="trash" role="destructive" label="Remove Route" onPress={remove} />
      </ContextMenu.Items>
    </ContextMenu>
  );
}
