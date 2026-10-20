# BusBuddy — iOS 26 / Liquid Glass design research and redesign concept

Prepared 2026-10-20 for a full UI/UX overhaul of BusBuddy (Expo SDK 58, React Native, iOS 26+ with iOS 27 now shipping).
Scope: Liquid Glass fundamentals, transit/maps reference patterns, design-skill rules from GitHub/Expo, motion and accessibility, and a proposed IA and screen concept.
(A sibling doc, `award-winning-ios-apps.md`, covers non-transit award-winning apps. This doc only cross-references them.)

> **Research access notes (what was blocked).** The sandbox proxy blocks appllama.io (403 on CONNECT, and WebFetch DNS failure on every variant I tried), along with mobbin.com, dribbble.com, medium.com, transitapp.com, macrumors.com, typingmind.com, wwdcnotes.com, createwithswift.com and docs.expo.dev. developer.apple.com was reachable, so every HIG quote below is first-party: I pulled the HIG pages as JSON from `developer.apple.com/tutorials/data/design/human-interface-guidelines/*.json`, and the WWDC transcripts came from the session pages. For blocked sites I used WebSearch summaries, and those claims are labelled *(secondary)*. GitHub's search API is limited to repo-scoped endpoints in this session, so I found repos by name and cloned them with `git clone --depth 1`.

---

## 0. TL;DR — the recommendation

1. **Make it one screen: a map canvas with a persistent, non-dismissable glass sheet that opens at a "glance" detent.** Today the Tracker tab and the Map tab show the same object (my bus → my stop) twice. Merge them, Apple Maps / Find My style. At the glance detent the **hero countdown sits in the sheet** and the **map above it frames the bus approaching your stop**. That map view is the trust evidence, because live vehicle positions are the only real-time signal the app has. Drag the sheet down to *peek* for a full map, or up to *large* for the trip stop timeline and the timetable. **Remove the tab bar** (and the Glass demo tab).
2. **Glass is chrome only.** Allowed: the system sheet, a route-switcher capsule (top-leading), a 2-button control cluster (top-trailing), toolbar buttons. Everything in the sheet is *content*: grouped backgrounds, fills, vibrancy, and **no glass cards, no glass chips, no aurora backdrop**.
3. **One primary number.** Show minutes until the next bus at your stop, 88pt bold rounded with tabular digits. Live vs scheduled is shown by **weight + a glyph + a word**, never by color alone. Live is bold label color with an animated `wave` glyph and the word "Live". Scheduled is regular weight, secondary label color, a `clock` glyph and the word "Scheduled". Stale is an orange `exclamationmark` badge plus "Updated 3 min ago".
4. **One accent color** (the route color, or systemBlue when there isn't one). Status colors are reduced to green (live), orange (stale/late) and red (missed/error only). Remove the separate hero-state, delay and trend palettes.
5. **Motion is quiet.** The number changes with a numeric-text roll. The sheet uses native detent springs. Bus markers glide along the polyline between fixes. Nothing has an entrance animation. Haptics fire for four moments only: detent snap, route switch, leave-now and arriving.
6. **Live Activity is the real product surface** for the walk-to-stop moment. Compact shows `T816 | 4 min`. Expanded and Lock Screen show a stops-away progress line. Set `staleDate` so the system can show staleness honestly.

---

## (a) Principles, with citations

### A1. Liquid Glass is a *functional layer*, not a style
- "It is best reserved for the navigation layer that floats above the content of your app." Also: "always avoid glass on glass." Content on glass should "use fills, transparency, and vibrancy… to make them feel like a thin overlay that is part of the material." — *Meet Liquid Glass*, WWDC25-219.
- HIG Materials: "**Don't use Liquid Glass in the content layer.** … Instead, use standard materials for elements in the content layer." "**Use Liquid Glass effects sparingly.** … Limit these effects to the most important functional elements in your app." The one exception is transient controls such as sliders and toggles, which "take on a Liquid Glass appearance … when a person activates it."
- HIG Materials, regular vs clear: Regular "blurs and adjusts the luminosity of background content to maintain legibility … Most system components use this variant." Clear "is highly translucent … Use this variant for components that float above media backgrounds". For clear over bright content, "consider adding a dark dimming layer of 35% opacity". WWDC25-219 adds that the two variants "should never be mixed". **For a map app, use Regular for every control.** A map is not media-rich in the sense Apple means, and controls carry labels.
- Glass morphs and materializes ("Instead of fading, Liquid Glass objects materialize in and out by gradually modulating the light bending"). Larger glass reads as "thicker" with deeper shadow and lensing. Small glass (bars, buttons) flips light/dark with its background, large glass (sheets, menus) doesn't. — WWDC25-219.
- Implication for Expo: **never animate opacity on a `GlassView` or its ancestors.** Animate the content and let the glass rest (expo-native-ui `visual-effects.md`). Use `GlassContainer`/`GlassEffectContainer` for grouped glass, because "Glass cannot sample other glass" (conorluddy/LiquidGlassReference).

### A2. Hierarchy through layout and grouping, not decoration
- "Instead of relying on decoration, hierarchy should be expressed through layout and grouping." — *Get to know the new design system*, WWDC25-356.
- "Typography has been refined … now bolder and left-aligned." — WWDC25-356.
- WWDC26-251 (*Communicate your brand identity on iOS*): "the content layer is the best opportunity to express your brand identity … move color into the content area of your app, into the scroll view. That way, Liquid Glass controls sit above the content layer and pick up your brand color dynamically." Also: "Forcing your brand can compromise the user experience."

### A3. Concentricity
- Three shape types: "fixed shapes have a constant corner radius. Capsules use a radius that's half the height of the container. And concentric shapes calculate their radius by subtracting padding from the parent's." "For phone layouts, use a capsule with extra margin to create space near the screen edge." — WWDC25-356.
- HIG Toolbars: standard items "have corner radii that are concentric with bar corners. If you need to create a custom component, ensure that its corner radius is also concentric".
- HIG Live Activities: "Use consistent margins and concentric placement … use ContainerRelativeShape … instead of hard-coding".
- Rule: **inner radius = outer radius − inset.** Floating controls near the screen edge are capsules or circles.

### A4. Scroll edge effects replace dividers
- "Scroll edge effects reinforce that boundary, replacing hard dividers with subtle blur … Soft is the default … Apply one scroll edge effect per view." — WWDC25-356.
- HIG Toolbars: "Reduce the use of toolbar backgrounds and tinted controls … use a ScrollEdgeEffectStyle when necessary". AvdLee's skill: "Don't add custom darkening backgrounds behind toolbars (conflicts with scroll edge effect)."

### A5. Tab bars, accessories and toolbars
- HIG Tab bars: "Use a tab bar to support navigation, not to provide actions." It "floats above content at the bottom … on a Liquid Glass background." Minimize-on-scroll is for "tab bars with an attached accessory, like the MiniPlayer in Music".
- WWDC25-356 on accessories: "persistent features … like media playback controls … Avoid placing screen-specific actions here." A countdown to *your* bus is a persistent, app-wide feature, so it would be a legitimate bottom accessory *if* the app kept tabs. The recommended IA has no tabs, so this is moot (see E1).
- HIG Toolbars: "Prefer system-provided symbols without borders." "Use the .prominent style for key actions such as Done … Only specify one primary action." "Minimize the number of groups … aim for a maximum of three." "Keep actions with text labels separate."
- Toolbar items are grouped automatically when you use the correct API (`ToolbarSpacer`, or `Stack.Toolbar` in Expo Router). Don't hand-build glass pills for bar buttons.

### A6. Sheets
- HIG Sheets (iOS): "large is the height of a fully expanded sheet and medium is about half … Sheets can have one or more custom detent values." "consider supporting the medium detent to allow progressive disclosure." "Include a grabber in a resizable sheet … a grabber also works with VoiceOver." "Support swiping to dismiss." "use a nonmodal sheet" when it affects the parent view (the Apple Maps pattern).
- iOS 26 sheets get an inset Liquid Glass background at partial heights automatically. Remove any custom `presentationBackground` / `contentStyle.backgroundColor` so the system glass shows (LiquidGlassReference §2.6; expo `visual-effects.md` sets `contentStyle: { backgroundColor: 'transparent' }`). Sheets "morph" from their source button through zoom transitions (`matchedTransitionSource` + `.navigationTransition(.zoom)`; in Expo this is `Link.AppleZoom`).
- WWDC25-356: "when focus shifts, like dragging a sheet upward, Liquid Glass subtly recedes, becoming more opaque". The large detent becomes opaque by design, so content there should be designed for a solid surface.

### A7. Color
- HIG Color, Liquid Glass color: "Apply color sparingly … reserve it for elements that truly benefit from emphasis, such as status indicators or primary actions. To emphasize primary actions, apply color to the background rather than to symbols or text … Refrain from adding color to the background of multiple controls."
- "Avoid relying solely on color … people who are color blind may have particular difficulty with pairings such as red-green" (HIG Color, Accessibility). "If you define a custom color, … supply light and dark variants, and an increased contrast option for each".
- Tinting: "Avoid tinting all your elements. When every element is tinted, nothing stands out … If you want to imbue color into your app, do it in the content layer instead." — WWDC25-219.

### A8. Accessibility is built into the material, but not into your custom views
- Reduce Transparency makes glass "frostier", Increase Contrast makes elements "predominantly black or white … with a contrasting border", and Reduce Motion "disables any elastic properties". These apply automatically to *system* glass (WWDC25-219). Custom views must handle them: when Reduce Transparency is on, swap glass and blur for a solid `systemBackground` (expo-native-ui).
- HIG Accessibility: 4.5:1 contrast up to 17pt; 44×44pt minimum hit target; "Convey information with more than color alone"; under Reduce Motion, reduce "zooming, scaling, and peripheral motion".
- **iOS 27 adds a system Liquid Glass transparency slider** that runs from ultra-clear to fully tinted, plus darker edges and brighter specular highlights (*secondary*: MacRumors, Tom's Guide, TechTimes, June 2026; the SOTU recap confirms glass "better tuned to maintain readability"). **Test the redesign at both ends of that slider.** Any custom tint or shadow you add on top of glass will look wrong at one extreme.

### A9. Motion and haptics
- HIG Motion: "Add motion purposefully … In apps, generally avoid adding motion to UI interactions that occur frequently … Let people cancel motion … Make motion optional".
- HIG Haptics: "Use system-provided haptic patterns according to their documented meanings … Avoid overusing haptics … Often, the best haptic experience is one that people may not be conscious of, but miss when it's turned off." Notification haptics are for outcomes, impact haptics for "a view snaps into place", selection haptics for "values … changing".
- Springs (WWDC23-10158 *Animate with springs*; Apple docs): `Animation.smooth/snappy/bouncy(duration: 0.5, extraBounce: 0)` all default to a **0.5s perceptual duration**. `spring(response: 0.5, dampingFraction: 0.825)` is the default spring. The session's examples use bounce 0.15 for a small bounce. Designing Fluid Interfaces (WWDC18, via emilkowalski/apple-design): reposition uses damping 1.0 / response 0.4, a drawer or sheet uses 0.8 / 0.3. **Add bounce only when a gesture carried momentum.**
- `contentTransition(.numericText(countsDown:))` exists for exactly the countdown use case (Apple docs). Live Activities allow animations up to 2s, and "a sports app might use numeric content transitions for score changes" (HIG Live Activities).

### A10. The design-skill canon (GitHub / Expo), distilled
From expo/skills (`expo-design-system`, `expo-native-ui`, `expo-animation`), emilkowalski/skills (`apple-design`, `animate-expo`), AvdLee/SwiftUI-Agent-Skill (`liquid-glass.md`), twostraws/SwiftUI-Agent-Skill (`design.md`, `accessibility.md`), Dimillian/Skills (`haptics.md`), ehmo/platform-design-skills (`ios`), conorluddy/LiquidGlassReference:
- **One token theme** (color, spacing, type, radius, motion). Semantic system colors first, and a brand set "tiny (accent, accentContrast)". "Never hardcode hex … outside theme".
- Screen titles come from the native stack. Never hand-roll headers or tab bars.
- `borderCurve: 'continuous'` on every non-capsule radius, `fontVariant: ['tabular-nums']` on counters, `selectable` on data text.
- Four-state screens: loading ≠ empty, keep stale content while revalidating, skeletons only for a slow first load with a known layout.
- Animation gate: 100+/day → no animation; tens/day → under 150ms or nothing; occasional → standard; rare → delight. "Tab switches never slide." "Reduced motion ships with the animation."
- Haptics: "Same frame as the visual. One per user action. Never the only feedback."
- Glass: `isInteractive` only on controls; check both `isLiquidGlassAvailable()` and `isGlassEffectAPIAvailable()`; never `overflow: hidden` on glass ancestors; never animate glass opacity; fall back to `BlurView` and then to solid when Reduce Transparency is on.
- Use `ContentUnavailableView`-style empty states (twostraws). "Buttons with image labels must always include text" for VoiceOver.
- WWDC26-250 *Principles of great design* (via emilkowalski/apple-design): Purpose, Agency, Responsibility, Familiarity, Flexibility, **Simplicity, not minimalism** ("sometimes *adding* context simplifies"), Craft, Delight.

### A11. Transit-specific UX principles
- **Glanceability: one number, one status, one action.** Transit and Citymapper critiques praise "countdowns, live arrival times, stop counts and clear 'Get off now' prompts" that "do not overwhelm" (*secondary*: Pratt IXD critiques of Citymapper).
- **Be honest about live vs scheduled.** In Transit, "real-time arrivals are bold and indicated by two pulsating waves, and scheduled times are in grey" (*secondary*: Transit help center via search, and The Urbanist 2019). Google Maps colors live times green/red and shows black for "scheduled, no live data", but "the color coding … is not read by screen readers" (*secondary*: BGR, Perkins). A 2026 roundup credits Transit and Citymapper as the most open about which times are live (*secondary*: unstar.app).
- **Ghost buses destroy trust faster than late buses.** "A phantom arrival … teaches the passenger that the information itself cannot be trusted" (*secondary*: Optibus). WMATA switched to showing real-time only and hid scheduled buses by default to fight ghosts (*secondary*: Stateline, Camsys). For BusBuddy, which has positions but no TripUpdates, the scheduled fallback must look clearly different and must never pretend to be live.
- **Stale data must age visibly.** Show "updated Xs ago" and degrade the presentation as age grows (see B5).

---

## (b) Pattern library for a bus tracker

Each entry gives the pattern, why it matters, how references do it, and do/don't guidance.

### B1. Map canvas with a persistent glass sheet (detents)
- **What:** a full-bleed map with one nonmodal sheet resting at detents: *peek* (about 120–150pt, roughly 0.18), *glance* (about 0.5, the default) and *large* (1.0).
- **Why:** the map is the evidence for the number. Progressive disclosure is handled by a native gesture, which is free, accessible (the grabber works with VoiceOver) and familiar.
- **References:** Apple Maps (iOS 26) is a map with a floating search/sheet and glass control clusters. Find My and Uber use the same idea. HIG Sheets recommends "a nonmodal sheet" when it affects the parent view.
- **Do:** start at glance. Keep the map interactive above the sheet up to the glance detent (`sheetLargestUndimmedDetentIndex: 1` in Expo Router formSheet). Re-frame the camera when the detent changes so the bus and stop stay in the visible region. Move the Apple logo and legal link "10 points above the lowest resting position of the card" (HIG Maps; react-native-maps `legalLabelInsets`, verify).
- **Don't:** let the sheet be dismissed, because then there is nothing to return to (use `isModalInPresentation`-equivalent behaviour; in RN-screens try `gestureEnabled: false` with detents and verify on device). Don't add a second sheet on top: "Display only one sheet at a time" (HIG). Settings and route picking replace the sheet's content or push within it, or present modally *above* and then dismiss back.

### B2. Floating glass control clusters
- **What:** top-trailing, a vertical glass capsule with 2 buttons: **Recenter** (`location.fill`; when the user has panned, swap to `scope` with a magic-replace symbol transition) and **More** (`ellipsis`, a menu with Settings, Map style, Share). Top-leading, the **route switcher capsule** (`T816 ⌄`), which opens a native menu of favourites plus "Add route…".
- **Why:** this is the Apple Maps idiom. Related actions are grouped "by function and frequency" with "a maximum of three" groups (HIG Toolbars).
- **Do:** use regular glass, `isInteractive`, 44pt circles (48pt is fine on a map), and a `GlassContainer` around the cluster. Symbols are monochrome label color (glass flips light/dark automatically). Keep 16pt from the safe-area edges.
- **Don't:** tint the cluster, put text and symbols in one group, use outlined-circle symbols ("Borders … aren't necessary"), or drop shadows on glass.

### B3. Hero countdown
- **What:** a single large number in minutes, a unit, and one status line under it.
  - `4` (88pt, bold, rounded, tabular) and `min` (title2 semibold, secondaryLabel, baseline-aligned)
  - status line: `〰 Live · 3 stops away · updated 12s ago` (subheadline)
  - secondary line: `Then 18 · 34 min` (subheadline, secondaryLabel, tabular)
- **Why:** "Focus on important information that people need to see at a glance" (HIG Live Activities applies equally in-app). Fitness, Weather and Flighty all lead with one number (see the sibling doc).
- **Rules:** floor minutes, because it's safer to tell people they have slightly less time. Under 60s show **"Due"** (Transit and TfL use "Due"; "Now" reads as "you missed it"). Show **"Arriving"** only when the vehicle is within roughly 150m of the stop. At 60 min or more show clock time (`10:42`). **No seconds** for predictions, which would be false precision. Seconds appear only in the walk timer's final minute.
- **Do:** use `numericText(countsDown: true)` semantics (Reanimated: per-digit vertical roll, about 350ms). Keep the hero visible at the glance detent and at AX text sizes (see B12).
- **Don't:** use a progress ring around the number, color the number by state (green/amber/red), or put a gradient or aurora behind it.

### B4. Live vs scheduled vs stale encoding (color-blind safe)
| Source | Number weight/color | Glyph | Word | Map marker |
|---|---|---|---|---|
| Live (fix ≤ 2× poll interval old) | Bold, `label` | `wave.3.up`-style "waves" (SF Symbol variable-color iterative, systemGreen) | "Live" | Solid route-color disc, white bus glyph, heading wedge |
| Aging (2–6× poll interval) | Bold, `label` | waves static + small orange `clock` badge | "Updated 2 min ago" | Solid disc at 70% saturation, with "last seen" tail |
| Stale/lost (> 6× poll, or > 3 min) | Regular, `secondaryLabel` | `clock` | "Scheduled · live signal lost 4 min ago" | Hollow dashed ring (ghost), no heading |
| Scheduled only | Regular, `secondaryLabel` | `clock` | "Scheduled" | Hollow dashed ring at the interpolated scheduled position, or none |
- Meaning is carried by **weight + glyph + word**. Color only reinforces it, which satisfies `accessibilityDifferentiateWithoutColor` (twostraws) and HIG Color.
- Pick the waves symbol in the SF Symbols app. Candidates: `dot.radiowaves.right` or `wave.3.right`. Animate with variable color (iterative) on a 1.5s cycle, and keep it static under Reduce Motion. Stay far from about 0.2 Hz (5s) oscillations (HIG Motion, visionOS note, also a general comfort rule).

### B5. Staleness and "ghost bus" policy
- **Why:** BusBuddy has no TripUpdates, so the ETA is derived from position plus schedule progression. The UI must show its confidence.
- **Policy:** thresholds are relative to the feed cadence (data.gov.my positions refresh on the order of 30s; confirm against `gtfs-realtime-service`).
  - Under 2× cadence: live.
  - 2–6× cadence: live, with "updated N min ago" visible and orange.
  - Over 6× cadence: demote to scheduled presentation and say so.
  - A vehicle that hasn't moved for N polls while the schedule says it should have: label it "Bus may be stationary", which reuses the existing motion-status logic.
- **Do:** keep the last good content on screen while refetching (expo "four states"). Use `RefreshControl` only at the large detent.
- **Don't:** silently fill gaps with schedule data while keeping the live glyph. That is the ghost bus.

### B6. Route line, stops and vehicle markers
- **Map style:** `mapType="mutedStandard"` on iOS. HIG Maps: "The muted style … is great if you have a lot of information-rich content that you want to stand out".
- **Route polyline:** 6pt stroke in route color with a 2pt casing (white in light mode, `#000`/45% in dark mode) for contrast over roads and parks. **Segment already passed by the bus: 35% opacity.** Direction is shown with chevrons every ~120pt at high zoom only.
- **Stops:** 8pt `systemBackground` dots with a 2pt route-color ring. **Boarding stop:** 16pt, filled route color, white center, with a name label in caption1 semibold. Hide minor stop labels below zoom ~15 (HIG: "Adjust map detail based on the zoom level"). Cluster stop dots at low zoom.
- **Vehicles:** 30pt discs with a 2pt white border and `bus.fill` at 15pt semibold white. A heading wedge appears when bearing is known. **The next bus to your stop** gets a 36pt disc and a subtle pulse ring. Pulse it at most once per new fix (the "fresh data" cue), not continuously. Other buses on the route: 26pt, 60% opacity.
- **Movement:** glide the marker along the polyline from the previous fix to the new one over the poll interval (linear, dead-reckoned along the shape). On a jump larger than about 300m, or a gap over 2× cadence, crossfade (200ms) instead of sliding across town.
- **Don't:** use red pins, emoji, drop shadows on markers, or a tram icon for a bus (the current tab icon is `tram.fill`).

### B7. Trip stop timeline (large detent)
- **What:** a vertical list of stops on the active trip. A 4pt route-color rail runs down the leading edge. Passed stops are dimmed (tertiaryLabel, hollow node). The bus position is a bus glyph *between* nodes. Your stop is emphasised (headline weight, filled node, "Your stop" tag). Each row has its ETA on the trailing edge in tabular digits.
- **References:** Citymapper and Transit "stops away" lists, and Transit GO's Live Activity ticking down "the number of remaining stops" (*secondary*: MacStories).
- **Do:** auto-scroll so the bus row sits about a third from the top when the sheet reaches large. Do that once per open, not on every update. Rows use a plain or inset-grouped list background, not cards.
- **Don't:** use a card per stop, animate row insertions on every refresh, or put row entrance animations on a virtualized list (expo-animation).

### B8. Walk timer ("Leave now")
- **What:** in the glance detent, a single prominent filled capsule button under the hero: **"Leave in 6 min"**. That's a decision people make, so it's the primary action. Tapping it arms a reminder and starts the Live Activity. When the time arrives it flips to **"Leave now"**: systemOrange fill, one warning haptic plus a notification if backgrounded. Then it becomes **"Walking · 4 min to stop"** with a quiet countdown. If the bus will beat you, show **"You'll miss this one — next in 18 min"** (red text, no button color change).
- **Why:** "Simplicity — not minimalism … sometimes adding context simplifies" (WWDC26-250). The walk time turns the bus ETA into an action.
- **Do:** derive walk time from location when it's permitted. Otherwise use a value from settings, and say which one is in use ("4 min walk · from settings").
- **Don't:** offer more than one primary button in the sheet, or use a glass button inside the sheet content. Use a solid tinted fill: "apply color to the background rather than to symbols or text" (HIG Color).

### B9. Route switcher and favourites
- **What:** a top-leading glass capsule with the route badge and a chevron, opening a native `Menu`. Each favourite shows "Route + boarding stop". Below them: "Add Route…" and "Edit Favourites…".
- **Why:** this replaces the current RouteSwitcher row. Switching between favourites happens tens of times a day, so it uses a native menu with no custom animation (expo-animation gate).
- **Add Route flow:** a full-height form sheet. The search field sits at the bottom (iOS 26 convention for reachability), results are a list, then a stop picker shows the stop list for the chosen direction (a segmented control picks direction), then Done. Done is the single `.prominent` action, trailing (HIG Toolbars, Sheets).

### B10. Sheets that morph from buttons
- Settings opens from the More menu, or, if you prefer a button, from a glass button through a zoom transition (`Link.AppleZoom`, Expo SDK 55+). The sheet "springs from the action itself" (WWDC25-356). Use it for Settings and Add Route. Don't use it for the persistent trip sheet.

### B11. Live Activity / Dynamic Island
- **Compact:** leading is the route badge (`T816`, route-color capsule, white text, rounded semibold 13pt). Trailing is `4 min` (bold, tabular). Make both "read as a single piece of information" (HIG). Limited-width (28pt circle) version: `4m`.
- **Minimal:** the number only, `4`, in route color. "display updated information rather than just a logo" (HIG, Timer example).
- **Expanded / Lock Screen (14pt margins, 84–160pt high):** top row is route badge + stop name, trailing big minutes. Middle is the **stops-away line**: bus glyph on a 4pt rail with your stop as the terminal node, "3 stops away". Footer is "Live · updated 0:12 ago", or "Scheduled", or "Leave in 6 min".
- **Behaviour:** start on Walk-timer tap (or from an App Shortcut). Update only on meaningful change (HIG). Set `staleDate` = last fix + 3 min so the view can show "updating…" honestly (WWDC26-223). Alert only once, at "Leave now", plus optionally a Dynamic Island auto-expand when the bus is 2 stops away (*secondary*: Transit GO via MacStories). **End immediately** after the bus departs your stop, with a dismissal window of about 5 min. iOS 27 shows Live Activities in landscape, so handle `isDynamicIslandLimitedInWidth` (WWDC26-223).
- **Countdown rendering:** use the system timer text (`Text(timerInterval:countsDown:)`) against the predicted arrival date so it ticks without pushes. Push or broadcast an update only when the prediction moves by 1 min or more.

### B12. Dynamic Type and large-text layouts
- The hero scales up to `maxFontSizeMultiplier ≈ 1.25`, because it's already display-size. Everything else scales fully. At accessibility sizes, the glance detent snaps to large and the layout reflows vertically: number, then unit, then status, each on its own line. HIG: "aim to display as much useful text at the largest accessibility font size as you do at the largest standard font size."

### B13. Empty, error, offline and service-ended states (in the sheet; the map stays)
| State | Sheet content (glance detent) | Map | Notes |
|---|---|---|---|
| First launch, no favourite | `ContentUnavailable`-style: `bus` symbol, "Track your bus", "Pick a route and the stop you board at.", one button "Choose Route" | Centered on the user, or on KL | No onboarding carousel |
| Loading (first fetch, cache exists) | Show cached scheduled ETA immediately with "Scheduled"; crossfade to live when the first fix lands | Route + stops from cache | Never a spinner blink |
| Loading (no cache at all) | Skeleton of the hero (number block + 2 lines), no shimmer under Reduce Motion | Route skeleton hidden | Only on cold first-ever load |
| No live buses, service running | Scheduled presentation (B4) + "No live buses reporting on T816 right now." | Ghost markers at scheduled positions, or none | Honest copy |
| Service ended today | `moon.zzz` symbol, "No more buses today", "First bus tomorrow 6:10 from Stop X" (tabular), button "Remind Me" | Route dimmed to 35% | Uses quiet-hours logic |
| Before first bus | "First bus at 6:10" as the hero in clock time, plus "in 47 min" | Normal | |
| Bus just left / missed | "Missed by 1 min · next in 18 min" as a one-line banner above the hero for 60s, then normal | | Red text only here |
| Offline | Small capsule under the status line: `wifi.slash` "Offline — showing timetable". Hero switches to scheduled | Cached tiles, last positions as ghosts | No modal alert |
| API error (5xx, rate limit) | Same as offline, but "Can't reach live data — retrying" (with backoff) | | Retry is automatic; no button unless it fails for more than 2 min |
| Location denied | Walk timer shows "Set walk time" (inline link to Settings) | No user dot | Ask in context, not at launch |
| Notifications denied | Walk button still works in-app; footnote "Turn on notifications to get Leave-now alerts" | | Replaces the NotifDeniedChip |

---

## (c) Tokens (concrete)

### C1. Color (semantic first; brand set of 1)
| Token | iOS value | Use |
|---|---|---|
| `label` / `secondaryLabel` / `tertiaryLabel` | `Color.ios.*` | Text hierarchy |
| `background` | `systemBackground` (map screen); sheet has none (system glass) | |
| `groupedBackground` / `secondaryGrouped` | system grouped set | Settings, timeline list at large detent |
| `separator` | `separator`, hairline width | Lists only |
| `accent` | GTFS `route_color` if present and passing 3:1 against both backgrounds; else `systemBlue` | Primary button fill, route line, badge, selected states |
| `onAccent` | `#FFFFFF` (or `route_text_color`) | |
| `live` | `systemGreen` | Waves glyph only |
| `warning` | `systemOrange` | Stale badge, "Leave now" fill, late text |
| `critical` | `systemRed` | Missed / error text only |
- Delete the parallel palettes (`heroStateColor`, `delayStatusColor`, `trendColor`, `amberTint`, `blueTint`). Five state colors on one screen is the "tint everything" anti-pattern.
- Status colors in Reanimated: static hex pairs are fine (PlatformColor can't cross into worklets), but add light, dark and increased-contrast variants (HIG Color).
- Don't use Rapid KL branding or logos. The app is not Prasarana's, and a lookalike would read as impersonation. Route color from GTFS is data, not branding.

### C2. Typography (SF Pro; SF Pro Rounded for numerals)
| Role | Size/leading (default Large) | Weight | Notes |
|---|---|---|---|
| Hero number | 88/88 | Bold | Rounded design (`fontFamily: 'ui-rounded'` on iOS; verify on SDK 58), `tabular-nums`, tracking −2% |
| Hero unit "min" | 22 (title2) | Semibold | `secondaryLabel`, baseline-aligned |
| Sheet title (route + stop) | 22 (title2) | Bold | Left-aligned (WWDC25-356 "bolder, left-aligned") |
| Section header | 17 (headline) | Semibold | No ALL CAPS |
| Body / row title | 17 | Regular | |
| Status line | 15 (subheadline) | Medium for "Live", Regular otherwise | |
| Row ETA | 17 | Semibold | `tabular-nums` |
| Footnote / attribution | 13 | Regular | `secondaryLabel` |
| Caption (map labels) | 12 | Semibold | Minimum on map; never below 11 |
- HIG: avoid Ultralight/Thin/Light. Weight carries hierarchy. Don't use `caption2` except for legal text.
- Live Activity: medium weight or heavier, large numerals (HIG Live Activities).

### C3. Spacing (4pt grid)
`xxs 4 · xs 8 · sm 12 · md 16 · lg 20 · xl 24 · xxl 32 · xxxl 44`
- Screen and sheet horizontal margin: **16** (the current 20 makes rows look indented next to system list insets; 20 is only for very wide layouts).
- Floating controls: **16** from the safe-area edges; 8 between clusters.
- Gaps: hero to status line 4; status to secondary line 4; hero block to walk button 20; section to section 32; row vertical padding 12 (44pt minimum row height).
- Separate proximity levels: row gap < group gap < section gap (expo "16-Everything" tell).

### C4. Corner radius (concentric)
| Element | Radius |
|---|---|
| Glass control buttons | circle (44–48pt) |
| Glass clusters / route capsule | capsule (h/2) |
| Sheet | system-managed (don't override) |
| Content group inside sheet (e.g. timetable group) | `ConcentricRectangle`-equivalent: sheet radius − 16 inset. Fall back to **20** when you can't read the system value |
| List rows / thumbnails | 12 |
| Chips / badges (route badge) | capsule |
| Map markers | circle |
- Always `borderCurve: 'continuous'` except on capsules and circles.

### C5. Elevation
- No shadows on glass. Content cards inside sheets get none either (use grouping and background).
- Markers: `0 1px 2px rgba(0,0,0,0.25)` only (map contrast, HIG Maps: "thin stroke or light drop shadow").

### C6. Motion
| Token | Reanimated | SwiftUI equivalent | Use |
|---|---|---|---|
| `press` | CSS transition 120ms, `cubicBezier(0.23,1,0.32,1)`, scale 0.97 | — | Custom buttons only (rows highlight, they don't scale) |
| `state` | 180ms ease-out | `.smooth(duration: 0.18)` | Toggles, badge swaps, color/weight change live→scheduled |
| `number` | Per-digit roll 350ms ease-out (or `withSpring({duration: 350, dampingRatio: 1})`) | `.contentTransition(.numericText(countsDown: true))` + `.smooth` | Hero digits, row ETAs |
| `reposition` | `withSpring({duration: 400, dampingRatio: 1})` | `.smooth(duration: 0.4)` | Camera re-frame UI, layout shifts |
| `sheet` | native detents (don't override); custom: `{duration: 300, dampingRatio: 0.8, velocity}` | `.spring(response: 0.3, dampingFraction: 0.8)` | Drawer-like surfaces |
| `snapBack` | `{duration: 400, dampingRatio: 0.8, velocity}` | `.snappy` (bounce ≈ 0.15) | After a drag only |
| `marker` | linear over the poll interval along the polyline | — | Bus glide |
| `crossfade` | 200ms opacity | `.opacity` transition | Marker teleport, offline swap, Reduce Motion replacement |
| `pulse` | 1.5s cycle, once per fresh fix (single ring 1.0→1.6 scale, 0.35→0 opacity) | `symbolEffect(.variableColor.iterative)` | Live waves, new-fix ring |
- Reduce Motion: drop translation, scale, roll and pulse, and keep opacity/color changes (expo-animation; HIG). Numbers swap with a 150ms crossfade. Markers jump with a crossfade.
- Never use `ease-in` on UI, and never `scale(0)` (expo-animation).

### C7. Haptics (expo-haptics; one per user action, same frame as the visual)
| Moment | Haptic |
|---|---|
| Sheet detent snap (user drag) | none if native (system handles it); custom: `impactAsync(Light)` |
| Route switched from menu | `selectionAsync()` |
| Favourite added / Live Activity started | `notificationAsync(Success)` |
| "Leave now" fires while app is foreground | `notificationAsync(Warning)` (+ banner/Live Activity alert if backgrounded) |
| Bus status becomes "Arriving" at your stop (only if walk timer or Live Activity active) | `impactAsync(Medium)` once |
| Error that blocks the task (can't add favourite) | `notificationAsync(Error)` |
| Countdown minute ticks, data refresh, marker updates, scrolling | **never** |
- Native `Switch`, pickers and menus already play haptics: "don't add extra" (expo-native-ui).

---

## (d) Anti-patterns (each mapped to the current codebase where seen)

1. **Glass in the content layer.** `glassTokens` for "live card, timetable chips, and islands" → make them content (grouped fills). (HIG Materials; WWDC25-219)
2. **Glass on glass.** Glass cards inside the glass sheet. (WWDC25-219)
3. **Tinting everything / rainbow states.** Five color maps for one status. (WWDC25-219; HIG Color)
4. **Color-only meaning.** A green/amber/red dot as the only live/delay cue (`StatusDot`, `LiveDot`). Add glyph + word. (HIG Accessibility)
5. **Decorative backdrop.** `AuroraBackdrop` ("Purple-Gradient Hero", expo native-slop #4). Expression belongs to the content: the route color on the map.
6. **Bento / Everything's a Card.** `LiveTrackBento`, `JourneyCard`, `CurrentBusCard` → one hero block plus grouped lists. (expo native-slop #7)
7. **Two places for one object.** Separate Tracker and Map tabs. Plus a demo tab shipped in navigation.
8. **Wrong glyph.** `tram.fill` for a bus app → `bus.fill`.
9. **Progress rings and sparklines on the hero** (`ProgressRing`, `ApproachTrendChart`). This is decoration that competes with the number, and the trend chart is unexplained telemetry. If a trend matters, say it in words: "Bus is stuck in traffic".
10. **False precision.** Seconds on predicted ETAs, or exact minutes on scheduled data presented as live.
11. **Ghost buses.** A scheduled fallback that keeps the live glyph or a solid marker.
12. **Spinner blink / skeleton everywhere.** Many `*Skeleton.tsx` files suggest skeletons appear on every refetch. Show them on the cold first load only, and keep stale content while revalidating.
13. **Grand entrance.** Staggered fade-ins on every focus. (expo native-slop #14)
14. **Squish reflex.** Scale-on-press on full-width rows. (expo native-slop #13)
15. **Hand-rolled chrome.** Custom tab bars or headers instead of NativeTabs or the stack. Custom backgrounds behind toolbars (they kill the scroll edge effect).
16. **Animating glass opacity**, or `overflow: hidden` on glass ancestors (clips the rim and bulge).
17. **Haptics on data refresh** or minute ticks.
18. **Pulsing forever.** Continuous scale pulses on markers or dots. They're distracting and drain battery, and they amount to "pulse to look alive" theatre.
19. **Hard dividers under floating chrome.** Use the system scroll edge effect.
20. **Hiding the map attribution permanently** under the sheet (HIG Maps).
21. **Live Activity that lingers** after the bus has left, or alerts on every update. (HIG Live Activities)
22. **Tinted custom glass that ignores the iOS 27 transparency slider.** Test at "clear" and "tinted".

---

## (e) Proposed IA and screen concept

### E1. Map-first vs tracker-first: decision
**Recommendation: one map-backed screen with a tracker-first sheet** (the Apple Maps / Find My pattern), defaulting to the glance detent where the countdown is the dominant element.

| Criterion | Tracker-first (tabs: Tracker / Map) | Map-backed single screen (recommended) |
|---|---|---|
| Glance task ("when is my bus?") | Excellent | Excellent: hero is in the sheet at the default detent |
| Trust ("is it real?") | Needs a tab switch to see the bus | Bus approaching is visible at the same time as the number |
| Duplication | Same data in 2 tabs, 2 sets of states | One object, one set of states |
| HIG fit | Tab bar used for two views of one thing, not sections | Nonmodal sheet "affects the parent view" (HIG Sheets) |
| Liquid Glass showcase | Glass only in the tab bar | Sheet + 2 control clusters: chrome over content, as intended |
| Cost | Cheaper (map not mounted at launch) | Map mounts at launch, so keep annotations few and markers lightweight |
| Risk in RN | Low | Medium: needs a reliable non-dismissable multi-detent sheet over a map (Expo Router `formSheet` + `sheetLargestUndimmedDetentIndex`, or `@expo/ui` BottomSheet). **Spike this first.** |

Why not pure map-first, where the map dominates and the number lives in a small card? The core job is temporal ("how long?"), not spatial ("where?"). People glance in 1–2 seconds and want the number before they want geography. The glance detent gives the number about 50% of the screen and the map gets the other 50% as evidence. **Fallback:** if the sheet spike fails on device, ship tracker-first without tabs and with a map preview (a 160pt non-interactive map snapshot in the content that zooms into a full map screen through `Link.AppleZoom`). Same content hierarchy, same states.

### E2. Information architecture
```
Root (no tab bar)
└─ Map canvas  ─────────────────────────────────────────────┐
   ├─ [top-leading] Route switcher capsule ▸ Menu            │ glass (chrome)
   │     • favourites (route · stop) • Add Route… • Edit…    │
   ├─ [top-trailing] Cluster: Recenter │ More ▸ Menu          │
   │     • Settings… • Map style (Muted/Standard/Satellite)   │
   │     • Share ETA • About data                            │
   └─ Trip sheet (persistent, nonmodal, glass by system) ────┘
         peek   : route badge · "4 min" · Live/Scheduled · stop name
         glance : hero countdown · status · next buses · Walk button
         large  : + trip stop timeline · today's timetable at my stop
                  · Live Activity toggle · route info/attribution
Modal (form sheet, zoom from source)
   • Add Route  → search (bottom field) → direction + stop picker → Done
   • Settings   → grouped list (Favourites · Walking · Alerts ·
                  Live Activities · Display · About & data)
System surfaces
   • Live Activity / Dynamic Island  • Lock Screen widget (inline: "T816 · 4 min")
   • Notifications (Leave now only)  • App Shortcut: "Track my bus"
```

### E3. Screen by screen

**1. Trip, glance detent (default; the app opens here)**
- **Map (top ~50%):** auto-framed to fit [next bus, boarding stop, user if within 1km] with 48pt padding on top and sides, sheet-aware bottom inset. Muted map style. Route line with the passed section dimmed. Stops, the boarding stop emphasised, buses.
- **Chrome:** route capsule `T816 ⌄` top-leading; `[◎][…]` cluster top-trailing.
- **Sheet:**
  - Grabber.
  - Title row: "Taman Melawati → Stop name" (title2 bold). The trailing info button is optional. Skip it unless needed.
  - Hero: `4 min`.
  - Status: `〰 Live · 3 stops away · 12s ago`.
  - Next: `Then 18 · 34 min`.
  - Primary button: `Leave in 6 min`, full width minus 16 margins, 50pt capsule, accent fill.
  - Footnote: `4 min walk · from your location`.
- **Choreography on open:** none. Cached content renders instantly. When the first live fix arrives: the digits roll (350ms) only if the value changed, the waves glyph appears (symbol appear effect, 200ms), and the scheduled→live weight change takes 180ms. No haptic.
- **On each fix:** if the minute value changes, the number rolls. The marker glides. The "12s ago" text updates without animation. The fresh-fix ring pulses once on the bus marker. Under Reduce Motion: crossfade only, no ring.

**2. Trip, peek detent**
- One row, 56pt: `[T816] 4 min 〰 · Stop name`. Tapping the row or dragging up returns to glance. The map gets the full height and the camera re-frames to the route extent (reposition spring, 400ms, damping 1). Use this when people want to look at the bus.

**3. Trip, large detent**
- The sheet becomes opaque (system behaviour). The hero compacts into the title area: number at 34pt bold rounded inline with the title. Implement it as a **cross-fade between two layouts keyed to detent**, not an animated font size.
- Sections:
  1. **This trip:** stop timeline (B7). Auto-scroll once so the bus is visible.
  2. **Today at [stop]:** a timetable grid of departure times, tabular, 4 per row, past times in tertiaryLabel, the next one emphasised, the live-matched trip marked with a waves glyph.
  3. **Live Activity:** toggle "Show on Lock Screen".
  4. **About this route:** operator, data source "data.gov.my GTFS (Prasarana)", last static update date.
- Scroll edge effect at the top (system). No custom header background.

**4. Route switcher (menu)**
- Native menu anchored to the capsule. It morphs out of the glass capsule automatically. Items: `T816 · Stop A` (checkmark on current), `T815 · Stop B`, divider, `Add Route…` (`plus`), `Edit Favourites…` (`pencil`). Selecting one fires `selectionAsync`, the sheet content crossfades (180ms), and the camera re-frames (400ms). The previous data stays until the new data arrives, which avoids a spinner blink.

**5. Add Route (form sheet, large, zoom from the "Add Route…" source)**
- Step 1: the search field sits at the bottom, iOS 26 style, and is focused on open. Results list: route badge, long name, "Feeder · Rapid KL" in secondary. Empty query shows "Nearby routes" when location is permitted.
- Step 2 (push within the sheet): a segmented control picks direction (2 options, named by terminus). Below it, the stop list in order, with the nearest stop marked `location.fill` "Nearest". Tap selects with a checkmark.
- Done (prominent, trailing) saves, fires `Success` haptic, dismisses, and the trip sheet shows the new route. Cancel is leading (HIG Sheets).

**6. Settings (form sheet from More ▸ Settings)**
- An `@expo/ui` List (inset grouped):
  - **Favourites:** reorder and delete.
  - **Walking:** "Use my location" toggle, plus walk time to each stop (stepper, minutes) as fallback.
  - **Alerts:** "Leave-now alerts" toggle; "Alert me N min before" (picker 1/2/3/5); quiet hours (existing logic).
  - **Live Activities:** "Start automatically when I tap Leave" toggle.
  - **Display:** "Show times as" (Minutes / Clock time) and map style.
  - **About & data:** source, licence, last refreshed, version.
- No custom colors. Native switches (built-in haptics).

**7. Live Activity**
- See B11. Lock Screen layout:
  ```
  [T816]  Stop name                              4 min
  ●━━━━━━━━━━🚌━━━━━━━━━━━━━━━━━━○ 3 stops away
  〰 Live · updated 0:12 ago              Leave in 2 min
  ```
- Leave-now alert: expands in the Dynamic Island with "Leave now · 4 min walk".

### E4. Interaction × motion × haptics matrix
| Interaction | Visual response | Spec | Haptic |
|---|---|---|---|
| Launch | Cached state, instant | none | none |
| Live fix arrives | Digit roll if changed; marker glide; one ring pulse | number/marker/pulse tokens | none |
| Live→stale | "Updated N min ago" turns orange; badge appears | state 180ms | none |
| Stale→scheduled | Weight bold→regular, glyph waves→clock (replace), marker solid→ghost (crossfade) | state 180ms + crossfade 200ms | none |
| Drag sheet between detents | Native; camera re-frames after settle | reposition 400ms | system |
| Pan map | Auto-follow stops; Recenter glyph swaps `location.fill`→`scope` (magic replace) | symbol replace | none |
| Tap Recenter | Camera re-frames; glyph swaps back | reposition 400ms | none |
| Switch route | Content crossfade; camera re-frame | 180ms / 400ms | selection |
| Tap "Leave in 6 min" | Button label → "Reminder set · 6 min"; Live Activity starts | state 180ms | success |
| Leave-now moment | Button fill → orange, label "Leave now" (bounce symbol `figure.walk` once) | state 180ms + symbol bounce | warning |
| Bus "Arriving" at your stop | Hero text "Arriving"; marker reaches stop node | number roll | medium impact (only if timer/LA active) |
| Bus departed your stop | Hero rolls to the next bus; "Missed by…" banner if the user was walking | number roll; banner slide-down 250ms ease-out (fade under RM) | none |
| Offline | Capsule "Offline — showing timetable" fades in | 200ms | none |
| Add favourite (Done) | Sheet dismisses (native); new route shows | native | success |
| Pull to refresh (large detent) | `RefreshControl` | native | system |

### E5. VoiceOver and accessibility spec
- **Hero element (single combined element):** label "Route T816 to Stop Name"; value "Next bus in 4 minutes. Live, updated 12 seconds ago. 3 stops away." Add the `updatesFrequently` trait (Deque, useyourloaf).
- **Announcements:** only at threshold crossings (10, 5, 2 and 1 min, Arriving, Leave now, source change live↔scheduled), and never on every tick.
- **Marker accessibility:** "Bus, 3 stops from your stop, live". Ghost: "Scheduled bus position, not live".
- **Icon-only glass buttons need text labels** ("Recenter map", "More"). Route capsule: "Route T816, Stop Name. Switch route" with button trait and a hint.
- **Differentiate Without Color:** already satisfied by B4. With Increase Contrast, the route line casing goes to 3pt and the stale badge gets a border.
- **Reduce Transparency:** the system glass frosts. Custom glass falls back to solid `secondarySystemBackground`.
- **Large text:** see B12. Every row grows in height and none truncate ETAs.
- **Voice Control:** `accessibilityInputLabels` on the walk button ("Leave", "Walk timer"), because its label changes (twostraws).

### E6. Implementation notes for Expo SDK 58 (verify on device)
- Sheet: Expo Router `presentation: 'formSheet'`, `sheetAllowedDetents: [0.18, 0.5, 1]`, `sheetLargestUndimmedDetentIndex: 1`, initial detent glance, grabber visible, transparent `contentStyle` so the iOS 26 glass shows. Make it non-dismissable (test `gestureEnabled: false`). Alternative: the `@expo/ui` `BottomSheet` (SwiftUI) if it exposes background interaction and dismiss-disabled.
- Glass controls: `expo-glass-effect` `GlassView isInteractive` inside `GlassContainer`; guard with `isLiquidGlassAvailable() && isGlassEffectAPIAvailable()`; Reduce Transparency means solid.
- Map: `react-native-maps` on Apple Maps with `mapType="mutedStandard"`, `legalLabelInsets` tied to the current detent, and `showsCompass={false}` unless rotated.
- Menus: Expo Router `Link.Menu` / `@expo/ui` `Menu`. Zoom transitions: `Link.AppleZoom`.
- Live Activity: `expo-widgets` (already a dependency); system timer text for the countdown; `staleDate`.
- 120Hz: confirm `CADisableMinimumFrameDurationOnPhone` (expo-animation).

### E7. Using appllama.io (blocked here; manual checklist for the designer)
Appllama is a library of 25,000+ (now ~28,600) screens from 600–700+ top-earning iOS apps, with flows such as onboarding, home and paywalls, and element, color and font inspection (*secondary*: chatgate.ai, productdirs, launly). There was also a TypingMind listing for an "Appllama App Design Skill" aimed at RN/Expo screens. I couldn't reach either. When browsing it manually, collect:
1. Map apps with bottom sheets (Apple Maps-like). Note the peek-detent content and how the hero survives at the medium detent.
2. Countdown and timer heroes: number size relative to screen width, unit placement, and how live vs estimate is labelled.
3. Empty states for "nothing scheduled", e.g. "No more today".
4. Live Activity lock-screen layouts from travel, delivery and rideshare apps (progress line patterns).
5. Search-at-bottom flows on iOS 26.
Compare, don't copy. Appllama's own guidance stresses comparison over copying (*secondary*).

---

## Sources

**Apple (first-party, fetched)**
- Meet Liquid Glass, WWDC25-219: https://developer.apple.com/videos/play/wwdc2025/219/
- Get to know the new design system, WWDC25-356: https://developer.apple.com/videos/play/wwdc2025/356/
- Animate with springs, WWDC23-10158: https://developer.apple.com/videos/play/wwdc2023/10158/
- Principles of great design, WWDC26-250: https://developer.apple.com/videos/play/wwdc2026/250/ (summarised via emilkowalski/skills `apple-design`)
- Communicate your brand identity on iOS, WWDC26-251: https://developer.apple.com/videos/play/wwdc2026/251/
- Live Activities essentials, WWDC26-223: https://developer.apple.com/videos/play/wwdc2026/223/
- WWDC26 Platforms State of the Union Recap, 122: https://developer.apple.com/videos/play/wwdc2026/122/
- HIG pages (fetched as JSON): Materials https://developer.apple.com/design/human-interface-guidelines/materials · Sheets …/sheets · Tab bars …/tab-bars · Toolbars …/toolbars · Color …/color · Motion …/motion · Playing haptics …/playing-haptics · Maps …/maps · Live Activities …/live-activities · Typography …/typography · Accessibility …/accessibility · SF Symbols …/sf-symbols · Loading …/loading · Layout …/layout
- SwiftUI docs: `Animation.smooth(duration:extraBounce:)` https://developer.apple.com/documentation/swiftui/animation/smooth(duration:extrabounce:) · `spring(response:dampingFraction:blendDuration:)` https://developer.apple.com/documentation/swiftui/animation/spring(response:dampingfraction:blendduration:) · `ContentTransition.numericText(countsDown:)` https://developer.apple.com/documentation/swiftui/contenttransition/numerictext(countsdown:)

**GitHub / skills (cloned and read)**
- expo/skills (local clone): `expo-design-system` (SKILL.md, references/native-slop.md), `expo-native-ui` (SKILL.md, visual-effects, controls, icons), `expo-animation` (SKILL.md, RECIPES.md), `expo-router` references (tabs, form-sheet, zoom-transitions, toolbar-and-headers)
- emilkowalski/skills (`apple-design`, `mobile-native`, `animate-expo`): https://github.com/emilkowalski/skills
- conorluddy/LiquidGlassReference: https://github.com/conorluddy/LiquidGlassReference
- AvdLee/SwiftUI-Agent-Skill (`references/liquid-glass.md`): https://github.com/AvdLee/SwiftUI-Agent-Skill
- twostraws/SwiftUI-Agent-Skill (`swiftui-pro/references/design.md`, `accessibility.md`): https://github.com/twostraws/SwiftUI-Agent-Skill
- Dimillian/Skills (`swiftui-ui-patterns/references/haptics.md`): https://github.com/Dimillian/Skills
- ehmo/platform-design-skills (`skills/ios`): https://github.com/ehmo/platform-design-skills
- callstack/liquid-glass: https://github.com/callstack/liquid-glass · GonzaloFuentes28/LiquidGlassCheatsheet: https://github.com/GonzaloFuentes28/LiquidGlassCheatsheet · mertozseven/LiquidGlassSwiftUI: https://github.com/mertozseven/LiquidGlassSwiftUI

**Secondary (via search summaries; the sites themselves were blocked)**
- iOS 27 Liquid Glass changes: https://www.macrumors.com/2026/06/10/how-liquid-glass-is-changing-in-ios-27/ · https://www.tomsguide.com/phones/iphones/ios-27-has-a-bunch-of-changes-including-a-refined-liquid-glass-design-but-how-much-has-changed-from-ios-26 · https://www.techtimes.com/articles/317975/20260608/apple-liquid-glass-ios-27-wwdc-2026-brings-refinements-developers-must-adopt-today.htm
- Transit app real-time waves and grey scheduled: https://help.transitapp.com/article/93-how-to-use-transit · https://theurbanist.org/2019/04/19/transit-app-improves-real-time-arrival-info-including-for-community-transit · GO / Live Activities: https://help.transitapp.com/article/104-get-notifications-about-your-trip-with-go · MacStories on Transit's Dynamic Island: https://macstories.net/?p=74916
- Google Maps live colors: https://bgr.com/2222643/google-maps-eta-time-color-meaning-explained/ · https://www.perkins.org/resource/google-maps-bus-and-train-stations/ · https://lowyat.net/2020/215359/google-maps-rapid-kl-bus-real-time-update
- Apple Maps live-data icon (single source): https://www.letemsvetemapplem.eu/?p=765591
- Transit app comparison 2026: https://unstar.app/blog/transit-citymapper-moovit-google-maps-trainline-public-transit-apps-ranked-2026
- Citymapper critiques: https://ixd.prattsi.org/2026/02/design-critique-citymapper-ios-app/ · https://ixd.prattsi.org/2019/02/design-critique-citymapper-iphone-app/
- Ghost buses and trust: https://blog.optibus.com/anatomy-of-a-ghost-bus · https://stateline.org/2023/01/31/ghost-buses-haunt-transit-agencies-and-frustrate-riders/ · https://camsys.software/blog/how-to-avoid-ghost-buses-and-other-pitfalls-of-using-real-time-bus-data · https://www.goswift.ly/blog/eta-completeness-benchmark
- Bus-times UX research: https://www.lab.mobi/blog/more-than-a-timetable-what-ux-research-on-a-bus-times-app-revealed-about-commuting
- VoiceOver for updating content: https://www.deque.com/blog/ios-updating-content/ · https://useyourloaf.com/blog/voiceover-for-frequently-updating-data/
- Appllama: https://appllama.io (blocked) · https://chatgate.ai/post/appllama · https://productdirs.com/projects/appllama · https://www.typingmind.com/skills/appllama-appllama-app-design-skill (blocked)
- Liquid Glass overview: https://css-tricks.com/getting-clarity-on-apples-liquid-glass/ · https://www.createwithswift.com/exploring-a-new-visual-language-liquid-glass/
