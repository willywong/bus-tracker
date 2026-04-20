# Phase 05 — Tracker Screen (@expo/ui + glassEffect)

The centrepiece. A SwiftUI-native screen with a giant "Leave in X minutes" countdown card using the `glassEffect` modifier, a live ETA section, status indicator gauge, last-updated ticker, and a "leaving now" action button. Built entirely with `@expo/ui/swift-ui` primitives inside one `<Host style={{ flex: 1 }}>`.

## Dependencies
- Phase 03 complete: `useEta()` returns a minute value.
- Phase 04 complete: Tracker tab mounted.
- `@expo/ui` native module installed; Xcode 26 / iOS 26 target available.

## Success criteria
1. Home screen renders with `<Host><Form>…</Form></Host>` — no `<View>` at the root.
2. Countdown card (`Text` size ~64, `glassEffect({ glass: { variant: 'clear' } })` + `padding({ all: 24 })`) shows "Leave in 7 min" (example).
3. Current bus ETA section (`Form` + `Section` + `HStack` rows) shows minutes, vehicle id, "On time / Delayed / No data" badge.
4. Status indicator uses `Gauge` (`circularCapacity`) with PlatformColor thresholds.
5. Last-updated ticker text updates every 30s with the realtime poll.
6. "I'm leaving now" `Button` flips a local walk-timer state.

## Task order
1. [01-countdown-card.md](./01-countdown-card.md)
2. [02-bus-eta-section.md](./02-bus-eta-section.md)
3. [03-status-indicator.md](./03-status-indicator.md)
4. [04-last-updated-ticker.md](./04-last-updated-ticker.md)
5. [05-leaving-now-action.md](./05-leaving-now-action.md)

## Hand-off to Phase 06
- Tracker screen fully functional with real data on Simulator (visual glass fidelity deferred to Phase 09 real-device QA).
- Same shared `useEta()` and `useBusPosition()` hooks will be reused by the Map screen.
