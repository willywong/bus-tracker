# 05-Tracker-Screen / 04 — Last Updated Ticker

## Context
- Tracker shows live data but user has no feedback on freshness.

## Goal
Add a muted text line "Updated Xs ago" that increments every second.

## Prerequisites
- `useBusPosition().lastUpdated`.

## Steps
1. Use `date-fns` `formatDistanceToNowStrict(lastUpdated, { addSuffix: true })`.
2. Re-render via a 1s `useInterval` tick.
3. When `>= 90s` stale → style red via token.

## Verification
- Text updates every second; turns red when the poller stops.

## Handoff to next step ([05-leaving-now-action.md](./05-leaving-now-action.md))
