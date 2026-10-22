# Phase 13 — Rail Experience (see trains next to buses)

Rail lines become part of the one map: official line colours, station squares, a **station sheet** with a departure board, and a **line sheet** with a vertical strip map showing estimated trains. The trip sheet's existing Connections rows now open stations. No tab bar — trains and buses share the same map and persistent sheet.

Spec: [`docs/design/transit-and-planner.md`](../../design/transit-and-planner.md) §2, §6.4, §6.5, §7.2–7.4.

## Dependencies

- Phase 12 complete: `useTransitNetwork()` provides rail patterns, frequency windows, stations and health.
- Existing: `components/map/*` (react-native-maps), `components/trip/Connections.tsx`, `components/detail/StopPhoto.tsx`, `theme/design.ts`, `@expo/ui` 58.
- 13/01–05 are **JS-only**. 13/03's Look Around banner depends on phase 15/01's native module and degrades to Street View until it exists. 13/06 (stretch) adds `react-native-svg` → **native rebuild**.

## Scope decisions (locked)

- **No tab bar.** New screens are stack `formSheet`s over the map (`station`, `line`), matching existing `stops` / `departure` sheets.
- **Honesty:** rail has no live data. Boards show "every N min" (≤ 5 min headway) or "about N min" — never a clock time styled as live. Estimated trains use the dashed-outline "scheduled" encoding plus an explicit caption.
- **Colour:** only rail lines carry colour (Calm Mono rule); buses remain ink.
- **Layers:** a toolbar layers Menu: My buses · Buses nearby (later) · Rail lines (default on) · Satellite. Persisted in settings.
- **Strip maps use RN Views + Reanimated** (straight vertical rail) — no Skia.

## Success criteria

1. Rail lines render in official colours under the bus route; dim below zoom 11; station squares tap through to `station`.
2. Station sheet lists every line × direction with "every N min"/"about N min", first/last train, nearby bus stops with next departure, and walking interchanges (curated, "about" when unverified).
3. Line sheet shows the full strip map for either direction with estimated trains gliding at timetable spacing; static under Reduce Motion; caption present.
4. Trip sheet Connections rows and search results (phase 15) deep-link into `station`.
5. Expired rail feed: lines and stations still render from bundled `RAIL_STATIONS`; boards show "Timetable unavailable" instead of times.
6. VoiceOver reads boards as "Kelana Jaya Line towards Gombak, every 3 minutes".

## Skills to invoke

- `expo:expo-ui`, `expo:expo-router`, `animate-expo`, `emil-design-eng`, `apple-design`. Check `docs/design/README.md` Calm Mono before any visual choice.

## Task order

1. [01-departure-board-model.md](./01-departure-board-model.md) — pure functions: next departures per station/line/direction from the network (headway + timetabled), first/last.
2. [02-rail-map-layer.md](./02-rail-map-layer.md) — `RailLayer` polylines + station markers + layers Menu.
3. [03-station-sheet.md](./03-station-sheet.md) — `app/station.tsx` board, nearby buses, interchanges, photo banner.
4. [04-line-strip-map.md](./04-line-strip-map.md) — `app/line.tsx` strip map + estimated trains (Reanimated).
5. [05-entry-points.md](./05-entry-points.md) — Connections → station, map selection model, quick action, deep links.
6. [06-network-diagram-stretch.md](./06-network-diagram-stretch.md) — optional schematic KL rail diagram (react-native-svg, native).

## Hand-off (post phase)

- `station` and `line` routes exist and accept `?station=<id>` / `?line=<routeId>&dir=0|1`; phase 15 links to them from search and itinerary timelines.
- `RailLayer` accepts a `focus` prop (line ids at 100%, others 15%) that the itinerary view will use.
