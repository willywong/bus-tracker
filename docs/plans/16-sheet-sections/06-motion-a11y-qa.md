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

## Implementation notes (2026-10-23)

Run on the iPhone 17 Pro Max Simulator, Debug build with Metro. JS-only throughout: no prebuild.

- **Crossfade.** `SectionBody` fades the incoming body in over `motion.crossfade` (none under Reduce Motion). It is wrapped in `LayoutAnimationConfig skipExiting`, so the outgoing body leaves at once. Before that fix, the Nearby peek card's own `exiting` fade showed as a ghost under Plan. Verified: no ghost, and rapid Plan → Nearby → Saved taps land on the last one tapped.
- **Scroll reset.** `SheetScroll` takes a `resetKey` (the section) and scrolls to the top with no animation when it changes.
- **Bare `t816://` while running** (`app/+native-intent.tsx`). Since 13/05 the bare link was routed to `/`, which pushed a second map over the trip sheet. A warm bare link is now dropped (`redirectSystemPath` returns null when `!initial`), and `useSectionLinks` turns the sheet to Nearby. `isBareLink` in `components/rail/deepLink.ts` serves both and is unit-tested. Verified: on Plan, `xcrun simctl openurl … t816://` turns the sheet to Nearby, and the sheet stays up.
- **Loop routes in the Today grid** (`Timetable`). T815 passes the same stop twice on one trip. That gave duplicate React keys (a LogBox error) and two blue "your bus" chips. The key now includes the departure time, and only the trip's first pass is marked. Verified on T815: one blue chip, no error.
- **Dark mode.** Plan, Nearby and Saved checked at peek: the picker, rows, tiles and route badges read correctly.
- **Dynamic Type, AX3** (accessibility-extra-extra-extra-large):
  - At peek, every section shows the picker and its first row.
  - The SwiftUI segmented control keeps its size. That is the system behaviour for segmented controls, which offer the Large Content Viewer on long press instead; it is not a bug to fix.
  - **Route badge** (`RouteBadge`): it had a fixed 24 pt height, so the code was cut in half. It now uses `minHeight` plus `maxFontSizeMultiplier={1.6}`, as the rail `LineBadge` does.
  - **Saved tiles**: the 76 pt square pushed the thumbnail under the picker and cut labels to "H…". The tile now grows (`minHeight`), and its label scales to at most 1.3×.
  - Plan's Home detail truncates to "Leave 7:19 AM · …" at AX3. That is the one-line row design, the same as `SuggestionRow`.
  - Anything below the first row clips at peek, as recorded in 15/08.
- **VoiceOver**: checked in code only; the Simulator tools can't drive VoiceOver.
  - The picker is a native SwiftUI `Picker` labelled "Sheet section".
  - The profile circle is labelled "Settings".
  - Plan rows, Saved tiles and route rows carry the labels and hints from 03 and 04. The active route also carries `selected`.
- **Not run:**
  - **Release build.** Criteria 1, 2 and 4 were checked in Debug only.
  - **iPhone SE peek.** The 0.4 cap was worked out, not seen on that Simulator.
  - **Cold-launch quick action.** Covered by `useQuickActions`, which sets `plan`, and by 15/08's native patch; not re-run this phase.
  - **break-ui worst-case data**: 60-character recents, 6 pins plus Home and Work, 12 routes. The truncation and scrolling come from the components' `numberOfLines` and horizontal `ScrollView`; not seeded on the Simulator.

### Success criteria

| # | Result |
|---|---|
| 1 | Verified on the 17 Pro Max: the picker shows at peek, switching sections never moves the sheet, and the 252 pt peek fits. iPhone SE not run. |
| 2 | Verified: Nearby's peek matches the old one, below the picker row. |
| 3 | Verified for stop detail: the picker hides and back returns to Saved. Go and ride share the same `sheetMode` gate, which is unit-tested. |
| 4 | Live Activity link → Nearby verified while running. Cold-launch quick action: code and unit tests only. |
| 5 | Verified: the section survives a relaunch. |
| 6 | Code-level only (see VoiceOver). |
| 7 | Verified: "…" is gone, Share arrival is in Nearby, and the profile button opens Settings. |
| 8 | `tsc` clean; `pnpm test` 448/448 (the railShapes timing test flaked once and passed on rerun). |
