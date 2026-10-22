# 13-Rail-Experience / 01 — Departure Board Model

**Build impact:** JS-only (Metro reload)

## Context

- Rail has no real train times. The compiled `TransitNetwork` (spec §3.3, built in phase 12) stores rail as turn-up-and-go windows: `patterns.freqStart/freqLen` index into `fStart/fEnd/fHeadway` (seconds after service-day midnight, at the pattern's **first** stop), and `patterns.runOffset[stopStart + s]` gives the template run time to stop `s`. KTM, feeder and long-headway bus-kl windows are expanded into concrete trips (`tripStart/tripLen`, `dep[(tripStart + t) * stopLen + s]`).
- A station is `network.stations[i]` (the existing `RailStation` type, `packages/shared/src/utils/rail.ts:24-34`, plus KTM). Its platforms are the stops with `stops.station[s] === i`; `stopRoutes.start/len/pattern/pos` lists the patterns calling at each stop.
- Malaysia time: `toMalaysiaParts(now)` (`packages/shared/src/utils/gtfs-time.ts:44-57`) returns `ymd`, `secSinceMidnight`, `midnightUtcMs`. UTC+8, no DST.
- Copy rules: spec §6.4 and README §"Scope decisions": rail never shows a clock time styled as live. Calm Mono pluralises minutes ("1 min", "5 mins") via `mins()` in `apps/mobile/components/trip/model.ts:664-666`.
- `packages/shared` tests run with `tsx --test "src/**/__tests__/*.test.ts"` (`packages/shared/package.json`), so `src/transit/__tests__/` is picked up automatically.

## Goal

Pure, tested functions in `packages/shared/src/transit/board.ts` that turn the network plus "now" into a per-line × direction board for a station (and the same for a bus stop), with first/last service and an honest label. No React, no I/O.

## Prerequisites

- Phase 12/03 (`compileNetwork`, `TransitNetwork` in `packages/shared/src/transit/network.ts`) and 12/02 (KTM `RailMode`) merged.
- Phase 12 fixture network available to tests (12/03 fixtures), or build a synthetic one with the helper in step 8.

## Steps

1. **Types** in `packages/shared/src/transit/board.ts`:
   ```ts
   export type NextDeparture =
     | { kind: 'headway'; headwaySec: number; nextAboutSec: number }
     | { kind: 'timetable'; times: number[] }          // epoch ms, ascending, ≤ 3
     | { kind: 'closed'; reopensAt: number | null };   // before first / after last; epoch ms
   export interface BoardRow {
     route: number;                 // index into net.routes
     pattern: number;               // representative pattern for this direction
     dir: 0 | 1;                    // from lineDirections (step 5)
     towards: string;               // display name of the pattern's last stop
     next: NextDeparture;
     first: number | null;          // epoch ms, today's first departure at this station
     last: number | null;           // epoch ms, last departure
   }
   export interface StationBoard { station: number; rows: BoardRow[]; stale: boolean }
   ```
   `closed` is an addition to the two-kind model so "before first train" and "service ended" never masquerade as a countdown.

2. **Service-day clock.** `serviceClock(net, nowEpochMs): { t: number; midnightMs: number } | null`. Use `toMalaysiaParts(new Date(nowEpochMs))`; if `parts.ymd === net.meta.serviceDate` then `t = secSinceMidnight`; if `ymd` is the day after, `t = secSinceMidnight + 86_400` and `midnightMs -= 86_400_000` (GTFS spill-over); otherwise `null` (board `stale: true`).

3. **`stopDepartures(net, stopIndex, nowEpochMs): BoardRow[]`.** For each entry of `stopRoutes` at the stop, skip patterns where `pos` is the last stop (arrivals only). Group by `(route, last stop)` so both platforms of an interchange and duplicate patterns merge into one direction row. Per group:
   - **Headway windows:** shift each window by `off = runOffset[stopStart + pos]`. If `fStart + off ≤ t ≤ fEnd + off`, next train on the grid is `d = fStart + off + ceil((t − fStart − off) / h) · h`; emit `{ kind: 'headway', headwaySec: h, nextAboutSec: d − t }`. If none active but a later window exists, `closed` with `reopensAt` = that window's start.
   - **Timetabled trips:** binary-search `dep` at column `pos` for the first `≥ t`; take up to 3; `{ kind: 'timetable', times }` in epoch ms (`midnightMs + sec * 1000`).
   - **first / last:** min over window starts and trip deps, max over window ends and trip deps, each + `off`.
   - A group with both kinds (rare) prefers the active headway window.
4. **`stationBoard(net, stationIndex, nowEpochMs): StationBoard`.** Collect every stop with `stops.station[s] === stationIndex`, concatenate `stopDepartures`, sort rows by `routes.label` then `towards`. Returns `{ rows: [], stale: true }` when `serviceClock` is `null` or `net.meta.feeds.rail.included === false` (spec §3.6; the sheet shows "Timetable unavailable").
5. **`lineDirections(net, routeIndex): number[]`** — the network has no `direction_id` (spec §3.3), so directions are derived: group the route's patterns by last stop, keep the longest pattern per group, order so `dir 0` is the one whose first stop has the lowest numeric station code (`KJ1` Gombak first), headsign A–Z as tie-break. 03's board rows and 04's direction picker both use it, so `dir` means the same thing everywhere.
6. **Honesty label** (pure, no plurals logic duplicated — take a `mins` formatter arg so mobile passes `mins()` from `components/trip/model.ts`):
   ```ts
   export const HEADWAY_ONLY_MAX_SEC = 300;
   export function boardText(n: NextDeparture, fmtMins: (m: number) => string, fmtClock: (ms: number) => string):
     { primary: string; secondary: string | null; spoken: string }
   ```
   - headway ≤ 300 s → primary `every ${fmtMins(round(h/60))}`, secondary `null`. Never a countdown.
   - headway > 300 s → primary `about ${fmtMins(max(1, floor(next/60)))}`, secondary `then every ${fmtMins(round(h/60))}`.
   - timetable → primary `fmtClock(times[0])`, secondary the rest joined with ` · `; spoken prefixed "Scheduled".
   - closed → primary `First ${fmtClock(reopensAt)}` or `No more trains today`.
   - `spoken` spells minutes out ("every 3 minutes") for VoiceOver (README success criterion 6).
7. **Export** from `packages/shared/src/transit/index.ts` (created in phase 12) and the package root `src/index.ts`.
8. **Tests** `packages/shared/src/transit/__tests__/board.test.ts`, using a `syntheticNetwork()` helper in `__tests__/fixtures/syntheticNetwork.ts` (one 3-stop rail pattern each way, 06:00–09:00 every 180 s then 09:00–23:30 every 420 s, `runOffset` [0, 120, 300]; one KTM pattern with three trips):
   - `serviceClock maps 00:30 MYT onto the previous service date as t ≥ 86400`
   - `headway row at 07:00 at stop 2 reports headwaySec 180 and nextAboutSec on the shifted grid`
   - `boardText shows only "every 3 mins" when headway ≤ 300 s`
   - `boardText shows "about 4 mins" + "then every 7 mins" when headway > 300 s`
   - `window boundary at 09:00 switches headway without a negative nextAboutSec`
   - `before first window returns closed with reopensAt = first departure`
   - `after last window returns closed with reopensAt null`
   - `last stop of a pattern yields no row (arrivals only)`
   - `interchange station merges both platforms and sorts by line label`
   - `timetable rows return ≤ 3 epoch-ms times in Malaysia time`
   - `rail feed excluded → stationBoard stale with no rows`
   - `first/last include the runOffset for mid-line stations`
   - `lineDirections puts the pattern starting at the lowest station code first`
   - If the 12/03 fixture network exists: `Pasar Seni board on 2026-10-28 08:00 has KJ and KG rows in both directions`.

## Verification

- `pnpm --filter @bus-tracker/shared test` — all new `board.test.ts` cases pass, existing suites unchanged.
- `pnpm type-check` — clean across the monorepo.
- `pnpm --filter mobile test` — unchanged (no mobile edits), still green.
- Spot check in a scratch `tsx` script against the 12/03 fixture: Kajang Line at Pasar Seni, 07:30 → `every 6 mins` or `about N mins · then every N` matching the `frequencies.txt` window.

## Handoff to next step ([02-rail-map-layer.md](./02-rail-map-layer.md))

- `stationBoard`, `stopDepartures`, `lineDirections`, `boardText`, `serviceClock`, `HEADWAY_ONLY_MAX_SEC` are exported from `@bus-tracker/shared`.
- 03 renders `boardText(...).primary/secondary` and uses `spoken` for VoiceOver; 04 reuses `serviceClock` and the active window's `headwaySec` for train spacing.
- Assumption carried forward: `network.stations[i].id` keeps the slug ids of `RAIL_STATIONS` (`packages/shared/src/data/rail-stations.ts`), so bundled and network station ids agree.

## Implementation notes
- **Trip times are read through `ev(net, p, t, s)`.** The Context formula `dep[(tripStart + t) * stopLen + s]` is the flat index that 12/03 replaced, because it collides across patterns with different `stopLen`.
- **`last` is the last departure on the grid, not `fEnd + off`.** A window's trains leave at `fStart + k·h ≤ fEnd`, so KJ's 19:00–23:15 window every 7 min leaves its origin last at 23:12. Using `fEnd` would show "Last 23:15" while the row already says "No more trains today". The two agree wherever `h` divides the window, which is most windows in the fixture.
- **Headway rule:**
  - A row is `headway` when `t` lies inside a shifted window `[fStart + off, fEnd + off]` and the next grid departure comes no more than one headway after that window's end. This covers a window whose end falls between grid departures (06:00–09:00 every 7 min ends its grid at 08:55, so at 08:57 the next train is 09:00, from the next window).
  - `headwaySec` is the headway of the window containing `t`. On an exact boundary, the later window wins. So the headway switches at the boundary itself, never before it.
  - Outside every window, or in a gap between windows, the row is `closed`, with `reopensAt` set to the next start or `null`.
  - `nextAboutSec` is never negative and never more than the headway.
- **Timetabled rows:** a `timetable` row lists the next ≤ 3 scheduled departures, including before the day's first train. Scheduled clock times are honest on their own. The row is `closed` with `reopensAt: null` only once no departure is left.
- **Directions (`lineDirections`):**
  - On top of the spec's rule, a tie on the lowest station code prefers the longer pattern before headsign A–Z. KTM Port Klang has three patterns from 17300; without this, dir 0 would be the 25-stop `→ Klang` short working rather than the 30-stop `→ Pel Klang Sel` run.
  - The result is `[dir 0, every pattern running the other way (longest first), other dir-0 patterns]`, so `[1]` is always the full run the other way. Rail has exactly two entries (`[KJ1→Putra Heights, KJ37→Gombak]`). KTM Seremban has four and Port Klang five.
  - A row's `dir` is 0 or 1 according to whether its (route, last stop) group runs the same way as dir 0. "Same way" means the first two stops it shares with the dir-0 pattern come in that pattern's order. Without two shared stops, the fallback is whether the group ends nearer dir 0's terminus than its origin.
- **`pattern` on a row** is the longest pattern of its group that calls at this stop or station (lowest index on a tie). It is not the route-wide representative, which may not call here.
- **Stale:** `stationBoard` is stale when any feed of the station's own stops (`feedOfStopId` over `stopIds`) is excluded, rather than only when `rail` is excluded. A rail station's result is the same. A KTM station keeps its board when only the rail feed has expired.
- **Merging:** `stationBoard` groups rows across all of the station's stops in one pass, so the same (route, last stop) on two platforms becomes one row. `stopDepartures` uses the same path for a single stop.
- **Extra test:** `a window ending off its grid hands over to the next window; a gap is closed` covers the two edges above. The synthetic helper also exports `buildNetwork()` for one-off networks. Its patterns list KJ3 → KJ1 first, so the `lineDirections` test actually reorders them.
- **Fixture check, 2026-10-28:** Kajang Line at Pasar Seni at 07:30 shows `about 1 min · then every 6 mins` towards Kajang and `about 4 mins · then every 6 mins` towards Kwasa Damansara, matching the 06:00–09:00 / 360 s window.
