# 12-Transit-Network / 01 — Shared types, feed ids and modes

**Build impact:** JS-only (Metro reload)

## Context
- `GtfsRoute` (`packages/shared/src/types/gtfs.ts:3`) has only `route_id`, `route_short_name` and `route_long_name`. `GtfsStop` (`gtfs.ts:9`) has id, name, lat/lon and `wheelchair_boarding`.
- `parseGtfsZip` maps `routes.txt` at `packages/shared/src/utils/gtfs-parser.ts:256` and `stops.txt` at `:264`, so new columns are dropped today.
- `RailMode` is `"LRT" | "MRT" | "Monorail" | "BRT"` (`packages/shared/src/utils/rail.ts:5`).
  - `packages/shared/scripts/build-rail-stations.ts:65` orders modes with `MODE_ORDER`.
  - No mobile code switches on `RailMode`. A grep of `apps/mobile` finds no consumer.
- Id namespaces exist only for bus categories: `namespaceId` at `packages/shared/src/utils/categories.ts:154`, prefixes at `:53`–`:89`. Rail and KTMB have no prefix yet.
- Spec §3.2 and §3.3 define `FeedId`, `Mode` and `TransitNetwork`. This task adds types only. Behaviour comes in 02–05.

## Goal
Add the shared vocabulary for phase 12:
- optional GTFS fields, parsed when present;
- `RailMode` plus `KTM`;
- `FeedId` and `Mode` with their feed metadata;
- the `TransitNetwork` interface exactly as spec §3.3.

Existing bundles and tests must keep working unchanged.

## Prerequisites
- Task 00: the fixtures exist, so the parser test can use a real `routes.txt` with `route_color`.

## Steps

1. **Optional GTFS fields** in `packages/shared/src/types/gtfs.ts`:
   ```ts
   export interface GtfsRoute { route_id: RouteId | string; route_short_name: string; route_long_name?: string;
     route_type?: number; route_color?: string; route_text_color?: string }
   export interface GtfsStop { /* existing */ location_type?: number; parent_station?: string }
   ```
   Parse them in `parseGtfsZip` (`gtfs-parser.ts:256` and `:264`):
   - Leave a field `undefined` when its column is blank or absent.
   - Keep colours as the raw 6-hex string, without `#`.
   - Use `num()` for `route_type` and `location_type` only when the cell is non-empty.

2. **KTM rail mode** in `packages/shared/src/utils/rail.ts:5`: `export type RailMode = "LRT" | "MRT" | "Monorail" | "BRT" | "KTM";`.
   - Append `"KTM"` to `MODE_ORDER` in `build-rail-stations.ts:65`.
   - Do not regenerate `rail-stations.ts`; its output does not change.

3. **Create `packages/shared/src/transit/network.ts`** with:
   - `FeedId`, `Mode` and the full `TransitNetwork` interface, copied verbatim from spec §3.3;
   - these constants:
   ```ts
   export const FEED_IDS = ['rail', 'bus-kl', 'feeder', 'ktm'] as const satisfies readonly FeedId[];
   export const MODES = ['bus', 'feeder', 'lrt', 'mrt', 'monorail', 'brt', 'ktm'] as const satisfies readonly Mode[];
   export const NETWORK_VERSION = 1 as const;
   export interface FeedInfo { label: string; credit: string; idPrefix: string; staticUrl: string; category?: BusCategory }
   export const FEED_INFO: Record<FeedId, FeedInfo> = {
     rail:     { label: 'Rapid KL rail',   credit: 'Prasarana', idPrefix: 'rail:', staticUrl: `${API}/gtfs-static/prasarana?category=rapid-rail-kl` },
     'bus-kl': { label: 'Rapid KL bus',    credit: 'Prasarana', idPrefix: 'kl:',   staticUrl: BUS_CATEGORY_INFO['rapid-bus-kl'].staticUrls[0], category: 'rapid-bus-kl' },
     feeder:   { label: 'MRT feeder bus',  credit: 'Prasarana', idPrefix: '',      staticUrl: BUS_CATEGORY_INFO['rapid-bus-mrtfeeder'].staticUrls[0], category: 'rapid-bus-mrtfeeder' },
     ktm:      { label: 'KTM Komuter',     credit: 'KTMB',      idPrefix: 'ktm:',  staticUrl: `${API}/gtfs-static/ktmb` },
   };
   export function feedIdPrefix(feed: FeedId): string;           // FEED_INFO[feed].idPrefix
   export function namespaceFeedId(feed: FeedId, id: string): string; // '' stays ''
   export function feedOfStopId(id: string): FeedId;             // by prefix; unprefixed → 'feeder'
   export const RAIL_MODE_TO_MODE: Record<RailMode, Mode> = { LRT: 'lrt', MRT: 'mrt', Monorail: 'monorail', BRT: 'brt', KTM: 'ktm' };
   ```
   - `API` is module-private in `categories.ts:50`. Export it from there as `DATA_GOV_MY_API` rather than repeating the host.
   - The `bus-kl` and `feeder` prefixes must equal `BUS_CATEGORY_INFO[...].idPrefix` (`categories.ts:64`, `:56`).
   - Derive them from `BUS_CATEGORY_INFO` instead of repeating the literals, so the namespaces cannot drift.
   - The numeric index of a `FeedId` in `stops.feed` / `routes.feed` is its position in `FEED_IDS`. The numeric `Mode` in `routes.mode` is its position in `MODES`. Document both in JSDoc. These numbers are part of the binary format in task 05.

4. **Transfer kinds**, also in `network.ts`. Task 04 uses them:
   ```ts
   export const TRANSFER_KIND = { walk: 0, station: 1, interchange: 2, interchangeVerified: 3 } as const;
   ```

5. **Barrel exports.**
   - Create `packages/shared/src/transit/index.ts`, re-exporting `network.ts`. Later tasks add to it.
   - Add `export * from "./transit/index.js";` to `packages/shared/src/index.ts`.
   - Export `RailMode` changes through the existing block at `src/index.ts:5`–`:17`. No change is needed there.

6. **Tests** (TDD: write first):
   - `packages/shared/src/utils/__tests__/gtfs-parser.test.ts`:
     - `parseGtfsZip reads route_type and colours when present`: a routes.txt with `route_type,route_color,route_text_color`.
     - `parseGtfsZip leaves optional route/stop fields undefined when absent`: the existing `makeFixture()` at the top of the file.
     - `parseGtfsZip reads location_type and parent_station`.
   - `packages/shared/src/transit/__tests__/network.test.ts`:
     - `FEED_INFO prefixes match BUS_CATEGORY_INFO`;
     - `namespaceFeedId keeps feeder ids raw and prefixes rail/ktm/kl`;
     - `feedOfStopId round-trips namespaceFeedId for every feed`;
     - `RAIL_MODE_TO_MODE covers every RailMode`: a `satisfies Record<RailMode, Mode>` compile check, plus a runtime key count of 5.
   - The test glob `src/**/__tests__/*.test.ts` already picks up `src/transit/__tests__/`.

## Verification
- `pnpm --filter @bus-tracker/shared test`: all existing tests plus the new ones pass.
- `pnpm type-check`: passes in `packages/shared`, `apps/mobile` and `apps/api`. The `RailMode` widening must not break mobile.
- `pnpm --filter @bus-tracker/shared build`: `dist/index.d.ts` contains `TransitNetwork` and `FEED_IDS`.
- Manual: `grep -n "route_color" packages/shared/src/utils/gtfs-parser.ts` shows the field parsed once.

## Handoff to next step ([02-rail-and-ktm-normalisation.md](./02-rail-and-ktm-normalisation.md))
- `FeedId`, `Mode`, `FEED_INFO`, `namespaceFeedId` and `TransitNetwork` live in `packages/shared/src/transit/network.ts`, exported from the package root.
- `GtfsRoute.route_color/route_text_color/route_type` and `GtfsStop.location_type/parent_station` are parsed when present.
- `RailMode` includes `"KTM"`. `RAIL_MODE_TO_MODE` maps it to the network `Mode`.
