# 13-Rail-Experience / 02 — Rail Map Layer

**Build impact:** JS-only (Metro reload)

## Context

- The map is `apps/mobile/app/index.tsx`. `MapView` (`index.tsx:334-355`, Apple Maps via `PROVIDER_DEFAULT`) hosts `RouteLayer` (`index.tsx:356-373`), the ghost bus and `BusMarker`s. Overlay colours come from `hex` + `pick` with a satellite → dark palette rule (`index.tsx:313-319`).
- Today only stations near your stop are drawn: `railStations` memo (`index.tsx:92-103`, `nearbyRailStations`) feeds the `RailStationMark` squares in `RouteLayer.tsx:150-170` (type at `RouteLayer.tsx:10-17`, style `rail`/`railDot` at `RouteLayer.tsx:258-271`).
- Marker rules (`RouteLayer.tsx:41-49`, `BusMarker.tsx:19-25`): Apple Maps ignores `anchor`, so every marker view is fixed-size, glyph centred, wrapper `collapsable={false}`.
- **Z-order on Apple Maps:** `Polyline.zIndex` is "Google Maps only" on iOS (`node_modules/react-native-maps/dist/src/MapPolyline.d.ts:117-125`), so `RouteLayer`'s `zIndex={0}` is a no-op. Overlays stack in add order, and any prop change re-adds an overlay on top (`RouteShimmer.tsx:42-49`). `RouteLayer` already remounts runs rather than mutating (`RouteLayer.tsx:72-74`).
- Map type is persisted as `bt.mapType` (`hooks/useSettings.ts:91-101`, setter `:328-334`); Standard/Satellite currently sit in the More menu (`index.tsx:489-505`).
- SQLite `shape_points` (`db/schema.ts:35-41`) belongs to followed bus routes: `deleteRouteRows` (`db/bootstrap.ts:142-147`) and the v4 migration (`db/database.ts:60-65`) delete shapes no `trips` row references. Rail has no rows in `trips`.

## Goal

A `RailLayer` that draws every rail line in its official colour under the bus route, station squares that open the station sheet, and a toolbar **Layers** menu persisted as `bt.mapLayers`.

## Prerequisites

- 13/01 merged. Phase 12/06 (`useTransitNetwork()`, `network_blobs`) and 12/02 (shapes lon/lat swap fixed) merged.

## Steps

1. **Rail geometry store: a dedicated table, not `shape_points`.** Add to `db/schema.ts` DDL and bump `SCHEMA_VERSION` one past 12/06's value:
   ```sql
   CREATE TABLE IF NOT EXISTS rail_shapes (
     route_id TEXT PRIMARY KEY NOT NULL,   -- network routes.id ('rail:KJ', 'ktm:…')
     shape_id TEXT NOT NULL,
     coords BLOB NOT NULL                  -- Float32Array [lat0, lng0, lat1, lng1, …]
   );
   ```
   Why: `shape_points` rows are pruned whenever no bus trip references them, its ids are un-namespaced (collision risk with feeder ids), and reading 8 lines × thousands of rows per map mount is slower than 10 BLOBs. Geometry stays in SQLite as spec §3.3 says; only the table is new.
2. **Write it in the rail step of the 12/06 refresh**, inside the same transaction as the network blob: for each rail route, take `network.routes.shapeId[r]`, simplify its `shapes.txt` points (Douglas–Peucker, 5 m tolerance; put `simplifyPath` in `packages/shared/src/transit/shapes.ts` with a test), encode, `INSERT OR REPLACE`. Never delete rows on feed expiry: an expired feed keeps the last good geometry.
3. **Pure model** `apps/mobile/components/map/railModel.ts` (tests in `components/map/__tests__/railModel.test.ts`):
   ```ts
   export interface RailLineDraw { routeId: string; color: string; coords: { latitude: number; longitude: number }[] }
   export function railLines(net: TransitNetwork | null, shapes: ReadonlyMap<string, Float32Array>): RailLineDraw[];
   export function railStationMarks(stations: readonly RailStation[]): RailStationMark[];
   export function railAlpha(routeId: string, focus: readonly string[] | null, dim: boolean): 'FF' | '59' | '26';
   export function zoomFromRegion(longitudeDelta: number, widthPts: number): number;
   ```
   - KTM (no shapes, phase 12 hand-off): straight segments between the stops of the route's longest pattern, in stop order.
   - No network yet (first launch offline) or rail excluded: fall back to `RAIL_STATIONS` grouped by line, ordered by the numeric part of each `stopIds` code (`KJ1…KJ37`, `KG18A` after `KG18`).
   - `railAlpha`: focus non-null → `FF` for listed routes, `26` (15%) for others; else `59` (35%) when `dim`, else `FF`. Hex suffix on `#RRGGBB`, same trick as `inkMuted` (`index.tsx:366`).
   - `zoomFromRegion`: `log2(360 · (widthPts / 256) / longitudeDelta)`.
4. **`components/map/RailLayer.tsx`**, memoised like `RouteLayer`:
   ```ts
   interface RailLayerProps {
     lines: RailLineDraw[]; stations: RailStationMark[];
     focus: readonly string[] | null;  // route ids at 100 %, others 15 %
     dim: boolean;                     // zoom < 11
     showAllStations: boolean;         // zoom ≥ 12
     paper: string; ink: string;
     onStationPress?: (stationId: string) => void;
   }
   ```
   - Per line: a casing `Polyline` (`strokeWidth 5`, `paper`, i.e. 1 pt each side) then the line (`strokeWidth 3`, `color + railAlpha(...)`), `lineCap`/`lineJoin` round. Casing alpha follows the line's.
   - Stations: reuse the square from `RouteLayer.tsx:159-168`, but fixed-size: frame `RAIL + (n − 1) · 9` wide, 20 tall, `collapsable={false}`; one 8 pt dot per line colour (interchange = split square). `displayPriority` `high` for interchanges, `low` otherwise. Below zoom 12 render interchanges only (~25 markers), at ≥ 12 all (~190).
   - `accessibilityLabel`: `"Kelana Jaya Line and Kajang Line station, Pasar Seni"`.
5. **Z-order wiring in `index.tsx`:** render `<RailLayer>` as the first `MapView` child, before `RouteLayer`. Compute `railKey = \`${dim}|${focus?.join(',')}|${layers.rail}\``; key `RailLayer` by it **and** append it to `RouteLayer`'s key (`index.tsx:358`) so the bus route is re-added after the rail overlays whenever rail restyles. Flips are rare (zoom threshold, focus change, toggle).
6. **Zoom state without per-frame renders:** in `onRegionChangeComplete` (`index.tsx:153-165`) read the region argument, compute zoom, and `setState` only when `dim` or `showAllStations` changes.
7. **Station duplicates:** when the rail layer is on, pass `railStations={[]}` to `RouteLayer`; keep the `index.tsx:92-103` squares when it is off.
8. **Settings key** in `hooks/useSettings.ts`: add `mapLayers: { myBuses: boolean; rail: boolean }` to `Settings` (`:31-48`), default `{ myBuses: true, rail: true }` in `DEFAULT_SETTINGS` (`:50-60`), `STORAGE_KEYS.mapLayers = 'bt.mapLayers'` (JSON), a tolerant `parseMapLayers`, load it in `loadFromStore` (`:170-208`), and `setMapLayer(key, on)` mirroring `setMapType`. Satellite stays `bt.mapType`.
9. **Layers menu** in `MapToolbar` (`index.tsx:439-518`), trailing group before Recenter:
   ```tsx
   <Stack.Toolbar.Menu icon="square.3.layers.3d" accessibilityLabel="Map layers">
     <Stack.Toolbar.MenuAction icon="bus.fill" isOn={layers.myBuses} onPress={…}>My buses</Stack.Toolbar.MenuAction>
     <Stack.Toolbar.MenuAction icon="bus" disabled subtitle="Soon">Buses nearby</Stack.Toolbar.MenuAction>
     <Stack.Toolbar.MenuAction icon="tram.fill" isOn={layers.rail} onPress={…}>Rail lines</Stack.Toolbar.MenuAction>
     <Stack.Toolbar.MenuAction icon="globe.asia.australia" isOn={mapType === 'satellite'} onPress={…}>Satellite</Stack.Toolbar.MenuAction>
   </Stack.Toolbar.Menu>
   ```
   `isOn`, `disabled`, `subtitle` exist on `MenuAction` (`expo-router/build/layouts/stack-utils/toolbar/StackToolbarMenu/types.d.ts`). Remove the "Map" inline section from More (`index.tsx:490-505`). `haptics.selection()` on each toggle (a decision). Keep `MapToolbar` memoised on primitives: pass `railOn`, `myBusesOn` booleans.
10. **My buses off** hides `RouteLayer`, `RouteShimmer`, ghost and bus markers; the trip sheet is unaffected.
11. **Station tap** → `onStationPress(id)` → `router.push({ pathname: '/station', params: { station: id } })` (route arrives in 03; wired fully in 05). No haptic: opening is navigation, not a decision.
12. **Tests** (`components/map/__tests__/railModel.test.ts`):
    - `railAlpha dims to 59 below zoom 11 and is FF otherwise`
    - `railAlpha focus keeps listed routes FF and drops others to 26`
    - `railLines builds KTM from stop order when shapeId is empty`
    - `railLines falls back to RAIL_STATIONS code order when network is null`
    - `railStationMarks gives interchanges one colour per line`
    - `zoomFromRegion returns ~11 for KL_REGION on a 393 pt wide screen`

## Verification

- `pnpm --filter mobile test`, `pnpm --filter @bus-tracker/shared test`, `pnpm type-check` all green.
- Device (Metro reload): all 8 lines + KTM visible in official colours; bus route sits **above** rail after zooming across 11 and toggling Rail lines; lines fade at zoom < 11.
- Pan the map with ~190 station markers: no visible hitch; markers stay on their coordinates when zooming out (no drift).
- Light, dark and Satellite: casing reads on all three. Layers menu state survives an app relaunch.
- VoiceOver: station squares read their lines and name. Dynamic Type XL: map unaffected (markers ignore font scale).
- Airplane mode on a fresh install: lines draw from the `RAIL_STATIONS` fallback.

## Handoff to next step ([03-station-sheet.md](./03-station-sheet.md))

- `RailLayer` with `focus` prop exists; `index.tsx` keeps `railKey` ordering so restyles never cover the bus route.
- `bt.mapLayers` persisted; Layers menu replaces the More → Map section.
- Station taps push `/station?station=<slug>`; 03 creates the screen, 05 adds focus/framing via `TripContext`.

## Implementation notes

- **Schema v9** (12/06 left it at v8). `rail_shapes` is in the DDL exactly as specified; the v8 → v9 step in `db/database.ts` has nothing to backfill. `META_KEYS.railShapesHash` records the rail feed hash the table was last written from.
- **Not in the blob's transaction.** Shapes are written by `refreshRailShapes` (`services/railShapes.ts`), called once at the end of `refreshTransitNetwork`, before `pruneBlobs`. It uses its own `withTransactionAsync`: the rows plus the hash go in together. It doesn't share the blob's transaction for two reasons. The blobs are per date, while the geometry is per rail feed version. And with 12/07's health check an expired rail feed is compiled out of the blob, yet its geometry must stay.
  - **When it writes:** when the stored rail feed's hash differs from `railShapesHash`. That covers a new rail feed, and a fresh install or the v9 upgrade, where there is no hash yet and the stored zip is read. The daily rebuild of "tomorrow" doesn't write again.
  - **Rows are only replaced** (`INSERT OR REPLACE`), never deleted.
- **Rail is read with shapes.** Both `readFeedSteps` calls in the refresh pass `{ shapes: d.feed === "rail" }` / `{ shapes: f === "rail" }`, so a rail read during the refresh is reused. Otherwise the stored zip is read once more.
- **Sliced.** `railShapesSteps` yields every 2,048 trip or shape rows and after each route. On the fixture, all 8 lines take 1.8 ms on Node and the longest step is well under 1 ms; the test asserts < 10 ms.
- **Shape per route:** the route's first trip's `shape_id`, the same rule `compileNetwork` uses for `routes.shapeId`, read from the parsed rail feed. The network isn't needed, which matters when rail is compiled out.
  - Keys are the network route ids: `rail:AG`, `rail:KJ`, `rail:PH`, `rail:KGL`, `rail:PYL`, `rail:MR`, `rail:BRT`, `rail:SA`.
  - Simplified at 5 m (`simplifyPath` in `packages/shared/src/transit/shapes.ts`), this is 1,412 points in all: AG 82, KJ 256, SP 203, KG 300, PY 325, MR 70, BRT 38, SA 138.
- **Shapes reach the map** through `useRailShapes(network)` (`hooks/useRailShapes.ts`). It reads `rail_shapes` on mount and again whenever the provider swaps in a network; the refresh writes shapes before it reloads the network.
- **`railModel.ts` deviations.**
  - The station type is `RailStationDraw` (`id, name, lat, lng, colors, interchange, label`) rather than `RailStationMark`, which stays `RouteLayer`'s type for the nearby squares.
  - Extra exports: `hasRailFeed`, `railStationsFor(net)`, `spokenLineName`, `railZoomBand`, `RAIL_DIM_BELOW_ZOOM` = 11 and `RAIL_ALL_STATIONS_FROM_ZOOM` = 12.
  - **Route ids in the fallback.** With no network, or with rail compiled out, the bundled lines use the `RailLine.code` ('LRT KJ', 'MRT KG', …) as `routeId`, since the network ids can't be derived from `RAIL_STATIONS`. KTM still comes from the network when it is there. `focus` ids therefore only match a network that has rail.
  - **Stations.** `railStationsFor(net)` is `net.stations` when rail is in; otherwise `RAIL_STATIONS` plus the network's KTM stations.
  - A rail route whose shape isn't stored yet draws station to station along its longest pattern, the same rule as KTM.
- **`interchange`** means more than one distinct line name. A station gets one 8 pt dot per distinct colour, in a square `20 + (n − 1) · 9` wide, the same square as `RouteLayer`'s. The accessibility label drops the "LRT/MRT/BRT " prefix: "Kelana Jaya Line and Kajang Line station, Pasar Seni".
- **`railKey` also carries a lines signature.** The key is `${dim}|${focus}|${layers.rail}|${routeId:pointCount,…}`. Without the signature, new lines after a refresh would re-render `RailLayer` in place and cover the bus route. With rail off it is the constant `'rail-off'`, so crossing zoom 11 doesn't remount `RouteLayer`.
- **Zoom** is kept as a 3-value band state (`RailZoomBand`), set in `onRegionChangeComplete(region)` from `region.longitudeDelta` and the window width. React bails out when the band is unchanged.
- **My buses off** hides `RouteLayer`, `RouteShimmer`, the ghost bus and the bus markers. The bus markers first have their glides stopped, then unmount on the next render (`busMarkersShown`), because unmounting a marker mid-animation trips Fabric (see `useGlidingMarkers`).
- **Focus is wired but unset.** `railFocus` is the module constant `NO_RAIL_FOCUS` (null). 13/05 (selection) and 15/05 (itinerary) replace it with real state; `railKey` already includes it.
- **`/station` push.** `router.push({ pathname: '/station', params: { station } } as unknown as Href)`, cast because typed routes don't know `/station` until 13/03 adds `app/station.tsx`. Remove the cast then. Until 13/03, a tap lands on `+not-found`.
- **Settings.** `mapLayers` is `{ myBuses, rail }`, stored as JSON in `bt.mapLayers`. `parseMapLayers` is exported and keeps the default for any missing or invalid field. `setMapLayer(key, on)` is available. The Layers menu replaces More → Map, and Satellite toggles `bt.mapType` between standard and satellite.
- **Tests:**
  - `components/map/__tests__/railModel.test.ts` (8): the 6 specified, plus "stored shape vs stops" and "rail feed left out".
  - `services/__tests__/railShapes.test.ts` (4): fixture shapes, BLOB round trip, write-once/never-delete, and a refresh integration.
  - `packages/shared/src/transit/__tests__/shapes.test.ts` (5).
- **Build impact:** JS-only (Metro reload). No new native modules or config; the SQLite table is created at runtime by the DDL.
