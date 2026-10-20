# Award-winning & craft-praised iOS apps: patterns for a premium Liquid Glass bus tracker

Research date: 2026-10-20. Target: minimal iOS bus tracker built with Expo SDK 58 / RN 0.88, iOS 26+ Liquid Glass. The repo already has `@expo/ui` (SwiftUI), `expo-glass-effect`, `expo-symbols`, `expo-haptics`, `expo-widgets` and Reanimated 4.7, so most patterns below can be built natively.

Out of scope here, because a sibling agent covers them: Liquid Glass HIG fundamentals and transit apps (Apple Maps, Transit, Citymapper).

---

## 0. Method, source reliability, blocked domains

- **Primary sources I could read in full:** developer.apple.com (ADA pages, "Behind the Design" articles, ADA Q&As, WWDC and Meet-with-Apple transcripts, HIG JSON, SwiftUI docs JSON) and GitHub (cloned).
- **Blocked from the sandbox (DNS failures for both WebFetch and curl):**
  - appllama.io (the user asked about this one specifically)
  - mobbin.com, screensdesign.com, dribbble.com
  - apple.com/newsroom, 9to5mac, macrumors, macstories, nngroup.com, medium.com
  - flighty.com, tideguide.com, culturedcode.com, structured.app, uber.com/blog
  - blakecrosley.com, uxsnaps.com, verenaortlieb.com

  For these I used web-search result snippets only, and the claims are attributed as such.
- **Reverse-engineered specs:** `github.com/meliwat/awesome-ios-design-md` holds 200 "DESIGN.md" specs, including Flighty, Wallet, Fitness and Things 3, with hex values, type ramps, springs and haptics. They are reverse-engineered by a third party and likely partly AI-generated. **Treat their numbers as plausible starting values, not ground truth.** They are marked [RE] below.
- **appllama.io:** What I learned comes from search snippets and directory listings (toolfolio, peerpush, launly, productdirs). It is a design-research library of **flows from top-grossing iOS apps**: 25k–71k screens from 600–1,550 apps, depending on the listing date. It is organised by flow (onboarding, paywalls, galleries, etc.), with colour and font inspection plus revenue and rating context. It is useful for **onboarding and permission-prompt flows**, but it is not a curated "beautiful apps" gallery. Its emphasis is conversion, not craft. The gallery flow page listed Denim, Touchpix, AI Mirror and Home Planner. (https://appllama.io/, https://appllama.io/flows/gallery)

---

## 1. Awards landscape (apps only; games omitted)

### 1.1 Apple Design Awards 2026 (announced 2026-06-02)

Source: https://developer.apple.com/design/awards/ ; Apple Newsroom (blocked, from snippets).

| App | Category | What Apple praised | Relevance to a bus tracker |
|---|---|---|---|
| **Moonlitt** (Flipping Hues) | **Interaction – winner** | "best-in-class Liquid Glass integration, and easy onboarding"; SwiftUI; runs on 5 platforms. Founder: "with Liquid Glass everything felt much more alive. It was like the interface was breathing." | Its Q&A goal applies directly: "elegant and easy to explore… while all the magic happens under the hood". A data-heavy utility made calm. |
| **Tide Guide** (Condor Digital) | **Visuals & Graphics – winner** (also an Interaction finalist) | "integrates the new design and Liquid Glass, adding extra polish to data presentation and custom animations"; "powerful widgets"; "palette… designed to match the color of the sky throughout the day"; full-screen charts. | **The closest analogue**: a glanceable, time-series utility with live data, widgets and a contextual palette. See §2.2. |
| grug (Ocho) | Delight & Fun – winner | Scribbled design, hand-drawn status bar, "no login, no cloud syncing, nothing extraneous." | Ruthless scope. No account wall. |
| Guitar Wiz | Inclusivity – winner | Robust VoiceOver, Dynamic Type, **Increased Contrast, Differentiate Without Color**. | Status colours must never be the only signal. |
| Primary: News in Depth | Social Impact – winner | "a properly minimal UI… gets out of the way… keeping the focus on the story." | The content (the ETA) is the hero, and the chrome recedes. |
| NBA | Innovation – winner (visionOS) | Multi-game live scoreboards. | Live-data density done well. |
| **Structured** | Inclusivity – finalist | "Visually sharp and easy to scan," "simple layout"; Foundation Models pre-fill tasks. In its iOS 26 redesign the tab bar floats, with the add button centred beside it (developer blog, from a snippet). | Floating tab bar plus a separate primary action. A scannable timeline. |
| The Outsiders | Interaction – finalist | "Training Readiness Score" is "a beautiful data visualization". | A single synthesised score as the hero. |
| (Not Boring) Camera | Visuals – finalist | "giant buttons and haptic scroll wheels". | Haptic detents on scrubbing. |
| Hearing Buddy, Detail, Harvee, Katha Room, Metaballs, Blippo+ | finalists | Mostly AI or spatial. Katha Room is "a lovely showcase for sound design". | – |

### 1.2 Apple Design Awards 2025 (https://developer.apple.com/design/awards/2025/)

| App | Category | Praised for |
|---|---|---|
| CapWords | Delight – winner | Capture animation; "each flash card transition is accompanied by a real-world sound". |
| **Lumy** (sun tracker) | Delight – finalist | "simple design, carefully curated color palette, and elegant widgets and Live Activities". In Apple's Liquid Glass gallery it added a **Quick Access Menu, a floating Peek Panel and fluid sliders**. |
| Denim | Delight – finalist | "smooth scroll transitions and elegant text and mesh gradients"; "custom haptics". |
| Speechify | Inclusivity – winner | "worked to reduce cognitive load all throughout the app". |
| Train Fitness | Inclusivity – finalist | Works without looking at the screen (motion sensing). |
| Play | Innovation – winner | "well-designed UI is nicely organized, visually pleasing". |
| Capybara | Innovation – finalist | A mascot "hangs out on the screen while the app is doing its thing"; "results are delivered right away". |
| **Mela** | Interaction – finalist | Cooking mode: "steps, measurements, and timing details are subtly dimmed and highlighted at the proper time"; "Timers integrate with the Dynamic Island". |
| iA Writer | Interaction – finalist | Edge-swipe navigation (right for library, left for preview). |
| Watch Duty | Social Impact – winner | "clearly and reliably offering updates… real-time guidance". **Reliability under stress is the design.** |
| Ground News | Social Impact – finalist | "color-coded bias markers" in "user-friendly layouts". |
| Opal | Social Impact – finalist | "haptics when unlocking 'gems'". Widgets, Shortcuts. |
| Vocabulary | Visuals – finalist | "Typography and iconography feel modern and balanced"; "the use of haptics is a nice touch". |

### 1.3 Apple Design Awards 2024 (https://developer.apple.com/design/awards/2024/)

- **Winners:**
  - Crouton (Interaction): "a clean, tasty interface… Everything… is easy to find and right where you need it"; "effortless series of interactions mean people can keep their focus on the counter rather than their screen".
  - Gentler Streak (Social Impact): "subtle and consistently pleasing design language". The Monthly Summary is "less about hard comparisons and more about progress".
  - **oko** (Inclusivity): "alerts pedestrians to the state of lighted signals through haptic and audio feedback"; "flawless VoiceOver and Dynamic Type". This is a transit-adjacent precedent for haptic and audio street-side cues.
  - Rooms (Visuals), Bears Gratitude (Delight).
- **Finalists:** Tiimo, Copilot Money, **Arc Search** (Interaction), How We Feel, **Sunlitt** (Visuals), Meditate, SmartGym.

### 1.4 App Store Awards 2025 (2025-12-04)

- **iPhone App of the Year: Tiimo.** Apple called it an "impressive visual planner". It uses a visual timeline, leans on icons and colour rather than text lists, and has integrated timers and Watch haptic nudges.
- Other winners: iPad = Detail, Mac = Essayist, Watch = Strava. Finalists for iPhone included BandLab and LADDER.
- Sources: MacRumors, Apple Newsroom (snippets), https://developer.apple.com/news/?id=id45s69d

### 1.5 Apple's Liquid Glass gallery (developer.apple.com/design/new-design-gallery, Nov 2025, refreshed Apr 2026)

The page now redirects to the Design overview. Contents come from search snippets of 9to5Mac, MacRumors and MacObserver.

- **Nov 2025:**
  - **Crumbl**: the brand pink moves *out of the toolbar into the content layer*, so photography leads.
  - **Tide Guide**: submenus and popovers move off the top toolbar; glass complements its rich blue palette.
  - **GrowPal**: "smart use of the toolbar and scroll-edge effects… much more space for data, while maintaining its sharp-yet-minimal identity".
  - **Lumy**: "keeps all actions within easy reach and focuses on the data people care about"; Quick Access Menu, floating Peek Panel, fluid sliders.
- **Apr 2026:**
  - AllTrails, Fantastical, Kroger, SketchPro, Trello, Le Monde.
  - **CARROT Weather**: look updated throughout, most visible when panning the Radar map. The developer **reduced the number of tabs in the bottom toolbar**.

### 1.6 Apple "Meet with Apple" Liquid Glass showcases (full transcripts read)

- **Tide Guide** (Tucker MacDonald), https://developer.apple.com/videos/play/meet-with-apple/257 , covered in §2.2.
- **Slack**, https://developer.apple.com/videos/play/meet-with-apple/255/
  - Moved search into the tab bar. Their reasons: "it just decreased the user learning curve… users could learn this with all the other apps", and the iOS 26 tab bar "uses less space".
  - They prototyped three glass headers (concentric, capsule, gradient). The capsule "sometimes felt like a primary button", and the gradient failed with variable scroll content. They kept something close to the old header.
  - On custom controls: "we had taken the path of custom controls… That kind of slowed us down"; with native controls "the OS was propelling us forward."
  - They rolled out in phases, most-used surfaces first.
- **CNN**, https://developer.apple.com/videos/play/meet-with-apple/256/
  - "We limit its use in high frequency UI areas like list and animations, reserving it for static or top level components like the tab bar and toolbars."
  - "Avoid nested glass effect modifiers… Double translucency, layered blur, and unpredictable rendering."
  - "The effect is GPU intensive, especially in scrollable or frequently updated views."
- **LTK**, https://developer.apple.com/videos/play/meet-with-apple/254/
  - "Our identity should not compete with creator content. It should complement it."
  - Rebuilt in SwiftUI. Added a dedicated search tab, and "search usage doubled overnight".
  - "saying no to more could help us focus on what really matters."

### 1.7 Context for Oct 2026

- iOS 27 shipped in September 2026. Press coverage of WWDC26 (TapSmart, BGR, Tom's Guide snippets) says Liquid Glass was **refined, not replaced**:
  - a user **slider from clear to tinted** replaces the iOS 26.1 binary toggle
  - **darkened edges plus brighter highlights** for legibility
  - better dispersion of complex backgrounds
- Implication: design and test the app across the whole clear-to-tinted range, and never rely on glass translucency to convey meaning.
- Halide co-founder Sebastiaan de With, whose essay "Physicality: the new age of UI" (lux.camera) anticipated Liquid Glass, joined Apple's Human Interface team in January 2026 (MacRumors, from a snippet).

---

## 2. App deep dives (most relevant first)

### 2.1 Flighty: the reference for "live status of a vehicle you're waiting for"

**Primary source:** Apple "Behind the Design: Flighty", https://developer.apple.com/news/?id=970ncww4 (ADA 2023 winner).

- **North star:** "We want Flighty to work so well that it feels almost **boringly obvious**." Key information sits "front and center" in an "immediately understandable interface."
- **Real-world analogy, the departure board:** "Those airport boards have **one line per flight**, and that's a good guiding light." Airports have had "50 years of figuring out what's important." The Live Activities and Dynamic Island are "designed to recall airport signage conventions." **For buses, this means one row per departure, styled like a bus-stop countdown sign (a passenger information display).**
- **Persistent information beats checking:** "There's something comforting about information always being there. You don't have to check your phone and think, 'OK, I have to be at the gate in 32 minutes,' and then, 'Now I have to be there in 29 minutes.'" This is why Live Activities sit at the core of the product, not as an add-on.
- **Design for failure states:** "We really have to shine when things go awry."
  - Connectivity-aware design: "Whenever [someone] takes off, we have to assume that we won't see them again until they land." Before takeoff the Dynamic Island switches to self-advancing progress bars and counters, plus a "minimal, simple circular chart" of the flight's duration.
  - **Bus analogue:** once the user boards, assume data may go stale. Show progress that is computed locally from the schedule and the last known position, and label it honestly.
- **Sharing:** a few taps share the flight path and ETA with people who don't have the app (the pickup use case).
- **Process:** sketch **20 ideas** per problem ("what fits on a sheet of paper"). Push past idea 6–7 when you think you're done. Don't start from your existing asset library.
- **iOS 26:**
  - Liquid Glass redesign; its Live Activity redesign shipped in v4.7.0 (Nov 2025).
  - The CEO was "most excited" about the new **flight progress bar**.
  - Larger-button toolbars.
  - **CarPlay Live Activities** for timing airport pickups.

  Sources: Thrifty Traveler and Executive Traveller (snippets), https://thriftytraveler.com/news/flighty-pro-app-ios26-update/
- **2026 updates:**
  - Airport Intelligence: disruption alerts *with the reason* (Mar 2026).
  - Connection Assistant, with step-by-step guidance plus gate predictions from historical data (Jul 2026).
  - **Lesson: explain why something is late, and predict before it's official.**
- **Third-party analysis (snippets only):**
  - Countdown labels like "Departs in 5h 55m" reduce timezone and mental-math errors (uxsnaps).
  - The team "packs and wraps data in color so users don't have to interpret it" (the Flighty designer's portfolio).
  - Critique on Hacker News: some secondary text is tiny and low-contrast. Don't copy that.
- **[RE] spec values** (awesome-ios-design-md/travel/flighty):
  - Near-black canvas `#0B0B0F`, a single blue accent `#0A84FF`.
  - **Strict status semantics:** green `#30D158` = on time, amber `#FFD60A` = delayed, red `#FF453A` = cancelled. Used only on status chips, timeline nodes and the status strip, never decoratively.
  - Chips: tinted at 15 % fill, 13pt bold uppercase pill.
  - Times are the largest type at 32pt bold, **tabular figures everywhere**.
  - Delay timeline: a vertical 2pt rail with 12pt coloured nodes, and the **latest node pulses**. Each row has an 11pt mono timestamp, a 15pt semibold event and a coloured delta ("+22m").
  - In-app status strip mirrors the Live Activity layout: origin dot, a plane at the current %, destination dot.
  - On a status flip: chip colour cross-fade, **one** medium impact haptic, and a timeline node appended with a pulse.
  - Map arc draws in over ~900 ms ease-out. The plane glides, never steps.

### 2.2 Tide Guide: 2026 Visuals winner and the best Liquid Glass case study for a data utility

**Primary source:** "Liquid Glass showcase: Tide Guide", https://developer.apple.com/videos/play/meet-with-apple/257

- **Adopt first, then redesign:** "my process was more adopt and then redesign. Many of the best aspects come from just using the latest version of system components… a redesign is certainly not required."
- **Interactive glass on small controls:** "particularly useful on smaller buttons, ones that are normally covered by your finger." Day-of-week buttons "expand and morph within the container. The effect is snappy and **with a little haptic feedback** it makes for a really nice moment."
- **Glass that appears only on touch:** "This effect doesn't change the appearance of a view until you interact with it."
  - Scrubbing the tide wave adds "a soft, subtle highlight beneath the wave".
  - Chart cards replaced a custom scale animation with the glass interaction, which feels "more cohesive within the rest of the app and the platform".
  - "when you scrub through the hourly conditions, the container scales and feels very tactile."
- **Glass in content, sparingly and purposefully:** a glass highlight on the selected water level while sliding. The **empty state's radar rings refract through glass**, so the empty state itself is a moment of delight.
- **Menus became glass popovers:** nested context menus "deconstruct every time… many, many taps", and flattening them into one list is "very hard to read". Instead, Tide Guide uses a **glass popover with the same components**: the user can tweak without it dismissing, tap through to a full sheet, and it "collapses back into the ellipsis menu, giving a sense of origin".
- **Non-glass craft he credits:**
  - Concentric soft corners make screens "feel much more welcoming".
  - "consistent leading alignment and spacing" increases familiarity.
  - Adopt the new keyboard and bottom search placement; old keyboards "are increasingly noticeable".
- **ADA citation:** full-screen charts "filled with custom animations"; "aquatic theme and **sky-matching palette**"; widgets that "save a step right from the Home Screen".

### 2.3 Sunlitt and Moonlitt (Flipping Hues): contextual colour, metaphor, calm

Sources: https://developer.apple.com/articles/sunlitt/ and https://developer.apple.com/news/?id=v1nphz91

- **Metaphor first:** "We decided to place a monolith on the screen and let it cast a shadow". The user is a small white cube with the sun path over it. A complex dataset becomes one physical image.
- **Sky-mimicking colour:** "We chose colors that mimicked the sky, so when a user opens the app, they 'feel' the sun on their screen." Backgrounds shift between blue, light green, yellow and orange-red.
- Feedback goes through "visuals, haptics, and animations".
- Moonlitt pairs the hero state with a big number ("Full Moon 100%"), plus a calendar strip of phase icons, a map path, AR and a watch face.
- "simplify that complexity through a thoughtful interface and spot-on interactions."
- **Listen to reviews:** a 2025 review about a missing eclipse warning led to a whole eclipse feature set.

### 2.4 CARROT Weather: personality without chrome

- In Apple's April 2026 gallery: reduced the number of bottom tabs, and a Liquid Glass refresh most visible over the full-bleed radar map (search snippets of MacRumors, 9to5Mac, BGR).
- Its personality lives in **copy, voice and optional layers**, while the layout stays conventional. Brian Mueller is a past ADA winner (Interaction).
- **Lesson:** personality comes from copy and micro-moments, not from custom navigation.

### 2.5 (Not Boring) Weather and Camera (Andy Allen): tactility as identity

Sources: App Store story, TapSmart, Fast Company and a Medium case study (snippets).

- Real 3D (SceneKit, low-poly) and lighting.
- Original **sound design per weather event** by Thomas Williams.
- "Just-noticeable" haptics that are "so subtle that you might miss them".
- A sound setting with three options: always / respect silent mode / off.
- (Not Boring) Camera was a 2026 ADA finalist for "giant buttons and **haptic scroll wheels**".
- Allen has argued publicly for "an end to minimalism" (Fast Company).
- **Lesson:** even a minimal app can have a single tactile signature control, such as a time scrubber with detents.

### 2.6 Mercury Weather (Triple Glazed Studios): the restrained, cross-device utility

- MacStories called it "a crystal clear design for every Apple device".
- iPhone layout in three bands: current conditions, then a horizontally scrolling hourly strip, then an 8-day outlook. Beautiful charts.
- Developer intent: "show the right amount of information at the right time, without clutter" (App Store "Apps We Love" snippet).
- **Lesson:** a three-band hierarchy works well for "now → next few → later".

### 2.7 Things 3 (Cultured Code): calm, a single accent, a signature quick-add

- **OS 26 post** (snippet): "glassy buttons that respond to your touch with a subtle glow and scale". The **Magic Plus button "deforms its shape slightly in response to your movements as you drag it."**
- Things 3.22 brought softer curves and four icon variants (default, dark, tinted, clear).
- **[RE] spec values** (awesome-ios-design-md/productivity/things-3):
  - White canvas, a single blue `#4F97FF` accent for selection, primary action and checkbox fill. Today-yellow is the only warm note.
  - Checkbox: fills centre-out in ~180 ms, check spring (response 0.3, damping 0.6) plus a soft haptic, then the row fades and collapses in 250 ms.
  - Magic Plus tap: scale 0.94 → 1 (response 0.25, damping 0.7) plus a medium impact. Drag lifts it to 1.05, and an insertion line eases to the nearest gap.

### 2.8 Structured, Tiimo, Gentler Streak: humane data and timelines

- **Structured** (2026 ADA finalist): a timeline-first day view, "visually sharp and easy to scan". iOS 26 changes: floating tab bar with a separate add button; collapse the day to peek at the week with the background blurred through; the Focus Timer background ripples on device tilt.
- **Tiimo** (iPhone App of the Year 2025): a visual timeline with icons and colour instead of text lists, aimed at ADHD and autistic users. Timers and gentle Watch haptic nudges.
- **Gentler Streak** (ADA 2024, Behind the Design: https://developer.apple.com/news/?id=3m0ht22s):
  - "Statistics are just numbers. Without knowing how to interpret them, they are meaningless… focus on the humanity."
  - The prototype "guided but it didn't push… it wasn't based on numbers; it was more explanatory."
  - The Activity Path shows a band you should stay within. iOS 26 brought glass segment pickers for 1/10/30-day views.
- **Bus lesson:** translate raw data into a verdict. "Leave now", "You'll make it" and "Next one is better" beat a bare "4 min".

### 2.9 Mela, Lumy, Crumbl, GrowPal, Denim, Opal: smaller craft lessons

- **Mela:** focus mode dims what isn't relevant now and highlights the current step "at the proper time". Timers go to the Dynamic Island. → On a journey screen, dim past stops and highlight the next one.
- **Lumy:** curated palette, elegant widgets and Live Activities. iOS 26 brought the floating **Peek Panel** and **Quick Access Menu**: all actions within reach, focused on the data.
- **Crumbl and LTK:** move the brand colour out of the chrome and into content. Glass chrome stays neutral.
- **GrowPal:** toolbar plus scroll-edge effects free up vertical space for data.
- **Denim:** scroll transitions, mesh gradients, custom haptics.
- **Opal:** haptics as reward ("unlocking gems").

### 2.10 Uber Live Activity: the progress-bar trick

**Source:** "Pickup in 3 minutes: Uber's implementation of Live Activity on iOS" (Uber engineering blog, July 2024; snippets only).

- "Information on this surface is only glanced at for a few seconds at a time… Attempting to cram the same information from our app into the Live Activity view would have been a mistake."
- **Non-linear progress bar:** "The last 20% of the progress bar represents the last 2 min of the progress **no matter how long the whole waiting time is**." The final approach always feels alive and meaningful.
- The Dynamic Island "shares its limited real estate… our design had to be even more concise."

### 2.11 Apple first-party exemplars

These are well-known behaviours, stated from general knowledge unless cited.

- **Weather:**
  - The hero temperature in very large, light-weight SF numerals, with the condition and hi/lo below it.
  - A **full-bleed animated backdrop that encodes the condition and time of day**, so you read the state before reading text.
  - Modular cards with a header glyph plus a caption, scrolling over the backdrop. The header collapses into a compact "18° | Cloudy" on scroll.
  - "Feels like" moved under the actual temperature in iOS 18 (TechRadar snippet).
- **Fitness** ([RE] awesome-ios-design-md/fitness/apple-fitness):
  - Rings are the brand. On a true-black canvas, everything else is system-quiet.
  - Rings sweep from 0 over ~1 s ease-out, staggered by ~80 ms. Closing a ring triggers a particle burst plus a success haptic.
  - Reduce Motion fallback: a 250 ms crossfade with no sweep.
  - Tabular numerals in the legends.
- **Wallet** ([RE] finance/apple-wallet):
  - Card stack with ~80pt peeks on true black. Chrome is nearly absent: a title and a "+".
  - Expand uses spring (response 0.5, damping 0.8) plus a medium impact. Collapse uses a soft impact.
  - The transit balance counter animates old → new over ~800 ms.
- **Find My / Maps:** full-bleed map plus a persistent detented sheet (peek / half / full). The sheet *is* the navigation. In iOS 26 the sheet is glass, and at a small detent it floats inset from the screen edges.
- **Timer / Clock Live Activity:** the HIG cites it. The minimal presentation shows the **remaining time instead of a static icon**.
- **Apple Sports:** built "to be fast and simple" (AppleInsider snippet). Scores-first, Live Activities, no TV or News clutter. Criticism: starting a Live Activity is several taps away. **Make "follow this bus" one tap.**

---

## 3. Galleries and tools

| Gallery | Status | Use it for |
|---|---|---|
| appllama.io | Blocked | Real-order flows of top-grossing apps: onboarding, paywalls, permission priming. Conversion-oriented, not craft-oriented. |
| Mobbin, Screensdesign | Blocked | Screen and flow libraries. Search "live activity", "countdown", "map bottom sheet", "empty state". |
| Dribbble "iOS 26 Liquid Glass" | Blocked; snippets only | Concept work, mostly floating tab bars and glass cards. **Caution:** Dribbble concepts over-apply glass to content cards, which CNN, Apple and NN/g all warn against. |
| 60fps.design (flighty, not-boring-weather pages) | Not reachable | Screen recordings of motion. |
| github.com/meliwat/awesome-ios-design-md + spectr.to | **Cloned** | Reverse-engineered DESIGN.md for 200 apps, with Expo flavours (`DESIGN-expo.md`). Useful as seed values [RE]. |
| Apple Liquid Glass gallery + Meet-with-Apple showcases | Partly readable | The most authoritative adoption examples (§1.5–1.6). |

---

## (a) Cross-cutting principles of premium native iOS apps

1. **Boringly obvious, then delightful.** The core read must be instant: Flighty's "boringly obvious"; Primary "gets out of the way"; grug "nothing extraneous". Delight is layered on top and never sits in the critical path. *Bus:* the next-departure ETA for the nearest or favourite stop is visible with zero taps on launch.

2. **One real-world analogy drives the layout.**
   - Flighty → the airport board ("one line per flight").
   - Sunlitt → a monolith casting a shadow.
   - Wallet → a billfold.

   *Bus:* the **stop-side countdown sign**, with one line per departure (route badge · destination · minutes). Plus the **line diagram** (the stop strip printed on bus maps) for the journey view.

3. **Persistent, ambient information beats "checking".** Flighty's Live Activity rationale, Mela's timers in the Dynamic Island, Lumy's Live Activities, Tide Guide's widgets. The product lives on the Lock Screen, Dynamic Island and widgets as much as in the app.

4. **Design for the bad day.** Flighty: "shine when things go awry" and give the *reason* for disruption. Watch Duty is praised for reliability under stress. *Bus:*
   - stale-data states
   - "scheduled, not live" honesty
   - cancelled or detoured trips
   - no-signal underground
   - GPS jitter

5. **Translate data into a verdict.** Gentler Streak: "statistics are just numbers"; The Outsiders' single readiness score; Tiimo's visual timeline. *Bus:* "Leave in 3 min to catch it" or "Run!" beats a raw "6 min" when you know the walking distance.

6. **Single accent + strict semantic status colours.** Flighty: one blue plus green/amber/red only on status. Things: one blue plus one warm note. Fitness: colour only in the rings. Crumbl and LTK: brand colour lives in content, not chrome.

7. **Native components first, custom only where it's the signature.**
   - Slack: custom controls "slowed us down"; native ones mean "the OS was propelling us forward".
   - Tide Guide: "adopt then redesign".
   - CNN: tab and nav bars "looked great out of the box".
   - Tide Guide's custom wave, Things' Magic Plus and Flighty's arc are *one* signature element each.

8. **Glass is for the navigation and control layer, never for content.** This is CNN's rule (static top-level components only, no nested glass, GPU cost in lists). It is Apple's Liquid Glass gallery framing too, and NN/g's legibility critique ("anything placed on top of something else becomes harder to see"). Content cards stay solid or grouped. Exceptions are only touch-revealed glass, as in Tide Guide.

9. **Contextual atmosphere.** Tide Guide and Sunlitt match the palette to the sky and time of day. Weather encodes the state in the backdrop. *Bus:* a subtle time-of-day tint behind the hero, or a status-tinted ambient glow. Keep it low contrast, and keep it off any element that carries meaning.

10. **Tactility is calibrated.**
    - (Not Boring) uses just-noticeable haptics; Tide Guide adds "a little haptic feedback" when glass morphs; Opal uses haptics as reward.
    - HIG: "Often, the best haptic experience is one that people may not be conscious of, but miss when it's turned off."
    - Haptics accompany *user-caused* events, matched to animation intensity.

11. **Accessibility is a design feature, not compliance.**
    - Guitar Wiz: Differentiate Without Color, Increased Contrast.
    - oko: haptic and audio for street-side state.
    - Speechify: cognitive load.
    - Train Fitness: works eyes-free.
    - *Bus:* VoiceOver reads "Route 42 to Downtown, live, arrives in 3 minutes". Status uses glyph plus text plus colour.

12. **Ruthless scope and fast iteration on device.**
    - Is This Seat Taken? asked "Is this necessary? Does this add value?" and cut the bus-driving mechanic because "Driving is not fun."
    - LTK: "saying no to more".
    - Slack builds daily and throws things out.
    - Flighty sketches 20 ideas.
    - Carrot cut tabs.

13. **Make the empty state and onboarding moments of craft.**
    - Moonlitt's "easy onboarding" was explicitly cited.
    - Tide Guide's refracting radar empty state.
    - grug has no login.
    - *Bus:* no account. Ask for location in context, when the user taps "Nearby". The first launch shows a useful map plus nearby stops immediately.

---

## (b) "Steal this" patterns for the bus tracker

Each entry gives What / From / Adapt / Motion & haptics.

1. **Departure-board rows ("one line per bus")**
   - **From:** Flighty's airport-board analogy.
   - **Adapt:** Each row = route badge (rounded rect in the agency route colour; the only place route colour appears) · headsign (17pt, 1 line, truncate middle) · ETA right-aligned (tabular, large) · a small live glyph.
     - Up to 3 upcoming departures per route, grouped by stop.
     - No cards inside cards: grouped inset list rows on a system background.
   - **Motion & haptics:**
     - When an ETA changes, use `contentTransition(.numericText(countsDown: true))` with `.smooth`.
     - When a row reorders, animate only the moving row and fade the others (HIG Live Activity list guidance applies equally in-app).
     - No haptic on data refresh.

2. **Hero ETA with verdict, like Weather's hero number**
   - **From:** Apple Weather, Flighty times-as-hero, Gentler Streak's interpretation.
   - **Adapt:** On the stop detail or "Next bus" home card:
     - a giant number, e.g. `4` with a `min` unit in a smaller weight beside it, baseline-aligned
     - one line of verdict above or below it ("Leave now · 3 min walk", "Live · 2 stops away")
     - absolute clock time secondary ("12:41")
   - Below 1 min, replace the number with **"Due"** or **"Now"**. Never show "0 min".
   - **Motion & haptics:** numericText count-down. On the "Due" flip, a symbol `bounce` plus a single `.impact(.soft)` only if the screen is foregrounded *and* the user is following this bus.

3. **Live-ness indicator (honest realtime vs schedule)**
   - **From:** Flighty's strict semantics, Watch Duty's reliability, Transit-app conventions (don't duplicate; just the principle).
   - **Adapt:**
     - Live = a `dot.radiowaves` (or similar) symbol using the SF Symbols **variableColor** iterative effect, or a slow breathe.
     - Scheduled-only = a static `clock` glyph with the time in secondary colour.
     - Stale data (>2 min old) = an amber "Updated 3 min ago" footnote.
   - **Motion & haptics:**
     - Pulse period ~1.5–2 s.
     - Stop all repeating effects under Reduce Motion.
     - Never use a repeating effect on more than one element per screen.

4. **Journey timeline (stop-by-stop)**
   - **From:** Flighty's delay timeline with a pulsing latest node, and Mela's dim-past / highlight-current.
   - **Adapt:** A vertical rail in the route colour:
     - past stops dimmed (tertiary label)
     - the current vehicle position as a filled node between stops, gliding
     - the user's boarding and alighting stops emphasised with larger nodes and labels
     - per-stop ETA in tabular secondary text
     - delay deltas coloured ("+3")
   - **Motion & haptics:**
     - The vehicle node interpolates continuously between updates (never steps).
     - Auto-scroll keeps the vehicle about 1/3 from the top.
     - `.selection` haptic only when the user scrubs or taps stops.

5. **Map + persistent glass sheet**
   - **From:** Find My and Maps, Lumy's floating Peek Panel, Tide Guide's popovers.
   - **Adapt:** Full-bleed map with a system sheet at 3 detents.
     - Peek: next departure for the nearest stop.
     - Half: list of nearby stops.
     - Full: stop detail.
     - Floating glass buttons for "recenter" and "layers" only. Filters go in a **glass popover**, not nested menus.
   - **Motion & haptics:**
     - The system sheet's spring.
     - A `.selection` haptic on detent snap is optional (the system may already provide it; don't double up).
     - Selecting a map stop: the pin scales up with `.snappy`, and the sheet morphs to stop detail.

6. **Live Activity: phase-aware like Flighty**
   - **From:** Flighty phases plus HIG/WWDC guidance (§2.10, HIG notes in (c)).
   - **Adapt:** Phases:
     1. **Waiting:** "42 · 4 min" with the leave-by verdict.
     2. **Arriving:** "Due". Alert once, as the only alerting update.
     3. **On board:** "3 stops · get off at Elm St" with a progress bar.
     4. **Next stop is yours:** alert.
     5. **End:** dismissal around 15 min after alighting.
   - Compact: leading = route badge, trailing = minutes. When `isDynamicIslandLimitedInWidth`, fit a 28pt circle by dropping "min".
   - Minimal: the live minutes, not the logo (the HIG's Timer example).
   - Lock Screen: 14pt margins, a heavy-weight hero number, the line strip.
   - **Motion & haptics:**
     - numericText for minutes; content-replace when the phase changes. Animations ≤ 2 s.
     - Height grows when you board (HIG: dynamic height).
     - Use `Text(timerInterval:)` or relative date styles so it ticks without pushes. Push only when the prediction changes.

7. **Non-linear approach progress bar**
   - **From:** Uber.
   - **Adapt:** In the Live Activity and on the hero card, map waiting time so that **the last ~20 % of the bar = the last ~2 minutes** (or the last stop) regardless of total wait. The final approach visibly moves.
   - **Motion & haptics:** Linear interpolation between updates. No bounce.

8. **Favourite stops as a compact stack ("Wallet-lite")**
   - **From:** Wallet's stack and expand physics.
   - **Adapt:** For 2–5 favourites:
     - collapsed cards peek ~56–64pt, each showing route badges plus the next ETA
     - tap to expand one, and the others tuck down
     - beyond 5, fall back to a list (Wallet's stack doesn't scale for frequent comparison)
   - **Motion & haptics:**
     - [RE] Expand with spring (response 0.5, damping 0.8) ≈ `.snappy` plus `.impact(.medium)`; collapse with `.impact(.soft)`.
     - Stagger the inner content in after ~150–200 ms.

9. **One-gesture "pin" / quick add**
   - **From:** Things' Magic Plus (glassy, deforms while dragged).
   - **Adapt:**
     - A glass "+" (or star) in the stop detail toolbar pins the stop.
     - Long-press any departure row → context menu: "Follow this bus" (starts the Live Activity), "Alert me 5 min before", "Pin route".
     - "Follow this bus" in one tap answers the Apple Sports critique.
   - **Motion & haptics:**
     - The symbol `bounce` on pin with `.impact(.light)`; or `.success` when a reminder is scheduled.
     - Symbol transitions via `.replace` (star → star.fill).

10. **Contextual backdrop**
    - **From:** Tide Guide's sky palette, Sunlitt, Weather.
    - **Adapt:** Behind the hero card only, a very subtle gradient:
      - dawn / day / dusk / night from the stop's local time, or
      - a status wash (neutral = fine, amber wash = disrupted).

      Keep contrast ≥ 4.5:1 for text over it. Never let the backdrop be the only carrier of meaning.
    - **Motion & haptics:** Crossfade over 1–2 s. Disabled under Reduce Transparency and Reduce Motion.

11. **Widgets that answer one question**
    - **From:** Tide Guide ("save a step from the Home Screen"), Lumy.
    - **Adapt:**
      - Small: the next bus at a pinned stop.
      - Medium: 2 routes × 2 departures.
      - Lock Screen inline or rectangular: "42 · 4, 12 min".
      - Use relative date text so it ticks, plus timeline entries per departure.
      - Support tinted / clear accented rendering (`widgetAccentedRenderingMode`).
    - **Motion & haptics:** Numeric content transitions between timeline entries.

12. **Glass popover instead of nested menus**
    - **From:** Tide Guide.
    - **Adapt:** Route/direction filters and "show arrivals as minutes / clock time" live in one glass popover that doesn't dismiss on each toggle, and collapses back to the toolbar button.
    - **Motion & haptics:** `.selection` haptic per toggle (the system toggle already provides this).

13. **Touch-revealed glass for scrubbing**
    - **From:** Tide Guide's identity/interactive glass on charts.
    - **Adapt:** A "plan ahead" time scrubber (now → +60 min) over the departures list. While dragging, an interactive glass highlight follows the finger, and later departures filter in.
    - **Motion & haptics:** A `.selection` detent every 5 minutes, like (Not Boring) Camera's haptic wheels, and `.impact(.rigid)` at "Now".

14. **Delightful empty and error states**
    - **From:** Tide Guide's refracting radar empty state, Capybara's companion "hanging out while working".
    - **Adapt:**
      - No nearby stops → a calm illustration or SF Symbol with `drawOn` plus a "Search a stop" button.
      - No service tonight → the first departure tomorrow, in clock time.
      - Offline → the last known data with a timestamp. Never a blank screen.
    - **Motion & haptics:** A symbol `drawOn` once on appear. No haptics.

15. **Share ETA**
    - **From:** Flighty's live sharing for pickups.
    - **Adapt:** "Share my bus" → a link or text: "On the 42, arriving Elm St ~12:41".
    - **Motion & haptics:** System share sheet.

---

## (c) Typography, numbers, colour, spacing, iconography

### Typography

- **System fonts only:** SF Pro (Text and Display optical sizes are automatic; Display from about 20pt) and **SF Pro Rounded** via `.fontDesign(.rounded)`.
  - Rounded suits friendly hero numerals and badges. Fitness metrics and Watch numerics are rounded; Apple Weather's temperature is standard SF.
  - Recommendation: **SF Pro Rounded, semibold, for the hero ETA and route badges**; standard SF Pro for everything else. Don't mix more than 2 designs.
- **Weight discipline:** 400 / 600 / 700 ([RE] for both Flighty and Things). No thin weights at small sizes. A very large hero numeral can go lighter (Weather style) *or* bold (Flighty style). Pick one.
- **Width:** `.fontWidth(.condensed)` (or compressed) keeps long headsigns or dense boards to one line before truncating. Use it sparingly.
- **Ramp** (iOS default Dynamic Type sizes): Large Title 34, Title1 28, Title2 22, Title3 20, Headline 17 semibold, Body 17, Callout 16, Subheadline 15, Footnote 13, Caption1 12, Caption2 11.
- **Suggested ramp:**
  - Hero ETA 64–76pt rounded semibold (scaled with Dynamic Type via a relative text style, e.g. `.largeTitle` scaled ×2)
  - Row ETA 22–28pt rounded semibold tabular
  - Headsign 17 regular or semibold
  - Meta 13–15 secondary
- **Units:** "min" at ~45–55 % of the numeral size and one weight lighter, baseline-aligned. Make it a separate Text so numericText animates only the digits.

### Numbers

- **Always use tabular figures** for anything that updates: `.monospacedDigit()` (SwiftUI; also in `@expo/ui` modifiers) or `fontVariant: ['tabular-nums']` in RN. Proportional digits "jitter as data updates" ([RE] Flighty don'ts; SwiftUI docs: "Using fixed-width digits allows you to easily align numbers").
- **Animate changes** with `.contentTransition(.numericText(countsDown: true))`, inside an animation transaction. `@expo/ui` exposes `contentTransition('numericText')` plus `animation(...)`. WWDC23 Live Activity talk: "Use the numeric content transition to count up or down important numbers."
- **Formatting rules (recommended):**
  - Minutes = floor of seconds/60, so you don't promise time the user doesn't have.
  - < 60 s → "Due" or "Now".
  - ≥ 60 min → clock time ("13:05").
  - Show relative time primary and absolute secondary (Flighty's "Departs in 5h 55m" reduces mental maths). Let the user choose minutes or clock time.
  - Singular "1 min".
  - Never show seconds in-app except in a deliberate "Due" countdown.
  - Use `Text(timerInterval:countsDown:)` or `Text(date, style: .relative)` in widgets and Live Activities so the system ticks it.
- **Delay deltas:** signed, coloured, short ("+3", "−1"), with a VoiceOver label ("3 minutes late").

### Colour

- **Neutral base:** system backgrounds and labels (the label opacity ramp: primary, secondary ≈ 60 %, tertiary ≈ 30 %).
- **One app accent** (tint) for interactive things only.
- **Route colours** (agency GTFS `route_color`) appear only in route badges, the timeline rail and the map line. Ensure badge text contrast (compute black or white text).
- **Strict status semantics:**
  - green = on time / live
  - amber = delayed / stale
  - red = cancelled / no service
  - grey = scheduled only

  Use them only in status glyphs, chips and deltas. Always pair them with a glyph or text (Differentiate Without Color).
- Live Activities: use "bold colors for text and objects" for identity (HIG). Tint the Dynamic Island **key line** to match. The Dynamic Island background is always black. Check contrast on Always-On and StandBy Night Mode (red tint).
- On glass: don't tint all glass with the accent. Tinted glass is for the single primary action, if any. Keep the brand in content (Crumbl, LTK).

### Spacing and shape

- **Margins:**
  - 16pt screen margins (20 on large phones is fine).
  - Lock Screen Live Activity standard margin **14pt** (HIG).
  - Consistent leading alignment across screens (Tide Guide credits this for familiarity).
- **Concentric corners:** inner radius = outer radius − inset.
  - HIG Live Activities: "use even, matching margins between rounded shapes and the edges"; use the container-relative corner API instead of hard-coding.
  - iOS 26 offers concentric container shapes (`ConcentricRectangle` / `.containerShape`, which `@expo/ui` exposes as `containerShape`).
- **[RE] radius scale (Flighty):** 10 control · 12 field · 14 button · 16 card · 20 sheet · pill for chips.
- **4pt grid.** Row height ≥ 44pt hit target. Dense board rows of 56–64pt.

### Iconography (SF Symbols 7)

- **Weight matches the adjacent text weight**; scale `.medium` in rows and `.large` in toolbars.
- **Rendering mode:** hierarchical for most glyphs; palette for the live indicator (accent + secondary); monochrome in toolbars over glass.
- **Effects available natively through `@expo/ui` `symbolEffect`** (verified in node_modules): `appear`/`disappear`, `bounce` (up/down), `breathe` (plain/pulse), **`drawOn`/`drawOff`** (new SF Symbols 7 draw animations), `pulse`, `rotate`, `scale`, **`variableColor`** (cumulative/iterative), `wiggle`. `expo-symbols` `animationSpec` supports `bounce`, `pulse`, `scale` plus variable colour.
- **Usage map:**
  - live = variableColor iterative or breathe
  - pin = bounce + `.replace` (star → star.fill)
  - refresh = rotate once
  - empty state = drawOn
  - alert set = bell `wiggle`
  - error = `wiggle` + error haptic

  Each effect plays once per user-caused event, except a single live indicator.
- Suggested glyphs: `bus.fill`, `bus.doubledecker.fill`, `mappin.and.ellipse`, `location.fill`, `clock`, `bell.badge`, `star`/`star.fill`, `dot.radiowaves.left.and.right`, `exclamationmark.triangle.fill`, `figure.walk`.

---

## (d) Motion vocabulary and haptics

### Springs: what Apple actually specifies

- **SwiftUI presets** (docs JSON): `Animation.smooth(duration: 0.5, extraBounce: 0)` (no bounce), `.snappy(duration: 0.5, extraBounce: 0)` ("small amount of bounce"), `.bouncy(duration: 0.5, extraBounce: 0)` ("higher amount of bounce").
  - Their base bounce values aren't listed in the docs. WWDC23 "Animate with springs" describes ~15 % bounce as "brisk" and ~30 % as "noticeable bounciness". The commonly cited values are snappy ≈ 0.15 and bouncy ≈ 0.3 (inferred, unverified).
- `Spring(duration: 0.5, bounce: 0)` is the default. **iOS 17+ `Animation.default`** = spring(response 0.55, dampingFraction 1.0). `.spring()` = response 0.5, dampingFraction 0.825.
- **WWDC23 rules** (https://developer.apple.com/videos/play/wwdc2023/10158/):
  - "When you're not sure, use a spring with bounce 0."
  - Add bounce "to feel more playful" or "at the end of a gesture".
  - "be cautious about using values higher than around 0.4."
  - `duration` is *perceptual*; use completion handlers rather than waiting for the settling time.
  - Springs preserve velocity on retarget, which matters for interruptible sheets and cards.
- **WWDC18 "Designing Fluid Interfaces"** (https://developer.apple.com/videos/play/wwdc2018/803/):
  - Start at 100 % damping.
  - "if the gesture… has momentum, then you should reward that momentum with a little bit of overshoot." Music: tap-to-show = 100 % damping, swipe-to-dismiss = 80 %.
  - Highlight on touch-down, commit on touch-up.
  - Gesture hysteresis is ~10pt.
  - Project momentum to choose the end state.
  - Everything is interruptible and redirectable.
- **Live Activities:** max animation duration **2 s**. No animation on reduced-luminance Always-On.

### Recommended vocabulary for this app

| Interaction | SwiftUI (`@expo/ui` `Animation.*`) | Reanimated 4.7 equivalent (installed presets) | Notes |
|---|---|---|---|
| ETA digit change | `.smooth` + numericText(countsDown) | n/a (do it natively) or `withTiming(…, 250ms)` | No haptic |
| Row insert/reorder | `.smooth(duration: 0.35)` | `GentleSpringConfigWithDuration` = 550 ms, dampingRatio 1 (shorten to ~350) | Fade the others |
| Card expand/collapse, sheet morph | `.snappy` (0.4–0.5 s) | `SnappySpringConfigWithDuration` = 550 ms, dampingRatio 0.92, overshoot clamped | |
| Gesture release (swipe to dismiss, drag pin) | `.spring(duration: 0.45, bounce: 0.15–0.2)` with gesture velocity | `withSpring(v, {duration: 450, dampingRatio: 0.8, velocity})` | Bounce only after momentum |
| Press feedback | scale 0.97 with `.snappy(duration: 0.25)`; native glass `interactive` handles it on glass buttons | `withSpring(0.97, {duration: 200, dampingRatio: 1})` | Highlight on touch-down |
| Celebration (alert set, arrived) | symbol `bounce`; `.bouncy` for a badge pop | `WigglySpringConfigWithDuration` = 550 ms, dampingRatio 0.75 | Rare |
| Ambient (live dot) | symbol `breathe`/`variableColor`, ~1.5–2 s | – | One per screen; off with Reduce Motion |
| Vehicle marker glide | linear interpolation over the update interval | `withTiming(…, {duration: interval, easing: linear})` | Never step |
| Backdrop/time-of-day | `.easeInOut(duration: 1.5)` crossfade | `withTiming` 1500 ms | |

- Avoid Reanimated's legacy `Reanimated3DefaultSpringConfigWithDuration` (1333 ms, dampingRatio 0.5): it is too wobbly for UI.
- **Reduce Motion:** replace sweeps, slides and pulses with ≤250 ms crossfades (the Fitness [RE] pattern). Keep numericText; it is subtle. Honour Reduce Transparency, since glass falls back automatically for system components.

### Haptics

**HIG rules** (https://developer.apple.com/design/human-interface-guidelines/playing-haptics):

- Use system patterns "according to their documented meanings".
- Be consistent and causal.
- "complement other feedback… match the intensity and sharpness of a haptic with the intensity and sharpness of the animation."
- "Avoid overusing haptics."
- Prefer short haptics for discrete events.
- Make them optional.

| Event | SwiftUI `sensoryFeedback` | expo-haptics | Notes |
|---|---|---|---|
| Segment/tab/filter toggle, scrubber detent, picker | `.selection` | `selectionAsync()` | Free with system controls; don't double up |
| Pin/unpin stop, follow bus | `.impact(weight: .light)` or `.impact(flexibility: .soft)` | `impactAsync(Light/Soft)` | Paired with symbol bounce |
| Card expand / grab draggable | `.impact(weight: .medium)` | `impactAsync(Medium)` | |
| Snap to detent / "Now" on scrubber | `.impact(flexibility: .rigid)` or `.alignment` | `impactAsync(Rigid)` | |
| Arrival alert scheduled, Live Activity started | `.success` | `notificationAsync(Success)` | |
| Bus now delayed / data stale (user-initiated refresh only) | `.warning` | `notificationAsync(Warning)` | Never on background auto-refresh |
| Failed action (network error on pull-to-refresh) | `.error` | `notificationAsync(Error)` | |
| Start/stop following | `.start` / `.stop` | Medium / Light impact | |
| ETA ticking, background data updates | **none** | – | Ambient changes are visual only |

- **Sound:** off by default. If added (as in Not Boring), make it optional and respect silent mode.
- Live Activity alerts use the system notification sound. Alert **only** for "Due" and "Your stop is next".

### Live Activity checklist

From the HIG Live Activities page and the WWDC23/WWDC26 sessions:

- **Purpose and scope:**
  - Defined start and end, ≤ 8 h.
  - Glanceable essentials only.
  - No ads. No sensitive data.
  - Logo mark uncontained, not the full app icon.
  - Text in "large, heavier-weight… medium weight or higher".
- **Compact presentation:**
  - Leading and trailing read as one unit, snug to the TrueDepth camera, balanced widths (shorten units, use less precise data).
  - When width is limited, fit a 28pt circle, or show a leading view only.
  - `isDynamicIslandLimitedInWidth` (new in WWDC26) handles landscape.
- **Minimal:** live data, not just a logo.
- **Expanded:** keep relative placement, wrap tight around the sensor, and avoid a "forehead".
- **Lock Screen:**
  - 14pt margins. A unique layout, not a notification clone.
  - Dynamic height.
  - Check the generated dismiss button colour.
- **StandBy:** 2× scale, so use a container shape (no edge-bleeding graphics) or the default background with `activityBackgroundTint`. Check Night Mode.
- **Other surfaces:** declare `supplementalActivityFamilies([.small])` for Watch and CarPlay, with a dedicated small layout.
- **Updates:**
  - Update only when content changes; alert only for essentials.
  - Don't also send a push notification for the same event.
  - One activity that rotates multiple tracked buses rather than many activities.
- **Lifecycle:**
  - End immediately when done, with a custom dismissal of 15–30 min.
  - Offer an App Shortcut to start it.
  - Deep-link taps to the exact bus.
  - Let users turn it off in-app.
- **Animation:** numericText for numbers, content-replace for phase changes, max 2 s.

---

## (e) Anti-patterns these apps avoid

1. **Glass on content:** glass cards, glass list rows, glass on everything. This is the CNN rule and Apple's. NN/g: overlays on busy backgrounds hurt legibility. Also avoid **nested glass** ("double translucency").
2. **Tinting all glass with the brand colour, or putting the brand colour in the toolbar.** Crumbl and LTK moved it into content.
3. **Custom tab bars and navigation** re-implementing the system (Slack's regret). Too many tabs (Carrot cut them).
4. **Deep nested menus** that dismiss on every choice (Tide Guide).
5. **Proportional digits on live numbers**, jittering layouts, numbers that jump without a transition.
6. **"0 min"**, false precision (seconds), and unlabelled scheduled-vs-live times. Presenting stale data as live.
7. **Decorative use of status colours**, or colour as the only status signal (Guitar Wiz: Differentiate Without Color).
8. **Haptics on ambient or background events** (data refresh, every ETA tick). Double haptics on system controls. Haptics that mean different things in different places.
9. **Bounce everywhere.** Bounce > 0.4. Bounce on non-gesture transitions. Long, non-interruptible animations that block input.
10. **Live Activity sins:** cramming the app in (Uber); logo-only minimal view; alerting on every update; lingering after the trip ends; ads; pushing a notification *and* an LA update for the same event; content drawn to the island's edge.
11. **Account walls and permission prompts on first launch.** grug has "no login". Ask for location when the user asks for "Nearby".
12. **Dense, tiny, low-contrast secondary text** (the critique of Flighty on HN). Thin weights at small sizes.
13. **Separate per-surface designs that don't relate.** Flighty mirrors the Live Activity layout in-app ([RE]); HIG: "maintain relative placement" between presentations.
14. **Heavy custom chrome over the map** competing with the content. Flighty's "the map is sacred", [RE].
15. **Empty and blank error screens.** Always show last-known data with a timestamp, or a crafted empty state.
16. **Redesigning before adopting.** Tide Guide: adopt system components first; the best parts come "from just using the latest version of system components."

---

## Appendix: Expo/RN implementation notes (from the installed packages)

- **`@expo/ui@58.0.21` SwiftUI layer** includes:
  - `GlassEffectContainer`, `glassEffect({variant, interactive, tint, shape})`, `glassEffectId`
  - `contentTransition('numericText')`, `monospacedDigit()`
  - `symbolEffect(...)` (all SF Symbols 7 effects, incl. drawOn/variableColor)
  - an `Animation.{smooth,snappy,bouncy,spring,interpolatingSpring}` factory and worklet `withAnimation`
  - `BottomSheet`, `Popover`, `ContextMenu`, `Gauge`, `ProgressView`, `Chart`, `ContentUnavailableView`
  - `scrollEdgeEffectStyle`, `containerShape`, `activityBackgroundTint`, `widgetAccentedRenderingMode`

  This means hero ETA, departure rows and the timeline can be native SwiftUI islands, with numericText and symbol effects, inside RN screens.
- **`expo-glass-effect`:** `GlassView` falls back to a plain View below iOS 26. Check availability, since accessibility settings can disable it.
- **`expo-symbols` `animationSpec`:** bounce, pulse, scale, plus `variableAnimationSpec`.
- **`expo-haptics`:** `selectionAsync`, `impactAsync(Light|Medium|Heavy|Rigid|Soft)`, `notificationAsync(Success|Warning|Error)`.
- **Reanimated 4.7 duration-based presets** (from `springConfigs.d.ts`):
  - Gentle: 550 ms / dampingRatio 1
  - Snappy: 550 ms / 0.92, clamped
  - Wiggly: 550 ms / 0.75
  - Legacy default: 1333 ms / 0.5 (avoid)
- **`expo-widgets`** is installed and is the path for widgets and Live Activities in this repo.

---

## Sources

**Apple (read in full):**
- ADA 2026: https://developer.apple.com/design/awards/
- ADA 2025: https://developer.apple.com/design/awards/2025/
- ADA 2024: https://developer.apple.com/design/awards/2024/
- Behind the Design, Flighty: https://developer.apple.com/news/?id=970ncww4
- ADA Q&A, Moonlitt: https://developer.apple.com/news/?id=v1nphz91
- Sunlitt: https://developer.apple.com/articles/sunlitt/
- Gentler Streak: https://developer.apple.com/news/?id=3m0ht22s
- Art of Fauna: https://developer.apple.com/news/?id=dgmr27r7
- Is This Seat Taken?: https://developer.apple.com/news/?id=z12xq8fa
- Liquid Glass showcases: Tide Guide https://developer.apple.com/videos/play/meet-with-apple/257 · Slack https://developer.apple.com/videos/play/meet-with-apple/255/ · CNN https://developer.apple.com/videos/play/meet-with-apple/256/ · LTK https://developer.apple.com/videos/play/meet-with-apple/254/
- WWDC23 Animate with springs: https://developer.apple.com/videos/play/wwdc2023/10158/
- WWDC23 Design dynamic Live Activities: https://developer.apple.com/videos/play/wwdc2023/10194/
- WWDC26 Live Activities essentials: https://developer.apple.com/videos/play/wwdc2026/223
- WWDC18 Designing Fluid Interfaces: https://developer.apple.com/videos/play/wwdc2018/803/
- HIG Live Activities: https://developer.apple.com/design/human-interface-guidelines/live-activities
- HIG Playing haptics: https://developer.apple.com/design/human-interface-guidelines/playing-haptics
- SwiftUI docs: Animation.smooth/snappy/bouncy, Animation.default, spring(response:dampingFraction:), SensoryFeedback, ContentTransition.numericText, monospacedDigit (developer.apple.com/documentation/swiftui/…)

**Search snippets (pages blocked from fetch):**
- Apple Newsroom: 2026 ADA winners, 2025 App Store Awards
- MacRumors / 9to5Mac on the Liquid Glass gallery (Apr 2026): https://www.macrumors.com/2026/04/06/apple-liquid-glass-design-gallery-update/ · https://9to5mac.com/2026/04/06/apple-showcases-apps-using-liquid-glass-in-new-developer-gallery/
- BGR Liquid Glass apps: https://www.bgr.com/1969287/best-ios-26-apps-updated-liquid-glass-design/
- Thrifty Traveler on Flighty iOS 26: https://thriftytraveler.com/news/flighty-pro-app-ios26-update/
- Flighty 2026 updates: TechCrunch (2026-03-24), 9to5Mac (2026-07-07)
- Uber Live Activity: https://www.uber.com/us/en/blog/live-activity-on-ios/
- Cultured Code, Things for OS 26: https://culturedcode.com/things/blog/2025/09/things-for-os-26/
- Structured iOS 26: https://structured.app/blog/ios26
- MacStories Mercury Weather review: https://www.macstories.net/reviews/mercury-weather-a-crystal-clear-design-for-every-apple-device/
- Not Boring Weather: Fast Company, TapSmart, App Store story id1556321408
- NN/g Liquid Glass: https://www.nngroup.com/articles/liquid-glass/ (via Michael Tsai's quote)
- iOS 27 Liquid Glass changes: TapSmart WWDC26 recap, BGR, Tom's Guide
- Sebastiaan de With joins Apple: https://www.macrumors.com/2026/01/28/sebastiaan-de-with-joins-apple/
- appllama: https://appllama.io/ and directory listings
- Tiimo App of the Year: TechCrunch 2025-12-04; Gentler Streak iOS 26: ithinkdiff

**Reverse-engineered [RE]:** https://github.com/meliwat/awesome-ios-design-md (`design-md/travel/flighty`, `finance/apple-wallet`, `fitness/apple-fitness`, `productivity/things-3`). Cloned to `/tmp/claude-0/-home-user-bus-tracker/1886dee9-c669-51c4-bc6d-cee6ce2d3238/scratchpad/clones/awesome-ios-design-md`.
