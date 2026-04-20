# 03-ETA-Engine / 04 — Dwell Buffer

## Context
- Traffic API gives drive time, not passenger loading time (brief §9).

## Goal
Add 1–2 min buffer per intermediate stop between bus and user's stop.

## Prerequisites
- Phase 01 stop list in SQLite.

## Steps
1. Count stops between `busProjection.segmentIndex` and user's stop's `segmentIndex`.
2. `dwellMinutes = count * 1.5` (tunable constant — expose via a Settings flag later if needed).
3. Final ETA = `trafficMinutes + dwellMinutes`.

## Verification
- Spot-check: 3 intermediate stops → +4.5 min added.

## Handoff to next step ([05-useEta-hook.md](./05-useEta-hook.md))
- The ETA function is composable and pure: inputs are projection + stop list + traffic minutes.
