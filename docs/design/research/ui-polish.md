# BusBuddy UI polish: legibility, sheet layout, map markers, empty states

*Research date 2026-10-20. Scope: five problems seen on device (iOS 27, dark mode, satellite map). This builds on the earlier reports (`ios26-design-research.md`, `award-winning-ios-apps.md`, `expo-native-capabilities.md`) and does not repeat them.*

**Evidence tags:**
- **[HIG]/[WWDC]/[DOC]:** Apple primary source, read in full.
- **[CODE]:** verified in this repo or in `node_modules`.
- **[S]:** search-result snippet only. expo.dev, transitapp.com, citymapper.com, 9to5mac, techcrunch and support.google.com all failed DNS from the sandbox.
- **[OBS]:** common pattern I observed in the apps, not documented anywhere. Check it against a screenshot.
- **[REC]:** my recommendation.

---

## A. Legibility on Liquid Glass sheets over a map

### What Apple does
| Surface | Partial detents | Full height | Map dimming |
|---|---|---|---|
| System sheet (Maps, Find My, any `.sheet`) | Inset, floating **Liquid Glass**. "At smaller heights, the bottom edges pull in" [WWDC 25-323] | "the glass background gradually transitions, becoming opaque and anchoring to the edge of the screen" [WWDC 25-323]. "When focus shifts, like dragging a sheet upward, Liquid Glass subtly recedes, becoming more opaque" [WWDC 25-356] | None for parallel tasks. Dimming is only for modal tasks: "When a task interrupts the main flow, pair Liquid Glass with a dimming layer" [WWDC 25-356] |
| Glass size | "A larger size is more opaque. A smaller size is clearer" [WWDC 25-284] | | |
| Variant | Sheets and most system parts use **regular**: it "blurs and adjusts the luminosity of background content to maintain legibility… Use the regular variant… when components have a significant amount of text". Use **clear** only "over visually rich backgrounds" such as photos and video, with a 35% dimming layer if the content is bright [HIG Materials] | | |
| Weather-style cards | Content sits on a standard material (ultraThin to thick). "Thicker materials, which are more opaque, can provide better contrast for text" [HIG Materials] | | |
| iOS 27 | Glass "more effectively diffuses complex content", with darker edges and brighter specular highlights. A user slider runs from ultra-clear to fully tinted. iOS 26.1 already added Clear/Tinted [S: MacRumors, TechRadar, TidBITS] | | |

### Why our text fails: no vibrancy
Text inside system glass is legible because the system makes it **vibrant**. "To add content… use the visualEffectView's contentView. The label automatically becomes vibrant, based on its textColor" [WWDC 25-284]. SwiftUI likewise "automatically uses a vibrant text color" inside a glass effect [WWDC 25-323].

React Native `<Text>` in a form sheet does not sit in that `contentView`. **[CODE]** `PlatformColor('secondaryLabel')` therefore comes out as a fixed grey: `#EBEBF5` at 60% alpha in dark mode, `#3C3C43` at 60% in light mode. Over glass that is showing a bright satellite tile, that grey has no adaptive contrast.

Two lines in the app are already below the minimum on any glass:
- the scheduled hero uses `secondaryLabel`
- the "about" footnote uses `tertiaryLabel` (30% alpha, so 1.8–2.5:1)

The HIG warns that `quaternaryLabel` is too low-contrast even on real vibrant materials [HIG Materials].

### Contrast numbers (WCAG)
Thresholds from [HIG Accessibility]: up to 17pt needs **4.5:1**; 18pt and up, or bold, needs **3:1**. The backdrops below are assumed effective colours behind the text, computed in `scratchpad/contrast.py`.

| Text colour (dark mode) | Dark glass `#262628` | Glass over bright satellite `#48484A` | Worst case `#636366` |
|---|---|---|---|
| `label` (white) | 15.1 | 9.1 | 6.0 |
| white at 80% | 10.2 | 6.6 | **4.5** |
| white at 75% | 9.1 | 6.0 | 4.2 |
| `secondaryLabel` (60%) | 5.6 | 3.9 | **2.9 ✗** |
| `tertiaryLabel` (30%) | 2.5 ✗ | 2.1 ✗ | 1.8 ✗ |
| `systemGreen` `#30D158` | 7.5 | 4.5 | 3.0 |
| `systemBlue` `#0A84FF` | 4.1 | 2.5 ✗ | 1.6 ✗ |

In light mode, `secondaryLabel` measures only **3.3–3.4:1** even on solid `#F2F2F7` or white. `systemGreen` `#34C759` on white is **2.2:1**, so it must never carry text. Use green for glyphs only.

### Rules [REC]
1. **Keep the system glass at peek and glance. Do not add a full custom background.** Apple says to remove `presentationBackground` [WWDC 25-323]. Large becomes opaque by itself.
2. **Use two text levels on glass, not four:**
   - `label` for anything people read: hero, titles, times, stop names.
   - `sheetSecondary` for metadata: white at **80%** (dark), black at **70%** (light), plus Increase Contrast variants at 100%.
   - Never use `tertiaryLabel` or `quaternaryLabel` for text in the sheet. They are fine for disabled glyphs.
3. **Add a legibility plate for satellite and hybrid maps.** Put a content-layer plate behind the sheet content at partial detents:
   - `secondarySystemBackground` (`#1C1C1E`) at **70%** opacity in dark mode, `#FFFFFF` at 70% in light mode.
   - Crossfade it out over 200ms when the sheet reaches large.
   - Over the worst-case backdrop this lifts `secondaryLabel` from 2.9 to **5.0:1**.
   - This follows the HIG's "thicker material" advice, applied in the content layer, so it is not a custom sheet background.
   - With `mutedStandard`, skip the plate.
4. **Reduce Transparency:** treat it like satellite mode and use a 100% opaque plate.
5. **Test on device:** the iOS 27 slider at both ends, Clear vs Tinted, and Reduce Transparency, all over satellite imagery of KL (bright roofs and roads).

### The scheduled hero [REC]
Transit greys out scheduled times ("faded"), with "two pulsating waves" marking real time [S: Transit help center]. That works on Transit's **opaque** list and fails on glass.

Google Maps draws non-live times in **black, not grey**. Green means on-time live and red means early or late [S: Google support page via TimeOut LA]. Apple Maps marks live times with a small green "wifi-like" glyph [S: letemsvetemapplem].

So the convention is that the **glyph** carries the difference, not a grey number.

| | Live | Scheduled |
|---|---|---|
| Number | 88pt SF Rounded **Bold**, `label` | 88pt SF Rounded **Regular** (or Medium), `label`. Not grey. It passes 3:1 at any size |
| Unit "min" | 22pt Semibold, `sheetSecondary` | same |
| Status glyph | `dot.radiowaves.left.and.right`, 15pt, `systemGreen`, variable colour | `clock`, 15pt, `sheetSecondary` |
| Status word | "Live · 3 stops away", 15pt Semibold, `label` | "Scheduled", 15pt Semibold, `label`, plus "No live buses reporting" in 15pt Regular `sheetSecondary` |

If a lighter scheduled hero is wanted, the floor is white at 80% in dark mode (≥4.5 worst case) or black at 70% in light mode.

---

## B. Sheet layout specs

### Type scale
Use the HIG Large (default) sizes [HIG Typography]:

| Style | Size / leading | Weight |
|---|---|---|
| Large Title | 34/41 | Regular (Bold when emphasised) |
| Title 1 | 28/34 | Regular |
| Title 2 | 22/28 | Regular |
| Title 3 | 20/25 | Regular (Semibold) |
| Headline | 17/22 | Semibold |
| Body | 17/22 | Regular |
| Callout | 16/21 | Regular |
| Subheadline | 15/20 | Regular |
| Footnote | 13/18 | Regular |
| Caption 1 | 12/16 | Regular |
| Caption 2 | 11/13 | Regular |

The minimum is 11pt. Avoid Ultralight, Thin and Light.

### Spacing and geometry [REC, grounded where noted]
| Token | Value | Notes |
|---|---|---|
| Horizontal margin | **16pt**, or **20pt** when the window is 430pt wide or more (Pro Max) | UIKit `layoutMargins` default. Use one value for every row, header and group in the sheet |
| Content top, below the grabber | 14–16pt | The grabber is system-drawn. Keep `sheetGrabberVisible` on (HIG: it works with VoiceOver) |
| Header row | min **52pt** | Route badge capsule **28pt** tall (radius 14, 15pt Bold Rounded) · gap 12 · title 17 Semibold `label` (1 line) over 13–15pt `sheetSecondary` · trailing compact ETA 17 Semibold tabular. Trailing buttons are 30–32pt circles, 44pt hit area |
| Hero block | hero → status 4 · status → "Then…" 4 · block → primary action **20** | |
| Primary action | Capsule, **50pt** tall, full width minus margins | |
| Section → section | **28–32** | |
| Section title → group | **8** | Title 3 Semibold 20pt, sentence case, no caps |
| Grouped row | min **44pt** (52pt matches iOS 26 Settings [OBS]) · padding 12 vertical / 16 horizontal | |
| Group radius | **20–26pt** continuous | In iOS ≤18 inset-grouped used ~10pt. On iOS 26 a one-row section is "almost the shape of a capsule" [Apple forum 798726], so the system radius is now much larger. Use 20 (README token) and keep inner shapes concentric: inner = outer − inset |
| Group fill | `secondarySystemFill` (not today's `tertiarySystemFill`, which is 12% and too faint on glass). At large, `secondarySystemGroupedBackground` | |
| Separator | hairline `separator`, inset to the text leading edge (16, or 16+29+12=57 with an icon) | |

### Link rows (bug 3) [REC]
**[CODE]** Today each link is its own 20pt-radius card with accent-coloured text. Change to:
- **One** group per section, separated by hairlines.
- Leading SF Symbol 17pt in accent, or a 29×29pt rounded square (radius 7) with a white glyph.
- Title in Body `label`. Accent text is for actions only, such as "Add to Favourites".
- Trailing glyph 13pt Semibold `sheetSecondary`: `chevron.right` for in-app navigation, `arrow.up.forward` for external links.

### Peek detent sizing (bug 2)
**[CODE]** The peek is 18% of the window, which is 157pt on an 874pt-tall iPhone. Header (52) + top inset (16) + bottom safe area (34) is about 102pt, so roughly **40–55pt of the hero shows** under the header.

Apple's own sample uses a fixed-height smallest detent: `.presentationDetents([.height(180), .medium, .large])` [WWDC 25-323]. Apple Maps' peek is only its search or header row [OBS].

Fix:
1. **Size the peek to the header.** `peek = (16 + headerHeight + 12 + bottomInset) / windowHeight`. Measure `headerHeight` with `onLayout` so it follows Dynamic Type. That is ≈0.13–0.14 on current phones. `sheetAllowedDetents` takes any fraction [CODE: react-native-screens types].
2. **Hide the body anyway at detent 0.** Set opacity 0, `pointerEvents="none"` and `accessibilityElementsHidden`, so nothing can peek during the drag or at AX sizes. The compact ETA in the header already covers this detent.

---

## C. Transit map markers

### What reference apps do
- **Apple Maps:**
  - Transit view dims roads and emphasises lines and "key terminus and transfer stations" [WWDC 16-241].
  - Stations take the line colour. Multi-route stations get a **white "pill"**, and stop detail grows with zoom [Apple patent US 11054275].
  - A selected place becomes the balloon marker with its title beneath [DOC: MKMarkerAnnotationView]. Titles hide when they collide (default `displayPriority` is `defaultLow`).
- **Transit:** single-line stops are a **coloured circle**, multi-line stops a **white bar** [S: Transit blog]. Live times get pulsing waves, and vehicle corner badges show "the last time we got an update" [S: Transit help].
- **Citymapper:** bus icons on list and map; tapping shows the last update time [S: Citymapper news].
- **Google Maps, Moovit:** vehicles are icons that move along the line, colour-coded by status [S].
- **Common to all:** the heading arrow is on the marker and the glyph stays upright [S: GitHub bus-frontend PR #52; agency legends].

### Marker specs [REC]
All sizes are pt. The accent is the GTFS `route_color` or `systemBlue`. The stroke is white in both modes because it reads on satellite and dark tiles. Shadow means `0 1 3 rgba(0,0,0,.30)` unless stated.

| Marker | SVG-level spec | Zoom / priority |
|---|---|---|
| **Route stop** | 12×12 box, `<circle r=4 fill=#FFF stroke=accent stroke-width=2/>` (10 visible). No shadow (the 8pt line casing gives contrast) | Hide when `latitudeDelta` > 0.03 (≈ zoom < 14). `displayPriority="low"` |
| **Boarding stop (selected)** | 28 disc, accent fill, **2.5 white stroke**, `bus.fill` 13pt Semibold white, shadow. Under it, a 44 halo `circle fill=accent opacity=.18`, static | Always visible, `required`, zIndex above stops and below the primary bus |
| **Boarding stop label** | **Separate marker.** Capsule h **22**, padding 8h, Caption 1 Semibold 12pt `label`. Fill `systemBackground` at 92% (or the regular material). 0.5 hairline stroke, shadow `0 1 2 rgba(0,0,0,.2)`. Max width 160, single line, tail truncation | `required`. Placed *below* the dot (see anchoring) |
| **Destination stop** | Use a different *shape*: 22×22 rounded square, radius 6, `label`-colour fill, 2 white stroke, `flag.fill` 11pt in inverse colour | `required` |
| **Rail interchange** (LRT/MRT nearby) | White capsule h **18**, 1.5 stroke `#000` at 25%. Inside, one 10pt dot per line in the official line colour with 2pt gaps (Apple's white pill, Transit's white bar). At zoom ≥ 16 add the code chip (e.g. "KG16") at Caption 2 Bold | Hide when `latitudeDelta` > 0.05. `high` |
| **Live bus** | 32 disc (primary bus **36**), accent fill, 2.5 white stroke, `bus.fill` 15/17pt white, shadow. Heading: 10×7 triangle in accent with a 1.5 white stroke, **2pt outside** the disc, inside a 48 frame rotated by `bearing`. Optional route chip on non-primary buses: capsule h 18, "T816" 11pt Bold Rounded | `required`. Primary bus zIndex 3 |
| **Live pulse** | One ring 36→60, stroke accent 2, opacity .35→0, 1.2s ease-out, **once per new fix**. Off under Reduce Motion | |
| **Ghost (scheduled)** | 28 circle, fill `systemBackground` at 75%, **dashed 2pt stroke** (dash 3 gap 3) in `secondaryLabel`, `clock` 12pt. No heading, no pulse, no shadow, zIndex 1. Never route-colour filled | |
| **Passed / other buses** | 28 disc at 60% opacity; past your stop, `#8E8E93` fill | `high` |

### Anchoring and drift (bug 4): the root cause
**[CODE]** react-native-maps documents `anchor` as "iOS: Google Maps only. For Apple Maps, see the `centerOffset` prop". `RouteLayer.tsx` sets `anchor={{x:0.5,y:0.25}}`, which MapKit **ignores**.

MapKit "places the center point of an annotation view at the coordinate" [DOC: centerOffset]. Today's view is 160 wide and about 39 tall (20 dot + 3 + about 16 label). Its centre sits on the stop, which draws the dot **about 9.5pt north** of the true point.

A fixed screen-space error covers a different ground distance at each zoom: about 1m at street level, hundreds of metres zoomed out. So the dot slides along the route as you zoom. That slide is the drift.

Fix [REC]:
1. **Dot marker:** a square view, `centerOffset {0,0}`, so its centre is the coordinate.
2. **Label marker:** a second `<Marker>` at the same coordinate with `centerOffset {x:0, y: 14 + 4 + 11}` (dot radius + gap + half the chip height). Positive y moves it down [DOC].
   - Fix the chip height with `allowFontScaling={false}` or `maxFontSizeMultiplier≈1.2`, so the offset stays correct under Dynamic Type.
   - Alternatively, measure the height with `onLayout` and set the offset from it.
3. For a **pin or balloon** (tip at the coordinate), use `centerOffset {0, -height/2}`, as SwiftUI does with `Annotation(anchor: .bottom)` [WWDC 23-10043].
4. **Keep annotation bounds tight.** MapKit hides lower-priority views whose collision frames overlap a `required` one. Collision modes are rectangle, circle and none [DOC]; rectangle is the default and RN doesn't expose `collisionMode`. A transparent 160pt-wide wrapper therefore suppresses nearby stop dots. Size the chip to its text.
5. Buses already use a 48 square frame with the disc centred, so they are correct. Delete their no-op `anchor` props to avoid confusion.
6. **No-code alternative (Apple-native look):** a child-less `<Marker pinColor={accent} title=… titleVisibility="visible">` renders a real `MKMarkerAnnotationView`. You get the balloon, correct anchoring, the system label halo and collision handling [CODE: AIRMapMarker.m]. You lose a custom glyph, because `glyphImage` is not bridged.

### Label collision [REC]
- Label only the boarding stop and the destination.
- Show other stop names only at `latitudeDelta` < 0.008 (≈ zoom 16+) as text with a halo: 11pt Semibold, `textShadowRadius` 2 in the inverse colour. Use `displayPriority="low"` so MapKit drops them on collision.
- Never label buses on the map. The sheet describes the selected bus.

---

## D. Empty and edge states
**What the best apps do.** Apple's own pattern is `ContentUnavailableView`: an SF Symbol, a title, a description and optionally an action. Apple says to use it for "a network error, a list without items, a search that returns no results" [DOC]. Apple first-party apps keep illustrations for onboarding and feature introductions, not for errors [OBS]. Transit and Citymapper use brand illustration for personality moments [OBS].

**[CODE]** `@expo/ui/swift-ui` ships `ContentUnavailableView` with `title`, `systemImage` and `description`, but no actions slot. Put a native `Button` under it. `expo-symbols` supports `hierarchical`, `palette` and `multicolor`.

| State | Visual | Spec [REC] |
|---|---|---|
| **Track your bus** (first run) | The one place an illustration earns its keep. Otherwise use SF Symbol `bus.fill` in palette (accent + `label` at 30%) | Illustration: 160×110, two-tone line art (bus + stop pole), accent plus `label` at 25%, with a dark-mode variant, stored as SVG or PDF. Title 2 Bold 22 · description Subheadline 15 `sheetSecondary`, max width 300, centred · capsule button 50 tall. Fits at glance (≈420pt) |
| **No more buses today** | `moon.zzz` hierarchical, 48pt | Title "No more buses today" · "First bus 6:10 tomorrow" in tabular `label` · "Remind me" button |
| **Live data is down** | **Not** an empty state, because the timetable is still useful. Use an inline row above the hero: `antenna.radiowaves.left.and.right.slash` 15pt orange + "Can't reach live data · showing timetable", 15pt `label` | Height 36, `secondarySystemFill`, radius 12 |
| **Cold load** | Redacted hero (README) | No spinner, no shimmer under Reduce Motion |

Keep symbols static: no bounce on appear. The HIG reserves motion for meaning.

---

## E. Three iOS-native visual directions
| | 1. **Apple Maps native** | 2. **Transit bold colour** | 3. **Calm editorial / mono** |
|---|---|---|---|
| Reference apps | Apple Maps, Find My, Weather (iOS 26/27) | Transit (route-coloured cards, waves glyph), Flighty (bold status colour), Citymapper | Mercury Weather, Things 3, Tide Guide (ADA 2026), Apple News or Journal typography |
| Map | `mutedStandard`, POIs filtered to transit | `standard`, 8pt route line with a 3pt white casing | `mutedStandard` dark-biased; route line in `label` colour at 6pt, accent only on the bus |
| Sheet material | System glass at all partial detents, `sheetSecondary` text, plate only in satellite mode | Glass sheet, but the **hero block is an opaque route-colour card** (radius = sheet radius − 16) with white text, so legibility is solved by construction | Glass at peek. At glance and above, an opaque `systemBackground` plate (like a page), so there is no translucency behind text |
| Hero type | SF Rounded 88 Bold, `label` | SF Rounded 96 Heavy, white on route colour | SF Pro 76 Semibold, or New York serif for the stop name at Title 1; tabular, `label` |
| Colour | One accent; green and orange for status glyphs only | Route colour carries identity: badge, card, markers, Live Activity | Monochrome, plus **one** colour for "live" |
| Markers | Balloon (`MKMarkerAnnotationView`) for the boarding stop, discs for buses | Route-number capsules for buses ("T816 ▸" with heading), white-pill interchanges | Hairline rings: 10pt stop rings, bus as a solid `label` disc with an accent heading wedge |
| Risk | Looks generic | Route colours must pass 3:1 against white text. Some feeder colours won't, so fall back to darkened variants | Low glanceability for "live vs scheduled". Lean on the glyph and word |

**Pick [REC]:** Direction 1 is the base, with two borrowings:
- the opaque legibility plate and the hero-as-card idea from Direction 2, for satellite mode
- Direction 3's discipline: no `tertiaryLabel` text, and one colour for live.

---

## Sources
- HIG Materials: https://developer.apple.com/design/human-interface-guidelines/materials
- HIG Accessibility (contrast table): https://developer.apple.com/design/human-interface-guidelines/accessibility
- HIG Typography: https://developer.apple.com/design/human-interface-guidelines/typography
- HIG Sheets: https://developer.apple.com/design/human-interface-guidelines/sheets
- HIG Maps: https://developer.apple.com/design/human-interface-guidelines/maps
- WWDC25-323, Build a SwiftUI app with the new design: https://developer.apple.com/videos/play/wwdc2025/323/
- WWDC25-284, Build a UIKit app with the new design: https://developer.apple.com/videos/play/wwdc2025/284/
- WWDC25-356, Get to know the new design system: https://developer.apple.com/videos/play/wwdc2025/356/
- WWDC23-10043, Meet MapKit for SwiftUI: https://developer.apple.com/videos/play/wwdc2023/10043/
- WWDC16-241, Apple Maps transit: https://developer.apple.com/videos/play/wwdc2016/241/
- MKAnnotationView.centerOffset: https://developer.apple.com/documentation/mapkit/mkannotationview/centeroffset
- MKAnnotationView.CollisionMode: https://developer.apple.com/documentation/mapkit/mkannotationview/collisionmode-swift.enum
- MKMarkerAnnotationView: https://developer.apple.com/documentation/mapkit/mkmarkerannotationview
- ContentUnavailableView: https://developer.apple.com/documentation/swiftui/contentunavailableview
- Apple Developer Forums 798726 (iOS 26 grouped cell radius): https://developer.apple.com/forums/thread/798726
- Apple transit-mode patent US 11054275: https://patents.justia.com/patent/11054275
- [S] Transit, auto-generated maps: https://blog.transitapp.com/how-we-built-the-worlds-prettiest-auto-generated-transit-maps-12d0c6fa502f/
- [S] Transit help, real-time waves and faded scheduled times: https://help.transitapp.com/article/445-how-to-track-departures-on-your-transit-line
- [S] Google Maps colours: https://support.google.com/maps/answer/6142130 ; https://www.timeout.com/los-angeles/blog/google-maps-will-now-let-you-know-if-a-metro-bus-is-delayed-or-on-time-121115
- [S] Citymapper live buses: https://citymapper.com/news/558/live-buses-on-the-map
- [S] Apple Maps real-time glyph: https://www.letemsvetemapplem.eu/?p=765591
- [S] Bearing-rotated bus pin: https://github.com/RuggMatt/bus-frontend/pull/52
- [S] Expo, Apple Maps-style sheets: https://expo.dev/blog/how-to-create-apple-maps-style-liquid-glass-sheets
- [S] iOS 27 Liquid Glass: https://macrumors.com/2026/06/10/how-liquid-glass-is-changing-in-ios-27 ; https://www.techradar.com/phones/ios/liquid-glass-isnt-going-anywhere-in-ios-27-but-theres-good-news-for-its-readability
- [S] iOS 26.1 Tinted option: https://tidbits.com/2025/10/21/ios-26-1-to-add-optional-opacity-to-liquid-glass/
- [CODE] `node_modules/react-native-maps/dist/src/MapMarker.d.ts` (anchor is Google-only on iOS), `ios/AirMaps/AIRMapMarker.m`; `apps/mobile/components/map/RouteLayer.tsx`, `app/_layout.tsx`, `app/trip.tsx`, `components/trip/Connections.tsx`; `node_modules/@expo/ui/build/swift-ui/ContentUnavailableView/index.d.ts`
