# BusBuddy — Liquid Glass redesign (v2)

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

The app needs no BusBuddy server. `services/gtfsFeed.ts` downloads the
official GTFS static feed (`rapid-bus-mrtfeeder`) once per session and parses
it on the device. Route search, the stop picker and the per-route SQLite
bootstrap all read from that. Live positions are polled from the GTFS
Realtime vehicle-position feed every 30 s. `apps/api` is now optional and
only needed for server-sent push alerts (`EXPO_PUBLIC_API_BASE_URL`).

## 2. Information architecture

```
Root Stack (no tabs)
├─ index      Map canvas (full bleed, Apple Maps muted style)
│   ├─ toolbar left : Route menu  "T816 ▾"  → favourites · Add Route… · Edit…
│   └─ toolbar right: Recenter · More ▾ (Map style, Share ETA, Settings)
├─ trip       Persistent form sheet over the map (cannot be dismissed)
│   ├─ peek   (18%)  route badge · stop name · compact ETA
│   ├─ glance (50%)  hero countdown · status · next buses · primary action
│   └─ large  (100%) + approach timeline · today's timetable · Lock Screen toggle · about
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
| Glance | Hero `4 min` · status line · "Then 18 · 34 min" · primary action · walk footnote |
| Large | + "On the way" approach timeline · "Today at <stop>" timetable · Lock Screen toggle · data source |

**Hero rules.** Minutes are floored and never shown with seconds. Under 1 min
shows **Due**; within ~300m and under 1 min shows **Arriving**; 60 min or more
shows the clock time. Digits roll with SwiftUI `contentTransition(.numericText)`.

**Status line.** Each source has its own look:

| Source | Number | Glyph | Copy |
| --- | --- | --- | --- |
| Live | bold, label | `dot.radiowaves.left.and.right`, green, variable-colour animation | "Live · 3 stops away" + motion ("Stopped at a traffic light") |
| Ageing (>90s) | bold, label | `clock.badge.exclamationmark`, orange | "Updated 2 min ago" |
| Scheduled | regular, secondary | `clock`, secondary | "Scheduled" / "No live buses reporting" |

**Primary action.** One filled capsule button (solid accent, not glass, because
it's content):
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
A native SwiftUI `Form` in a form sheet: Favourites (reorder/remove, change
stop), Walking time, Display (clock format, map style), About & data. The
toolbar has one Done button.

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
