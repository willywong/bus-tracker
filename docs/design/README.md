# BusBuddy — design spec (v3, "Calm Mono")

> **v3 (October 2026): Calm Mono.** Chosen from three directions mocked up on
> the design canvas (A Native Glass, B Transit Bold, C Calm Mono; research in
> [`research/ui-polish.md`](./research/ui-polish.md)). What changed from v2:
>
> - **Ink on paper.** The UI is monochrome (`INK` / `PAPER` in
>   `theme/design.ts`). Green is the only colour and only means "live";
>   orange marks warnings. Rail line colours appear only for rail stations.
> - **Opaque sheets at every detent.** Text no longer sits on glass over a
>   busy or satellite map, which failed contrast. Glass stays for the system
>   toolbar only.
> - **Type does the work.** Hero: 64pt thin, tabular, full ink whether live
>   or scheduled; live vs scheduled is the status line's glyph and word
>   (green dot + "Live" / clock + "Scheduled"), plus "as of 20:48" freshness.
> - **Hairline rows, no cards.** "Then 21:41 +39 min" (the cost of missing
>   this bus) and notes under the hero; sections are a 13pt sentence-case
>   label over hairline rows; options are plain rows with ink switches.
> - **Outlined route chip** (inverted ink chip in SwiftUI lists).
> - **Map markers:** a 4pt ink line on a paper casing, cut at the bus and at
>   your stop (`splitRoute`): ink behind the bus, ink with a travelling glint
>   from the bus to your stop (`RouteShimmer`, a UI-thread overlay that hides
>   while the camera moves, off under Reduce Motion), light ink past your
>   stop. On a loop where the bus wraps round, the road between your stop and
>   the bus stays ink. Stops are paper beads threaded on the line; your stop
>   is a solid ink pin with a standing figure, a faint halo and its name on a
>   paper chip; buses keep an upright `bus.fill` with a heading wedge outside
>   the disc, yours solid ink with the green dot, others paper; the selected
>   bus gets a halo. The scheduled bus is a dashed ring; rail stations are
>   small squares with line-colour dots; where you get off is a square. All
>   marker views are fixed-size and centred (Apple Maps ignores `anchor`).
>   Over satellite the dark palette is used.
> - **Peek detent hugs its content** (`PEEK_CONTENT_HEIGHT` points, not a
>   fixed fraction). The trip peek is a card after a Live Activity: route
>   chip and stop name; the thin number (a clock mark when scheduled; the
>   live dot is in the status capsule at the far right) beside
>   the journey rail (bus, a tick per stop between, your stop as the map
>   pin in miniature, a glint from bus to stop while live; otherwise
>   "Arrives 11:44 AM"); then the action as a native Liquid Glass capsule
>   ("Leave in 3 min", "Leave now", "Walking · 3:05"; a warning is orange
>   text) and, while the rail holds the top row, "Arrives 3:23 PM" opposite
>   it. With no button, "Arrives …" takes the left and the right says how
>   far the bus is ("2 stops away"). Later buses live in the Today grid. The stop and bus peeks use the same card
  (`PeekCard`): a stop shows its next bus, the rail ending at its bead (or
  your pin), a glass "Directions" and the timetabled bus after; a bus shows
  its minutes and rail to your stop, a glass "All N stops" and the distance
  to go. The ride peek keeps the two-cell strip.
> - **"Arriving" shimmers:** a soft light band sweeps the word (masked to
>   the glyphs), then rests; plain under Reduce Motion.
> - **Under the hero: one status line, then the facts.** After Transit,
>   the number stands alone: the live dot (pulsing green while fresh,
>   still orange once ageing) leads the status capsule beside it, with the
>   warnings, and the status sheet opens with a "Live · From the bus's GPS ·
>   Updated 3:12 PM" row. The line reads "Arrives 10:52 AM · 3 mins late"
>   (no "Live" word); "Updated 3 mins ago" leads it once it's a problem, and
>   "Scheduled" leads a timetable time. Where a live bus is sits under a
>   hairline as one left-aligned row (`BusPosition`): the ink bus disc the
>   map and "On the way" use, "2 stops away" in semibold, and "Near Jejantas
>   SS2/24 (utara)" under it in grey, full width so a long name isn't
>   squeezed. No "Your bus" label: the disc says it.
> - **Minutes are plural past one** everywhere ("1 min", "5 mins", "Leave in
>   6 mins", "+30 mins"); a count used as an adjective stays singular and
>   hyphenated ("a 10-min walk", "a 43-min gap").
> - **Other buses live in the Today grid, not under the hero.** There's no
>   "Next bus" row; it read as a second answer. Every time in the grid is a
>   clear Liquid Glass button, so it reads as tappable; the hero's bus is the
>   one prominent systemBlue button. A tap opens a small fit-to-content sheet:
>   the time large and light (40pt), "in 53 mins" under it rolling down as
>   minutes pass (a blue "Your bus" tag before it for the hero's), then two
>   icon rows, `bus` "T816 · Hotel Lisa De Inn │ Scheduled" and `figure.walk`
>   "Leave by 3:37 PM │ 10 min walk", and one glass action, "Remind me at
>   3:37 PM". Setting it bounces the bell, crossfades the label to "Reminder
>   set · 3:37 PM" and plays a success haptic; tapping again cancels. The
>   reminder has its own notification slot (`bt.departure`, one at a time),
>   so following the hero's bus never overwrites it.
> - **Why a time is scheduled is never status text.** The line under the hero
>   reads just "Scheduled · Arrives 3:14 PM". A quiet route, dead live data or
>   no connection is a glyph in the warnings capsule (question mark, antenna,
>   `wifi.slash`).
> - **Warnings are glyphs in a glass capsule beside the hero number**: a
>   small native Liquid Glass button (SwiftUI glass style, so it keeps its
>   rim and shadow on the opaque sheet) holding one glyph per warning, each
>   in its own colours: an orange walker for "Too soon to make it", a grey
>   cloud with blue rain for MET weather, a white question mark on grey for
>   a bus that isn't reporting, a grey antenna when live data is down.
>   Tapping opens a "Heads-up" sheet sized to its content: glyph, bold
>   title, a quieter detail that never repeats it ("Thunderstorms likely
>   this afternoon" / "Expected in parts of Petaling. Leave a few minutes early."),
>   and "Weather from MET Malaysia". With no hero (loading, service ended)
>   the warnings are listed inline instead. The peek card carries the same
>   capsule at the far right of the number's row; "Too soon to make it" is
>   its walker, so the peek shows no orange text for it, and "Arrives …"
>   drops to the bottom-left when there's no action.
> - **Dragging the map drops the sheet from glance to peek**, so the map
>   you're looking at isn't half covered. The native sheet only takes a
>   detent at presentation, so while the map is dragged it's offered peek
>   alone; all three detents return once the map settles and the finger is
>   off it.
> - **Where the times come from** closes the sheet as one line of 12pt
>   fine print, no glyphs: live from bus GPS, schedules from Prasarana,
>   weather from MET Malaysia, "open data via data.gov.my". The link is
>   a shade darker, not underlined, and opens an in-app Safari sheet.
> - **"On the way" is a vertical timeline** in the map's glyphs: the bus as
>   an ink disc, stops as rings, your stop as ring-and-dot. Stops are
>   tappable. A light glint runs down the line from the bus to your stop
>   (260 ms a row, then a 1.4 s rest), under the nodes, the way the bus is
>   coming; still under Reduce Motion and while the sheet is at peek. "All 15 stops ›" under it opens every stop in its own sheet over
>   the trip sheet; with no live bus it's a row in the links list instead.
> - **Map and stop taps swap the sheet to a detail** (stop or bus), with a
>   circular glass back button where the route badge was. Stop: next bus here
>   (live when one is approaching), where it sits relative to yours ("Stop 4
>   of 15 · 5 stops before yours"), the bus after or step-free access, today's
>   times, other routes, rail nearby, walking directions, Street View (Google
>   Maps' keyless pano link; Apple has no Look Around here). Bus: its headsign,
>   minutes, stops and distance to your stop, motion, and its On the way
>   timeline. The selected marker is drawn solid ink; tapping your own stop
>   or the back button returns to the trip. The camera frames the selection
>   with your stop. The swap is a shared-axis slide (32pt): going in, the
>   trip view slides left and fades out (150ms) while the detail slides in
>   from the right a beat later (70ms delay, 260ms, ease-out); back mirrors
>   it. Reduce Motion makes it a plain crossfade. Swiping right anywhere on a
>   detail also goes back, like a navigation pop: the detail follows the
>   finger and dims a little; past a third of the width, or on a flick, it
>   slides off and the trip returns, otherwise it springs home. Vertical
>   drags still scroll and resize the sheet.
> - **Today ends with the service span**: First bus and Last bus at either end
>   of a thin track filled up to now.
> - **Sections are split by a full-width 1pt rule**; rows inside a section keep
>   inset hairlines. Green appears once in the sheet (the status line); the
>   live-matched time in "Today" sits on a grey squircle instead.
>   Detent changes crossfade in place, in step with the native snap: out of
>   peek the body fades in and rises 10pt while the strip and compact number
>   fade out (240ms, ease-out); into peek it reverses, faster (140ms). The
>   strip sits over the body's top edge, so nothing reflows mid-fade.
> - **"Where to?" plans the whole trip** (phases 12–15, spec in
>   [`transit-and-planner.md`](./transit-and-planner.md)). A glass "Where
>   to?" capsule tops the trip peek, with Home and Work circles once set. It
>   opens `plan`: stations and stops first (offline), then Apple places, then
>   up to five results, each a row of leg chips, a journey bar and one
>   Live/Scheduled status line that re-times from live bus positions
>   ("Updated · was 9:12"). A result replaces it with `itinerary`: a timeline
>   at peek / 0.5 / 1 while the legs draw on the map in order, walks dotted.
>   **Go** follows that journey in the trip sheet: the current leg, change
>   and get-off alerts, and the Live Activity's "Leg 2 of 4". Rail is never
>   live; it reads "every N min" or "about". Rail lines share the map in
>   their colours, with `station`, `line` and `network` sheets (§2).
>
> Sections below describe v2; where they mention glass sheets, blue accent,
> filled badges or the 88pt rounded bold hero, v3 above wins.

Design spec for the iOS 26 / Liquid Glass overhaul of the mobile app. It distils
three research reports kept alongside it in [`research/`](./research):

| Report | Covers |
| --- | --- |
| [`ios26-design-research.md`](./research/ios26-design-research.md) | Liquid Glass HIG, transit / maps reference apps, motion, accessibility, IA proposal |
| [`award-winning-ios-apps.md`](./research/award-winning-ios-apps.md) | Apple Design Award / App Store Award winners (Flighty, Tide Guide, Things, Weather, Find My…), patterns to borrow |
| [`expo-native-capabilities.md`](./research/expo-native-capabilities.md) | What Expo SDK 58 actually exposes (verified against installed `.d.ts`) |

## 1. Principles

1. **One job, one screen.** The app answers "when do I leave for my bus?". The
   old Tracker and Map tabs showed the same bus twice; they are merged into one
   map with a persistent sheet (Apple Maps / Find My pattern). No tab bar.
2. **Glass is chrome, never content.** Liquid Glass is used only for the
   navigation layer: the system sheet, the native toolbar items over the map
   (route switcher, recenter, more) and system menus. Everything inside the sheet
   is content: plain text, fills and grouped backgrounds. No glass cards, no
   glass-on-glass, no aurora backdrops, no bento tiles.
3. **One primary number.** Minutes until the next bus at your stop, large,
   rounded, tabular digits. Everything else supports it.
4. **Honest about live vs scheduled.** The feed only has vehicle positions, so
   live ETAs are estimates and scheduled times are a fallback. Each is shown by
   **weight + glyph + word**, never by colour alone. A scheduled time never wears
   the live glyph, so the app never shows a "ghost bus".
5. **Quiet motion, meaningful haptics.** The digits roll, buses glide and the
   sheet uses system springs. Nothing animates in for its own sake. Haptics fire
   only on user decisions and the two moments that matter (leave now, arriving).
6. **Adopt the system first.** Native stack toolbars, menus, form sheets,
   SwiftUI text and buttons via `@expo/ui`, and SF Symbols. Hand-rolled chrome is
   avoided.

### Data: straight from data.gov.my

The app needs no BusBuddy server. It covers every Prasarana bus network
data.gov.my publishes: MRT feeder (`rapid-bus-mrtfeeder`), Rapid KL
(`rapid-bus-kl`), Rapid Penang (`rapid-bus-penang`) and Rapid Kuantan
(`rapid-bus-kuantan`). Rail stays separate (`rapid-rail-kl`, bundled stations
only). `services/gtfsFeed.ts` downloads each network's static zip (1.7–3.5 MB)
once per session and parses it on the device. Route search, the stop picker and
the per-route SQLite bootstrap all read from these feeds. Live positions are polled every
30 s from the vehicle-position feeds of the networks you follow, never all of
them (`services/realtimePlan.ts`).

- **Route keys.** A followed route is stored by a key that is also its label.
  Klang Valley routes use the bare code (`T816`, `400`, `SUNWAY LINE`), since
  feeder and Rapid KL codes don't overlap. Penang and Kuantan reuse Rapid KL
  numbers (201, 202, 300, 303…), so their keys carry the city (`401 Penang`,
  `300 Kuantan`). See `packages/shared/src/utils/categories.ts`.
- **Ids are namespaced** (`kl:`, `pg:`, `kt:`) because the feeds reuse them:
  feeder and Penang share stop and route ids, and KL and Kuantan share service
  ids. Feeder ids stay raw, so existing data and saved stops keep working.
  Realtime trip and stop ids are namespaced the same way when decoded.
- **Rapid KL and Kuantan publish headways** (`frequencies.txt`). Each template
  trip is expanded into one trip per departure (`<template>@HH:MM`, with an
  inclusive window end), so timetables, ETAs and widgets see plain trips. Live
  buses report the template id plus their run's `start_time`. They are named
  `<template>@<start>` and matched to the stored run nearest that start. They
  reach the route through Rapid KL's GTFS `route_id` (`U4000` → `400`).
- **Feed health is per route** (`feedHealthByRoute`), so a Rapid KL feed with
  buses can't mask a feeder outage. A Kuantan route never reads as "feed
  down".
- **Withheld trips.** data.gov.my strips about 2% of Rapid KL trips from
  `stop_times.txt`. Trips without stop times are dropped when a route is cut.
- **Kuantan** has no realtime feed, so its routes are timetable-only. Its
  static API currently returns 404, so the app falls back to the S3 object that
  the other categories redirect to.
- **Size.** One route in SQLite takes 0.2 MB (T816), about 1.5 MB (KL 400) and
  4–5 MB at worst (KL 300, Penang 101, 22–38k stop times). Rows go in as
  multi-row INSERTs.
- **Memory and search.** A feed is never parsed whole. Search uses a small
  index per feed, built straight from the zip (only routes, trips, stops and
  a line-by-line scan of `stop_times`, with no object per row) and saved in
  SQLite (50–350 KB each). The build never blocks typing. It inflates the
  zip 16 KB at a time and decodes and scans `stop_times` 64 KB at a time, in
  one pass. It hands the JS thread back every ~8 ms with `setTimeout`, and
  feeds build one after another. Measured on a Release simulator build, the
  longest JS stall during a cold build is under 40 ms. The same work done in
  one block froze it for 360–930 ms per feed. Building this way takes about
  twice as long in wall time (Penang: 2 s). Later searches, including after a
  relaunch, answer from the saved index in about a millisecond, refreshing it
  in the background after 12 h.
  The add-route screen loads the indexes on open, and results show as each
  feed's index arrives. Adding a route parses only that route's rows. Raw
  zips are dropped after 2 minutes idle. Measured on a Release build: a
  first search used to take the app from 143 MB to 457 MB (Hermes keeps its
  heap at the high-water mark); now it goes from 168 MB to about 183 MB.
  Route data stays lean too: a trip reads its polyline and stops once, and
  only that route's stops (15 for T816, not every saved route's ~260).
  Removing a route deletes the stops no other route calls at. Each live poll
  keeps only followed routes' buses (7 of 75 on Rapid KL) before re-keying
  them. Rapid KL and Kuantan trip ids are never loaded, since their buses
  match by route (246 runs skipped for KL 300).

`apps/api` is now optional and only needed for server-sent push alerts
(`EXPO_PUBLIC_API_BASE_URL`).

## 2. Information architecture

```
Root Stack (no tabs)
├─ index      Map canvas (full bleed, Apple Maps muted style)
│   ├─ toolbar left : Route menu  "T816 ▾"  → favourites · Add Route… · Edit…
│   └─ toolbar right: Layers ▾ (My buses, Rail lines, Rail map, Satellite) · Recenter · More ▾ (Share Arrival, Settings)
├─ trip       Persistent form sheet over the map (cannot be dismissed)
│   ├─ peek   (18%)  "Where to?" capsule (+ Home · Work) · route badge · stop name · compact ETA
│   ├─ glance (50%)  hero countdown · status · primary action
│   ├─ large  (100%) + approach timeline · today's timetable · Lock Screen toggle · about
│   └─ Go     a journey in progress replaces the body: current leg · timeline · End
├─ plan       Form sheet: search (stations, stops, places) → up to 5 results
├─ itinerary  Form sheet (peek / 0.5 / 1): timeline + legs drawn on the map · Go
├─ station    Form sheet (0.5 / 1): departure board · nearby buses · interchanges
├─ line       Form sheet (0.6 / 1): whole-line strip map with estimated trains
├─ network    Form sheet: schematic rail map (Layers → Rail map)
├─ add-route  Form sheet: search → pick boarding stop → saved
└─ settings   Form sheet: favourites · walking · display · about
```

## 3. Screens

### 3.1 Map (index)
- `mapType` **mutedStandard** (or satellite) with POIs filtered to public transport,
  so the route, stops and buses stand out.
- The route line is 5pt accent with an 8pt casing (white in light mode, black at
  45% in dark mode) so it reads over roads and parks.
- Route stops are small white dots with an accent ring. Your boarding stop is a
  larger accent marker with its name label.
- Buses are accent discs with a white border, `bus.fill` and a heading wedge.
  The bus heading to your stop is larger. Other buses on the route are dimmed.
- When no bus is live, a dashed "ghost" ring shows where the scheduled bus should
  be. It never looks like a live bus.
- Markers glide between position fixes over the poll interval.
- Camera: frames *next bus + your stop*, padded above the sheet. It re-frames on
  first data, on sheet detent change and on Recenter. Once you pan, it stops
  following until you tap Recenter, and the Recenter glyph turns from filled to
  outline to show that.
- `mapPadding.bottom` tracks the sheet height, so the legal label and centring
  stay clear of it.

### 3.2 Trip sheet
| Detent | Content |
| --- | --- |
| Peek | Route badge · stop name (headline) · compact ETA "4 min" + live glyph |
| Glance | Hero `4 min` with live dot · status line · facts · primary action (no helper text under it; what a tap does is a VoiceOver hint) |
| Large | + "On the way" timeline with "All N stops ›" · "Today" timetable · rail nearby · Lock Screen toggle · data source |

**Hero rules.** Minutes are floored and never shown with seconds. Under 1 min
shows **Due**; within ~300m and under 1 min shows **Arriving**; 60 min or more
shows the clock time. Digits roll with SwiftUI `contentTransition(.numericText)`.

**Status line.** Each source has its own look:

| Source | Number | Glyph | Copy |
| --- | --- | --- | --- |
| Live | bold, label | `dot.radiowaves.left.and.right`, green, variable-colour animation | "Live · 3 stops away" + motion ("Stopped at a traffic light") |
| Ageing (>90s) | bold, label | `clock.badge.exclamationmark`, orange | "Updated 2 min ago" |
| Scheduled | regular, secondary | `clock`, secondary | "Scheduled" (why is a warning glyph) |

**Primary action.** One full-width Liquid Glass capsule with an ink label
(semibold for a decision, regular while following or walking). "All N stops"
uses the same glass. In Today, every time is a glass button and the hero's bus (the
"Arrives 3:14 PM" one, live or scheduled) is the prominent systemBlue one in
white semibold, so the grid needs no legend:
- `Leave in 6 min` follows the bus: starts the Live Activity. Success haptic.
- `Leave now` (orange) is shown inside the 2-minute window. Tapping starts the
  walk timer. Warning haptic once when the window opens while you're following.
- `Walking · 3:12` is a quiet countdown with Cancel.
- `Bus arrives before you can walk there` is plain text with no fill when the
  bus will beat you.

**States.** Every state keeps the map and swaps only the sheet content:
- **No favourite:** a native `ContentUnavailableView`-style "Track your bus"
  screen with a Choose Route button.
- **Cold load:** a redacted hero with no shimmer.
- **No live buses:** the scheduled presentation plus honest copy.
- **Before first bus:** the clock time of the first bus as the hero.
- **Service ended:** `moon.zzz` and "No more buses today".
- **Feed error:** "Can't reach live data — showing timetable".

### 3.3 Add route
A large form sheet: search field, results list, then boarding-stop picker, then
saved. Done is the single prominent action. The sheet uses the system glass
background (no hard-coded hex).

### 3.4 Settings
A native SwiftUI `Form` in a form sheet: Your routes (with Add Route as the
group's last row), Walking time, Reminders, Display (clock format and map
style, both menu pickers), About. The form keeps its grouped background, so
each section is a card, and is tinted ink so rows, toggles and the slider are
monochrome. A route row is the code (semibold), "Board at <stop>" and the
route's long name, each held to one line, with a chevron. Routes follow the
system list pattern: tap a route to change its stop, swipe left to remove,
long-press for Change Stop / Remove Route. "Edit" in the section header puts
the form in edit mode: ⊖ to remove and ≡ to reorder. The footer copy changes
with the mode. The toolbar has one Done button.

## 4. Tokens (`theme/design.ts`)

- **Colour:** semantic system colours (`label`, `secondaryLabel`, grouped
  backgrounds). One accent (`systemBlue`). Status colours are `systemGreen` for
  live, `systemOrange` for stale or leave-now, and `systemRed` only for
  missed or error. These replace the old hero-state, delay, trend and aurora
  palettes.
- **Type:**

  | Role | Spec |
  | --- | --- |
  | Hero | 88 rounded bold tabular |
  | Unit | 22 semibold secondary |
  | Title | 22 bold |
  | Headline | 17 semibold |
  | Body | 17 |
  | Status | 15 |
  | Footnote | 13 |
  | Caption | 12 |

  No ALL CAPS section labels.
- **Spacing:** a 4pt grid (4, 8, 12, 16, 20, 24, 32). Margins are 16pt.
- **Radius:** controls are capsules and circles. Content groups are 20pt
  continuous. Rows are 12pt.
- **Motion:**

  | Token | Spec |
  | --- | --- |
  | press | 120ms |
  | state | 180ms |
  | number | `.smooth` 0.35s |
  | reposition | 400ms, damping 1 |
  | marker | linear over the poll interval |
  | crossfade | 200ms |
  | sheet in / out | 240ms / 140ms, ease-out `(0.23, 1, 0.32, 1)` |
  | trip ⇄ detail | out 150ms, in 260ms after 70ms, 32pt shared-axis slide, ease-out |

  With Reduce Motion, these become crossfades.
- **Haptics:**

  | Event | Haptic |
  | --- | --- |
  | Route switch | selection |
  | Follow / favourite added | success |
  | Leave-now window opens while following | warning |
  | Arriving while following | medium impact |
  | Countdown ticks, refreshes | never |

## 5. What was removed and why
- **Tab bar and the Glass demo tab:** two views of one object, plus a playground.
- **Aurora backdrop, bento tiles, glass content cards, progress ring, trend
  chart, rainbow status palettes:** decoration that competed with the number,
  and glass used in the content layer.
- **Map callouts with pan/re-anchor hacks:** a selected bus is now described in
  the sheet instead.
- **Traffic-signal circles drawn on the map:** visual noise. The signal data
  still feeds the "Stopped at a traffic light" status copy.

## 6. Verify on device
The sandbox has no iOS simulator. These need a device or simulator pass:
- the persistent form sheet (detents, `gestureEnabled: false`, map interaction
  below the glance detent)
- toolbar items over the map
- the hero `numericText` roll
- the iOS 27 Liquid Glass transparency slider at both ends
- Dynamic Type at accessibility sizes
- Reduce Motion and Reduce Transparency

## 7. Motion
The planner and rail moments (itinerary draw-on, estimated trains, rolling
countdowns, photos, the result stagger, re-timing, the route loader and Go)
are listed with their values in
[`transit-and-planner.md` §7](./transit-and-planner.md#7-motion-and-imagery).
They use the §4 tokens and haptics, and the same rule: under Reduce Motion
everything becomes a crossfade, the legs draw at once and trains stand still.
