# 13-Rail-Experience / 03 — Station Sheet

**Build impact:** JS-only (Metro reload)

> The Look Around banner depends on phase 15/01's native module (`modules/transit-maps`, prebuild + Xcode). Until it exists the banner falls back to the existing `StopPhoto`, so this task ships with a Metro reload.

## Context

- Sheets are registered in `apps/mobile/app/_layout.tsx`: opaque paper via `SHEET_BACKGROUND = color.paper` (`_layout.tsx:37`), `formSheet` options as in `stops` (`_layout.tsx:118-128`) and `departure` (`_layout.tsx:141-151`).
- Closest screens to copy: `app/stops.tsx` (title + close toolbar `:33-36`, `ScrollView contentInsetAdjustmentBehavior="automatic"` `:37-40`, `MARGIN` padding `:52-58`) and `app/departure.tsx` (`useLocalSearchParams` `:56`, SwiftUI `Host` + `Text` with `contentTransition('numericText', { countsDown: true })` and `animation(Animation.smooth({ duration: 0.35 }), value)` `:120-150`).
- Row vocabulary: `Section` (`components/trip/SheetBody.tsx:61-68`), `Hairline`, `NoteRow`, `LinkRow` (`components/trip/Rows.tsx:41-43, 122-129, 180-213`), `RouteBadge` outlined ink chip (`components/trip/SheetHeader.tsx:266`), line-colour dots as in `components/trip/Connections.tsx:37-41`.
- `StopPhoto` (`components/detail/StopPhoto.tsx:33-84`) is Street View, renders nothing without a key or imagery (`:56`), fixed `aspectRatio: 2` (`:119-122`), radius 16.
- Tokens: `color`, `space`, `MARGIN`, `radius` (`row` 12, `group` 20 — there is no `radius.lg`), `type`, `motion.state = 180`, `EASE_OUT` (`theme/design.ts:22-50, 80-109, 112-130`).
- Clock: `useTrip().now` ticks every 15 s (`state/TripContext.tsx:117-121`); `formatClockHHMM` (`components/tracker/logic.ts:132`); `mins` (`components/trip/model.ts:664`).
- Existing bus-departure hooks (`useScheduledDepartures`, `hooks/useScheduledDepartures.ts:33`; `getNextScheduledDepartures`, `db/queries.ts:429`) read SQLite, which only holds **followed** routes. Nearby stops around a station are mostly unfollowed, so the network is the source; the formatters and the trip's live ETA are reused.

## Goal

`app/station.tsx`: a `formSheet` at detents `[0.5, 1]` with a photo banner, the station name and line badges, a board per line × direction using 01's model, first/last trains, walking interchanges and nearby bus stops. Honest under an expired feed and fully readable by VoiceOver.

## Prerequisites

- 13/01 (`stationBoard`, `stopDepartures`, `boardText`), 13/02 (`RailLayer` pushes `/station`).
- Phase 12: `useTransitNetwork()` → `{ network, health, status }`; `packages/shared/src/data/rail-interchanges.ts` (12/04).

## Steps

1. **Register the route** in `_layout.tsx` after `departure`:
   ```tsx
   <Stack.Screen name="station" options={{
     presentation: 'formSheet', sheetAllowedDetents: [0.5, 1], sheetGrabberVisible: true,
     sheetLargestUndimmedDetentIndex: 0,   // the focused map stays visible at 0.5
     headerShown: true, headerTransparent: true,
     contentStyle: { backgroundColor: SHEET_BACKGROUND },
   }} />
   ```
2. **Pure model** `components/rail/stationModel.ts`:
   ```ts
   export interface StationSheetModel {
     station: RailStation; lines: { line: RailLine; routeIndex: number | null }[];
     boards: { line: RailLine; rows: BoardRowView[]; footer: string | null }[];
     unavailable: boolean;                       // rail expired / stale / no network
     interchanges: { stationId: string; name: string; colors: string[]; walk: string; note: string; spoken: string }[];
     nearby: { stopIndex: number; name: string; routeLabel: string; walk: string; next: string; spoken: string }[];
   }
   export interface BoardRowView { towards: string; primary: string; secondary: string | null; rolling: number | null; spoken: string; dir: 0 | 1 }
   export function buildStationSheet(i: { net: TransitNetwork | null; health: …; stationId: string; now: number }): StationSheetModel | null;
   ```
   - Resolve the station from `net.stations` by id, else `RAIL_STATIONS` (bundled), else `null`.
   - Boards: `stationBoard` grouped by line; `boardText(next, mins, formatClockHHMM)`. `rolling` is the minute count only when the label counts down (headway > 300 s); `null` for "every N mins" so nothing animates.
   - Footer: `First 6:00 · Last 23:25` from the row group's min `first` / max `last`.
   - `unavailable` when `health.rail === 'expired'`, `board.stale`, or no network.
   - Interchanges: curated entries whose `a` or `b` is one of this station's stop ids **and** whose other side is a different station (skip pairs already merged into one `RailStation`). Walk `"8 min walk"` when `verified`, `"about 8 min walk"` when not.
   - Nearby: bus-kl and feeder stops within **250 m** (the 12/03 grid lookup; add `stopsWithin(net, point, meters)` to `board.ts` if 12 didn't export one), nearest first, max 4, first `stopDepartures` row per route. Walk via `walkingMinutes(haversineMeters(...))` (`packages/shared/src/utils/rail.ts:96`).
3. **Photo banner** `components/rail/StationPhoto.tsx`:
   - Source order: Look Around (via `services/stationImage.ts#lookAroundUri(lat, lng)`, a stub returning `null` until 15/01 replaces it with `modules/transit-maps` `lookAround()`), then `StopPhoto`, then nothing.
   - While the Look Around lookup is pending (≤ 1.5 s), hold a 16:9 `color.fill` block at `radius.group`: the RN equivalent of SwiftUI `.redacted(.placeholder)`. On a URI, fade the `Image` in with Reanimated `FadeIn.duration(motion.state).easing(EASE_OUT)` (180 ms). On `null`, collapse the block.
   - Add an optional `aspectRatio` prop to `StopPhoto` (default 2, unchanged elsewhere); the station passes `16 / 9`.
4. **Header** in `app/station.tsx`: name in `type.title`, then `LineBadge`s. New `components/rail/LineBadge.tsx`: filled chip, `backgroundColor = line.color`, text `line.textColor`, label the last token of `line.code` (`KJ`, `KG`, `BRT`). Tap → `/line?line=<routes.id>&dir=0` (04). Toolbar: close `xmark`, as `stops.tsx:34-36`; `Stack.Screen options={{ title: '' }}`.
5. **Board sections** `components/rail/StationBoard.tsx`: one `Section` per line titled with the line name minus its mode prefix ("Kelana Jaya Line"). Rows (`minHeight` 52, `Hairline` between):
   - Left `→ Gombak` (`type.body`, `color.label`). Right: a `Host matchContents` with SwiftUI `Text` using `font({ size: type.body.fontSize })`, `monospacedDigit()`, `foregroundStyle({ type: 'hierarchical', style: 'secondary' })` and, only when `rolling != null`, `contentTransition('numericText', { countsDown: true })` + `animation(Animation.smooth({ duration: 0.35 }), rolling)`. `secondary` ("then every 6 mins") under it in `type.footnote`.
   - Row is `accessible` with `accessibilityLabel={row.spoken}`, e.g. "Kelana Jaya Line towards Gombak, every 3 minutes"; tap → `/line?line=…&dir=…`, `accessibilityHint` "Shows the whole line".
   - Footer under the rows: `type.footnote`, `color.secondaryLabel`, label "First train 6:00, last train 23:25". `ServiceSpan` (`Timetable.tsx:190-221`) is not reused: it is private and says "bus".
   - `unavailable`: replace each line's rows with `NoteRow icon="clock.badge.exclamationmark" text="Timetable unavailable"`, plus one footnote "Rail timetable from data.gov.my has expired." Name, badges, interchanges and map still render.
6. **"Walk to other lines"** section: Connections-style dots + name + walk text; tap → `router.setParams({ station: id })` (swap in place, no sheet stacking).
7. **"Buses nearby"** section: `RouteBadge` + stop name (`formatStopName`, `components/map/format.ts:69`) + `"3 min walk · next 9:14"`, or `"every 15 mins"` for headway stops (same honesty rule). Timetable times carry the `clock` glyph and the word "Scheduled" in `spoken`. If the row's stop and route equal `trip.stopId` / `trip.routeCode`, show `trip.model.compact` with the live dot instead, so live stays one source. If the stop is on the active route, tapping selects it in the trip sheet (`trip.select({ kind: 'stop', stopId })`, then `router.back()`), as `stops.tsx:23-29` does.
8. **Not found:** `ContentUnavailableView` (`@expo/ui/swift-ui`) with `title="Station not found"`, `systemImage="tram.fill"`.
9. **Haptics:** none. The sheet has no decisions (README §4 Haptics); navigation taps stay silent.
10. **Tests** `components/rail/__tests__/stationModel.test.ts`:
    - `expired rail marks unavailable but keeps station and lines from RAIL_STATIONS`
    - `headway ≤ 300 s rows have rolling null and primary "every 3 mins"`
    - `headway > 300 s rows roll the minute count`
    - `interchanges skip pairs merged into the same station`
    - `unverified interchange reads "about N min walk"`
    - `nearby keeps bus-kl and feeder stops within 250 m, max 4, nearest first`
    - `spoken row reads "Kelana Jaya Line towards Gombak, every 3 minutes"`
    - `unknown id returns null`

## Verification

- `pnpm --filter mobile test`, `pnpm --filter @bus-tracker/shared test`, `pnpm type-check` all green.
- Device (Metro reload): tap Pasar Seni on the map → sheet opens at 0.5 over an undimmed map; KJ and KG show both directions; rolling minutes tick down without layout jumps; badges open `line`.
- Set the device date to 2027-01-02: board shows "Timetable unavailable", the station still renders.
- Light/dark: line badges keep their official colours and text colours; banner placeholder matches `color.fill`.
- VoiceOver: each row is one element reading the `spoken` string; section labels are headers. Reduce Motion: banner appears without a fade. Dynamic Type XL: towards and time wrap onto two lines, never truncate the time.

## Handoff to next step ([04-line-strip-map.md](./04-line-strip-map.md))

- `/station?station=<slug>` exists; `LineBadge` and board rows push `/line?line=<routeId>&dir=0|1`, which 04 implements.
- `services/stationImage.ts` is the seam 15/01 fills with Look Around (and its 30-day cache).
- The spec §6.4 "Line" mini strip map in this sheet is deferred: rows and badges open the full `line` sheet instead.
