# BusBuddy: what data we actually have (as of 2026-10-20)

Scope: the data BusBuddy (Expo SDK 58, iOS, no backend, Rapid KL **MRT feeder** buses) can build features on. It covers
data.gov.my GTFS-Realtime and GTFS static, other free Malaysian open APIs, and what can be computed on the device.

## Evidence legend

- **[V]**: verified. Either a primary source I read (official docs source code and git history in `data-gov-my/datagovmy-front`), or real feed bytes I decoded myself in this session. A link or path is given.
- **[S]**: secondary. Measured or written down by a third-party project (named) that I could read but not re-run.
- **[U]**: unverified or inferred. Treat it as a hypothesis.

## Method note

The sandbox blocks `*.data.gov.my`, so I could not call the API live (`curl` got `CONNECT tunnel failed, 403`). In its place I used these sources:
- **Official docs, from source.** I cloned `data-gov-my/datagovmy-front` (HEAD 2026-10-16). The developer portal is built from `apps/docs/pages/**`, and its git history dates every change.
- **Real captured protobuf payloads committed in public repos**, decoded with my own wire-format decoder (`scripts/decode.py`):
  - `hongvin/bkhome`: rapid-bus-kl, 2026-09-28
  - `tomatogoesrotten/kl_transit`: 11 rapid-bus-kl snapshots plus KTMB, 2026-09-25
  - `junmob/final-year-project`: rapid-bus-mrtfeeder and rapid-bus-kl, 2026-10-20 02:10 MYT
- **Static GTFS snapshots committed in public repos**:
  - `wjgoh/bus-tracker-nohost`: mrtfeeder and bus-kl, Feb 2026 service
  - `tomatogoesrotten/kl_transit`: rapid-rail-kl
  - `junmob/final-year-project`: header and first-row dump of all feeds, downloaded around 2026-10-05
- **GitHub issues** on `data-gov-my/datagovmy-front`, read through github.com.
- **Measurement notes from `junmob/final-year-project`** (`docs/data-source/data-source-summary.md`). This is the most careful third-party study I found. It measured both KL bus feeds on 2026-10-05 and 2026-10-11, and the weather API on 2026-10-20.

All clones are in `scratchpad/feature-research/` (`datagovmy-front/`, `datagovmy-meta/`, `repos/`).

---

## 0. TL;DR constraints that shape every feature

1. **Only VehiclePositions exist, for buses** [V]. There are no TripUpdates and no Alerts. The docs still say they are *"in our pipeline for 2026"*. That wording was changed from "2024-25" on 2025-10-10 (commit `158899c4`). As of the 2026-10-16 docs HEAD, nothing has shipped and the changelog has no entry. Any ETA, delay or alert in the app is **our own inference**.
2. **Rate limit: 4 requests per minute for "GTFS Realtime"** [V] (`apps/docs/pages/rate-limit.en.mdx`).
   - The higher token tier (10/min) was **removed** on 2026-04-03 (commits `3bf1407b` and `ccf12993`: "Remove API auth docs"). There is now no API key, and no way to get a higher limit.
   - The docs do not say what the limit counts against (IP or endpoint).
   - Polling one category every 30 s uses 2 of the 4 requests.
   - On mobile carrier CGNAT, many phones may share one IP [U].
3. **For the mrtfeeder RT, join on `route_id`, not `trip_id`.**
   - RT `route_id` is the public route number (`T105`, `T816`). It equals static `routes.route_long_name`, not static `route_id` (`30000143`) [V].
   - RT `trip_id` matches static only about 86–90% of the time [S]. Sometimes it carries a year-old service prefix [V].
4. **Speed is km/h, not m/s** [V, by inference from the value distribution]. The app already assumes this.
5. **The feed can be "up but empty" for weeks.** HTTP 200 with zero entities happened in Mar 2026, Jun 2026 and from 2026-08-06 into September [S]. Show feed health explicitly.
6. **The mrtfeeder static feed has a short validity window** of about 5–6 weeks per calendar block, and it encodes public holidays [V]. Refresh it at least weekly. The docs recommend daily at 04:00 [V].

---

## 1. data.gov.my GTFS-Realtime: agencies, status, limits

### 1.1 Endpoints (official) [V]

Source: `apps/docs/pages/realtime-api/gtfs-realtime.en.mdx` and `changelog.en.mdx` in datagovmy-front. This is the source of developer.data.gov.my/realtime-api/gtfs-realtime.

| Feed | Realtime URL (`https://api.data.gov.my/gtfs-realtime/vehicle-position/...`) | Since | Official status / notes |
|---|---|---|---|
| Prasarana Rapid Bus KL | `prasarana?category=rapid-bus-kl` | 2023-11-14 | Live |
| **Prasarana MRT Feeder** | `prasarana?category=rapid-bus-mrtfeeder` | 2024-04-01 (v1.4.0) | Live |
| Prasarana Rapid Kuantan | `prasarana?category=rapid-bus-kuantan` | 2023-11-14 | Docs list E003/E004: trip_id and route_id are not in static. Returns **404** [S, transit-pulse `config.js`] |
| Prasarana Rapid Penang | `prasarana?category=rapid-bus-penang` | 2023-11-14 | E003/E004. RT trip_id has no service prefix. Match the suffix after `weekday_`/`weekend_`/`2310xxxx_` |
| Prasarana Rapid Rail KL | none (`rapid-rail-kl`) | n/a | *"does not yet have stable realtime feeds"*. Returns HTTP 404 [S, hongvin/bkhome fixtures README] |
| KTMB | `ktmb` | 2023-11-14 | Live, but only ETS intercity trains (see 1.4) |
| BAS.MY Johor Bahru | `mybas-johor` | 2023-11-14 | Live |
| BAS.MY Kangar, Alor Setar, Kota Bharu, Kuala Terengganu, Kuching | `mybas-<city>` | 2025-10-10 (v1.5.0) | Live. Issue #622: `routeId` and `startDate` are missing for these cities (open) |
| BAS.MY Melaka | `mybas-melaka` | 2025-10-13 (v1.6.0) | Live |
| BAS.MY Ipoh, Seremban A, Seremban B | `mybas-ipoh`, `mybas-seremban-a`, `mybas-seremban-b` | 2025-12-05 (commit `e2d2592b`). No changelog entry | Live. Seremban has two operators, so poll both |

- **Update frequency, official:** "All Vehicle Position feeds are updated every **30 seconds**." [V]
- **Actual cadence of rapid-bus-kl content: about every 60 s** [V, my decode of 11 kl_transit snapshots]. The header timestamp deltas were 61, 59, 79, 65, 55, 64 and 54 s. kl_transit reports the same: header advanced every 60–65 s, and fetches in between returned identical bytes [S].
- **Per-vehicle fix age when fetched:** 2–90 s, median about 20–35 s (my decode). kl_transit saw 20–140 s, median 60 s, and gaps of up to 270 s between fixes for one vehicle [S].
- **mrtfeeder cadence:** not measured. The FYP saw an 84 s spread of timestamps within one snapshot for bus-kl [S].
- **Feed age for BusBuddy:** polling faster than about 30 s gives nothing. A 30 s poll catches each 60 s update within about 30 s.

**Format** [V]:
- Protobuf FeedMessage, `gtfs_realtime_version` "2.0", incrementality FULL_DATASET.
- `content-type: application/octet-stream`, `content-disposition: attachment; filename=vehicle-position-prasarana.proto` [S, hongvin README].
- Payload size [S, FYP]: 6–12 KB at 80–125 vehicles. 15 bytes when empty.

**Redirects and CORS** [S]:
- `.../prasarana?category=...` answers **301** to `.../prasarana/?category=...`. Adding the trailing slash saves a round trip (hongvin, kl_transit, transit-pulse all report this).
- For static, transit-pulse says the opposite: 302 *with* the slash. kl_transit says "without slash redirects twice". The evidence conflicts, so just follow redirects.
- `Access-Control-Allow-Origin: *`. Native apps do not need this.

**Rate limit** [V]: 4 requests per minute per API family (Data Catalogue, OpenDOSM, Weather, GTFS Static and GTFS Realtime are listed separately). Excess requests get `429 Too Many Requests`.
- Enforcement observed [S]:
  - kl_transit made 6/min across two endpoints for 4 min with no 429.
  - hongvin saw 429 "after many requests in a minute".
- The FYP reads the table as separate buckets per API family [S].
- No token tier exists any more [V].
- **Auth:** none. Quickstart says "The Open API does not require an API token." [V]
- **License:** CC BY 4.0 per the docs FAQ [V]. Transitland DMFR also records CC-BY-4.0 [V, `transitland-atlas/feeds/data.gov.my.dmfr.json`].
- kl_transit notes the "Terms of Use for Government Open Data Malaysia 1.0" grant no right to logos. Do not use Rapid KL or Prasarana branding [S].

### 1.2 Status of trip updates, alerts and new feed types (late 2026)

- **Not launched** [V].
  - The only wording is still "service alerts and trip updates are in our pipeline for 2026".
  - The pipeline line history: "2024-25" (2023-11-14, `772f270e`), then "2026" (2025-10-10, `158899c4`).
  - Every changelog entry after 1.6.0 (2025-10-13) is absent. The only later feed change is the Ipoh and Seremban docs (2025-12-05).
  - Docs commits since then are infra or auth only. Latest: "Migrate to new Tinybird endpoints", 2026-10-16.
- `trip-update` and `alert` URLs return 404 [S, zeroWait `docs/gtfs-data-analysis.md`, 2026-04-12]. bus-watch has an unfilled probe for this.
- The usage-metrics dashboard config lists only `gtfsr-*` vehicle-position endpoints [V, `datagovmy-meta/data-catalogue/usage_metrics_openapi.json`].
- Web search (extended) found no announcement of trip updates or alerts going live [S].
- **Unofficial alternative (do not use):** issue #659 (Aug 2026) describes Prasarana's internal Socket.IO AVL stream at `rapidbus-socketio-avl.prasarana.com.my`, which powers the official live map. It is undocumented and unofficial, and it is not covered by the open-data licence. kl_transit explicitly refuses to scrape it. **Not recommended.**

### 1.3 Known data-quality issues

| Issue | Feeds | Evidence |
|---|---|---|
| E028: vehicle positions outside the service area (GPS transponder errors) | all bus feeds | [V] official docs |
| E003/E004: RT trip_id and route_id not in static | Kuantan, Penang | [V] official docs |
| **mrtfeeder RT `route_id` = route short name (`T105`), static `route_id` = `30000143`** | mrtfeeder | [V] my decode; issue #632 (closed 2026-09-18 with no fix or comment); FYP: 0/123 and 0/80 direct matches. The app's `realtime.ts` already falls back to `trip.route_id` |
| mrtfeeder RT `trip_id` only matches static about 86–90% of the time, even with a same-week static. Static trip_ids carry a date-like service prefix (`2610020100xxSnn`) that rotates with each static release | mrtfeeder | [S] FYP §4.4: 90.2%, 86.2%. [V] prefix format from static |
| rapid-bus-kl RT `trip_id` matches about 88%. Misses have a higher `_N` instance suffix than static defines | bus-kl | [S] FYP |
| **Ghost vehicle with a fixed future timestamp:** `VAL4552`, trip `241209021024S2` (Dec 2024 service prefix), route `T105`, timestamp `1886017556` = **2029-10-06T21:45:56Z**. Present from Jan 2026 (issue #632) to 2026-10-20 | mrtfeeder | [V] my decode of junmob `raw_rapid-bus-mrtfeeder_20261019T181054Z.pb`; [S] FYP E03 |
| **Feed returns HTTP 200 with zero entities while buses run (silent outage)** | bus-kl (and "KL feed") | [S] transit-pulse `feed-sources.js`: from 2026-08-06; issue #659 (2026-08-13, 0 vehicles); issues #634 (2026-03-21, count too low), #637 and #638 (2026-03-28/29, KL feed down), #646 (2026-06-01, KL feed stopped). All closed 2026-09-18 with no comment. Data was back by 2026-09-25 (kl_transit samples) [V] |
| Feeds drain to zero overnight. Buses report about 06:00–23:30 | all | [V] bus-kl was 15 bytes and empty at 02:10 MYT, mrtfeeder held only the ghost bus. [S] transit-pulse |
| mrtfeeder routes missing from RT (T504/T505 asked about, no answer) | mrtfeeder | [S] issue #668 (open, 2026-09-19). T504 and T505 **are** in static [V] |
| KTMB: placeholder `speed=90` and `bearing=0` on every entity; one fix at (0.0027, 0.0155); 4 of 12 responses empty, interleaved with full ones | ktmb | [V] my decode of kl_transit KTM fixture: all speeds 90.0. [S] kl_transit proposal |
| Vehicle id formats vary (`WB3552P` plates vs `RAPID443`, `RPD429`) | bus-kl, feeder | [S] FYP E06 |
| Device clock skew: the server header can be "from the future" relative to the client | all | [S] kl_transit (about 3 s) |
| Problematic-trips CSV (about 2% of rapid-bus-kl trips removed from stop_times) is now empty | bus-kl static | [V] docs; [S] issue #621 (open) |
| Rapid Bus KL stop coordinates out of date after the 2026 route restructuring (stops more than 80 m off the shape) | bus-kl static | [S] issue #650 (open) |

### 1.4 Other feeds, briefly

- **KTMB RT** carries only **ETS intercity** (labels `ETS301` to `ETS310`), 6–9 vehicles. There is no Komuter and no route_id. Speed and bearing are placeholders [V decode, S kl_transit, S zeroWait]. It is useless for Klang Valley commuter connections.
- **rapid-rail-kl RT** does not exist (404). Rail can only be **scheduled positions** from frequencies.

---

## 2. Exactly which VehiclePosition fields Prasarana populates

Decoded by me with `scripts/decode.py` (counts are entities with the field present).

| Field | rapid-bus-kl (2026-09-28 20:08 MYT, 100 ents; 2026-09-25 x11, 108–124 ents) | rapid-bus-mrtfeeder | Notes |
|---|---|---|---|
| `entity.id` | "0", "1", ... (index, **not stable**) | same | Key on `vehicle.id` instead [V] |
| `trip.trip_id` | 100% e.g. `weekday_U6520_U652002_2` | 100% e.g. `241209021024S2`, `261002030114S2` | bus-kl: `weekday_`/`weekend_` + route + shape + `_N`. Feeder: YYMMDD + 2-digit service + 4-digit block + `S` + seq [V]/[S] |
| `trip.route_id` | 100%, internal id (`U3000` = public "300"), present in static `routes.txt` | 100%, **public number (`T105`) = static `route_long_name`** | [V] |
| `trip.start_time` | 100% e.g. `19:20:28` (has seconds: actual start, not scheduled) | **absent** | [V] bus-kl; [S] FYP and zeroWait for feeder |
| `trip.start_date` | 100% `YYYYMMDD` | **absent** | Feeder service day must be inferred from timestamp (risky after midnight) [S] |
| `trip.direction_id`, `schedule_relationship` | absent | absent | [V] |
| `position.latitude/longitude` | 100% | 100% | float32 [V] |
| `position.bearing` | 100% (one decimal; 0.0 is common when stopped) | 100% (**integers**) | [V] decode; [S] FYP |
| `position.speed` | 100%. Median 15–18, p90 37–44, max 82 | 100% (**integers**, e.g. 13, 28–46) | **km/h** (see below) |
| `position.odometer` | absent | absent | [V] |
| `timestamp` (vehicle) | 100% epoch s | 100% (one bogus 2029 value) | [V] |
| `vehicle.id` | 100% = licence plate | 100% = plate | [V] |
| `vehicle.license_plate` | 100% | 100% | [V] |
| `vehicle.label` | **absent** | **absent** | KTMB only [V] |
| `current_stop_sequence`, `stop_id`, `current_status` | **absent** | **absent** | [V] 0/100 bus-kl; [S] feeder field list (FYP console dump, zeroWait) |
| `occupancy_status`, `occupancy_percentage`, `congestion_level`, `multi_carriage_details` | **absent** | **absent** | [V] bus-kl; [S] feeder. Crowding features are impossible |
| `FeedHeader.timestamp` | present | present | Use it to measure feed staleness [V] |

**Speed unit: km/h** [V, inference from real data].
- Across 1,357 bus-kl observations the median is about 16 km/h and the max is 82. Read as m/s, that would be 295 km/h for a city bus. That is impossible.
- Many values are `n/3.6` (16.67, 44.45, 55.56, 66.67). That suggests the AVL computes distance over time and reports km/h.
- Feeder values are integers 0–46.
- Agreeing sources: kl_transit ("almost certainly sending km/h"); transit-pulse displays raw values as km/h; the BusBuddy codebase already treats it as km/h.
- Dissenting sources: zeroWait labels it m/s; the FYP leans m/s for bus-kl because of the `/3.6` pattern. I think they are wrong given the maxima.

**Missing fields mean** [V]: there is no on-board "next stop" or "at stop" status and no occupancy. Stop progress must come from projecting the GPS position onto the shape.

---

## 3. GTFS static contents

### 3.1 Endpoints [V]

`GET https://api.data.gov.my/gtfs-static/prasarana?category={rapid-bus-kl|rapid-bus-mrtfeeder|rapid-rail-kl|rapid-bus-penang|rapid-bus-kuantan}`, plus `/gtfs-static/ktmb` and `/gtfs-static/mybas-*` (same city list as RT). Each returns a ZIP.

Update frequency: KTMB daily at 00:01; Prasarana and BAS.MY "as required". The docs recommend a daily refresh at 04:00. Rate limit: 4/min.

### 3.2 rapid-bus-mrtfeeder (our feed)

Analysed by me from `wjgoh/bus-tracker-nohost/src/staticgtfs/rapid_bus_mrtfeeder` (Feb–Mar 2026 service; script `scripts/analyze.py`). Cross-checked against the Oct 2026 header dump in junmob `sample_gtfs_static.txt`.

| File | Present | Contents / quirks |
|---|---|---|
| agency.txt | yes | **No `agency_id` column**. Name "MRT Feeder Bus", phone `03-7885-2585` [V] |
| routes.txt | yes (91 routes) | `route_id,agency_id,route_short_name,route_long_name,route_type`. **`agency_id` and `route_short_name` empty; public number is in `route_long_name`** (`T117`). **No `route_color`/`route_text_color`**, so we must pick colours ourselves. route_type 3 [V] |
| trips.txt | yes (6,227 trips) | `trip_headsign` always set, as "terminus - area" (e.g. `MRT SURIAN - SEK 11 KOTA DAMANSARA`). **`direction_id` is 0 for 6,087 trips and 1 for 140**: most routes are loops. `shape_id` set (92 shapes). **No `wheelchair_accessible`, no `block_id`** [V] |
| stop_times.txt | yes (174k rows, about 25 stops per trip) | **Exact, per-second times** (91% not on the whole minute, so probably interpolated). `shape_dist_traveled` in **km**. `stop_headsign` is populated, but in most trips it is **each stop's own name** (a quirk, not a headsign). 94% of trips are loops (first stop = last stop) [V] |
| stops.txt | yes (2,109 stops) | `stop_id,stop_code,stop_name,stop_lat,stop_lon`. `stop_code` is the public pole code (e.g. `PJ785`). **No `parent_station`, `wheelchair_boarding`, `location_type`** [V] |
| shapes.txt | yes (about 35k points) | with `shape_dist_traveled` (km) [V] |
| calendar.txt | yes (2–3 rows) | Numeric service ids (`26100201` Mon–Fri, `26100203` Mon+Sat+Sun). **Validity is about 5–6 weeks** (e.g. 2026-10-05 to 2026-11-13 and 2026-10-10 to 2026-11-15) [V] |
| calendar_dates.txt | yes | **Encodes public holidays** by adding the weekend/holiday service and removing weekday service. In Feb 2026: weekday `26020401` removed on 17–18 Feb (CNY), and `26020402` (Tue/Wed/Sat/Sun) removed on every Tue/Wed *except* 17–18 Feb. In Oct 2026: weekday removed on 2026-11-09 (Deepavali replacement holiday) [V]; [S] FYP V04 |
| frequencies.txt | **no** | schedule-based [V] |
| transfers.txt, fare_attributes.txt, fare_rules.txt, feed_info.txt, attributions.txt, levels/pathways | **no** | [V] |

Other numbers [V]:
- Weekday trips: 3,379. Weekend/holiday trips: 2,848.
- Service runs from 05:30 to 23:30 (first and last departures).
- Median scheduled headway per route, direction and service: **30 min** (p10 20, p90 45).
- Median trip duration: 35 min (max 105).

**Rail adjacency** [V, my computation]:
- 95 feeder stops lie within 250 m of a rapid-rail-kl station, covering 58 distinct stations.
- **88 of 91 feeder routes** touch a rail station.
- 70 feeder stop names contain "MRT" or "LRT" (e.g. `MRT SURIAN PINTU B`, `(M1) MRT SEMANTAN PINTU B`). Gate letter ("Pintu A/B") is in the name.

### 3.3 rapid-bus-kl (for comparison or a future expansion) [V]

- routes.txt: 138–145 routes, with **`route_color`** and **`route_text_color`** (e.g. `006CFF`, BRT `21618C`). `route_short_name` is the public number (`300`); `route_long_name` is "A ~ B".
- trips.txt: `trip_headsign` mostly **empty**. Derive it from the last stop.
- **Frequency-based:** `frequencies.txt` has about 2,100–2,300 rows, `exact_times=0`, headways typically 20–60 min. One template trip per window.
- calendar: `weekday`/`weekend` only, running 2020-04-01 to 2027-03-31 (Oct 2026 copy). **No calendar_dates, so holidays are not encoded.**
- stops.txt: `stop_name` embeds the pole code (`PJ445 LRT TAMAN JAYA`) and has `stop_desc`.
- No fares, transfers, wheelchair fields or feed_info.

### 3.4 rapid-rail-kl (LRT/MRT/Monorail/BRT): useful for rail-connection features [V]

From `tomatogoesrotten/kl_transit/data/gtfs` and hongvin copies:
- **8 routes** with official colours:
  - AG Ampang `e57200`
  - KJ Kelana Jaya `D50032`
  - PH Sri Petaling `76232f`
  - KGL Kajang `047940`
  - PYL Putrajaya `FFCD00`
  - MR Monorail `84bd00`
  - BRT Sunway `115740` (route_type 0)
  - SA Shah Alam LRT3 `00A9E0`
- **187 stops**, with non-standard extras `category` (LRT/MRT/MR/BRT), `route_id`, `isOKU` (all `true`), `status`, `search`, and `geometry` (literally `[object Object]`).
- **One stop row per line at interchanges.** No `parent_station` and no `transfers.txt`, so interchanges must be merged by name or proximity.
- **Frequency-based:** `frequencies.txt` has 105 rows (180 s peak and 300 s off-peak, e.g. Ampang line). Every template trip starts at 06:00 from the terminus.
- `stop_times.txt` has a **UTF-8 BOM**, extra `route_id`/`direction_id` columns using different codes (`AGL` vs `AG`), and times without a leading zero (`6:00:00`).
- `shapes.txt` column order is **lon, lat**. Read by header name.
- **calendar ends 2026-12-31**; old `weekday`/`weekend` rows ended 2026-03-31. **The feed expires in about 10 weeks unless renewed** [V]. There is no holiday calendar [S kl_transit].
- No realtime.

### 3.5 KTMB static [V, S]

- Komuter (Seremban, Port Klang, etc.), ETS, Intercity and Shuttle Tebrau.
- route_type 0 (sic). `route_color` present (e.g. `3C5A9F`).
- `stop_times.shape_dist_traveled` present, but no shapes.txt.
- calendar plus calendar_dates. Service windows are short (e.g. 2026-08-18 to 2026-10-19).
- It has gone stale before (issue #631: ended 2026-01-01).
- Could support "KTM Komuter connection" timetables, scheduled only.

### 3.6 BAS.MY (out of scope) [V]

- Johor and Melaka static feeds include **GTFS-Fares v2** (`fare_products`, `fare_leg_rules`, `areas`, `stop_areas`, `fare_media`, `rider_categories`; e.g. RM0.90 cash adult).
- Ipoh and Seremban calendars are valid for a single day (start = end).
- Issue #679: Kota Bharu static returns zero routes (2026-10-19).

---

## 4. Other free Malaysian open APIs worth combining

All on `https://api.data.gov.my`. No key [V]. 4 requests per minute per API family [V]. JSON. Query params: `filter`, `ifilter`, `contains`, `icontains`, `range`, `sort`, `date_start`/`date_end`, `timestamp_start`/`timestamp_end`, `limit`, `include`/`exclude`. Nested fields use `__` [V] (`request-query.en.mdx`).

| API | Endpoint | Data | Freshness | Use in BusBuddy | Evidence |
|---|---|---|---|---|---|
| **MET 7-day forecast** | `/weather/forecast` (e.g. `?contains=Ds057@location__location_id`) | Per location (`St` state, `Ds` district, `Tn` town, `Rc`, `Dv`): morning/afternoon/night/summary text in **Malay only** (fixed enum, e.g. `Ribut petir di beberapa tempat`), `summary_when`, `min_temp`/`max_temp`. **No coordinates** | daily, revised within the day | "Thunderstorms this afternoon, leave earlier" banner; rain-aware ETA padding | [V] docs. [S] FYP: unfiltered call returns all 440 locations x 7 days (3,080 rows, about 0.9 MB, about 24 KB gzip); no history (date filters for past dates return `[]`); actual values include undocumented spellings (`Jerebu`, `Tiada Hujan`). KL-area ids: `St009` WP KL, `St008` Selangor, `Ds057` Petaling, `Ds055` Gombak, `Ds058` Kuala Lumpur, `Tn076` Petaling Jaya, `Tn074` Damansara, `Tn070` Shah Alam, `Tn077` Subang Jaya, `Tn086` Cheras, `Tn090` Kajang, `Tn171` Puchong |
| **MET warnings** | `/weather/warning` | `warning_issue{issued,title_en,title_bm}`, `valid_from`/`valid_to`, `heading_en`, `text_en`, `instruction_en` (+ `_bm`). Area is in free text only | when issued | "Thunderstorm warning in effect" notice; parse areas by keyword | [V] docs |
| MET earthquake | `/weather/warning/earthquake` | quakes | as needed | not useful | [V] |
| Flood warning (JPS / DID) | `/flood-warning` | Station water level, alert/warning/danger thresholds, trend, rainfall, lat/lon; updated every 15 min (per the old docs) | 15 min | "Flood alert near your route" by proximity to route shapes | [V] launched in v1.0.0; docs **removed 2024-02-07** ("temp remove flood warning docs", `89524287`). **Current availability unverified [U]**; a third-party MCP server still calls it [S] |
| Data catalogue: ridership | `/data-catalogue?id=ridership_headline` or parquet at `storage.data.gov.my/transportation/ridership_headline.parquet` | Daily trips by line: `bus_rkl`, `bus_rkn`, `bus_rpn`, each rail line. **No feeder-only column** | daily (as of 2026-08-31) | "How busy is the network" context only | [V] `datagovmy-meta/data-catalogue/ridership_headline.json` |
| Data catalogue: Rapid Rail OD | `storage.data.gov.my/transportation/rail/rapidrail_YYYY_daily.parquet` (`exclude_openapi: true`) | Daily origin-destination trips per station pair, with `A0` aggregate rows | T+1 | Rank feeder routes by the rail station demand they serve (offline analysis; too big for a phone) | [V] catalogue JSON; [S] FYP |
| Air pollution | catalogue `air_pollution` | **Monthly** averages only | monthly | not useful live. Real-time API (APIMS, eqms.doe.gov.my) has **no documented public API** | [V] catalogue; [S] search |
| Public holidays | **none on data.gov.my** | n/a | n/a | Use the mrtfeeder `calendar_dates` (already encodes holidays). Otherwise bundle a hand-maintained list per state (WPKL vs Selangor differ) | [V] no catalogue entry; [S] FYP §6.3 |
| MET Malaysia native API | `api.met.gov.my/v2.1` | richer forecasts | n/a | Needs a registered token. Status in 2026 unknown | [U] |
| Non-government extras (free, no key) | OpenStreetMap / Overpass (station entrances, footpaths), Apple MapKit `MKDirections` walking (on device) | | | Walking time to stop or station entrance | [U] not researched in depth |

---

## 5. Derived capabilities computable on the device

Inputs: mrtfeeder static (routes, trips, stop_times, shapes, calendar, calendar_dates), the RT position every 30–60 s, the user's location, and optionally rapid-rail-kl static.

| Capability | How | Caveats |
|---|---|---|
| **Route matching for a live bus** | RT `route_id` (`T816`) to static `route_long_name`. Use `trip_id` to static only as a bonus (about 88%) | Drop entities with a future timestamp (more than 5 min ahead of the header) or more than 10 min stale. Filter ghost vehicles |
| **Snap to route and progress** | Project the GPS point onto the trip's or route's shape. `shape_dist_traveled` (km) gives the distance along the route and maps to the stop sequence | Loops (94%): first and last stop are the same, so use monotonic progress and direction from bearing and history to avoid snapping to the wrong half. E028 GPS outliers: reject jumps above about 120 km/h implied speed. Off-route detours: flag them when more than about 100 m off the shape |
| **Stops away / next stop** | From the snapped distance vs stop `shape_dist_traveled` | No `current_stop_sequence` in the feed, so this is purely our inference |
| **ETA (estimated, not predicted)** | Remaining distance divided by a speed model: live smoothed speed (km/h), the scheduled segment time from stop_times (per-second precision), or a locally learned segment time by hour of day | **No TripUpdates**, so label it "estimated". The position is 20–90 s old on arrival; add age x speed. Feeds can silently go empty |
| **Schedule adherence (early/late) per trip** | When RT `trip_id` matches static: compare progress with the stop_times-interpolated scheduled position. Otherwise match to the nearest scheduled trip of that route (closest scheduled position, same service day from `calendar` + `calendar_dates`) | The feeder has no `start_time`/`start_date`; infer the service day (after midnight is risky). Trip-match ambiguity on loops with 20–30 min headways is low |
| **Headway and bunching detection** | Sort live buses on a route by along-route distance; gap = distance difference divided by speed, or time-since-passing at a point. Flag when the gap is under 25–35% of the scheduled headway (scheduled median 30 min) | Needs at least 2 buses on a route at once. Many feeder routes run 1–3 buses |
| **"Ghost" or missing service** | Scheduled trips (static) with no matching live vehicle on that route within ±10 min, so "bus not tracked / possibly cancelled" | Some routes never appear in RT (issue #668: T504/T505), and feed outages. Show this as "not tracked", not "cancelled" |
| **Historical reliability (local logging)** | Store per-stop pass times derived from snapped positions (SQLite, about 1 row per stop passage) to build on-time %, typical wait, and headway regularity per route, stop and hour | Only while the app is polling (iOS background limits), so data is sparse and biased to when the user looks. No backend aggregation across users |
| **Feed health indicator** | Track header age, entity count vs the usual for the hour, and 429/404 counts | Empty-but-200 outages have lasted weeks |
| **Nearest stop / walking** | Haversine to 2,109 stops; walking time from MapKit or straight line x 1.3 | No pathways or entrances in GTFS |
| **Rail connections / transfers** | Proximity join (under 250 m) of feeder stops to rapid-rail-kl stations: 58 stations, 88/91 routes. Name match on `MRT X PINTU Y`. Next-train times from rail `frequencies.txt` (headway-based: "every 3–5 min") | Rail has no realtime and its calendar ends 2026-12-31. Interchanges are separate stops per line. No `transfers.txt` or min transfer time, so assume about 5 min |
| **Route coverage map / search** | Shapes plus stops plus `trip_headsign`; search by route number, stop name or **`stop_code`** (pole code printed at stops) | No route colours in the feeder feed |
| **Service-day awareness (holidays)** | `calendar_dates` already moves holidays to the weekend timetable | It covers only about 6 weeks ahead, so refresh static weekly or daily |
| **First/last bus, frequency by time of day** | Directly from stop_times per stop and route | Must apply calendar_dates |
| **Weather-aware nudges** | `/weather/forecast` for the user's district or town id (a static mapping table), plus `/weather/warning` | Malay enum strings; no coordinates; forecast not observation |
| **Accessibility (wheelchair)** | **Not available.** No `wheelchair_*` fields in bus feeds and no vehicle accessibility in RT. Rail `isOKU` is `true` everywhere (uninformative) | — |
| **Crowding / occupancy** | **Not available** in RT | — |
| **Fares** | **Not in Prasarana feeds.** Would have to be hard-coded | [U] the current feeder fare policy was not researched |

### Request budget for a no-backend phone app

- Realtime, one category (mrtfeeder) at 30 s = 2 req/min, within the documented 4/min.
- Adding rapid-bus-kl would make 4/min, exactly at the limit with no room for retries. Stagger requests, or poll each at 60 s; content changes only about every 60 s anyway.
- Static ZIP once a day (or on launch if older than 24 h) and weather once every 3–6 h each use the separate per-family buckets.
- On 429, back off and do not retry inside the same minute.

---

## 6. Key sources

**Official docs source:**
- [datagovmy-front/apps/docs/pages](https://github.com/data-gov-my/datagovmy-front/tree/main/apps/docs/pages): `realtime-api/gtfs-realtime.en.mdx`, `gtfs-static.en.mdx`, `weather.en.mdx`, `rate-limit.en.mdx`, `quickstart.en.mdx`, `changelog.en.mdx`
- Commits `158899c4`, `e2d2592b`, `3bf1407b`, `ccf12993`, `89524287`
- Rendered at https://developer.data.gov.my/realtime-api/gtfs-realtime

**Issues:**
- [#632](https://github.com/data-gov-my/datagovmy-front/issues/632): feeder route_id
- [#622](https://github.com/data-gov-my/datagovmy-front/issues/622): BAS.MY routeId
- [#634](https://github.com/data-gov-my/datagovmy-front/issues/634), [#637](https://github.com/data-gov-my/datagovmy-front/issues/637), [#638](https://github.com/data-gov-my/datagovmy-front/issues/638), [#646](https://github.com/data-gov-my/datagovmy-front/issues/646), [#659](https://github.com/data-gov-my/datagovmy-front/issues/659): outages and empty feeds
- [#650](https://github.com/data-gov-my/datagovmy-front/issues/650): stop coordinates
- [#668](https://github.com/data-gov-my/datagovmy-front/issues/668): T504/T505
- [#621](https://github.com/data-gov-my/datagovmy-front/issues/621): problematic trips
- [#631](https://github.com/data-gov-my/datagovmy-front/issues/631): KTMB stale
- [#679](https://github.com/data-gov-my/datagovmy-front/issues/679): Kota Bharu

**Catalogue metadata:** [datagovmy-meta/data-catalogue](https://github.com/data-gov-my/datagovmy-meta/tree/main/data-catalogue) (`ridership_headline.json`, `ridership_od_rapidrail_daily.json`, `air_pollution.json`, `usage_metrics_openapi.json`)

**Real payloads decoded:**
- [hongvin/bkhome fixture](https://github.com/hongvin/bkhome/tree/main/bob-transit/worker/fixtures)
- [tomatogoesrotten/kl_transit fixtures and proposal](https://github.com/tomatogoesrotten/kl_transit/tree/main/src/live/fixtures)
- [junmob/final-year-project evidence](https://github.com/junmob/final-year-project/tree/main/docs/evidence/realtime_probe)

**Third-party measurement notes:**
- [junmob data-source-summary.md](https://github.com/junmob/final-year-project/blob/main/docs/data-source/data-source-summary.md)
- [kaizen-hryy/zeroWait gtfs-data-analysis.md](https://github.com/kaizen-hryy/zeroWait/blob/main/docs/gtfs-data-analysis.md)
- [zeeva85/transit-pulse feed-sources.js](https://github.com/zeeva85/transit-pulse/blob/main/feed-sources.js)
- [mingng18/bus-watch feed-inspection.md](https://github.com/mingng18/bus-watch/blob/main/docs/feed-inspection.md) (probe, unfilled)

**Static snapshots:**
- [wjgoh/bus-tracker-nohost staticgtfs](https://github.com/wjgoh/bus-tracker-nohost/tree/main/src/staticgtfs)
- [tomatogoesrotten/kl_transit data/gtfs](https://github.com/tomatogoesrotten/kl_transit/tree/main/data/gtfs)

**Transitland registry:** [transitland-atlas data.gov.my.dmfr.json](https://github.com/transitland/transitland-atlas/blob/main/feeds/data.gov.my.dmfr.json)

**Scripts used here:** `scratchpad/feature-research/scripts/decode.py` (GTFS-RT wire decoder) and `scripts/analyze.py` (feeder static plus rail proximity).
