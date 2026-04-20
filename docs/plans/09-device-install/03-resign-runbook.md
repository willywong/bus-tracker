# 09-Device-Install / 03 — 7-Day Re-sign Runbook

## Context
- Free Apple ID certificates expire every 7 days (brief §7).

## Goal
Document the ~1 minute re-sign procedure as a top-level runbook so the user never has to rediscover it.

## Steps
1. Write `docs/RUNBOOK_RESIGN.md` (or append to root README):
   ```
   When the app stops launching with "untrusted" error:
   1. Plug iPhone into Mac
   2. open apps/mobile/ios/T816Tracker.xcworkspace
   3. Hit ▶ Run in Xcode
   4. App re-signs and reinstalls in ~1 min — data preserved
   ```
2. Add a reminder: no need to rebuild JS — this is pure re-signing.

## Verification
- Wait 8 days → follow the runbook → app runs again.

## Handoff to next step ([04-liquid-glass-real-device-qa.md](./04-liquid-glass-real-device-qa.md))
