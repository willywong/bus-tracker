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

Effort: S = a day or two, M = about a week, L = more. All items use only GTFS static and vehicle positions unless noted.

### Phase 1 — Trust ("is that bus real?")
| # | Feature | Effort | Notes |
| --- | --- | --- | --- |
| 1 | ✅ **Drop ghost and stale buses** (future timestamps, fixes over 10 min old) | S | Done in this change: `dropImplausibleFixes` is used by the app and the API. |
| 2 | **"Live as of 08:41"** on every live ETA. Pass `staleDate` to the Live Activity so iOS greys it out when data stops. | S | `expo-widgets` `start/update(props, staleDate)` already supports it. |
| 3 | **Feed-health state:** tell "no buses on your route right now" apart from "data.gov.my live data is down", which is the whole feed returning zero buses during service hours. | S | Avoids blaming the user's route during the known outages. |
| 4 | **Ghost-trip guard:** a scheduled departure with no live bus near the start of its loop shows "No live bus yet — may not run" (Transit's "likely cancelled"). | M | Uses timetable plus positions. Never styled as live. |
| 5 | **"Miss it = +30 min":** show the cost of missing this bus ("next one 08:42, +30 min"). | S | Already computable from `secondaryArrival`. |

### Phase 2 — Reach ("tell me without opening the app")
| # | Feature | Effort | Notes |
| --- | --- | --- | --- |
| 6 | **Home and Lock Screen widgets:** next departures for a favourite, a minutes gauge, an inline "T816 · 8:42". | M | `expo-widgets` `createWidget` + `updateTimeline` (installed). Widgets can't fetch data, so the app writes timeline entries from the timetable and shows how fresh they are. |
| 7 | **Last-bus guard:** from about 21:00, show "Last bus 23:30" in the sheet, with an optional reminder. | S | Timetable only, so it works when the feed is empty overnight. |
| 8 | **"Leave by" commute reminders:** local, time-sensitive notifications computed from the timetable and your walk time. No server. | M | `expo-notifications` scheduled triggers. Needs the time-sensitive entitlement in `app.json`. Re-planned with `expo-background-task`, not the deprecated `background-fetch`. |
| 9 | **Live Activity on Apple Watch, CarPlay and Mac:** add a compact `bannerSmall` layout. | S | `expo-widgets` already declares the small activity family. |
| 10 | **Walking directions to your stop:** hand off to Apple Maps (walking mode, Look Around). | S | `Linking.openURL('https://maps.apple.com/directions?...&mode=walking')`. |
| 11 | **Home Screen quick actions:** long-press the icon for "Track T816 at Hotel Lisa De Inn". | S | Community `expo-quick-actions`. |

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
| 16 | **On-board mode with a "get off" alert:** stops-to-go countdown, and haptic or spoken "next stop is yours". | M–L | Background location (needs App Review justification) plus `expo-speech`. |
| 17 | **Arrive-at-stop geofence:** auto-start the countdown or Live Activity when you reach your stop. | M | `expo-location` geofencing. Needs Always permission, so offer it, never default to it. |
| 18 | **"Where's my bus coming from":** feeders are loops, so it's usually the bus finishing its previous lap. Show its lap progress (Flighty-style "inbound"). | M | Positions plus shape. |
| 19 | **Rain and flood nudges:** "Rain warning for Petaling — leave 5 min early." | M | MET `/weather/warning` (Malay text, district-level). Separate rate-limit bucket. |
| 20 | **Gaps and bunching:** "Next two buses 2 min apart, then a 40 min gap". Plus personal reliability history from your own polling. | M | Needs two or more buses on the route. History is local only. |
| 21 | **Rail connections:** "MRT Phileo Damansara 120 m from this stop" with line colours. | M | Distance join with `rapid-rail-kl` GTFS. |

## 3. Deliberately not doing (now)
- **Crowding or seat availability:** not in the feed.
- **Fares, transfers, wheelchair info:** not in the feeder feed. The app's existing `fare_*` and `transfers` tables stay empty.
- **Crowdsourced reports, live "follow my bus" links, push-driven updates:** these need a server and a user base.
- **A native Apple Watch app or a CarPlay app:** the Live Activity on Watch and CarPlay covers most of it, and no CarPlay category fits transit.
- **An Apple Intelligence chatbot:** Malay isn't supported, and timetable answers should be exact.
- **Prasarana's unofficial Socket.IO tracking stream:** outside the open-data licence.
- **Anti-features:** gamification, news or promo feeds, notifications on by default, colour-only status, scheduled times styled as live.
