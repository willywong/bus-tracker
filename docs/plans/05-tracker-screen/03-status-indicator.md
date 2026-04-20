# 05-Tracker-Screen / 03 — Status Indicator Gauge

## Context
- Bus ETA rows in place.
- Need a visual On Time / Delayed / No Data indicator.

## Goal
Add an `@expo/ui` `Gauge` (`circularCapacity`) that thresholds: ≤ scheduled ETA → green, ≤ +5 min → orange, > +5 min → red. No data → gauge hidden.

## Prerequisites
- Step 02; scheduled ETA available from Phase 01 `stop_times.txt`.

## Steps
1. Compute `scheduledMinutes` from next trip in SQLite.
2. `delta = current.minutesToStop - scheduledMinutes`.
3. Map delta to normalised gauge value (0..1) and threshold colors via `PlatformColor('systemGreen'/'systemOrange'/'systemRed')`.

## Verification
- Gauge color shifts as delta changes.

## Handoff to next step ([04-last-updated-ticker.md](./04-last-updated-ticker.md))
