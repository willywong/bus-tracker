import { SymbolView } from 'expo-symbols';
import { useRouter } from 'expo-router';
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatStopName } from '@/components/map/format';
import { PlaceThumb } from '@/components/plan/PlaceThumb';
import { EmptyState } from '@/components/sheet/EmptyState';
import { placeTiles, routeRows, type PlaceTile, type RouteRow } from '@/components/sheet/savedModel';
import { Hairline, SectionLabel } from '@/components/trip/Rows';
import { SheetBody } from '@/components/trip/SheetBody';
import { RouteBadge } from '@/components/trip/SheetHeader';
import { openDb } from '@/db/database';
import { getStopsByIds } from '@/db/queries';
import { useSettings } from '@/hooks/useSettings';
import { toPlace, usePlanner } from '@/state/PlannerContext';
import { color, MARGIN, radius, space, type } from '@/theme/design';
import { haptics } from '@/utils/haptics';

/** A place tile: the thumbnail over its label, in a 76 pt square. */
const TILE = 76;
const THUMB = 44;
/** The paper disc carrying a tile's glyph over its map. */
const GLYPH_DISC = 22;
/** Tile labels grow with Dynamic Type only this far: the tile is a fixed 76 pt wide. */
const LABEL_MAX_SCALE = 1.3;

/**
 * The Saved section (plan 16/04): your places as a strip of map tiles, then
 * your routes. A place plans to it, a route starts tracking it and switches
 * to Nearby, and Edit opens Settings. Peek shows the strip alone.
 */
export function SavedSection({ peek, scheme }: { peek: boolean; scheme: 'light' | 'dark' }) {
  const settings = useSettings();
  const router = useRouter();
  const planner = usePlanner();
  const { savedPlaces, favoritedRoutes, preferredStopByRoute, preferredRouteCode } = settings;
  const tiles = useMemo(() => placeTiles(savedPlaces), [savedPlaces]);
  const stopNames = useStopNames(favoritedRoutes, preferredStopByRoute);
  const rows = useMemo(
    () => routeRows(favoritedRoutes, preferredRouteCode, stopNames),
    [favoritedRoutes, preferredRouteCode, stopNames],
  );

  if (savedPlaces.length === 0 && favoritedRoutes.length === 0) {
    return (
      <EmptyState
        icon="bookmark"
        title="Nothing saved yet"
        message="Save a place from trip results, or add a route to track."
        scheme={scheme}
        compact
      />
    );
  }

  const openTile = (tile: PlaceTile) => {
    if (tile.kind === 'place') {
      planner.setTo(toPlace(tile.place));
      router.push('/plan');
    } else if (tile.full) {
      // Six pins: make room in Settings → Places first.
      router.push('/settings');
    } else {
      planner.setTo(null);
      router.push('/plan');
    }
  };

  const track = (code: string) => {
    haptics.selection();
    settings.setPreferredRouteCode(code);
    settings.setSheetSection('nearby');
  };

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}
      >
        {tiles.map((tile) => (
          <PlaceTileView
            key={tile.kind === 'place' ? tile.place.id : 'add'}
            tile={tile}
            onPress={() => openTile(tile)}
          />
        ))}
      </ScrollView>
      {/* Mounted at peek but hidden, as the trip body is, so nothing clips under the strip. */}
      {rows.length > 0 ? (
        <SheetBody peek={peek}>
          <View>
            <View style={styles.titleRow}>
              <SectionLabel>Your routes</SectionLabel>
              <Pressable
                onPress={() => router.push('/settings')}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Edit routes"
                accessibilityHint="Opens Settings"
              >
                <Text style={styles.edit}>Edit</Text>
              </Pressable>
            </View>
            {rows.map((row, i) => (
              <Fragment key={row.code}>
                {i > 0 ? <Hairline /> : null}
                <RouteRowView row={row} onPress={() => track(row.code)} />
              </Fragment>
            ))}
          </View>
        </SheetBody>
      ) : null}
    </View>
  );
}

/** Each favourite's boarding stop name, read from the local GTFS. */
function useStopNames(
  favorites: readonly string[],
  stopByRoute: Record<string, string>,
): Record<string, string> {
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    if (favorites.length === 0) {
      setNames({});
      return;
    }
    (async () => {
      const next: Record<string, string> = {};
      try {
        const db = await openDb();
        const ids = favorites.flatMap((code) => stopByRoute[code] ?? []);
        const byId = new Map<string, string>();
        for (const s of await getStopsByIds(db, ids)) byId.set(s.stop_id, formatStopName(s.stop_name));
        for (const code of favorites) {
          const name = byId.get(stopByRoute[code] ?? '');
          if (name) next[code] = name;
        }
      } catch {
        // Stop names are a nicety; the route code alone still reads.
      }
      if (!cancelled) setNames(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [favorites, stopByRoute]);
  return names;
}

function PlaceTileView({ tile, onPress }: { tile: PlaceTile; onPress: () => void }) {
  if (tile.kind === 'add') {
    return (
      <TileButton
        onPress={onPress}
        label="Add a place"
        hint={tile.full ? 'Six places are pinned. Opens Settings' : 'Searches for a place'}
      >
        <View style={[styles.thumb, styles.add]}>
          <SymbolView name="plus" size={17} weight="medium" tintColor={color.label} />
        </View>
        <Text style={styles.label} numberOfLines={1} maxFontSizeMultiplier={LABEL_MAX_SCALE}>
          Add
        </Text>
      </TileButton>
    );
  }
  const { place } = tile;
  return (
    <TileButton onPress={onPress} label={tile.label} hint="Plans a trip">
      <View style={styles.thumb}>
        <PlaceThumb lat={place.lat} lng={place.lng} size={THUMB} />
        <View style={styles.glyph}>
          <SymbolView name={tile.symbol} size={11} weight="semibold" tintColor={color.label} />
        </View>
      </View>
      <Text style={styles.label} numberOfLines={1} maxFontSizeMultiplier={LABEL_MAX_SCALE}>
        {tile.label}
      </Text>
    </TileButton>
  );
}

/** A 76 pt tile button, dimmed while pressed (as RowButton is). */
function TileButton({
  onPress,
  label,
  hint,
  children,
}: {
  onPress: () => void;
  label: string;
  hint: string;
  children: ReactNode;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
    >
      <View style={[styles.tile, pressed && styles.pressed]}>{children}</View>
    </Pressable>
  );
}

/** Route chip, boarding stop, and a checkmark on the route you're tracking. */
function RouteRowView({ row, onPress }: { row: RouteRow; onPress: () => void }) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={row.stopName ? `${row.code}, ${row.stopName}` : row.code}
      accessibilityHint={row.active ? undefined : 'Tracks this route'}
      accessibilityState={{ selected: row.active }}
    >
      <View style={[styles.routeRow, pressed && styles.pressed]}>
        <RouteBadge code={row.code} />
        <Text style={styles.stop} numberOfLines={1}>
          {row.stopName ?? 'Your stop'}
        </Text>
        {row.active ? (
          <SymbolView name="checkmark" size={15} weight="semibold" tintColor={color.label} />
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  strip: {
    paddingHorizontal: MARGIN,
    paddingTop: space.xxs,
    paddingBottom: space.xs,
    gap: space.xxs,
  },
  tile: {
    width: TILE,
    // Grows with the label at large text sizes, so the thumb never rides up.
    minHeight: TILE,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: {
    position: 'absolute',
    width: GLYPH_DISC,
    height: GLYPH_DISC,
    borderRadius: GLYPH_DISC / 2,
    backgroundColor: color.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  add: {
    borderRadius: radius.row,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.hairline,
  },
  label: {
    ...type.footnote,
    maxWidth: TILE,
    color: color.label,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.55,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  edit: {
    ...type.section,
    fontWeight: '600',
    color: color.label,
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 52,
    paddingVertical: space.xs,
  },
  stop: {
    ...type.body,
    flex: 1,
    color: color.label,
  },
});
