# BusBuddy: rail and journey planner (design spec)

> **Status:** proposal, October 2026. This spec is the source of truth for
> plan phases [12](../plans/12-transit-network/README.md) to
> [15](../plans/15-journey-planner-ui/README.md). It extends
> [`README.md`](./README.md) (Calm Mono v3) and does not replace it: every
> Calm Mono rule still applies unless this file says otherwise.

BusBuddy grows from "when do I leave for my bus?" to "how do I get there?".
It does this in three ways:

1. **Rail you can see:** LRT, MRT, Monorail, BRT and KTM Komuter lines on the
   same map as your buses. Each station gets a departure board and each line a
   strip map.
2. **"Where to?":** type a place and get door-to-door options that combine
   walking, feeder and city buses, and rail. The routing runs on the phone
   against the same data.gov.my GTFS feeds the app already uses, and bus legs
   are re-timed with live GTFS-R bus positions.
3. **Go mode:** follow a chosen journey with the existing Live Activity,
   get-off alert and on-board machinery, extended to more than one leg.

There is still no BusBuddy server. Everything below runs on the device.

---

## 1. What the data allows (verified 2026-10-23)

Feeds were downloaded and counted for this spec (one weekday, 2026-10-28).
The script is in plan task 12/00.

| Feed (`api.data.gov.my/gtfs-static/…`) | Stops | Patterns | Trips per weekday | Stop events | Timing | Live |
|---|---:|---:|---:|---:|---|---|
| `prasarana?category=rapid-rail-kl` | 187 | 16 | 2,727 (expanded) | 64,924 | **Headways only** (`frequencies.txt`, 180–840 s) | **None** (404) |
| `prasarana?category=rapid-bus-kl` | 4,068 | 171 | 5,830 (expanded) | 219,997 | Headways (300–12,600 s, median 30 min), `exact_times=0` | Vehicle positions |
| `prasarana?category=rapid-bus-mrtfeeder` | 2,117 | 92 | 3,443 | 95,718 | Real timetables, `calendar_dates` holidays | Vehicle positions |
| `ktmb` | 155 (national) | 88 | 305 | 4,034 | Real timetables, short windows | ETS only (useless for Komuter) |
| **Total** | **≈6.5k** | **367** | **≈12.3k** | **≈385k** | | |

A one-day network is about **3 MB as Int32 arrays**, which is small enough to
route on the phone (§4).

### Rail feed quirks the compiler must handle

- **No real train times.** Each line has one template trip per direction and
  service day. `frequencies.txt` gives headways, e.g. Kajang Line every 6 min
  at 06:00–09:00, then every 10 min. Prasarana confirms that RapidKL rail has
  no fixed station times.
- **Interchanges are separate stops, one per line.** There is no
  `parent_station` and no `transfers.txt`. A name match finds 20
  interchanges but misses walk links (KL Sentral ↔ Monorail, Muzium Negara ↔
  KL Sentral, Bukit Nanas ↔ Dang Wangi, and so on). We therefore keep a
  curated interchange table (§3.4).
- **Malformed CSV:**
  - `stop_times.txt` has a UTF-8 BOM, `route_id`s that disagree with
    `trips.txt` (`AGL` vs `AG`), and unpadded times (`6:00:00`).
  - `shapes.txt` puts lon before lat.
  - Stop names are ALL CAPS, some with trailing spaces.
  - The `geometry` column holds `[object Object]`.
- **Expiry.** The rail calendar ends **2026-12-31**. KTMB's current window
  ends in early November (`calendar.txt` says 20261106; Transitland lists
  2026-11-05), and KTMB has gone stale before (data.gov.my issue
  #631). The app must cope with an expired feed: §3.6.
- **Holidays.** Rail and rapid-bus-kl have no `calendar_dates`; only the
  feeder encodes holidays.
- **Realtime ids.** Feeder GTFS-R `trip_id`s do not join to static ones (an
  RT id `241209021024S2` versus static `261002010049S10`). Join on route:
  RT `route_id` `T105` matches static `route_long_name`, as the app does
  today (`resolveRouteAlias`).
- **Budget.** data.gov.my allows 4 requests per minute per API family, with
  static and realtime counted separately.

### Rejected alternatives

| Option | Why not |
|---|---|
| OpenTripPlanner 2 or MOTIS on a VPS | Needs a server (€5–10/mo) and a JVM or ops work. Neither turns vehicle positions into routing changes without a synthetic TripUpdates feed. |
| Transitous (hosted MOTIS) | Its terms require the app to be open source and non-commercial, and its only Malaysian realtime feed is KTMB. |
| Google Routes (transit) | Costs money after 10k requests per month. Its terms restrict showing results on Apple Maps, and it adds a key. Kept only as a development benchmark. |
| Apple `MKDirections` transit | Returns `directionsNotFound` for Malaysia from the API, even though the Maps app works. |
| minotor (MIT RAPTOR) | Has no `frequencies.txt` support, and its parser is Node-only. We borrow ideas, not code. |
| planarnetwork RAPTOR / CSA | GPLv3, which is a problem for App Store distribution. |

**Decision:** an in-house **RAPTOR** engine in `packages/shared/src/transit/`.
It is pure TypeScript, so it runs on Hermes and in `node --test`, and it
plugs into the existing parser, `expandFrequencies`, `computeEta` and
`haversineMeters`.

---

## 2. Information architecture

**Principle kept:** one map, one persistent sheet, no tab bar
([README §1](./README.md)). Trains and buses share the same map. The new
features are new *states of the sheet*, not new tabs.

> Considered: iOS 26 `NativeTabs` with Bus, Rail and a search-role "Go" tab.
> Rejected for three reasons. A persistent `formSheet` presented inside a tab
> covers the tab bar. Three tabs would show the same map three times, the
> problem v2 removed. And Apple Maps and Find My, our reference apps, put
> search *in the sheet*.

```
Map (index) ──────────────────────────────────────────────────────────────
│  toolbar: [route switcher ▾] [layers ◎] [recenter] [more]
│  layers menu: ✓ My buses · Buses nearby · ✓ Rail lines · Satellite
│
├─ trip (persistent sheet; peek / glance / large)
│    peek:  [ 🔍 Where to?            (Home) (Work) ]   ← NEW, 52pt
│           [ existing PeekCard: T816 · 4 min · rail … ]
│    glance+: existing trip body; "Connections" rows now open stations
│
├─ plan            NEW formSheet [large]   search → results
├─ itinerary       NEW formSheet [peek, 0.5, 1]  timeline + map legs
├─ station         NEW formSheet [0.5, 1]  departure board + strip map
├─ line            NEW formSheet [0.6, 1]  whole-line strip map
└─ go              NEW: journey in progress (reuses ride + Live Activity)
```

### Entry points

| You want | You tap |
|---|---|
| Plan a trip | The **Where to?** capsule in the peek. Or long-press the app icon → "Where to?" (quick action), or a saved-place chip (Home or Work) next to it. |
| See trains | **Layers → Rail lines** (on by default) draws the lines in their colours. Tap a station square to open `station`, or a line badge to open `line`. |
| Trains near your bus stop | The existing **Connections** rows in the trip sheet now open `station`. |
| A station by name | Type it in **Where to?**: stations and stops are local results that work offline. |

### Map layering (z-order, bottom to top)

On Apple Maps, react-native-maps ignores `Polyline` `zIndex`, so the order
comes from **mount order**. The layers share a remount key (13/02), and
`ItineraryLayer` mounts after `RailLayer` and `RouteLayer`.

1. Rail lines: official colours, 3pt, on a 1pt paper casing.
   - Below zoom 11 they draw at 35% opacity.
   - In `station`, `line` and `itinerary` they draw at 100%, and every other
     line drops to 15%.
2. Bus route: the existing 4pt ink line.
3. Itinerary legs, only in `itinerary` and `go`:
   - walk: a 3pt ink dotted line;
   - bus: a 4pt ink line;
   - rail: a 5pt line in the line colour.
4. Station squares. An interchange gets a square split into one colour dot
   per line (README §Markers).
5. Bus markers (existing), then the user's location.

Colour stays rare: **only rail lines carry colour**, plus the existing green
for "live" and orange for "warning". Buses stay ink, including inside
itineraries.

---

## 3. Data layer (phase 12)

### 3.1 Feeds and refresh

| Feed | Refresh | Notes |
|---|---|---|
| rail | Daily if older than 24 h, else on launch | 80 KB |
| bus-kl | Daily | 1.7 MB |
| feeder | Daily (already fetched) | 2.0 MB |
| ktmb | Daily | 47 KB. Filter to Komuter lines (`Seremban Line`, `Port Klang Line`) inside the Klang Valley bounding box (lat 2.70–3.45, lon 101.25–101.95). |

- Fetch the zips one after another, at least 16 s apart, so the static
  family stays under 4 requests per minute.
- `services/gtfsFeed.ts` already downloads per category, and it is extended
  to the two new categories.
- A `meta` row stores each feed's `etag`/hash, `fetchedAt` and `validUntil`
  (the maximum `end_date` across active services).

### 3.2 Shared types (extend, don't fork)

```ts
// packages/shared/src/types/gtfs.ts: add optional fields; existing bundles still parse
interface GtfsRoute { …; route_type?: number; route_color?: string; route_text_color?: string }
interface GtfsStop  { …; location_type?: number; parent_station?: string }

// packages/shared/src/utils/rail.ts
type RailMode = 'LRT' | 'MRT' | 'Monorail' | 'BRT' | 'KTM';   // + KTM
```

### 3.3 The compiled network: `TransitNetwork`

There is one network per **service date**. It is compiled on the device from
the parsed feeds and stored as a single binary blob in SQLite
(`network_blobs(service_date TEXT PRIMARY KEY, version INT, built_at INT, data BLOB)`).

Everything is struct-of-arrays, so routing touches only typed arrays. Times
are **seconds after service-day midnight** and can exceed 86,400, as in GTFS.

```ts
// packages/shared/src/transit/network.ts
export type FeedId = 'rail' | 'bus-kl' | 'feeder' | 'ktm';
export type Mode = 'bus' | 'feeder' | 'lrt' | 'mrt' | 'monorail' | 'brt' | 'ktm';

export interface TransitNetwork {
  meta: {
    version: 1;
    serviceDate: string;                 // 'YYYYMMDD'
    builtAt: number;                     // epoch ms
    feeds: Record<FeedId, { fetchedAt: number; hash: string; validUntil: string; included: boolean }>;
  };
  stops: {
    count: number;
    id: string[];                        // namespaced: 'rail:KJ15', 'kl:1005840', 'ktm:19100', feeder raw
    name: string[];                      // display case (title-cased for rail/KTM)
    lat: Float32Array; lon: Float32Array;
    feed: Uint8Array;                    // FeedId index
    station: Int32Array;                 // index into stations, or -1
  };
  stations: RailStation[];               // merged physical stations (existing type + KTM)
  routes: {
    count: number;
    id: string[]; label: string[];       // 'T816', '300', 'KJ', 'KTM Seremban'
    longName: string[]; mode: Uint8Array; color: string[]; textColor: string[];
    feed: Uint8Array;
    shapeId: string[];                   // for drawing legs; geometry stays in SQLite
  };
  patterns: {                            // one per (route, direction, exact stop sequence)
    count: number;
    route: Int32Array; headsign: string[];
    stopStart: Int32Array; stopLen: Int32Array; stops: Int32Array;   // flattened stop indices
    // Timetabled trips (feeder, KTM, and bus-kl expanded from headway templates)
    tripStart: Int32Array; tripLen: Int32Array;                      // sorted by first departure
    timeStart: Int32Array;               // per-pattern base into arr/dep
    arr: Int32Array; dep: Int32Array;    // arr[timeStart[p] + t * stopLen[p] + s]
    tripKey: string[];                   // GTFS trip_id or '<template>@HH:MM'
    // Turn-up-and-go windows (rail and any headway ≤ 12 min)
    freqStart: Int32Array; freqLen: Int32Array;
    fStart: Int32Array; fEnd: Int32Array; fHeadway: Int32Array;
    runOffset: Int32Array;               // [stopStart + s] seconds from first stop (template)
  };
  stopRoutes: { start: Int32Array; len: Int32Array; pattern: Int32Array; pos: Int32Array };
  transfers:  { start: Int32Array; len: Int32Array; to: Int32Array; seconds: Int32Array; kind: Uint8Array };
  grid: { cellDeg: number; cells: Map<number, Int32Array> };   // nearest-stop lookups
}
```

**The rule for headway feeds** decides how each frequency window is stored:

- **Every rail window (any headway; 180–840 s observed), and any bus window
  with a headway of 12 minutes or less,** becomes a *turn-up-and-go* window.
  - The engine boards at `t + headway/2`, the expected wait.
  - The UI shows "every 4 min", never a fake clock time.
  - This covers all rail and the busiest rapid-bus-kl corridors.
- **A longer bus headway** is expanded into concrete trips on the
  `start + k·headway` grid with the existing `expandFrequencies`. That is what
  the trip sheet's Today grid already shows. These trips are labelled
  **Scheduled**.

**Feeder stop ids** stay un-prefixed so they match what is already in
SQLite and settings. The other feeds use the prefixes from `namespaceId`,
plus new `rail:` and `ktm:` prefixes.

### 3.4 Transfers

Three sources are combined. When the same pair appears in more than one,
the **most specific** source wins: curated, then same station, then
proximity. A curated time is a real walk (KL Sentral KJ15 ↔ MR1 is about 8
min through NU Sentral), so it must override the generic 180 s same-station
default even though it is longer.

1. **Proximity:** every stop pair within **250 m**, found through the grid.
   `seconds = ceil(haversine × 1.25 / 80 m/min) + 60`, rescaled per query (§4.1) (a fixed 60 s to find
   the stop).
2. **Same station:** stops merged into one `RailStation` get
   `seconds = 180` (a platform change).
3. **Curated rail interchanges:** `packages/shared/src/data/rail-interchanges.ts`.

The curated table looks like this:

```ts
export interface Interchange { a: string; b: string; seconds: number; note: string; verified: boolean }
// Seed (ids checked against the 2026-10-23 feeds; times are estimates until walked,
// verified=false shows "about"). Rail ids are raw rapid-rail-kl stop_ids, KTM ids are ktmb stop_ids.
// KL Sentral KJ15 ↔ Monorail MR1 (via NU Sentral) 480 s · KJ15 ↔ KTM 19100 180 s
// Muzium Negara KG15 ↔ KL Sentral KJ15 360 s
// Pasar Seni KJ14 ↔ KG16 240 s · Pasar Seni KJ14 ↔ KTM Kuala Lumpur 19000 420 s
// Masjid Jamek KJ13 ↔ AG7 / SP7 180 s · Hang Tuah MR4 ↔ AG9 / SP9 180 s
// Bukit Bintang MR6 ↔ KG18A 240 s · Dang Wangi KJ12 ↔ Bukit Nanas MR8 300 s
// Plaza Rakyat AG8 / SP8 ↔ Merdeka KG17 300 s · Bandaraya AG6 / SP6 ↔ KTM Bank Negara 18900 360 s
// Subang Jaya KJ28 ↔ KTM 53700 180 s · Sunway-Setia Jaya BRT1 ↔ KTM Setia Jaya 53600 180 s
// USJ 7 BRT7 ↔ LRT USJ 7 KJ31 120 s · Abdullah Hukum KJ17 ↔ KTM 52700 180 s
// Putra Heights KJ37 ↔ SP31 60 s (cross-platform)
```

Task 12/04 asserts in a test that every id exists in the fixture `stops.txt`.

### 3.5 Building on the device

`compileNetwork(feeds, serviceDate)` is a **generator** that yields every
~16 ms of work. It reuses the `scanCsvColumnsSteps` pattern from
`gtfs-parser.ts`, so the UI never freezes.

1. It runs after the daily refresh, in idle time, for **today and
   tomorrow**. "Today" is the **service date**, `date(now − 4 h)` in
   Malaysia time, so trains running at 00:30 still belong to the network
   that holds them.
2. It keeps the previous blob until the new one is complete.
3. It needs about 3 MB of arrays plus strings.
4. **Target:** under 4 s on an iPhone 13 for all four feeds (prototype
   12/00 measures this).

**Fallback** if the device build is too slow: `apps/api` gets a cron that
compiles the same blob with the same shared code and serves it gzipped
(about 1.5 MB). The app then downloads one file instead of four. This stays
optional and switched off unless the prototype fails.

### 3.6 Feed health for routing

Each feed is in exactly one state:

- `ok`;
- `expiring`: `validUntil` is within 14 days;
- `expired`: today is past `validUntil` and the feed has no active
  services.

An expired feed is **left out of routing** (`included: false`). The planner
then shows a one-line note such as "Rail timetable from data.gov.my has
expired. Showing bus-only routes." It never silently returns worse results.
In the `expiring` state, a new Settings → Data sources section (SwiftUI) shows
the date.

**Static request budget.** Every static GTFS download goes through one
shared limiter in `services/gtfsFeed.ts`: the network refresh,
`prewarmRouteSearch` and on-demand route fetches alike. It allows at most 3
requests in any rolling 60 s, leaving one spare for a retry after a 429.

---

## 4. Routing engine (phase 14)

### 4.1 Algorithm

The engine is **RAPTOR** (Delling et al.), run as a range query over a
departure window.

- It works in rounds, one per transit leg, with **at most 4 rides** (3
  transfers).
- Each round scans the routes marked in the previous round. For each pattern
  it finds the earliest trip boardable at each stop, then relaxes arrivals
  downstream, then applies footpath transfers.
- **Boarding is pluggable per pattern:**
  ```ts
  earliestBoard(p, s, t): { kind: 'trip'; trip: number } | { kind: 'freq'; window: number; board: number } | null
  ```
  - Timetabled trips are found by binary search on `dep`.
  - Frequency windows bound when trips *start* at the first stop, so the
    engine shifts by the stop's run offset `r = runOffset[s]`. The trip start
    is `start = max(t − r, fStart) + headway/2`, valid while `start ≤ fEnd`.
    Then `board = start + r`, and the arrival at a downstream stop is
    `start + runOffset[s']`. Take the minimum over the candidate windows.
  - A change at the same stop costs `CHANGE_SEC = 60`.
- The **range query** runs RAPTOR at departure times from `t0` to `t0 + 40
  min` in 2-minute steps, latest first, and reuses labels between runs
  (rRAPTOR). The result is a Pareto set over (depart later, arrive earlier,
  fewer rides).
- **Access and egress:**
  - Up to 25 stops within **1,000 m** of the origin and of the destination.
  - Walk time is `haversine × 1.25 / walkMetersPerMin`, which defaults to
    80 m/min. There is no walk-speed setting today; `Settings.walkMinutes`
    is the walk to *your* stop, not a pace. Proximity transfers compiled at
    80 m/min are rescaled to the query's pace.
  - A **walk-only** option is offered when the distance is under 2 km.

### 4.2 Ranking and diversity

1. Collect the Pareto set.
2. Drop options that arrive more than 30 minutes after the fastest.
3. Score each option as:
   `arrive + 3 min per transfer + 1.5 × walk minutes beyond 5 + 2 min if the first wait is over 15 min`.
4. Return the **top 5**, guaranteeing that the first is the fastest and that
   "fewest transfers" and "least walking" are present when they differ.
5. Label them with plain words: "Fastest", "Fewer changes", "Less walking".

### 4.3 Live re-timing (GTFS-R)

There are no TripUpdates. So the engine **plans on the timetable, then
re-times with live positions**:

1. The itinerary's **first bus leg** must board within the next 60 minutes.
   For it, take the vehicle positions for that leg's category from the
   existing `realtimeStore`, `resolveRouteAlias` the route, and run
   `computeEta(stop)`.
2. If a live bus will reach the boarding stop after you can (walk time plus
   60 s), that leg becomes `timing: live`.
   - Its departure is the live ETA.
   - Its downstream times shift by (live − scheduled).
3. Re-check the next transfer.
   - If the shift misses it, re-run RAPTOR from that transfer stop, at the
     new arrival time, for the remaining legs.
   - Mark the itinerary "Updated · was 9:12".
4. Later legs stay scheduled or headway, and say so.
5. **Realtime budget:**
   - Today the poller fetches every followed category in parallel every
     30 s, so two followed categories already use the whole 4-per-minute
     budget.
   - Planner categories that are **not** already followed are polled every
     60 s, **only from spare budget**. If none is spare, the itinerary stays
     scheduled and says so. They are never dropped silently: the status line
     reads "Scheduled".

### 4.4 Engine API

```ts
// packages/shared/src/transit/plan.ts
export interface Place { kind: 'here' | 'place' | 'stop' | 'station'; name: string; lat: number; lng: number; ref?: string }
export interface PlanQuery {
  from: Place; to: Place;
  departAt: number;                  // epoch ms (Malaysia time is handled inside)
  walkMetersPerMin: number;          // default 80 (no setting yet)
  maxWalkMeters?: number;            // default 1000
  maxRides?: number;                 // default 4
  modes?: readonly Mode[];           // default all included feeds
}
export interface LegPoint { stop?: number; name: string; lat: number; lng: number; time: number /* epoch ms */ }
export type Timing =
  | { kind: 'scheduled' }
  | { kind: 'headway'; headwaySec: number }
  | { kind: 'live'; vehicleId: string; asOf: number; deltaSec: number };
export type Leg =
  | { kind: 'walk'; from: LegPoint; to: LegPoint; meters: number; seconds: number }
  | { kind: 'ride'; mode: Mode; route: number; label: string; color: string; headsign: string;
      from: LegPoint; to: LegPoint; via: LegPoint[]; timing: Timing; tripKey?: string };
export interface Itinerary {
  id: string;                        // stable hash of the leg sequence (survives re-timing)
  departAt: number; arriveAt: number;
  legs: Leg[]; rides: number; walkMeters: number;
  tags: ('fastest' | 'fewer-changes' | 'less-walking')[];
  warnings: ItineraryWarning[];
  previousArriveAt?: number;         // set by retime() when times moved: "Updated · was 9:12"
}
export type ItineraryWarning = 'last-service' | 'long-wait' | 'missed-connection';
export interface LiveSnapshot {      // one entry per polled category
  byCategory: Record<string, { asOf: number; positions: VehiclePosition[] }>;
}
export interface PlanResult { itineraries: Itinerary[]; excludedFeeds: FeedId[] } // banner from excludedFeeds, even when empty
export function plan(net: TransitNetwork, q: PlanQuery): Generator<void, PlanResult>; // yields between rounds
export function retime(its: Itinerary[], live: LiveSnapshot, net: TransitNetwork,
  ctx: Pick<PlanQuery, 'to' | 'walkMetersPerMin' | 'modes'>): Itinerary[];
```

Feed-expiry notes ("rail-expired", "KTM timetable expired") come from
`PlanResult.excludedFeeds`, not from per-itinerary warnings. That way the
banner still shows when no itinerary is returned.

**Performance budget:** one `plan()` call must take under 400 ms of JS time
on an iPhone 13 in Hermes, yielding between rounds. The prototype (14/00)
proves or disproves this. If it fails, the order of escalation is:

1. shrink the window to 20 min;
2. run on a `react-native-worklets` background runtime;
3. move it to the `apps/api` fallback.

**Tests:** golden journeys run in `node --test` against fixture zips
captured on 2026-10-23, for example:

- Hotel Lisa De Inn → KLCC (T816 → MRT → LRT);
- PJ Section 14 → KL Sentral;
- Subang Jaya → Bukit Bintang (KTM → LRT → Monorail);
- a 300 m walk-only case;
- the rail-expired fallback.

---

## 5. Place search and walking (phase 15/01)

A **local Expo module**, `apps/mobile/modules/transit-maps` (Swift, about 250
lines). It is a **native change**, so it needs `expo prebuild` and an Xcode
build. It wraps:

| Function | MapKit | Use |
|---|---|---|
| `complete(query, region)` | `MKLocalSearchCompleter` (`.pointOfInterest`, `.address`) | As-you-type suggestions. Free, on device, no key. |
| `resolve(completionId)` | `MKLocalSearch` | Turns a suggestion into coordinates and a category. |
| `walk(from, to)` | `MKDirections` `.walking` | Walking path and time. **Only for the selected itinerary's walk legs**: at most 2–4 calls. |
| `lookAround(lat, lng, size)` | `MKLookAroundSnapshotter` | Destination and station photos (§7.4). Returns a file URI or null. |
| `snapshot(region, size, dark)` | `MKMapSnapshotter` | Saved-place card images. |

Suggestions merge **local results first** (stations and stops from the
network, instant and offline), then Apple places. Each Apple place shows its
category glyph (from `MKPointOfInterestCategory` mapped to an SF Symbol) and
its distance.

Credit "Data: data.gov.my (Prasarana, KTMB), CC BY 4.0" in Settings → Data
sources, alongside the existing sources.

---

## 6. Screens (phases 13 and 15)

These screens use `@expo/ui/swift-ui` (SDK 58, verified against
`node_modules/@expo/ui/build/swift-ui`), Calm Mono tokens from
`theme/design.ts`, and opaque paper sheets.

### 6.1 Peek: the "Where to?" row

```
┌───────────────────────────────────────────┐
│ ( 🔍  Where to?                ) (⌂) (💼) │  ← glass capsule + 2 glass circles
│───────────────────────────────────────────│
│ [T816]  Hotel Lisa De Inn          4 min ●│  ← existing PeekCard, unchanged
│ ━━━•━━━•━━━━━◉   Leave in 1 min           │
└───────────────────────────────────────────┘
```

- **The capsule:** glass (chrome, so it is allowed), 44pt tall,
  `magnifyingglass` plus the placeholder in secondary ink.
- **On tap:**
  - The `magnifyingglass` symbol does `symbolEffect('bounce')`.
  - The `plan` sheet opens at the large detent with the field focused.
- **Saved-place circles** (Home and Work) are visible only once set. A tap
  plans straight to that place.
- `PEEK_CONTENT_HEIGHT` grows by 52pt. The peek card itself does not change.
  `sheetDetents()` caps the peek at 0.3 of the window, which clips on an
  iPhone SE (212/647 ≈ 0.33), so the cap rises to 0.35 (15/02).
- Apple suggestions carry no coordinates or category, so each row's glyph and
  distance fill in once the **top 3** are resolved, after a 400 ms pause in
  typing (15/03).

### 6.2 `plan`: search, then results

**Search state.** The search field is `.searchable`. Below it, in order:

1. **From:** "My location", tappable to change, with a ⇅ swap control.
2. **When:** a `Menu` with "Leave now", "Depart at…" (a DatePicker) and
   "Arrive by…" (v2; disabled with "Soon").
3. **Recents** (6), **Saved** (Home and Work, plus up to 6 pins), then
   **suggestions** while typing.

Each suggestion row:

- **A station** gets line-colour squares, the name, and a line count.
- **A stop** gets a `bus.fill` glyph, the name, and the routes ("T816 · T815").
- **A place** gets its category glyph, the name, the address, and its
  distance.

**Results state.** A header shows the destination name and address, with the
Look Around image as a 16:9 banner when one exists (§7.4). Then one row per
itinerary:

```
Leave in 4 min                                   38 min
[🚶5] › [T816] › [KJ] › [🚶3]                   9:12 AM
▁▁▁▁▃▃▃▃▃▃▃▃▃▃▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▁▁              ← proportional journey bar
● Live · 1 change · 650 m walk                  Fastest
```

- **Line one:** the leave time is the primary number, 20pt semibold with
  tabular digits and a `numericText` content transition. The trip length
  goes on the right.
- **Leg chips:**
  - walk = `figure.walk` plus minutes;
  - bus = an outlined ink chip (as in README);
  - rail = a filled chip in the line colour with its `route_text_color`;
  - turn-up-and-go legs get a small "every 4" caption under the chip.
- **The journey bar:** 4pt tall, one segment per leg sized by duration.
  - walk = a dotted ink segment;
  - bus = ink;
  - rail = the line colour;
  - the wait before the first ride = a light ink hairline.
- **The status line:**
  - green dot plus "Live" only if the first bus leg is live;
  - otherwise a clock glyph plus "Scheduled";
  - then the number of changes and the walk distance. The tag goes on the right.
- Footer: "Routes use data.gov.my timetables. Rail times are every-few-minutes
  estimates." It is shown once, in secondary text.

### 6.3 `itinerary`: the detail

**On the map:**

- The camera fits all legs.
- Each leg is drawn in order with the draw-on effect (§7.1).
- Transfer points get a paper ring.
- Origin and destination are pins.

**The sheet:** detents are peek (summary) / 0.5 / 1. At the peek detent it
shows the results row for this itinerary plus a glass **Go** button. From
0.5 up it shows a vertical timeline:

```
 9:00  ○  My location
       ┊  Walk 5 min · 380 m                      (dotted rail)
 9:05  ●  Hotel Lisa De Inn                  ● Live, 2 stops away
       ┃  [T816] towards MRT Phileo Damansara      (ink rail)
       ┃  ▸ 6 stops · 14 min                      (DisclosureGroup)
 9:19  ●  MRT Phileo Damansara (Pintu A)
       ┊  Change · walk 3 min to platform
 9:24  ■  [KG] Kajang Line towards Kajang     every 6 min
       ┃  ▸ 7 stops · 15 min                      (green rail)
 9:39  ■  Pasar Seni → change to [KJ]  about 4 min walk
       ...
 9:52  ◉  KLCC
```

- **Rails** are 4pt wide: a solid ink rail for a bus, a rail in the line
  colour for rail, and a dotted rail for a walk.
- **Nodes:** a circle for a bus stop, a square for a station, and a ringed
  pin at each end.
- **Times** use tabular digits:
  - live times are full ink with the live glyph;
  - scheduled times are secondary with a clock glyph;
  - headway legs read "every 6 min" instead of a time.
- Tapping a leg makes the map fit it, with a light haptic. Tapping a station
  opens `station`.

### 6.4 `station`: the departure board

```
[photo banner: Look Around or Street View, 16:9, if any]
Pasar Seni                                   [KJ] [KG]
Kelana Jaya Line ──────────────────────────────────────
 → Gombak                                  every 3 mins
 → Putra Heights                           every 3 mins
Kajang Line ───────────────────────────────────────────
 → Kajang                about 2 mins · then every 6 mins
 → Kwasa Damansara       about 5 mins · then every 6 mins
Nearby ─────────────────────────────────────────────────
 Bus stop (route chip)         3 mins walk · next 9:14
 KTM Kuala Lumpur              about 7 mins walk
[See the whole line ›]            (opens `line`; mini strip map deferred)
```

Copy follows Calm Mono's `mins()` helper ("1 min", "3 mins") everywhere;
"every N min" elsewhere in this spec is shorthand. Before the first train
or after the last, a row shows "First train 6:00" or "No more trains
today" (the `closed` state in 13/01), never a countdown.

The board and the planner can disagree slightly about the wait. The board
counts down on the headway grid; the planner boards at half the headway
(the expected wait). That is acceptable because a rail leg in the planner
never shows a specific train, only "every N mins".

- **Rail rows show the minutes as an estimate.** The time to the next train
  is computed on the headway grid, not as a real departure, so the label is
  "about 2 min" in secondary weight when the headway is over 5 min. Within 5
  min, "every 3 min" is enough, and the board shows only that, which avoids
  fake precision.
- **Bus rows** reuse the timetable, ETA and live code.
- **First and last train** sit in a quiet footer row ("First 6:00 · Last
  23:25"), because the last train matters at night.

### 6.5 `line`: the strip map

A vertical strip map for the whole line:

- the line-colour rail (6pt) on the left;
- station beads;
- interchange beads showing the other lines' colour squares;
- your nearest station marked with the standing-figure pin;
- **estimated trains** (§7.2).

A `Picker` (segmented) chooses the direction. The header has the line badge,
the full name, "every 3 min now", and first and last times.

---

## 7. Motion and imagery

All motion follows README §Motion: the ease-out curve (0.23, 1, 0.32, 1),
spring sheets, and a **crossfade-only fallback under Reduce Motion**.
Haptics fire only on decisions.

| # | Moment | Implementation | Values |
|---|---|---|---|
| 7.1 | **Itinerary draw-on:** legs draw from origin to destination when `itinerary` opens. | Append each leg as **chunked polylines** (at most 24 chunks per itinerary), one leg after another. Mutating coordinates at 60 Hz triggers the Fabric overlay re-add warnings noted in `RouteLayer.tsx` and `RouteShimmer.tsx`. The camera fits first. | 650 ms total, ease-out. Walk legs appear at once, dotted. Skipped (all legs at once) under Reduce Motion. |
| 7.2 | **Estimated trains on the strip map.** | Reanimated `translateY` along the straight rail (no Skia needed). Each train is a **dashed-outline** disc carrying its mode's glyph (glyph table below): the same "scheduled, not live" encoding as the scheduled-bus dashed ring, so it is honest. Trains are spaced by headway and move at the template run time between stations. | Linear motion, paused offscreen. Caption under the header: "Trains shown at timetable spacing — Rapid Rail doesn't publish live positions." Static dots under Reduce Motion. |
| 7.3 | **Countdowns roll.** | `@expo/ui` `Text` with `contentTransition('numericText', {countsDown: true})` + `animation(Animation.smooth, value)`. For under-a-minute timers, `Text date` with `dateStyle: 'timer'`. | System numeric transition. |
| 7.4 | **Destination and station photos.** | `lookAround()` snapshot, with fallback to the existing Street View `StopPhoto` (when a key is set), then to an `MKMapSnapshotter` tile. Fades in over 180 ms; a `redacted` placeholder holds the space. | 16:9 (`StopPhoto` gains an `aspectRatio` prop; it is 2:1 today), radius `radius.group`, cached per stop or place id in the caches directory for 30 days. |
| 7.5 | **Results arrive.** | Rows enter with a 40 ms stagger: opacity 0→1 and y 8→0 (Reanimated `FadeInDown`, custom 220 ms ease-out). | Only on the first results, not on live re-timing. |
| 7.6 | **Live re-timing.** | The changed time rolls (`numericText`). The status line crossfades to "Updated · was 9:12" for 4 s, then settles. | No haptic. |
| 7.7 | **Searching.** | While `plan()` runs for more than 150 ms, a 3-dot "route" loader: three ink beads travel along a short hairline (Reanimated, 900 ms loop). Never a spinner. | Hidden if the result arrives within 150 ms. |
| 7.8 | **Live dot.** | Reuse the existing pulsing green dot, or `symbolEffect('pulse')` on the `dot.radiowaves` variant in SwiftUI rows. | Existing. |
| 7.9 | **Go mode transitions.** | A leg completes → the timeline node fills, the next leg's rail brightens, and a success haptic fires on "get off now" (existing ride rules). | Existing ride motion. |

**Glyphs (SF Symbols):**

| Thing | Symbol |
|---|---|
| Bus | `bus.fill` |
| LRT / BRT | `tram.fill` |
| MRT / KTM | `train.side.front.car` |
| Monorail | `lightrail.fill` |
| Walk | `figure.walk` |
| Station | `square.fill` |
| Swap | `arrow.up.arrow.down` |
| Home / Work | `house.fill` / `briefcase.fill` |
| Live | `dot.radiowaves.left.and.right` |

**No new native animation libraries.** Skia, Lottie and Rive are not needed.
A full schematic network diagram (a KL metro map) is a **stretch** item
(13/06). It would add `react-native-svg`, which is native.

---

## 8. Go mode (phase 15/06)

Go mode extends `RideContext` and the Live Activity to a list of legs:

- **Live Activity:** shows the current leg ("Walk to Hotel Lisa De Inn · T816
  in 3 min", then "On T816 · 4 stops to MRT Phileo Damansara", then "KG
  towards Kajang · every 6 min · get off at Pasar Seni").
- **Notifications:** leave-now for the first ride, then get-off and change
  alerts per ride leg. These reuse the existing reminders and the
  `geofence` service.
- **Rail legs:** progress is shown by elapsed time against the template run
  times, since there is no live data, and says "about".
- **Off-route:** when the user's location strays more than 400 m from the
  plan, show "Off route? Re-plan from here", as a button and never
  automatically.

---

## 9. Risks and open questions

| Risk | Mitigation |
|---|---|
| The rail feed expires on 2026-12-31 and is not renewed. | The §3.6 states and a clear note. The bundled `RAIL_STATIONS` keep the map layer working. Watch the feed weekly. |
| The device build or `plan()` is too slow in Hermes. | Prototypes 12/00 and 14/00 run first. Escalation is in §4.4. |
| The headway model misstates real waits. | Show "every N min", never clock times, for rail. The expected-wait model is standard for frequent services. |
| The curated interchange times are wrong. | Each entry has a `verified` flag; unverified entries show "about". Walk them in person and update. |
| MapKit place search coverage in KL. | Local stations and stops always come first. A Google Places fallback is possible later, with a key. |
| The realtime 4-per-minute budget. | Planner subscriptions are capped at 2 categories at 60 s, merged in `realtimePlan`. |
| `MKLookAroundSnapshotter` coverage in Malaysia is unverified. | Street View, then the map snapshot as fallbacks. |
| KTMB realtime claims conflict: ETS only vs Komuter too. | Not used in v1. Re-decode the live feed during service hours (task 12/00) and revisit. |
