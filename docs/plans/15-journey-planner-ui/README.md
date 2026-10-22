# Phase 15 — Journey Planner UI ("Where to?")

The user taps **Where to?** in the peek, types a place, sees ranked multimodal options (leg chips, proportional journey bars, live/scheduled status), opens one to see a timeline + legs drawn on the map, and taps **Go** to follow it with the Live Activity and get-off/change alerts.

Spec: [`docs/design/transit-and-planner.md`](../../design/transit-and-planner.md) §2, §5, §6.1–6.3, §7, §8.

## Dependencies

- Phase 12 (`useTransitNetwork`), phase 14 (`plan`, `retime`), phase 13 (`station`, `RailLayer` focus).
- Existing: `trip` sheet + `PeekCard`, `RideContext` + `app/ride.tsx`, `activities/BusArrivalActivity.tsx`, `services/reminders/*`, `services/arrival/geofence.ts`, `services/realtimePlan.ts`, `useSettings` (walk speed), `expo-quick-actions`.
- **15/01 is native** (local Expo module `modules/transit-maps`, Swift) → `npx expo prebuild` + Xcode build. All other tasks are JS-only unless noted; each task file states which.

## Scope decisions (locked)

- **Entry:** a glass "Where to?" capsule at the top of the persistent trip peek (+52 pt), plus Home/Work circles once set. No tab bar.
- **Search:** local stations/stops first (offline), then Apple `MKLocalSearchCompleter` places. No Google/HERE keys.
- **Time:** Leave now + Depart at. Arrive-by shows disabled "Soon".
- **Results:** ≤ 5 itineraries; one live status line per itinerary; rail legs always "every N min".
- **Detail:** `itinerary` formSheet (peek / 0.5 / 1) + map legs with draw-on. Walk paths from `MKDirections` only for the open itinerary.
- **Go mode** extends ride mode and the existing Live Activity to multi-leg; re-plan is user-initiated only.
- **Images:** Look Around → Street View (`StopPhoto`, if key) → `MKMapSnapshotter`, cached 30 days.
- **Motion:** spec §7 table; Reduce Motion = crossfades only; no new animation libraries.

## Success criteria

1. From cold launch with a built network: tap Where to? → type "KLCC" → first results visible in < 1.5 s on iPhone 13.
2. Results show leg chips, journey bar, Live/Scheduled status, changes + walk; tags Fastest / Fewer changes / Less walking where they differ.
3. Opening an itinerary draws legs on the map in order (650 ms), camera fits, timeline matches legs; tapping a leg fits the map to it.
4. A live bus approaching the first stop flips that itinerary to Live and rolls its times; a broken transfer shows "Updated · was HH:MM".
5. Go mode: Live Activity shows the current leg; get-off/change notifications fire for each ride leg; rail progress labelled "about".
6. Airplane mode: station/stop search and planning still work (places search shows "Places need a connection").
7. VoiceOver reads a result as "Leave in 4 minutes, live. 56 minutes. Walk 5 minutes, bus T816, Kajang Line, Kelana Jaya Line, walk 3 minutes. Arrive 9:30. Fastest." It says "live" or "scheduled", never relying on colour.
8. Rail feed expired → note at top of results (from `PlanResult.excludedFeeds`, shown even with zero results); only bus/KTM options.

## Skills to invoke

- `expo:expo-ui`, `expo:expo-router`, `expo:expo-module` (15/01), `write-swift` (15/01), `animate-expo` (15/05, 15/08), `emil-design-eng`, `apple-design`, `break-ui` (15/08).

## Task order

1. [01-transit-maps-native-module.md](./01-transit-maps-native-module.md) — **native**: MapKit completer, local search, walking directions, Look Around + map snapshots.
2. [02-where-to-entry.md](./02-where-to-entry.md) — peek capsule, saved-place circles, `plan` route registration, quick action.
3. [03-plan-search-sheet.md](./03-plan-search-sheet.md) — searchable field, From/When, recents/saved, merged suggestions.
4. [04-results-list.md](./04-results-list.md) — `usePlanner` hook, result rows (chips, journey bar, status), loader, live re-timing.
5. [05-itinerary-detail.md](./05-itinerary-detail.md) — `itinerary` sheet timeline, map legs + draw-on, leg focus.
6. [06-go-mode.md](./06-go-mode.md) — multi-leg ride, Live Activity, change/get-off alerts, off-route prompt.
7. [07-saved-places-and-shortcuts.md](./07-saved-places-and-shortcuts.md) — Home/Work + pins, map snapshots, widget "Home in 32 min".
8. [08-motion-polish-and-qa.md](./08-motion-polish-and-qa.md) — motion pass, Reduce Motion, VoiceOver, break-ui worst cases, device QA checklist.

## Hand-off (post phase)

- `docs/design/README.md` updated: IA section mentions Where to?, station/line/itinerary sheets; roadmap marks multi-leg planning built.
- Follow-ups recorded: arrive-by (reverse RAPTOR), fares table, holiday calendar for rail/bus-kl, KTM live (if RT proves useful), schematic diagram.
