# BusBuddy — feature roadmap (what to build next)

Synthesis of two research reports (October 2026):

- [`research/data-capabilities.md`](./research/data-capabilities.md): what data.gov.my's GTFS and GTFS-Realtime feeds actually contain, checked against real feed captures.
- [`research/features-and-platform.md`](./research/features-and-platform.md): about 50 candidate features from leading transit apps and Rapid KL rider pain points, plus every iOS integration checked against Expo SDK 58.

Every feature below runs **on the phone, with no BusBuddy server**, using only the data.gov.my feeds.

## 1. What the data allows (the constraints that shape everything)

| Fact | Consequence |
| --- | --- |
| Only **vehicle positions** are live. Trip updates and service alerts are still "in the pipeline" and their URLs return 404. | Every ETA, delay or "bus is late" is our own estimate, and the UI says so. |
| Each feeder bus reports trip id, route (`T816`), lat/lon, bearing, speed (km/h) and timestamp. **No** stop status, occupancy or congestion. | No crowding features, and no "bus is at stop X" from the feed. We infer it from position. |
| The feed changes about **every 60 s**. The limit is **4 requests/min** per API, with no key. | One shared poller for the app, widgets, Siri and background work. Polling every 30 s is plenty. |
| **Silent outages:** HTTP 200 with zero buses for days or weeks (Mar, Jun, Aug–Sep 2026), and empty overnight. | We need a "live data unavailable" state, and last-bus features must use the timetable. |
| A permanent **ghost bus** (VAL4552, timestamped 2029, Dec 2024 trip). | Implausible fixes are dropped. Fixed in `dropImplausibleFixes`. |
| Feeder timetable: 91 routes, about 2,100 stops, about 6,300 trips. **Median headway 30 min**, last bus 23:30. Valid for about 5–6 weeks with holidays built in. **No fares, transfers, wheelchair or route colours.** | Missing a bus costs 30 min, so timing beats maps. Refresh the timetable at least weekly (the app refreshes daily). |
| 88 of 91 feeder routes stop within 250 m of an LRT/MRT station. `rapid-rail-kl` GTFS has 8 lines with official colours. | Rail connections can be computed by distance. |
| MET Malaysia **weather forecast and warnings** are on the same API, free with no key. | Rain-aware nudges. |

## 2. Recommended order

**Status:** Phases 1, 2, 4 and 5 are built (marked ✅ below). Phase 3 is still open, and the [follow-ups](#follow-ups-after-phase-5) after Phase 5 are the other candidates. Where the code lives (paths under `apps/mobile/` unless they say otherwise):

| Area | Code |
| --- | --- |
| Trip notes (feed health, ghost guard, miss cost, last bus, bunching, where-from, rain) | `apps/mobile/components/trip/model.ts` → `Notes.tsx` |
| Live Activity stale date, `bannerSmall` | `hooks/useBusLiveActivity.ts`, `activities/BusArrivalActivity.tsx` |
| Widgets | `widgets/` (synced from `hooks/useTripSideEffects.ts`) |
| Leave-now, last-bus, commute and get-off notifications | `services/reminders/`, settings `components/settings/RemindersSection.tsx` |
| Quick actions | `hooks/useQuickActions.ts` |
| On-board mode | `components/ride/`, `state/RideContext.tsx`, `app/ride.tsx` |
| Arrive-at-stop geofence | `services/arrival/geofence.ts` |
| Rain nudges | `services/weather/` |
| Rail connections | `packages/shared/src/utils/rail.ts`, `components/trip/Connections.tsx` |
| Rail layer, station and line sheets, rail map | `components/rail/` (the schematic map in `components/rail/diagram/`), `components/map/RailLayer.tsx` |
| Journey engine (RAPTOR, live re-timing) | `packages/shared/src/transit/` |
| Place search, walking paths, Look Around, map snapshots | `modules/transit-maps` (native) |
| "Where to?" search and results | `components/plan/`, `state/PlannerContext.tsx`, `services/planner/` |
| Itinerary detail and map legs | `components/itinerary/`, `components/map/ItineraryLayer.tsx` |
| Go mode | `components/ride/journey.ts`, `state/RideContext.tsx` |
| Saved places, Home/Work shortcuts, widget home line | `services/places/`, `services/quickActions.ts`, `widgets/nextBusTimeline.ts` |

Effort: S = a day or two, M = about a week, L = more. All items use only GTFS static and vehicle positions unless noted.

### Phase 1 — Trust ("is that bus real?")
| # | Feature | Effort | Notes |
| --- | --- | --- | --- |
| 1 | ✅ **Drop ghost and stale buses** (future timestamps, fixes over 10 min old) | S | Done in this change: `dropImplausibleFixes` is used by the app and the API. |
| 2 | ✅ **"Live as of 08:41"** on every live ETA. Pass `staleDate` to the Live Activity so iOS greys it out when data stops. | S | `expo-widgets` `start/update(props, staleDate)` already supports it. |
| 3 | ✅ **Feed-health state:** tell "no buses on your route right now" apart from "data.gov.my live data is down", which is the whole feed returning zero buses during service hours. | S | Avoids blaming the user's route during the known outages. |
| 4 | ✅ **Ghost-trip guard:** a scheduled departure with no live bus near the start of its loop shows "No live bus yet — may not run" (Transit's "likely cancelled"). | M | Uses timetable plus positions. Never styled as live. |
| 5 | ✅ **"Miss it = +30 min":** show the cost of missing this bus ("next one 08:42, +30 min"). | S | Already computable from `secondaryArrival`. |

### Phase 2 — Reach ("tell me without opening the app")
| # | Feature | Effort | Notes |
| --- | --- | --- | --- |
| 6 | ✅ **Home and Lock Screen widgets:** next departures for a favourite, a minutes gauge, an inline "T816 · 8:42". | M | `expo-widgets` `createWidget` + `updateTimeline` (installed). Widgets can't fetch data, so the app writes timeline entries from the timetable and shows how fresh they are. |
| 7 | ✅ **Last-bus guard:** from about 21:00, show "Last bus 23:30" in the sheet, with an optional reminder. | S | Timetable only, so it works when the feed is empty overnight. |
| 8 | ✅ **"Leave by" commute reminders:** local, time-sensitive notifications computed from the timetable and your walk time. No server. | M | `expo-notifications` scheduled triggers. Needs the time-sensitive entitlement in `app.json`. Re-planned with `expo-background-task`, not the deprecated `background-fetch`. |
| 9 | ✅ **Live Activity on Apple Watch, CarPlay and Mac:** add a compact `bannerSmall` layout. | S | `expo-widgets` already declares the small activity family. |
| 10 | ✅ **Walking directions to your stop:** hand off to Apple Maps (walking mode, Look Around). | S | `Linking.openURL('https://maps.apple.com/directions?...&mode=walking')`. |
| 11 | ✅ **Home Screen quick actions:** long-press the icon for "Track T816 at Hotel Lisa De Inn". | S | Community `expo-quick-actions`. |

### Phase 3 — System ("ask Siri")
| # | Feature | Effort | Notes |
| --- | --- | --- | --- |
| 12 | **"When's my bus?"** in Siri, Shortcuts, Spotlight and Siri Suggestions. | M | `expo-app-intents` 0.5.10 is official but **alpha**. Swift answers from a snapshot the app saves, because JS can't reply to Siri. |
| 13 | **"Leave now" alert in the Live Activity:** wakes the screen and expands the Dynamic Island. | S–M | Needs a small patch to `expo-widgets`; its `update()` lacks `alertConfiguration`. |
| 14 | **Scheduled Live Activity:** appears at your leave time with the app closed (iOS 26). | M | Native patch to `expo-widgets` (`Activity.request(..., start:)`). |
| 15 | **Bahasa Melayu**, then 中文 and தமிழ். Expand stop abbreviations (JLN, KG, SG, SEK, OPP), and speak stop names with a Malay voice in VoiceOver. | M | `expo-localization`, `accessibilityLanguage="ms-MY"`. "OPP" becomes "opposite side of the road". |

### Phase 4 — On the ride
| # | Feature | Effort | Notes |
| --- | --- | --- | --- |
| 16 | ✅ **On-board mode with a "get off" alert:** stops-to-go countdown, and haptic or spoken "next stop is yours". | M–L | Built without background location: your GPS while the app is open (else the bus's own position), plus a scheduled notification in case the screen is off. Speech is opt-in per ride. |
| 17 | ✅ **Arrive-at-stop geofence:** auto-start the countdown or Live Activity when you reach your stop. | M | `expo-location` geofencing. Needs Always permission, so offer it, never default to it. |
| 18 | ✅ **"Where's my bus coming from":** feeders are loops, so it's usually the bus finishing its previous lap. Show its lap progress (Flighty-style "inbound"). | M | Positions plus shape. |
| 19 | ✅ **Rain and flood nudges:** "Rain warning for Petaling — leave 5 min early." | M | MET `/weather/warning` (Malay text, district-level). Separate rate-limit bucket. |
| 20 | ✅ **Gaps and bunching:** "Next two buses 2 min apart, then a 40 min gap". Plus personal reliability history from your own polling. | M | Bunching note built. Personal reliability history is not built yet. |
| 21 | ✅ **Rail connections:** "MRT Phileo Damansara 120 m from this stop" with line colours. | M | Distance join with `rapid-rail-kl` GTFS. |

### Phase 5 — Getting there ("Where to?")
Built in plan phases 12–15; the spec is [`transit-and-planner.md`](./transit-and-planner.md). Place search and walking paths use Apple MapKit on the phone, with no keys.

| # | Feature | Effort | Notes |
| --- | --- | --- | --- |
| 22 | ✅ **Train tracker:** rail lines on the map in their official colours, under the bus route, with station squares. A Layers menu toggles My buses, Rail lines and Satellite. | M | `rapid-rail-kl` and KTM Komuter, compiled on the phone into one network per service day. Rail has no live positions. |
| 23 | ✅ **Station and line sheets:** a departure board per line and direction ("every 3 min"), nearby buses and walking interchanges; a whole-line strip map with estimated trains. | M | Trains on the strip map are dashed and captioned as timetable spacing. Deep links: `t816://station?station=…`, `t816://line?line=…&dir=…`. |
| 24 | ✅ **Schematic rail map:** a hand-drawn octilinear KL map (8 lines plus KTM Komuter), pinch and pan; tap a station to open it. VoiceOver gets a list instead. | L | Layers → Rail map. Adds `react-native-svg` (native). |
| 25 | ✅ **Multi-leg journey planning:** "Where to?" in the peek, up to five door-to-door options across walking, buses, rail and KTM, then an itinerary with a timeline and its legs drawn on the map. | L | Range RAPTOR on the phone, at most 4 rides. Bus legs re-time from live positions ("Updated · was 9:12"); rail always says "every N min" or "about". |
| 26 | ✅ **Saved places:** Home, Work and up to 6 pins, edited in Settings → Places; Home and Work as circles beside Where to? and as quick actions; the medium widget shows "Home by 18:14 · leave in 6:00". | M | The widget can't plan, so its home line is the app's last plan, written as timeline entries. It is never live and disappears at its leave time. |
| 27 | ✅ **Go mode:** follow a journey leg by leg in the trip sheet and the Live Activity ("Leg 2 of 4"), with leave, change and get-off alerts and an "Off route? Re-plan from here" button. | M–L | Extends on-board mode. Rail progress runs on the timetable and says "about". Re-planning is never automatic. |

### Follow-ups after Phase 5
| Follow-up | Why it waits |
| --- | --- |
| **Arrive by** | Needs a reverse RAPTOR. The When menu shows it as "Soon". |
| **Fares** | Not in any feed, so it needs a hand-kept fare table. |
| **Holiday calendar for rail and `rapid-bus-kl`** | Their feeds have no `calendar_dates`, so holidays aren't modelled; only the feeder feed has them. |
| **KTM live** | Only if KTMB's realtime feed proves useful for Komuter. |
| **Decode KTMB realtime in daytime** | Sources disagree on whether it carries ETS only or Komuter too, and the 12/00 decode ran overnight (one ETS train). Re-decode between 07:00 and 22:00 on a weekday and decide. |
| **Background re-planning of the widget's home line** | Running `plan()` in the background task means a 3 MB network decode inside its time budget. |
| **A separate "Go home" widget** | A new widget kind is a native change (`app.json` → `expo-widgets`). |
| **Restore Go after the app is killed** | Today a killed app ends the journey; the next launch only clears its leftover Live Activity. |

## 3. Deliberately not doing (now)
- **Crowding or seat availability:** not in the feed.
- **Fares, transfers, wheelchair info:** not in the feeder feed. The app's existing `fare_*` and `transfers` tables stay empty.
- **Crowdsourced reports, live "follow my bus" links, push-driven updates:** these need a server and a user base.
- **A native Apple Watch app or a CarPlay app:** the Live Activity on Watch and CarPlay covers most of it, and no CarPlay category fits transit.
- **An Apple Intelligence chatbot:** Malay isn't supported, and timetable answers should be exact.
- **Prasarana's unofficial Socket.IO tracking stream:** outside the open-data licence.
- **Anti-features:** gamification, news or promo feeds, notifications on by default, colour-only status, scheduled times styled as live.
