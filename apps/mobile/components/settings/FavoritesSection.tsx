import {
  Button,
  HStack,
  Image,
  Menu,
  Section,
  Spacer,
  Text,
  VStack,
} from '@expo/ui/swift-ui';
import {
  font,
  foregroundStyle,
  padding,
} from '@expo/ui/swift-ui/modifiers';
import { useEffect, useMemo, useState } from 'react';

import { formatStopName } from '@/components/map/format';
import { openDb } from '@/db/database';
import { getRoutes, getStopsForRouteOrdered, type StopRow } from '@/db/queries';
import { useSettings } from '@/hooks/useSettings';
import { useStaticGtfs } from '@/hooks/useStaticGtfs';
import { color } from '@/theme/design';

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
            async (code) =>
              [code, await getStopsForRouteOrdered(db, code)] as const,
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
  /**
   * Called when the user taps "Change boarding stop" on a favourite row.
   * Parent owns the bottom-sheet presentation state.
   */
  onRequestChangeStop: (code: string) => void;
}

export function FavoritesSection({
  onRequestChangeStop,
}: FavoritesSectionProps) {
  const settings = useSettings();
  const data = useFavoritesData();

  if (settings.favoritedRoutes.length === 0) {
    return (
      <Section
        header={<Text>Your routes</Text>}
        footer={<Text>Routes you add appear here and in the route menu on the map.</Text>}
      >
        <HStack spacing={12} modifiers={[padding({ vertical: 6 })]}>
          <Image systemName="bus.fill" size={18} color={color.secondaryLabel} />
          <Text
            modifiers={[
              foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
            ]}
          >
            No routes yet
          </Text>
        </HStack>
      </Section>
    );
  }

  return (
    <Section
      header={<Text>Your routes</Text>}
      footer={<Text>Tap a route to change where you board, reorder, or remove it.</Text>}
    >
      {settings.favoritedRoutes.map((code, index) => (
        <FavoriteRow
          key={code}
          code={code}
          index={index}
          count={settings.favoritedRoutes.length}
          meta={data.get(code) ?? null}
          onChangeStop={() => onRequestChangeStop(code)}
        />
      ))}
    </Section>
  );
}

interface FavoriteRowProps {
  code: string;
  index: number;
  count: number;
  meta: RouteMeta | null;
  onChangeStop: () => void;
}

function FavoriteRow({
  code,
  index,
  count,
  meta,
  onChangeStop,
}: FavoriteRowProps) {
  const settings = useSettings();
  const gtfs = useStaticGtfs();
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
    stopLabel = "Couldn't load — tap to retry";
  } else if (meta == null) {
    stopLabel = 'Loading…';
  } else if (selectedStop) {
    stopLabel = formatStopName(selectedStop.stop_name);
  } else {
    stopLabel = 'Pick a stop';
  }
  const longName =
    meta?.longName && meta.longName.trim() !== code ? meta.longName : null;

  const moveUp = () => {
    if (index === 0) return;
    const next = [...settings.favoritedRoutes];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    settings.reorderFavorites(next);
  };

  const moveDown = () => {
    if (index >= count - 1) return;
    const next = [...settings.favoritedRoutes];
    [next[index + 1], next[index]] = [next[index], next[index + 1]];
    settings.reorderFavorites(next);
  };

  const remove = () => {
    settings.removeFavorite(code);
  };

  const retry = () => {
    void gtfs.retry(code);
  };

  return (
    <Menu
      label={
        <HStack spacing={12} modifiers={[padding({ vertical: 6 })]}>
          <Image systemName="bus.fill" size={18} color={color.accent} />
          <VStack spacing={2} alignment="leading">
            <HStack spacing={8}>
              <Text>{code}</Text>
              {longName ? (
                <Text
                  modifiers={[
                    foregroundStyle({
                      type: 'hierarchical',
                      style: 'tertiary',
                    }),
                  ]}
                >
                  {longName}
                </Text>
              ) : null}
            </HStack>
            <Text
              modifiers={[
                font({ size: 13 }),
                foregroundStyle(
                  bootstrapFailed
                    ? color.warning
                    : { type: 'hierarchical', style: 'secondary' },
                ),
              ]}
            >
              {stopLabel}
            </Text>
          </VStack>
          <Spacer />
          <Image systemName="ellipsis.circle" size={16} />
        </HStack>
      }
    >
      {bootstrapFailed ? (
        <Button
          systemImage="arrow.clockwise"
          label="Retry loading stops"
          onPress={retry}
        />
      ) : null}
      <Button
        systemImage="mappin.circle"
        label="Change boarding stop"
        onPress={onChangeStop}
      />
      <Button
        systemImage="arrow.up"
        label="Move up"
        onPress={moveUp}
      />
      <Button
        systemImage="arrow.down"
        label="Move down"
        onPress={moveDown}
      />
      <Button
        systemImage="trash"
        role="destructive"
        label="Remove"
        onPress={remove}
      />
    </Menu>
  );
}
