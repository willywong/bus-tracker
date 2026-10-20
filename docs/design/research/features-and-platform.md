# BusBuddy: what to build next (features, platform integrations, accessibility, delight)

Research date: 2026-10-20. Scope: Rapid KL MRT-feeder buses, Expo SDK 58 / RN 0.88 / iOS 26–27, GTFS static + GTFS-Realtime **vehicle positions only**, no backend.

Legend for each feature:
- **Data**: ✅ GTFS static + vehicle positions (VP) are enough · ◐ enough with caveats · ❌ needs data/infra we don't have
- **Expo**: the concrete module/API, and whether it is an **official** Expo module, a **config plugin**, a **community** library, or needs a **custom native** (Swift) module
- **Effort**: S ≈ ≤2 days · M ≈ 3–7 days · L ≈ 2+ weeks
- **[V]** = verified against installed `.d.ts` / native source or a downloaded npm tarball; **[D]** = Apple developer docs fetched; **[W]** = web search summary only (sandbox blocked the page itself)

---

## 0. TL;DR: the strongest ideas

The constraint that matters most comes straight from the data. In the 2026-10-19 feeder GTFS, the median headway is **30 min**, **71 % of route-directions run every 30 min or worse**, and **every route's last departure is 23:30** (my analysis of the feed, §2.2). Missing a feeder bus costs half an hour. People don't need more maps. They need **trust** ("is that bus real?"), **timing** ("when do I leave?"), and **reach** ("tell me without opening the app").

**Build first (high value, low risk, all on-device):**
1. **Ghost-bus guard and "live as of"** (A1, A2). Mark scheduled trips with no matching vehicle as *"No live bus yet. May not run."* (Transit's "Likely cancelled"). Drop zombie vehicles: the feed has shown a bus with a **2029 timestamp** and a 2024 trip ID.
2. **Last-bus guard and "miss it = +N min"** (B1, B4). From about 21:00, show "Last bus 23:30". Schedule a local notification (`expo-notifications` DATE trigger). Live data often goes dark overnight, so this must be schedule-based and labelled honestly.
3. **Commute reminders without a server** (B2). Recurring local "leave by" notifications computed from the timetable, with `interruptionLevel: 'timeSensitive'` [V].
4. **Home and Lock Screen widgets** (C1–C3) with `expo-widgets` `createWidget` + `updateTimeline` [V]. Timeline entries run off the schedule and use `Text` timers. A dynamic-enum configuration lets the user pick which favourite to show. Interactive "next / previous departure" buttons work with no network.
5. **Live Activity everywhere for free** (C4). Add a `bannerSmall` layout. `expo-widgets` already declares `.supplementalActivityFamilies([.small, .medium])` [V], so the activity shows up properly on **Apple Watch Smart Stack, CarPlay Dashboard and the macOS menu bar** [D]. Also pass `staleDate`, which the app doesn't do today.
6. **"When's my bus?" in Siri / Shortcuts / Spotlight** (D1–D4) via **`expo-app-intents` 0.5.10**. This is official but alpha and ships with SDK 58 [V]. Swift `perform()` must answer from a cached App Group snapshot, because there is **no JS→Siri response channel** [V].
7. **Bahasa Melayu first and Malay pronunciation** (G1, H1). Set `accessibilityLanguage="ms-MY"` on stop names [V] and expand abbreviations: `JLN`, `KG`, `SG`, `SEK`, `SMK`, `OPP` are among the top tokens in stop names [V].
8. **Rain-aware nudges** (J2) from MET Malaysia warnings on the **same data.gov.my Open API** (`/weather/warning`, `/weather/forecast`, `/flood-warning`), on a separate rate-limit bucket [V].

**Build next (bigger, still on-device):** "Get off" alerts and on-board mode with VoiceOver/speech stop announcements (E1, E3). Arrive-at-stop geofence (F1). Scheduled Live Activities (iOS 26 `Activity.request(…, start:)` [D], which needs a small native patch to expo-widgets). Control Center / Action-button "Track my bus" control (C6). "Where's my bus coming from" in the Flighty style (J1).

**Don't build (yet):** crowdsourcing (Transit GO), crowding, live share links, push-to-start or widget push (all need a server). A native Watch app (the Live Activity on Watch covers about 80 %). A CarPlay app (no eligible category). An Apple Intelligence chatbot: **Malay is not an Apple Intelligence language** in iOS 27 [W], and the questions are better answered deterministically.

---

## 1. Method and reliability notes

- **Installed code verified:** `expo-widgets` 58.0.21 (`build/*.d.ts`, `ios/*.swift`, `plugin/build/types`), `expo-notifications` 58.1.5, `expo-location` 58.0.18, `expo-task-manager` 58.0.12, `expo-background-fetch` 58.0.11 (**deprecated** in favour of `expo-background-task`), `@expo/ui` 58.0.21 component list, RN 0.88 `AccessibilityInfo` / `ViewAccessibility`.
- **Downloaded and inspected from npm:** `expo-app-intents@0.5.10` (README, `build/index.d.ts`, bundled skill, templates) and `expo-background-task@58.0.11`. Version and peer checks on `@react-native-ai/apple`, `expo-local-llm`, `react-native-apple-llm`, `@fourlyn/apple-foundation-models`, `react-native-carplay`, `expo-quick-actions`, `react-native-watch-connectivity`, `@bacons/apple-targets`, `expo-speech`, `expo-localization`, `expo-store-review`.
- **Cloned:** `EvanBacon/expo-apple-targets` (target types, Control widget docs), `EvanBacon/expo-quick-actions`, `birkir/react-native-carplay`. I also used Malaysian community repos already in `repos/`: `junmob_final-year-project` (a data-source profiling of the data.gov.my feeds, **including a real 2026-10-19 feeder GTFS zip and realtime probes**), `kaizen-hryy_zeroWait`, `AlifCsEdu_rapidkl-tracker`.
- **Expo skills read:** `expo-overview`, `expo-app-clip`, `expo-native-ui`, `expo-module` (and `expo-app-intents`' own bundled skill).
- **Blocked in this sandbox:** reddit.com, lowyat.net, apps.apple.com, expo.dev/docs.expo.dev, 9to5mac, sixcolors, transitapp.com, citymapper.com, myrapid.com.my, data.gov.my. Rider sentiment therefore comes from search-engine summaries of Play/App Store reviews, Tripadvisor, Threads, MyRapid notices and Malaysian news [W]. **I found no Reddit threads.** Treat the pain-point section as directional.
- **Existing BusBuddy research was not duplicated.** See `docs/design/research/{award-winning-ios-apps,expo-native-capabilities,ios26-design-research}.md`. This report is about **what to add**.

---

## 2. Data reality check (what VP-only can and can't support)

### 2.1 Feed facts that shape features

| Fact | Evidence | Feature implication |
|---|---|---|
| Only **vehicle positions**. Trip updates and service alerts are "in our pipeline for 2026" | data.gov.my GTFS-R docs (copy in `junmob…/raw-data-source/08b`) [V] | Every ETA is BusBuddy's own estimate. Build the alerts parser defensively so it lights up when alerts ship. |
| Rate limit **4 requests/min per API category** (GTFS Realtime, GTFS Static, Weather and others are separate buckets) | `04_Rate_Limit.md` [V] | App, widget refresh, background task and Siri must **share one poller** and back off on 429. Weather has its own bucket. |
| Feeder RT `routeId` holds the **route_long_name** (`T117`), not `route_id`. `trip.startTime`/`startDate` are missing | FYP profiling §4.5–4.6 [V] | Map RT → static via the long name. Infer the service day from the timestamp, with care around midnight. |
| Only **86–90 %** of RT `tripId`s match static trips | FYP probes 10/5 and 10/11 [V] | Matching must tolerate misses. Fall back to "nearest vehicle on route shape". |
| A **zombie vehicle** (`VAL4552`): timestamp in **2029**, trip ID from a 2024 service. The overnight feed was otherwise empty (02:11 MYT) | probe CSV + console log [V] | Validate timestamps (future or >N min old → drop). Treat an empty feed at night as normal. |
| Feed is **often empty about 23:00–06:00** | Apify tracker note, FYP probe [W][V] | Last buses at 23:30 may have **no live data**, so last-bus UX must be schedule-first. |
| Public feed only carries buses **tied to scheduled trip blocks**; the operator kiosk shows more buses | community tracker notes [W] | "No live bus" ≠ "no bus". Word it as *may* not run. |
| Occasional GPS outside the service area (validator E028) | data.gov.my docs [V] | Snap to the route shape; reject jumps. |
| Feeder `speed` values are integers (likely km/h, not m/s) | FYP §4.5 [V] | Don't trust `speed` for ETA without a sanity check. |
| Static feed valid about **6 weeks**, rolling start dates; holidays run the **weekend service** via `calendar_dates` | FYP §3.4.2 [V] | Track expiry and refresh. Show a "holiday timetable" chip. |
| No `wheelchair_boarding`, no `block_id`, no `stop_desc` in feeder GTFS. Stop names are UPPERCASE Malay with abbreviations; **106 duplicate stop names**; `stop_code` like `PJ785` | my parse of `rapid-bus-mrtfeeder_20261019.zip` [V] | Accessibility claims can't come from the data. Disambiguate stops by code and side of road. Make names pronounceable. |
| Feeder routes are almost all **single-direction loops** (6151 of 6291 trips are `direction_id=0`) and start at an MRT station | same [V] | "Where's my bus coming from" works well: the next trip's bus is usually finishing the previous loop. |
| Jan 2026: **16 MRT feeder routes moved to Rapid KL On-Demand** | Malay Mail 2026-01-11 [W] | Favourites can vanish from a new feed, so detect it and explain. |

### 2.2 Timetable shape (feeder GTFS, weekday service 26100201) [V]

- 91 routes, 6,291 trips, 2,117 stops.
- Median headway per route-direction: deciles 15 / 20 / 29.5 / 30 / 30 / 30 / 30 / 35 / 40 min. **Median 30 min. 71 % ≥ 30 min.**
- First departure 05:49–06:00. **Last departure 23:30 for every route.**
- 30–43 trips per route per weekday.

(Script: `scratchpad/feature-research/scripts/analyse.py`.)

### 2.3 What VP-only lets us derive

✅ Vehicle-to-stop distance along the shape and a speed-model ETA. ✅ Headway and bunching between vehicles on a route. ✅ Missing vehicles versus the schedule (ghost risk). ✅ Personal on-device delay history (only while the app polls). ✅ Last bus and next-after-this. ❌ Crowding/occupancy. ❌ Cancellations announced by the operator. ❌ Detours. ❌ Accessibility of vehicles.

---

## 3. Reference apps: feature inventory and what users say

| App | Features relevant to us | Praise | Complaints | Take for BusBuddy |
|---|---|---|---|---|
| **Transit** | Nearby departures on open; **GO** trip mode with Live Activity and Dynamic Island that "wakes the phone only when you must act" and self-dismisses; **"Likely cancelled"** strike-through when a trip has no realtime data; GO crowdsourcing (1–2 s vehicle latency vs ~15 s transponders); **Royale** subscription with per-line leaderboards and emoji avatars, often agency-sponsored; VoiceOver sentences that condense route/stop/duration; step-free toggle; WCAG 2.1 AA | Speed to answer; GO alerts | Crowdsourced data varies by city; premium paywall | **"Likely cancelled"** logic (A1); "wake only when needed" alert policy (C5); VoiceOver sentences (G2). Skip crowdsourcing (needs server and users). |
| **Citymapper** | GO step-by-step with Lock Screen nav (iOS 16.1+); **Get-off alerts that work offline / underground**; next departure while waiting; delay/cancel notices; "Walk less" routing for rain and dark; AI best-route weighs weather | Polish, reliable get-off alerts | Rain warnings paywalled (G2 review) | Offline get-off alert (E1). Rain nudges (J2). |
| **Moovit** | Live arrivals; Live Directions with **Get-Off alerts with distinct vibration**; full VoiceOver/TalkBack (built with a blind developer); wheelchair routes; crowding labels where agencies supply them; WeWalk partnership | Accessibility leadership | Ads; data quality varies | Distinct haptic pattern for alight (E3/G5). Accessibility as a feature, not a checkbox. |
| **Google Maps** | Rapid KL live positions since 2020 (green = on time, red = late, black = schedule); crowdedness predictions in 100 countries; Live Activities for transit announced 2023 (launch unconfirmed) | Ubiquity | Lowyat 2020 thread is sceptical. Kiosk/LED displays "not accurate, not maintained" | Colour is not enough: keep the weight + glyph + word encoding already in the BusBuddy design. |
| **Apple Maps** | Transit directions in Malaysia since 2025 (live data unconfirmed); pin favourite lines; approaching-stop alert; iOS 27 adds a Parked Car widget and better Offline Maps; **unified Maps URLs (iOS 18.4+)** incl. `/directions?mode=walking` and `/look-around` [D] | System integration | KL realtime unclear | Handoff for walking directions (J9). Look Around stop preview (J8). |
| **OneBusAway (OBAKit)** | Open-source Swift; GTFS-RT; bookmarks and recent stops; Siri learns favourite stops (suggestions); Android "Report problem with trip"; VoiceOver-usable lists (map less so) | Accessible lists | 2.76★ on iOS | Siri suggestions via donations (D4). Make **lists, not the map, the accessible path** (G2). |
| **bustimes.org (UK)** | Live map across operators; **livery-coloured stripes** to tell buses apart; vehicle history; on-time check | "Best place for timetables and running info" | Ads; buses missing or mis-assigned; dead zones | Show vehicle plate or ID and "same bus as yesterday" history (J1). Be honest about missing buses. |
| **MyRapid PULSE** (official) | Journey planner, live bus tracker, rail map, "Explore City", rewards. **No longer a purchase channel for My50 since Jan 2026** (moved to TNG eWallet) | Some praise GPS accuracy (~10 s updates, Threads) | "7 of 10 times not accurate", crashes on tracker, "Unable to load this section"; **tracker repeatedly under maintenance (incl. July 2026)**, users sent to the MyRapid bus kiosk page | Users need a fallback that degrades gracefully, so BusBuddy's honesty is the product. |
| **Grab** | Trip Planner with transit in Indonesia (Jabodetabek); bike/car first-mile to stations; Grab Intercity bus tickets in MY. **No Malaysian transit directions found** | n/a | n/a | Optional "Grab instead?" deep link when the last bus is gone (B1), with no data dependency. |
| **Malaysian community** | `weareblahs/bus` (web, data.gov.my direct), `rapidkl-tracker` (PWA, BM/EN i18n, offline), **zeroWait** ("leave at 7:39" commute optimiser incl. multi-leg MRT + bus), BasBuddy, MyTransit Hub, XploreMY (Flutter), `junmob` reliability FYP (bunching, excess wait) | | Feed sparse versus kiosk; trip ID mismatches | zeroWait validates the "leave by" framing. Multi-leg (bus + MRT) is a natural later step since `rapid-rail-kl` GTFS exists. |
| **SG regional peers** (SG BusLeh, 100Bus, Arriving) | Tap a timing to see the bus on a map; seat availability (LTA data); **Live Activity + widget + buzz on arrival**; 100Bus 4.9★ | Minimal, fast | Some lack widgets | Confirms the minimal "one stop, one countdown" product in the region. |

### 3.1 Rapid KL rider pain points → features

| Pain point (evidence) | Feature(s) |
|---|---|
| Arrival times wrong, "bus later than the app shows", trackers crash or go down [W: Play reviews, MyRapid maintenance notices] | A1 ghost guard, A2 freshness, A5 feed-health state, A4 personal reliability |
| Long waits: 45 min, "no buses 7:30–9 pm", gave up and took Grab [W: Tripadvisor] | B4 "miss it = +N min", A3 gap warning, B1 Grab fallback |
| Long scheduled headways (30–70 min) [V/W] | B2 leave-by reminders, C1 widgets, B3 scheduled Live Activity |
| Buses leaving in heavy rain, waiting under bridges; flash floods closing stops or routes [W] | J2 rain/flood nudges, A5 "stop unserviceable" when alerts arrive |
| Route cuts to on-demand (Jan 2026) [W] | A6 timetable-change detection with an on-demand pointer |
| Last bus anxiety (23:30 everywhere; overnight feed empty) [V] | B1 last-bus guard |
| Feeder buses take only a physical TNG card or My50; open payment ~15 months after award [W] | J10 My50 renewal reminder (tiny); no payments work |

---

## 4. iOS platform integrations × Expo SDK 58 support

| Capability | What it gives a bus app | iOS | Expo SDK 58 status | Concrete API | Effort |
|---|---|---|---|---|---|
| **Home Screen widgets** | Next departures at a glance; StandBy; CarPlay widget stack (iOS 26) | 14+ (config 17+) | **Official** `expo-widgets` (installed) [V] | `createWidget(name, layout, initialProps)`; `widget.updateTimeline([{date, props}])`, `updateSnapshot`, `reload`, `getTimeline`; config plugin `widgets: [{name, displayName, description, supportedFamilies, configuration:{parameters:{route:{type:'enum', dynamic:true,…}}}}]`; `setConfigurationParameterEnum()`; env `widgetFamily`, `widgetRenderingMode` (`accented` for tinted/clear glass), `levelOfDetail` (26+), `isLuminanceReduced` | M |
| Widget refresh model | — | — | Timeline provider uses `policy: .atEnd` on entries the **app** wrote to the App Group [V]. The widget JS runs in a sandboxed JSContext for layout only, **no `fetch`** [V] | Refresh when the app runs, from `expo-background-task` (≥15 min, iOS decides) [V], or from interactive buttons | — |
| **Lock Screen widgets** | Circular minutes gauge, inline "T816 · 8:42" | 16+ | Official `expo-widgets` | families `accessoryCircular/Rectangular/Inline`; `Gauge`, `AccessoryWidgetBackground` in `@expo/ui` [V] | S |
| **Interactive widgets** | Flip to next/previous departure, switch favourite, without opening the app | 17+ | Official `expo-widgets` [V] | `Button target="…"` → `WidgetUserInteraction` AppIntent evaluates the layout's press handler in-extension, merges returned props into the entry, reloads; `addUserInteractionListener` in app [V] | S |
| **Widget push updates** | Server-pushed widget reload | 26 | Not exposed; needs server anyway | `WidgetPushHandler`, `apns-push-type: widgets` [D] | ❌ |
| **Live Activities** (local) | Countdown, leave-by, approach; Dynamic Island | 16.1+ | Official `expo-widgets` [V] | `createLiveActivity`; `start(props, url?, staleDate?)`, `update(props, staleDate?)`, `end(policy, props?, contentDate?)`, `getInstances()`; env `isStale`, `activityFamily`, `levelOfDetail` [V] | (exists) |
| LA on **Watch / CarPlay / Mac menu bar** | Glance on wrist, car dashboard, Mac | iOS 18 (Watch), 26 (CarPlay, Mac) | **Free**: expo-widgets already adds `.supplementalActivityFamilies([.small,.medium])` and renders `bannerSmall` for the small family [V] | Add `bannerSmall` to the layout; Mac needs nothing [D] | S |
| LA **alerting update** ("Leave now" lights the screen and expands the Island) | Key moment | 16.1+ | **Not exposed**: `update()` has no `alertConfiguration` [V] | `Activity.update(_:alertConfiguration:)` [D]. Small patch (patch-package) or local Expo module | S–M |
| **Scheduled Live Activity** | LA appears at leave time with the app closed | **26** | **Not exposed** [V] | `Activity.request(attributes:content:pushType:style:alertConfiguration:start:)` "Requests and schedules a Live Activity for a specific date" [D]. Patch `LiveActivityFactory.start` | M |
| Start LA from background via intent | Shortcut automation or Control starts tracking | 17+ | Needs Swift `LiveActivityIntent` in the app target (expo-app-intents inline module); expo-widgets' `LiveActivityAttributes` is **internal**, so you'd patch expo-widgets or re-declare a matching type (prototype first) [V][D] | `LiveActivityIntent.perform()` → `Activity.request` [D] | L |
| Push-to-start / push updates / broadcast | Server-driven LA | 17.2 / 18 | `addPushToStartTokenListener`, `getPushToken` exist [V], but **need a server** | — | ❌ |
| **App Intents: Siri, Shortcuts, Spotlight, Apple Intelligence** | "When's my bus?", "Track my bus", Spotlight search for routes and stops, Siri Suggestions, Lock Screen suggestions | 16.4+ (some 18/27) | **Official, alpha**: `expo-app-intents` 0.5.10 (SDK 58). Swift intents live in an `app-intents/` dir via **inline modules** (`experiments.inlineModules.watchedDirectories`) [V] | Swift: `AppIntent`, `AppShortcutsProvider` (≤10 shortcuts, phrase must include `\(.applicationName)`), `AppIntentDispatcher.shared.dispatch(name:params:)`. JS: `useAppIntents`, `removePendingInvocationAsync`, `setEntityCatalogAsync`, `reindexEntitiesAsync`, `donateIntentAsync`, `deleteDonationsAsync`, `appEntityIdentifier()` (18.4+, Xcode 27). **No response channel to `perform()`**; use `openAppWhenRun` or answer natively [V] | M |
| **Visual Intelligence** | Point the camera at a stop pole (`PJ785`) or bus number → open that stop/route | 26 | Possible via expo-app-intents (template `mail-visual-intelligence`), but you write `IntentValueQuery` in Swift [V][W] | `IntentValueQuery.values(for: SemanticContentDescriptor)` [W] | L |
| **Control Center / Lock Screen / Action button controls** | One-tap "Track my bus" or "Next T816" | 18+ (Watch & Mac 26) | **No Expo module**. `@bacons/apple-targets` 5.0.0 documents `ControlWidget` in a widget target with intents in `_shared/` [V]; `ExtensionStorage.reloadControls()` [V] | `ControlWidgetButton(action: OpenTrackIntent())` | M |
| **Home Screen quick actions** | Long-press icon → "Track T816 at Stop X" | 9+ | **Community** `expo-quick-actions` 6.0.2 (Evan Bacon, peer `expo *`) [V npm] | `QuickActions.setItems([...])`, `useQuickActionRouting` | S |
| **Local notifications** | Leave-by, last bus, arrived, rain | all | **Official** `expo-notifications` (installed) [V] | `scheduleNotificationAsync({content:{interruptionLevel:'timeSensitive', threadIdentifier, categoryIdentifier}, trigger:{type:'date'|'daily'|'weekly'|'calendar'|'timeInterval'}})`; categories with actions (`setNotificationCategoryAsync`, `allowInCarPlay`, `allowAnnouncement`). **No schedulable location trigger** (only `CALENDAR, DAILY, WEEKLY, MONTHLY, YEARLY, DATE, TIME_INTERVAL`) [V]. iOS keeps about 64 pending. The plugin doesn't add the time-sensitive entitlement, so add `com.apple.developer.usernotifications.time-sensitive` via `ios.entitlements` | S |
| **Geofencing** | "You're at the stop" auto-actions | all | **Official** `expo-location` + `expo-task-manager` [V] | `startGeofencingAsync(task, regions)`; needs **Always** permission; iOS limit about 20 regions; 58.x fixed `notifyOnEnter` and region-limit loops and no longer requires the `location` background mode [V CHANGELOG] | M |
| **Background location** | Get-off alerts with the app in the pocket | all | Official `expo-location` | `startLocationUpdatesAsync(task, {activityType, pausesUpdatesAutomatically, showsBackgroundLocationIndicator, deferredUpdates*})` + `UIBackgroundModes: location` (App Review 2.5.4 justification needed) [V] | M |
| **Motion activity** | Detect "now in a vehicle" to offer on-board mode | all | **Official, new** in `expo-location`: `getMotionActivityAsync`, `watchMotionActivityAsync` (**foreground only**), `MotionActivityType.Automotive` [V] | | S–M |
| **Background tasks** | Daily GTFS refresh; re-plan reminders; refresh widget timeline | 13+ | **Official** `expo-background-task` 58.0.11 (BGTaskScheduler). `expo-background-fetch` is **deprecated** [V]. `minimumInterval` ≥ 15 min, "short intervals often ignored… typically overnight" [V] | `registerTaskAsync(name,{minimumInterval})` | S |
| **AlarmKit** | Alarm-grade "leave now" or last-bus alarm that breaks Silent/Focus | 26 | **Community** `react-native-nitro-ios-alarm-kit` [W]. Countdown UI needs its own widget extension | `AlarmManager` | M |
| **Apple Watch app / complications** | Wrist countdown | watchOS | `@bacons/apple-targets` `watch` / `watch-widget` targets in SwiftUI (no RN on Watch); data via App Groups / WatchConnectivity (`react-native-watch-connectivity` 2.0.0) [V][W] | | L |
| **CarPlay app** | — | — | No category fits public transit [W]; `react-native-carplay` last published 2024 [V npm]. Use LA/widgets on CarPlay instead | — | ❌ |
| **StandBy** | Bedside/desk countdown | 17+ | Free with systemSmall widgets and LAs (LA scaled 200 % in StandBy) [D] | `isLuminanceReduced` for night mode | S |
| **Focus filters** | e.g. show the "home" favourite in Personal focus | 16+ | Swift `SetFocusFilterIntent` via expo-app-intents inline modules | | M (low value) |
| **Spotlight** | Find "T816" or a stop in system search | 18+ (indexed entities) | expo-app-intents `registerIndexed` + `setEntityCatalogAsync` [V] | | S–M |
| **Foundation Models** | On-device summarise/answer | 26+ (AI-capable devices) | **Community only**: `@react-native-ai/apple` 0.12.0, `react-native-apple-llm`, `expo-local-llm` 0.8.1 (2026-10-15), `@fourlyn/apple-foundation-models` [V npm]. **Malay unsupported** by Apple Intelligence [W] | | M (low value) |
| **Apple Maps handoff** | Walking directions to the stop; Look Around of the stop | 18.4+ unified URLs | Built-in `Linking.openURL` | `https://maps.apple.com/directions?destination=LAT,LON&mode=walking`, `…/look-around?coordinate=…`, `…/place?coordinate=…&name=…` [D]; legacy `maps://?daddr=…&dirflg=w` for older iOS | S |
| **Share** | Send "T816 ~8:42 at X" | all | RN `Share.share`; `@expo/ui` `ShareLink` [V] | | S |
| **TipKit** | Contextual tips | 17+ | No module; hand-roll one-time hints | | S |
| **App Clip** | Share a stop link that opens a mini BusBuddy | 14+ | `@bacons/apple-targets` `clip` + AASA hosting (skill `expo-app-clip`) [V]. Needs a domain and static hosting | | L |
| **Localisation** | BM/中文/தமிழ் UI, per-app language | — | **Official** `expo-localization` 58.0.5 (not installed) with `supportedLocales` config [W]; expo-widgets localises gallery names via `Localizable.strings` [V] | | M |
| **Speech** | Spoken stop announcements when VoiceOver is off | — | **Official** `expo-speech` 58.0.3 (not installed) [V npm] | `Speech.speak(text,{language:'ms-MY'})` | S |
| **Store review** | Tasteful rating prompt | — | **Official** `expo-store-review` 58.0.2 [V npm] | | S |

---

## 5. Candidate features

Each feature lists what it is, user value, reference app, data, iOS/Expo feasibility, effort and risks.

### A. Trust and honesty

**A1. Ghost-bus guard ("No live bus yet. May not run.")**
- *What:* For each upcoming scheduled departure at the user's stop, look for the vehicle that will serve it. That's either a matched `tripId` or, for loop feeders, a vehicle on the route near the start terminus in time to start the trip. If none is seen by *departure − (run time to the user's stop) − grace*, show the departure struck-through-lite: "No live bus yet. Next confirmed: 8:42 (live)". Never show a scheduled time with the live glyph.
- *Value:* Answers the #1 complaint ("app says coming, never came"). With a 30-minute headway this decides whether to wait or take Grab.
- *Ref:* Transit "Likely cancelled"; CTA/SEPTA cancellation data.
- *Data:* ◐. VP only covers buses tied to scheduled blocks, trip ID match is 86–90 %, and there's no `block_id`. Wording must be probabilistic.
- *Expo:* pure TS in the ETA engine; SQLite for today's trips. Nothing native.
- *Effort:* M. *Risks:* false "may not run" when a bus's GPS is off. Mitigate with a soft label, a never-hide rule, and suppressing the label when the feed itself is empty.

**A2. Freshness and zombie filtering ("live as of 8:31:10")**
- *What:* Drop vehicles whose timestamp is in the future, is more than about 3 minutes old, or whose trip isn't in today's service. Show a seconds-ago label and fade to "last seen 4 min ago". Pass `staleDate` to `LiveActivity.start/update` and use `env.isStale` in the layout. The app passes no `staleDate` today and only uses its own `props.isStale`.
- *Value:* Stops the "frozen bus" problem.
- *Ref:* Flighty data-age labels; bustimes.org caveats.
- *Data:* ✅ (the probe found a 2029 timestamp).
- *Expo:* `expo-widgets` `staleDate` [V].
- *Effort:* S. *Risks:* none.

**A3. Bunching and gap warning**
- *What:* When two vehicles on the user's route are within about 3 minutes of each other: "2 buses arriving together, then about 50 min gap". Also show the real gap after the next bus.
- *Value:* Explains bunching (a top feeder frustration in reliability research) and helps decide whether to run.
- *Ref:* `junmob` FYP metrics (headway regularity, bunching); TfL/Transit headway displays.
- *Data:* ✅ VP + shapes.
- *Expo:* TS.
- *Effort:* S–M. *Risks:* noisy at terminuses, so ignore vehicles in layover.

**A4. Personal reliability ("usually +4 min at this hour")**
- *What:* Whenever the app is polling, log predicted-vs-observed passage of vehicles at the user's favourite stop into SQLite. Show a small histogram (`@expo/ui` `Chart` [V]) and a one-line verdict.
- *Value:* Calibrates trust. Turns noise into a habit.
- *Ref:* Transit on-time stats (user-reported); Flighty on-time history.
- *Data:* ◐. Only covers times the app was active, so samples are sparse.
- *Expo:* `expo-sqlite`, `@expo/ui` `Chart`.
- *Effort:* M. *Risks:* privacy (keep it on-device); small samples (show n).

**A5. Feed-health state**
- *What:* Distinguish four states: "live data off overnight", "data.gov.my unreachable", "rate-limited, retrying", and "live OK". In every state except "live OK", fall back to the timetable with explicit copy.
- *Value:* Honesty when PULSE's tracker is "under maintenance" again.
- *Data:* ✅.
- *Expo:* TS.
- *Effort:* S.

**A6. Timetable-change and route-removed detection**
- *What:* On each GTFS static refresh, diff the user's favourites: route missing, stop missing, departures changed by more than X. Notify: "T5xx isn't in the new timetable. Rapid KL moved some feeders to On-Demand." Also warn before the static feed's `end_date`, since the feed rolls about every 6 weeks.
- *Value:* Avoids silent wrong data after the Jan 2026 cuts.
- *Data:* ✅.
- *Expo:* `expo-background-task` for an overnight refresh [V]; `expo-notifications`.
- *Effort:* S–M. *Risks:* data.gov.my static endpoint is 4 req/min too, so fetch once.

**A7. Service-day chip**
- *What:* "Holiday timetable today (weekend service)" from `calendar_dates`.
- *Data:* ✅ (Deepavali replacement holiday example in the current feed).
- *Effort:* S.

**A8. Alerts-ready parser (future)**
- *What:* Add the GTFS-R `Alert` entity parse path behind a flag. data.gov.my says alerts and trip updates are "in the pipeline for 2026".
- *Data:* ❌ today.
- *Effort:* S. *Risks:* none (dormant).

### B. Timing and reminders (no server)

**B1. Last-bus guard**
- *What:* After about 21:00, the hero shows "Last bus 23:30 · leave by 23:12". Optionally schedule a time-sensitive local notification 30 or 15 minutes before leave-by. Once the last bus has gone, show "No more buses today. First bus 06:00" with an optional "Grab instead" deep link and no data integration.
- *Value:* Last-bus anxiety. Every feeder ends at 23:30.
- *Ref:* Citymapper "last train" style; Tide Guide-like day framing.
- *Data:* ✅ static, and **must not depend on live data** because the overnight feed is empty.
- *Expo:* `scheduleNotificationAsync({trigger:{type:'date', date}})`, `interruptionLevel:'timeSensitive'` + entitlement [V].
- *Effort:* S. *Risks:* stale static feed. Pair with A6.

**B2. Commute "leave by" reminders**
- *What:* The user sets "weekdays, arrive at MRT by 8:15" or "weekdays 7:30–8:30". The app pre-computes the next 7 days of leave-by times from the timetable and walk time, and schedules them (within the ~64 pending limit, one thread per favourite). It re-plans whenever the app opens and in `expo-background-task`. The notification carries actions: "Start tracking" opens the Live Activity; "Snooze to next bus".
- *Value:* The core job ("when do I leave?") without opening the app.
- *Ref:* zeroWait; Transit/Citymapper commute alerts.
- *Data:* ◐ (schedule-based; label "scheduled").
- *Expo:* `expo-notifications` DATE/WEEKLY triggers, `setNotificationCategoryAsync` actions [V]; `expo-background-task` [V].
- *Effort:* S–M. *Risks:* notification fatigue (ship off by default, one per trip); stale if the app isn't opened for days (A6 covers this).

**B3. Scheduled Live Activity at leave time (iOS 26)**
- *What:* Instead of a notification, the Live Activity appears by itself at leave-by minus 5 minutes, with an alert. It shows the scheduled countdown until the app is opened, then switches to live data.
- *Value:* Lock Screen and Dynamic Island presence with zero taps.
- *Ref:* iOS 26 ActivityKit scheduling; Pushwoosh wraps it.
- *Data:* ◐ (scheduled until the app runs).
- *Expo:* **not in expo-widgets 58** [V]. Add a `schedule(props, startDate, alert)` method that calls `Activity.request(…, alertConfiguration:, start:)` [D] via patch-package or a local Expo module. Also upstream it.
- *Effort:* M. *Risks:* iOS 26+ only; the system may limit how many can be scheduled; content can't refresh without the app.

**B4. "Miss it = +N min"**
- *What:* Under the hero: "If you miss this one, next is 8:42 (+30 min)". Hide it when the headway is under 10 minutes.
- *Value:* Makes the cost of the decision explicit, which matters at 30-minute headways.
- *Data:* ✅.
- *Effort:* S.

**B5. Walk-time calibration**
- *What:* Learn the real walk time to each stop. Use the time from "Leave now" to the arrive-at-stop geofence (F1), or let the user record it once. Clamp to the median of recent samples.
- *Value:* Leave-by accuracy.
- *Data:* ✅ device.
- *Expo:* `expo-location` geofence/watchPosition.
- *Effort:* S–M.

**B6. Alarm-grade leave or last-bus alarm (opt-in)**
- *What:* Use AlarmKit for the one reminder the user can't miss, for example the last bus home.
- *Value:* Breaks through Silent/Focus.
- *Expo:* community `react-native-nitro-ios-alarm-kit` [W] plus its own countdown widget UI.
- *Effort:* M. *Risks:* intrusive; iOS 26 only; adds a second widget target alongside expo-widgets (watch out for conflicts).

### C. Glanceable surfaces

**C1. Home Screen widget, "my stop"**
- *What:* Small shows the route badge, stop and a large countdown as `Text` with timer style, so it ticks with no updates. A "live 8:31" or "scheduled" glyph sits beside it, plus the next departure. Medium shows the next 3 departures and leave-by. `updateTimeline` writes one entry per departure for the rest of the day. Each entry's props include the last live ETA if fresh, otherwise the schedule. Refresh on app foreground, after each poll while open, from `expo-background-task`, and in B2's re-plan.
- *Value:* The most-requested glance surface for bus apps (SG peers).
- *Ref:* Transit, 100Bus, Go NYC.
- *Data:* ◐. Live data is only as fresh as the last app run, so freshness must be shown.
- *Expo:* **official** `expo-widgets` `createWidget` + `updateTimeline` + `widgetRenderingMode` for tinted/clear glass [V]. Configurable per favourite with an `enum` parameter `dynamic:true` and `setConfigurationParameterEnum()` [V].
- *Effort:* M. *Risks:* users read stale "live" numbers as truth, so after about 5 minutes always demote to "scheduled"; widget reload budgets.

**C2. Lock Screen widgets**
- *What:* `accessoryCircular` shows minutes (`Gauge`); `accessoryRectangular` shows "T816 · 8:42 · leave 8:35"; `accessoryInline` shows "T816 in 7 min".
- *Expo:* same module, families [V].
- *Effort:* S (after C1).

**C3. Interactive widget controls**
- *What:* Buttons to step to the next or previous departure, or swap the favourite. These run in the extension's JS layout and merge props. Optionally a "Track" button that deep-links via `widgetURL`.
- *Expo:* `Button target`, `addUserInteractionListener` [V].
- *Effort:* S. *Risks:* button state lives in the timeline entry and resets on the next app write.

**C4. Live Activity on Watch, CarPlay and Mac**
- *What:* Add a compact `bannerSmall` layout: "T816 · 6 min · leave now". Check `env.activityFamily === 'small'`.
- *Value:* Watch Smart Stack, CarPlay Dashboard and Mac menu bar coverage without a Watch or CarPlay app [D].
- *Expo:* already wired by expo-widgets [V]; the current `BusArrivalActivity.tsx` doesn't define `bannerSmall`.
- *Effort:* S. *Risks:* none.

**C5. Phase-aware Live Activity with one alerting moment**
- *What:* Phases are waiting → leave now (**alert**) → at stop → bus 1 stop away (**alert**) → on board → end. Everything else is a silent update, following Transit GO's "wake only when you must act". Also use `levelOfDetail` (26+) and iOS 27's landscape Dynamic Island guidance.
- *Expo:* alerts need the small `alertConfiguration` patch (§4); updates while backgrounded need the app alive (foreground polling, or background location during E1).
- *Effort:* S–M. *Risks:* background staleness. Use `staleDate` and A2.

**C6. Control Center / Lock Screen / Action-button "Track my bus" control**
- *What:* A control that opens the app straight into tracking for the primary favourite. In v2, a `LiveActivityIntent` starts the Live Activity in the background.
- *Value:* One press from anywhere, including the Action button and Watch Control Center (26).
- *Expo:* **custom native**: `@bacons/apple-targets` widget target with `ControlWidget` + intents in `_shared/` [V]. Pick one widget-extension owner, either expo-widgets or apple-targets, or keep them in separate extensions.
- *Effort:* M (open-app control) to L (background LA start). *Risks:* two widget extensions; prebuild drift.

**C7. Quick actions**
- *What:* Long-press the icon for the 3 favourites: "Track T816 at Stop X".
- *Expo:* community `expo-quick-actions` [V].
- *Effort:* S.

**C8. StandBy night mode**
- *What:* Respect `isLuminanceReduced` with a red-shifted, low-luminance countdown.
- *Expo:* env flag [V].
- *Effort:* S.

### D. Siri, Shortcuts, Spotlight, Apple Intelligence

**D1. "When's my bus?" App Shortcut**
- *What:* "When's my bus in BusBuddy?" Siri answers: "T816 at Taman X: next at 8:42, about 6 minutes, live as of 8:31. Leave in 2 minutes." It answers in Swift from an App Group snapshot that the app writes on every poll.
- *Value:* Hands-free; also works on Watch via Siri.
- *Ref:* Moovit/OneBusAway Siri shortcuts.
- *Data:* ◐ (snapshot freshness).
- *Expo:* **official alpha** `expo-app-intents` [V]. The intent must **answer natively** because dispatch is one-way. Read the snapshot from shared `UserDefaults`. Writing it needs a small native setter (local module) or `@bacons/apple-targets` `ExtensionStorage`. Alternatively, publish "favourite" entities with `setEntityCatalogAsync` and have Swift read the catalog. Never use `openAppWhenRun` just to answer.
- *Effort:* M. *Risks:* alpha API churn; a stale snapshot spoken as fact (always say "scheduled" or "as of").

**D2. "Track my bus" intent and Shortcuts automations**
- *What:* `openAppWhenRun = true`, then `dispatch('track', {routeId, stopId})` and `useAppIntents` starts the Live Activity. Users can attach it to their own Shortcuts automations ("weekdays 7:45" or "when I leave Home").
- *Expo:* expo-app-intents [V].
- *Effort:* S–M.

**D3. Spotlight for routes and stops**
- *What:* Index favourites, and optionally all 91 routes plus stops by code, so "T816" or "PJ785" in Spotlight opens BusBuddy.
- *Expo:* `registerIndexed` + `setEntityCatalogAsync` (iOS 18+) [V].
- *Effort:* S–M. *Risks:* keep the catalog compact (UserDefaults).

**D4. Siri Suggestions and Lock Screen suggestions**
- *What:* `donateIntentAsync('track', {…})` each time the user opens a favourite, so iOS learns the 7:50 weekday habit.
- *Expo:* [V].
- *Effort:* S (after D1/D2).

**D5. iOS 27 view annotations ("when's the next one from this stop?")**
- *What:* `appEntityIdentifier()` on the stop header so Siri understands on-screen content.
- *Expo:* expo-app-intents (iOS 18.4+, Xcode 27) [V].
- *Effort:* S–M. *Risks:* Siri AI rolls out in English first; Malay isn't supported.

**D6. Visual Intelligence: scan a stop pole or bus number**
- *Expo:* `IntentValueQuery` in Swift [W].
- *Effort:* L. *Risks:* unknown whether stop codes are printed on poles; niche. **Defer.**

**D7. Foundation Models Q&A or summaries**
- *What:* Natural-language questions ("will I make the 8:42?").
- *Data:* ✅, but deterministic answers are better.
- *Expo:* community bridges only [V npm].
- *Effort:* M. *Risks:* device-gated; Malay unsupported [W]; hallucinated times are unacceptable. **Don't build.** If anything, use it later for an optional English "explain today's service" summary from structured facts.

### E. On the bus

**E1. On-board mode and "Get off" alert**
- *What:* After boarding (manual "I'm on", or E2), pick the destination stop from the trip's stop list. The Live Activity shows "4 stops · get off at Taman X" with progress, and alerts one stop before.
- *How:* Track the user's own GPS against the route shape in the background, so it works even when the vehicle feed lags 30 s+, and cross-check with the matched vehicle when available.
- *Value:* Moovit, Citymapper, Transit and Apple Maps all have it. It's critical for unfamiliar routes, night rides and blind/low-vision riders.
- *Data:* ✅ shapes + stops + device GPS.
- *Expo:* `expo-location` `startLocationUpdatesAsync` with `activityType: OtherNavigation`, `showsBackgroundLocationIndicator: true`; `UIBackgroundModes: location`; Always permission [V].
- *Effort:* M–L. *Risks:* App Review 2.5.4 (justify as navigation); battery (stop at alight).

**E2. Auto-detect boarding**
- *What:* When the user is near their boarding stop, the matched bus is at the stop, and `watchMotionActivityAsync` reports `Automotive` with high confidence, offer "On the T816? Track to your stop."
- *Expo:* official `expo-location` motion APIs, **foreground only** [V].
- *Effort:* S–M. *Risks:* motion latency; the prompt must be dismissible.

**E3. Spoken and haptic stop announcements**
- *What:* With VoiceOver on, call `AccessibilityInfo.announceForAccessibilityWithOptions("Next stop: Taman Mutiara", {queue:true})` [V]. Optionally speak announcements with `expo-speech` (`language:'ms-MY'`) through headphones. Add a distinct haptic pattern for "your stop is next".
- *Value:* Riders who can't hear or see on-board announcements, which Moovit and Lothian/RNIB precedents designed for.
- *Expo:* RN core plus official `expo-speech` [V npm].
- *Effort:* S (on top of E1).

### F. Location automation

**F1. Arrive-at-stop geofence**
- *What:* Monitor the boarding stops of active favourites (iOS limit about 20 regions, radius about 100–150 m). On enter, stop the walk timer, refresh VP once within the wake window, and post "At Stop X · T816 in ~4 min (live)" or a scheduled fallback. Update the existing Live Activity, which works from the background. Starting a new Live Activity doesn't.
- *Value:* Removes taps at the exact moment of need. Also feeds B5.
- *Ref:* Apple Maps nearby transit; Transit GO.
- *Data:* ✅.
- *Expo:* official `startGeofencingAsync` + `TaskManager.defineTask` [V].
- *Effort:* M. *Risks:* the **Always** location prompt is a big ask, so make it opt-in with clear value; region entry latency; background fetch may hit the 4/min limit if other pollers run.

**F2. Leave-home check**
- *What:* Exit-home geofence: "You're on track for the 8:12" or "Hurry, 2 min tighter".
- *Effort:* S after F1. *Risks:* creepiness (opt-in). **Low priority.**

### G. Accessibility and inclusivity

**G1. Pronounceable, readable stop names**
- *What:* Title-case the UPPERCASE names and expand abbreviations: JLN → Jalan, KG → Kampung, SG/SG. → Sungai, SEK./SEK → Seksyen, SMK → Sekolah Menengah Kebangsaan, TMN → Taman, OPP → opposite. Keep MRT/LRT/BRT uppercase. Set `accessibilityLanguage="ms-MY"` on stop-name `Text`, so VoiceOver uses a Malay voice [V].
- *Value:* VoiceOver otherwise spells out "J-L-N". Also helps sighted readers.
- *Data:* ✅ (top tokens in feeder stops: TAMAN 283, OPP 248, KG 63, JLN 43, SG 36 + SG. 28, SEK. 28, SMK 37) [V].
- *Effort:* S. *Risks:* a few odd expansions, so keep a small override table.

**G2. VoiceOver sentences and an accessible list path**
- *What:* Each departure row is one element: "T816 to MRT Surian, live, 6 minutes, leave in 2". The map is decorative for VoiceOver, and the stop timeline and timetable are the accessible path. Add rotor-friendly headings.
- *Ref:* Transit's condensed sentences; OBA reviews (lists good, map poor).
- *Effort:* S.

**G3. Dynamic Type to AX sizes and Large Content Viewer**
- *What:* Hero digits scale. Toolbar and glass buttons get `accessibilityShowsLargeContentViewer` + `accessibilityLargeContentTitle` [V].
- *Effort:* S.

**G4. System display preferences**
- *What:* Reduce Transparency → solid sheet instead of glass. Increase Contrast / Darker system colours → stronger live/scheduled weights. Reduce Motion → no digit roll or bus glide. Bold Text. Use `AccessibilityInfo.isReduceTransparencyEnabled / isDarkerSystemColorsEnabled / isReduceMotionEnabled / isBoldTextEnabled / prefersCrossFadeTransitions` [V].
- *Effort:* S.

**G5. Non-audio alerts**
- *What:* Distinct haptic patterns for leave / arriving / your stop, visible banners, and a flash-friendly Live Activity alert.
- *Effort:* S.

**G6. High-legibility map option**
- *What:* Bigger vehicle markers with route number, thicker route line, colour-blind-safe palette, and a heading arrow toward the stop entrance side.
- *Effort:* S.

**G7. Side-of-road clarity**
- *What:* Turn "(OPP)" into a pill ("Opposite side · cross at …"). Show `stop_code` (PJ785). Offer a "See the stop" Look Around link (J8). Disambiguate the 106 duplicate stop names by code and route.
- *Value:* Avoids waiting on the wrong side, a common feeder mistake.
- *Data:* ✅.
- *Effort:* S.

**G8. Wheelchair information (conditional)**
- *What:* Render `wheelchair_boarding` / RT `wheelchair_accessible` **only if** the feed adds them. Never infer. A static note like "Rapid KL says many buses are low-floor" is the most we can honestly say (malaysia.gov.my).
- *Data:* ❌ today.
- *Effort:* S.

### H. Localisation

**H1. Bahasa Melayu + English first, then 简体中文 and தமிழ்**
- *What:* Localise all UI, notification, widget and Live Activity strings in JS, since layouts take props. Also localise widget gallery names (`Localizable.strings`, supported by expo-widgets [V]) and permission strings. Enable iOS per-app language.
- *Value:* KL's main languages. Malay is a full iOS system language; Tamil system-language support arrived around iOS 18.4 per Indian press (sources conflict) [W].
- *Expo:* official `expo-localization` (`supportedLocales` plugin option) [W]; `Intl` for times and plurals.
- *Effort:* M (mostly translation and QA). *Risks:* string expansion in the Dynamic Island; stop names stay Malay in every locale.

**H2. Time formats and units**
- *What:* 12h/24h from locale; "minit"/"min"; MYT always (`Asia/Kuala_Lumpur`) even if the phone travels.
- *Effort:* S.

### I. Offline and resilience

**I1. Offline-first timetable**
- *What:* Already parsed on-device. Add explicit offline copy, keep the last 2 static versions, and do a background refresh overnight (`expo-background-task`) before the feed's `end_date`.
- *Effort:* S.

**I2. One poller and the rate-limit budget**
- *What:* A single scheduler shared by the foreground app, widget refresh, background task, geofence wake and intents. Respect 4 req/min per category; on 429, skip the slot. Poll only when the sheet is visible or a Live Activity or on-board mode is active.
- *Value:* Prevents self-inflicted 429s once widgets and background work arrive.
- *Effort:* S.

### J. Delight and craft (minimal)

**J1. "Where's my bus coming from"**
- *What:* Before your trip starts, show the bus that will likely run it: "Your 8:30 bus is finishing its loop, 6 stops from MRT Surian". Feeders are loops, so the previous lap's vehicle is usually the next trip. Optionally show the plate (`vehicle.id` is mostly the licence plate) and "same bus as yesterday".
- *Value:* Turns waiting into knowing, the most-loved idea in Flighty. It's also the strongest ghost-bus signal (A1).
- *Ref:* Flighty "where's my plane"; bustimes.org vehicle history.
- *Data:* ◐ (no `block_id`; infer from loop timing).
- *Effort:* M.

**J2. Rain-aware nudges**
- *What:* Read MET Malaysia `/weather/warning` (thunderstorm/heavy-rain warnings) and the district `/weather/forecast` (Malay values like "Ribut petir di beberapa tempat"). When a warning covers the user's district near commute time, add a rain glyph to the hero and a nudge: "Thunderstorm warning: leave 3 min earlier; stop has no shelter?" Read `/flood-warning` to flag routes near flooded stations.
- *Value:* Rain is the KL commute's defining variable (Tripadvisor: buses leaving in heavy rain, waiting under bridges).
- *Ref:* Citymapper "walk less" / rain-safe.
- *Data:* ✅ (same Open API; separate rate bucket) [V].
- *Expo:* `fetch`; `expo-notifications`.
- *Effort:* S–M. *Risks:* district granularity; warnings are coarse, so keep copy humble.

**J3. Arrival moment**
- *What:* One success haptic plus an alerting Live Activity update when the bus is 1 stop away, and a quiet digit roll to "Due".
- *Ref:* existing design doc (§(d) motion/haptics).
- *Effort:* S.

**J4. Share ETA**
- *What:* Share sheet text "I'm on the T816, reaching MRT Surian ~8:42", with a deep link `t816://…`. No live link without a backend.
- *Expo:* `Share.share` / `ShareLink` [V].
- *Effort:* S.

**J5. Apple Maps handoff**
- *What:* "Walk there" opens `https://maps.apple.com/directions?destination=LAT,LON&mode=walking` [D].
- *Effort:* S.

**J6. Look Around the stop**
- *What:* `https://maps.apple.com/look-around?coordinate=LAT,LON` [D], so the user can recognise the pole and the side of road.
- *Effort:* S. *Risks:* KL Look Around coverage unverified, so hide the link when unsupported or test first.

**J7. Tasteful first-run hints**
- *What:* Three hints at most, each shown once: favourite, widget, Siri. TipKit isn't available.
- *Effort:* S.

**J8. My50 renewal reminder (Malaysia-specific, optional)**
- *What:* The user enters their activation date and gets a local notification at day 28. My50 is still RM50 for 30 days; renewal is via TNG eWallet since Jul 2025.
- *Effort:* S. *Risks:* scope creep. Keep it in Settings, off by default.

**J9. Review prompt**
- *What:* After about 10 successful "caught it" sessions, show the `expo-store-review` prompt once.
- *Effort:* S.

**J10. Alternate route-colour icons**
- *What:* `expo-quick-actions` also does icons.
- *Effort:* S. *Risks:* gimmick. **Low priority.**

### K. Out of scope or needs infrastructure (record and revisit)

| Idea | Why not now |
|---|---|
| Crowdsourced reports / GO-style sharing, leaderboards (Transit Royale) | Needs backend and user density |
| Crowding / seat availability | No occupancy in feed |
| Live share link ("follow my bus") | Needs backend |
| Push-to-start, push LA updates, widget push, broadcast channels | Needs APNs server (`apps/api` exists but the app is now serverless) |
| Native Apple Watch app / complications | L effort; Live Activity on Watch via `bannerSmall` covers most needs |
| CarPlay app | No eligible category; Live Activity and widgets already appear on CarPlay |
| App Clip for shared stop links | Needs domain + AASA hosting; App Clip size limits; revisit if sharing takes off |
| Multi-leg bus + MRT planning (zeroWait-style) | Valuable but a different product; `rapid-rail-kl` GTFS makes it possible later |
| Payments / card balance | Feeder takes physical TNG card only; open payment rollout ~15 months after award (May 2026 status) |
| Foundation Models chat | Malay unsupported; deterministic answers are better |

---

## 6. Suggested sequencing

1. **Trust pass (1–2 weeks):** A2, A5, A1, B4, A7, I2, G1, G7, C4 (bannerSmall + staleDate).
2. **Reach pass (2–3 weeks):** C1–C3 widgets, B1 last bus, B2 reminders, C7 quick actions, J5 Maps handoff.
3. **System pass (2–3 weeks):** expo-app-intents D1–D4 (note alpha), C5 alert patch, B3 scheduled Live Activity (iOS 26), H1 Malay localisation.
4. **Ride pass (3–4 weeks):** E1–E3 on-board and get-off with speech/haptics, F1 geofence, J1 where's-my-bus, J2 rain nudges, A3/A4 reliability.
5. **Optional:** C6 Control Center control, A6 change detection polish, B6 AlarmKit, J8 My50.

**Anti-features to avoid** (consistent with the minimal design): streaks or gamification; feeds of news or promos (PULSE's "Explore City"); colour-only status; showing scheduled times with live styling; notifications by default; a Settings-heavy app (every feature above defaults to sensible values or is off).

---

## 7. Sources

**Installed / downloaded code (verified)**
- `/home/user/bus-tracker/node_modules/expo-widgets/{build/Widgets*.d.ts, ios/LiveActivity*.swift, ios/Widgets/{TimelineProvider,AppIntent,WidgetLiveActivity,WidgetsJSRuntime}.swift, plugin/build/types/WidgetConfig.type.d.ts, CHANGELOG.md}`
- `/home/user/bus-tracker/node_modules/expo-notifications/build/{Notifications.types,NotificationCategoriesModule.types}.d.ts`
- `/home/user/bus-tracker/node_modules/expo-location/build/{Location,Location.types}.d.ts`, `CHANGELOG.md`
- `/home/user/bus-tracker/node_modules/expo-background-fetch/build/BackgroundFetch.d.ts` (deprecation)
- `/home/user/bus-tracker/node_modules/react-native/Libraries/Components/{AccessibilityInfo/AccessibilityInfo.js, View/ViewAccessibility.js}`
- npm tarballs: `expo-app-intents@0.5.10` (README, `build/index.d.ts`, `skills/expo-app-intents/SKILL.md`, templates), `expo-background-task@58.0.11`
- Repos: github.com/EvanBacon/expo-apple-targets (README: target types, Control widgets, ExtensionStorage); github.com/EvanBacon/expo-quick-actions; github.com/birkir/react-native-carplay
- Expo skills: `expo-overview`, `expo-app-clip`, `expo-native-ui`, `expo-module` SKILL.md
- Feed evidence: `junmob_final-year-project/docs/data-source/data-source-summary.md`, `raw-data-source/{04_Rate_Limit,08b_Transport_API_GTFS-R,08c_Weather_API,02_Changelog}.md`, `data/raw/gtfs_static/rapid-bus-mrtfeeder_20261019.zip`, `docs/evidence/realtime_probe/*`

**Apple (fetched)**
- [Activity (ActivityKit) – request(…start:), update(…alertConfiguration:)](https://developer.apple.com/documentation/activitykit/activity)
- [WWDC25 "What's new in widgets"](https://developer.apple.com/videos/play/wwdc2025/278/)
- [WWDC26 "Live Activities essentials"](https://developer.apple.com/videos/play/wwdc2026/223/)
- [WWDC26 iOS guide](https://developer.apple.com/wwdc26/guides/ios/)
- [Adopting unified Maps URLs](https://developer.apple.com/documentation/mapkit/unified-map-urls)

**Web (search summaries; pages often blocked)**
- Expo: [SDK 58 changelog](https://expo.dev/changelog/sdk-58), [AppIntents docs](https://docs.expo.dev/versions/v58.0.0/sdk/app-intents/), [Introducing expo-app-intents](https://daily.dev/posts/introducing-expo-app-intents-siri-shortcuts-spotlight-and-apple-intelligence-for-expo-apps-exp-o6ugvnzto), [Localization v58](https://docs.expo.dev/versions/v58.0.0/sdk/localization/)
- Foundation Models bridges: [Callstack on-device Apple LLM](https://www.callstack.com/blog/on-device-apple-llm-support-comes-to-react-native), [expo-local-llm](https://github.com/GijungKim/expo-local-llm), [react-native-apple-llm](https://github.com/deveix/react-native-apple-llm), [fourlyn/apple-foundation-models](https://github.com/fourlyn/apple-foundation-models)
- Apple Intelligence languages: [Apple support 121115](https://support.apple.com/en-us/121115), [iOS 27 feature availability](https://www.apple.com/ios/feature-availability/), [MacObserver 16 languages](https://www.macobserver.com/news/apple-intelligence-english-only-features-16-languages/)
- Visual Intelligence: [App Intents 2.0 in iOS 26](https://blakecrosley.com/blog/app-intents-2-ios-26-additions)
- Live Activities: [CarPlay LA (Ubergizmo)](https://www.ubergizmo.com/2025/10/apple-carplay-live-activities/), [Pushwoosh scheduled LA](https://docs.pushwoosh.com/developer/pushwoosh-sdk/ios-sdk/ios-live-activities/)
- AlarmKit: [react-native-nitro-ios-alarm-kit](https://github.com/Gautham495/react-native-nitro-ios-alarm-kit), [Apple AlarmKit](https://developer.apple.com/documentation/alarmkit/scheduling-an-alarm-with-alarmkit)
- Watch with Expo: [apple-targets watch guide](https://mintlify.wiki/EvanBacon/expo-apple-targets/guides/watch-apps), [keiver.dev WatchConnectivity](https://keiver.dev/lab/apple-watch-app-with-react-native-bidirectional-communication)
- CarPlay categories: [ecorpit CarPlay SDK reference](https://ecorpit.com/carplay-sdk-reference-templates-entitlements-scenes-ios-27/), [WWDC26 CarPlay](https://developer.apple.com/videos/play/wwdc2026/212)
- Controls: [TechCrunch iOS 18 controls](https://techcrunch.com/2024/09/30/18-apps-that-add-useful-actions-to-the-ios-18-control-center), [MacStories Control Center](https://www.macstories.net/stories/ios-and-ipados-18-the-macstories-review/4/)
- Transit: [Track departures / Likely cancelled](https://help.transitapp.com/article/445-how-to-track-departures-on-your-transit-line), [GO notifications](https://help.transitapp.com/article/104-get-notifications-about-your-trip-with-go), [Royale](https://transit.helpscoutdocs.com/article/324-get-the-most-out-of-royale), [Accessibility](https://resources.transitapp.com/article/522-transit-and-universal-accessibility), [App Store](https://apps.apple.com/us/app/transit-subway-bus-times/id498151501), [Simple Transit 2026](https://www.simpletransit.com/posts/ai-transit-apps-2026-moovit-citymapper-equity), [WBEZ CTA ghost buses](https://www.wbez.org/transportation/2025/08/04/cta-canceled-bus-tracker-apps-ventra-transit), [Stateline ghost buses](https://stateline.org/2023/01/31/ghost-buses-haunt-transit-agencies-and-frustrate-riders/)
- Citymapper: [Get Off Alerts](https://citymapper.com/news/823/get-off-alerts), [GO](https://citymapper.com/news/517/go-your-personal-trip-assistant), [Lock Screen Navigation](https://citymapper.com/news/2553/citymapper-introduces-ios-lock-screen-navigation), [Walk less (Via)](https://ridewithvia.com/news/citymapper-the-ultimate-journey-planning-app-unlocks-features-that-make-it-easier-to-prioritize-safety-convenience-and-speed-on-every-trip), [AI best route](https://citymapper.com/news/2838/citymapper-now-uses-ai-powers-to-help-you-choose-the-best-route)
- Moovit: [crowding & wheelchair](https://www.masstransitmag.com/technology/passenger-info/mobile-applications/article/21210573/moovit-releases-realtime-crowding-wheelchair-accessible-feature-for-its-app), [WeWalk](https://moovit.com/blog/moovit-wewalk-partnership/), [blind users](https://techcrunch.com/2016/03/30/moovit-expands-accessibility-features-for-blind-users)
- Google Maps: [crowdedness](https://9to5google.com/2020/11/17/google-maps-transit-crowdedness/), [Live Activities](https://www.idownloadblog.com/2023/02/08/google-maps-live-activities-support-coming/), [Rapid KL on Google Maps (Lowyat)](https://www.lowyat.net/2020/215359/google-maps-rapid-kl-bus-real-time-update/), [Lowyat forum](https://forum.lowyat.net/topic/4982028)
- Apple Maps: [iOS 27 Maps (9to5Mac)](https://9to5mac.com/2026/06/09/heres-everything-new-for-apple-maps-in-ios-27/), [Transit directions in Malaysia (TechNave)](https://technave.com/gadget/Apple-Maps-now-features-Transit-Route-Directions-in-Malaysia-42719.html), [Apple transit support](https://support.apple.com/guide/iphone/get-transit-directions-ipha44f57caa/ios)
- OneBusAway: [OBAKit](https://opentransitsoftwarefoundation.org/2021/02/meet-obakit-the-new-onebusaway-for-ios/), [AppleVis](https://applevis.com/apps/ios/navigation/onebusaway)
- bustimes.org: [Live Bus Maps](https://95crailbus.substack.com/p/live-bus-maps), [RailForums](https://www.railforums.co.uk/threads/bustimes-org.235231/post-5892825)
- PULSE / Rapid KL: [Google Play](https://play.google.com/store/apps/details?id=com.prasarana.pulse.v4&hl=en_US), [Bernama launch](https://www.bernama.com/en/general/news.php?id=2418695), [Threads praise](https://www.threads.com/@diediemustrun/post/DXB8PaOFOZQ/suka-betul-dgn-accuracy-lokasi-bas-dalam-app-rapid-kl-ni-comel-je-icon-bas-tu?hl=en), [tracker maintenance notice](https://myrapid.com.my/info-penyelenggaraan-fungsi-penjejak-bas-aplikasi-pulse-sedang-dijalankan-4/), [Ask Rapid KL](https://x.com/askrapidkl/status/2079353048552591592), [Bus performance](https://myrapid.com.my/rapid-bus-performance/), [Tripadvisor](https://www.tripadvisor.com/Attraction_Review-g298570-d10533919-Reviews-RapidKL_Bus-Kuala_Lumpur_Wilayah_Persekutuan.html), [Jan 2026 restructuring](https://www.malaymail.com/news/malaysia/2026/01/11/rapid-bus-to-restructure-klang-valley-routes-shift-lowridership-lines-to-ondemand-service-starting-jan-16/205032), [Route list](https://en.wikipedia.org/wiki/List_of_bus_routes_in_Greater_Kuala_Lumpur), [Rapid Bus](https://en.wikipedia.org/wiki/Rapid_Bus), [Shah Alam flood suspensions](https://theleaders-online.com/mbsa-closes-roads-rapid-kl-suspends-three-bus-routes-after-heavy-rain/), [Aliran on feeders](https://aliran.com/thinking-allowed-online/too-many-uncles-no-father-fixing-malaysias-buses)
- Payments/passes: [Open payment (Malay Mail)](https://www.malaymail.com/news/malaysia/2026/05/22/coming-soon-kls-trains-buses-to-allow-credit-cards-for-tap-in-tap-out-prasarana-says-project-in-award-stage/220862), [Lowyat open payment](https://www.lowyat.net/2026/393567/prasarana-rapid-kl-open-payment-system-coming-soon/), [My50 stays RM50](https://malaymail.com/news/malaysia/2025/12/16/rapid-kl-transport-passes-prices-go-up-from-jan-1-but-my50-pass-stays-at-rm50/202162), [Rapid Bulanan](https://soyacincau.com/2026/06/21/rapid-kl-rapid-bulanan-pass-unlimited-ride-monthly-rm150-tng-ewallet/)
- Grab: [Trip Planner Indonesia](https://techsauce.co/news/grab-enters-mass-market-transportation-services-with-first-ever-public-transit-integration-in-southeast-asia), [Grab Intercity](https://www.digitalnewsasia.com/business/grab-launches-feature-connects-public-transportation)
- Community MY apps: [weareblahs/bus](https://github.com/weareblahs/bus), [malaysia-transit-tracker](https://github.com/agustiarfalahi94/malaysia-transit-tracker), [Apify tracker](https://apify.com/jaafahmy/transit-tracker), [basbuddy](https://github.com/farisdanish/basbuddy), [MyTransit Hub](https://mytransithub.my/), [XploreMY](https://github.com/ThuJianeee/xploremy), [ndoo.sg OTP/OBA](https://ndoo.sg/projects:software:malaysia_gtfs_opentripplanner_onebusaway)
- SG peers: [SG BusLeh](https://apps.apple.com/us/app/sg-busleh-bus-train-timings/id1457795886), [100Bus](https://apps.apple.com/app/id1600120667), [Arriving](https://marlvel.ai/apps/arriving-sg-bus-timing)
- Accessibility: [malaysia.gov.my OKU transport](https://www.malaysia.gov.my/en/topics/public-transport-facilities-for-the-disabled), [UUM thesis](https://etd.uum.edu.my/5151/), [RouteMe2 focus group](https://par.nsf.gov//servlets/purl/10063454), [PTV case study](https://www.vic.gov.au/transport-accessibility-strategic-framework/we-work-across-boundaries-achieve-outcomes/case-study-next-generation-ptv-mobile-application), [Lothian/RNIB app](https://www.foxnews.com/health/for-blind-bus-riders-a-new-app-boosts-independence)
- Localisation: [iOS 18.4 Indian languages](https://t2online.in/tech/tech-news/bengali-malayalam-and-more-in-april-there-will-be-more-choices-for-the-primary-iphone-language/1362326), [iOS language codes](https://ibabbleon.com/iOS-Language-Codes-ISO-639.html)
- Flighty: [ADA 2023](https://apple.co/2CTHmHk), [Behind the Design](https://cur.at/VcCahLU?m=web)
