# 05-Tracker-Screen / 05 — "Leaving Now" Action

## Context
- Tracker is informational; user needs to commit to leaving.

## Goal
Add a prominent `@expo/ui` `Button` that starts a 10-minute walk timer and suppresses further "Leave now" push notifications until the timer elapses.

## Prerequisites
- Settings context (Phase 07) or hard-coded 10 min.

## Steps
1. Button at the bottom of the Host tree:
   ```tsx
   <Button
     systemImage="figure.walk"
     variant="bordered"
     onPress={startWalk}
   >
     I'm leaving now
   </Button>
   ```
2. `startWalk()`: persist `walkStartedAt` to secure store; surface a countdown in the UI.
3. While walking: suppress "Leave now" push (Phase 08).

## Verification
- Button press flips UI into "Walking — Xs remaining" mode.

## Handoff — Phase 05 complete
- Tracker is fully functional.
- Phase 06 shifts to the Map screen.
