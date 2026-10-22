# T816 BusBuddy — Phased Implementation Plans

This folder contains the step-by-step build plan for the T816 BusBuddy iOS app. Each subfolder is one phase; each markdown file inside is one executable task.

> **Superseded UI.** Phases 04–07 describe the original tab-based UI (Tracker / Map / Settings tabs, glass cards, HERE traffic ETAs). The app now uses a single map screen with a persistent Liquid Glass trip sheet and GTFS-only ETAs — see [`docs/design/README.md`](../design/README.md) for the current design and the research behind it.

## Reading order
1. `00-foundation/` — monorepo, Expo SDK 54, @expo/ui, EAS simulator build
2. `01-static-data/` — GTFS static ingest, parse, SQLite cache
3. `02-realtime-data/` — GTFS realtime protobuf decode, outlier filter
4. `03-eta-engine/` — route projection, loop-leg detection, HERE traffic, dwell buffer
5. `04-ui-shell/` — Expo Router Native Tabs with Liquid Glass
6. `05-tracker-screen/` — `@expo/ui` Form + Gauge countdown with `glassEffect`
7. `06-map-screen/` — `react-native-maps` + `expo-glass-effect` overlay
8. `07-settings-screen/` — `@expo/ui` Form with persistence
9. `08-notifications/` — Expo Push "Leave now" alerts via serverless cron
10. `09-device-install/` — Xcode free-signing runbook
11. `10-polish/` — perf, error states, a11y, final README
12. `11-multi-bus-search/` — user-curated favorite bus list + Add Bus search modal
13. `12-transit-network/` — whole Klang Valley network (rail, city bus, feeder, KTM Komuter) compiled on device
14. `13-rail-experience/` — rail lines on the map, station departure boards, line strip maps
15. `14-journey-engine/` — on-device range RAPTOR planner + live re-timing of bus legs
16. `15-journey-planner-ui/` — "Where to?" search, results, itinerary timeline, Go mode
17. `16-sheet-sections/` — Plan · Nearby · Saved sections in the trip sheet, profile button

Phases 12–15 implement [`docs/design/transit-and-planner.md`](../design/transit-and-planner.md). Order: 12 → (13 ∥ 14) → 15. Tasks numbered `00` are prototypes that gate the rest of their phase.

## File shape (every task file)
- **Context** — what prior steps delivered (carried forward each hand-off)
- **Goal** — one-sentence outcome this step adds
- **Prerequisites** — files/services that must exist first
- **Steps** — concrete actions
- **Verification** — how to prove it works
- **Handoff to next step** — exact state the next file inherits

## Source of truth
The original product brief is at the repo root (`t816-tracker-project-brief.md`). The master plan is at `/Users/willywong/.claude/plans/glimmering-sprouting-ember.md`.
