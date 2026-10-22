# 16-Sheet-Sections / 06 — Motion, Accessibility and QA

**Build impact:** JS-only (Metro reload). Run the final pass on a Release build too (`npx expo run:ios --configuration Release`). Building Release isn't a native *change*, but it does need an Xcode build.

## Context
- **From 02–05:**
  - the `sections` mode renders `whereTo`, then `SectionPicker`, then a keyed `Animated.View` holding Plan, Nearby or Saved (`FadeIn.duration(motion.crossfade)`, none under Reduce Motion);
  - the peek is 252 pt of content, capped at 0.4;
  - the profile circle opens Settings, and "…" is gone;
  - quick actions and bare `t816://` set the section.
- **Known from 15/08:**
  - at AX text sizes the peek can clip, and the When menu doesn't scale;
  - Reduce Motion means crossfades only;
  - the motion table is in `docs/design/transit-and-planner.md` §7.
- **Simulator:** iPhone 17 Pro Max, UDID `C8004D24-F5C7-40B7-BB75-1007E42F3668`. Don't grant permission prompts on the user's behalf.

## Goal
Section switches feel instant and calm, and work with VoiceOver, Dynamic Type and Reduce Motion. Worst-case data doesn't break any section. The phase's success criteria are checked on the Simulator.

## Prerequisites
- 03, 04 and 05 merged.
- Invoke `animate-expo`, `emil-design-eng` and `break-ui`.

## Steps
1. **Motion.**
   - **Crossfade.** The section body fades in over `motion.crossfade` with `EASE_OUT` and no travel. The outgoing body leaves instantly: no `exiting`, so two bodies never stack and change the scroll height.
   - **Rapid taps.** Tap Plan, Nearby and Saved quickly in a row. Nothing queues or flickers, and the final section is the last one tapped.
   - **Scroll position.** Switching sections at large resets the scroll to the top: key `SheetScroll` content or call `scrollTo({ y: 0, animated: false })`. A long Nearby scroll offset must not carry into a short Plan.
2. **Peek pin.** Switch sections while `plan` or `itinerary` is up (the trip is pinned to peek). The pin holds and the trip never shows above the shorter sheet.
3. **VoiceOver.**
   - The picker reads as one segmented control with 3 items.
   - The section body's first element follows it in reading order.
   - The profile circle reads "Settings".
   - Tiles and rows read as specified in 03 and 04.
   - Fix any SwiftUI wording problems with `accessibilityLabel` on the `Text` children.
4. **Dynamic Type.**
   - At **Large** (default) and **AX3**, at peek, the picker and the first row of every section show.
   - Clipping below that at AX sizes matches the known 15/08 behaviour. Record it in this file; don't redesign the peek.
   - The segmented `Picker` scales with the system.
5. **break-ui.**
   - **Plan:** a 60-character recent ("Universiti Malaya Medical Centre (Pusat Perubatan Universiti Malaya)") truncates to one line with the detail on the next.
   - **Saved:** 6 pins plus Home and Work scroll horizontally, and the Add tile shows full. A 40-character pin name truncates under its tile.
   - **Routes:** 12 favourite routes scroll at large and show 0 rows at peek.
   - **Nearby:** every `TripState` (loading, arrival, before-service, service-ended, no-service, empty) under the picker.
   - **Dark mode** for all three sections.
6. **Phase criteria.** Walk README success criteria 1–8 on the Simulator in Debug, then repeat 1, 2 and 4 on Release.
   - Write results under "Implementation notes" in this file, as 15/08 did, with the date and anything verified only by unit tests.

## Verification
- `npx tsc --noEmit -p .` and `pnpm test` are green.
- Screenshots of each section at peek, glance and large, light and dark. Keep them in the scratchpad, not the repo.
- Every README criterion is marked verified, or explained.

## Handoff to next step (post phase)
- **Memory:** the project note says "sheet sections Plan · Nearby · Saved, profile → Settings; no tab bar".
- **Follow-ups recorded in the README:**
  - live Home/Work leave times (background `plan()`);
  - a "Buses nearby" layer feeding Nearby;
  - pinned stations in Saved.
