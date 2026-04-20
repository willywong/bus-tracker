# 06-Map-Screen / 04 — User Stop Marker

## Context
- Bus markers animate. User's preferred stop also needs visual anchor.

## Goal
Show a distinctive marker at the user's preferred stop (default: Hotel Lisa De Inn; alternative: PJ210).

## Prerequisites
- Preferred stop is available from Settings context (Phase 07) — for now, hard-code to Hotel Lisa De Inn.

## Steps
1. Read stop lat/lng from SQLite.
2. Render `<Marker coordinate={stop} title={stop.name} pinColor="green" />`.
3. Tap marker → show callout with scheduled + live ETA.

## Verification
- Marker visible at the correct location; tap shows callout.

## Handoff to next step ([05-glass-overlay-card.md](./05-glass-overlay-card.md))
