import {
  Button,
  HStack,
  Image,
  Menu,
  Section,
  Spacer,
  Text,
} from '@expo/ui/swift-ui';
import {
  foregroundStyle,
  padding,
} from '@expo/ui/swift-ui/modifiers';
import { useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS } from 'react-native';

import { formatStopName } from '@/components/map/format';
import { openDb } from '@/db/database';
import { getRoutes, getStopsForRoute, type StopRow } from '@/db/queries';
import { useSettings } from '@/hooks/useSettings';
import { useStaticGtfs } from '@/hooks/useStaticGtfs';

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
              [code, await getStopsForRoute(db, code)] as const,
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
  }, [key, gtfs.ready, gtfs.result?.generatedAt]);

  return data;
}

export function FavoritesSection() {
  const settings = useSettings();
  const data = useFavoritesData();

  if (settings.favoritedRoutes.length === 0) {
    return (
      <Section
        header={<Text>Favorite buses</Text>}
        footer={
          <Text>
            Add favorites from the bus dropdown on Tracker to see them here.
          </Text>
        }
      >
        <HStack spacing={12} modifiers={[padding({ vertical: 6 })]}>
          <Image systemName="bus.fill" size={18} color="#8E8E93" />
          <Text
            modifiers={[
              foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
            ]}
          >
            No favorites yet
          </Text>
        </HStack>
      </Section>
    );
  }

  return (
    <Section
      header={<Text>Favorite buses</Text>}
      footer={
        <Text>
          Tap a favorite to change its boarding stop, reorder, or remove it.
        </Text>
      }
    >
      {settings.favoritedRoutes.map((code, index) => (
        <FavoriteRow
          key={code}
          code={code}
          index={index}
          count={settings.favoritedRoutes.length}
          meta={data.get(code) ?? null}
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
}

function FavoriteRow({ code, index, count, meta }: FavoriteRowProps) {
  const settings = useSettings();
  const stops = meta?.stops ?? [];
  const selectedStopId = settings.preferredStopByRoute[code];
  const selectedStop = useMemo(
    () => stops.find((s) => s.stop_id === selectedStopId) ?? null,
    [stops, selectedStopId],
  );
  const stopLabel = selectedStop
    ? formatStopName(selectedStop.stop_name)
    : meta == null
      ? 'Loading…'
      : 'Pick a stop';

  const openStopPicker = () => {
    if (stops.length === 0) return;
    const names = stops.map((s) => formatStopName(s.stop_name));
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: `${code} — boarding stop`,
        options: [...names, 'Cancel'],
        cancelButtonIndex: names.length,
      },
      (choice) => {
        if (choice == null || choice === names.length) return;
        const stop = stops[choice];
        if (stop) settings.setPreferredStopForRoute(code, stop.stop_id);
      },
    );
  };

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

  return (
    <Menu
      label={
        <HStack
          spacing={12}
          modifiers={[padding({ vertical: 6 })]}
        >
          <Image systemName="bus.fill" size={18} color="#8E8E93" />
          <Text>{code}</Text>
          {meta?.longName ? (
            <Text
              modifiers={[
                foregroundStyle({ type: 'hierarchical', style: 'tertiary' }),
              ]}
            >
              {meta.longName}
            </Text>
          ) : null}
          <Spacer />
          <Text
            modifiers={[
              foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
            ]}
          >
            {stopLabel}
          </Text>
          <Image systemName="ellipsis.circle" size={16} />
        </HStack>
      }
    >
      <Button
        systemImage="mappin.circle"
        label="Change boarding stop"
        onPress={openStopPicker}
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
