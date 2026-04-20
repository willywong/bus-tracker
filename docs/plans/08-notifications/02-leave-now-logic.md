# 08-Notifications / 02 — Leave Now Trigger Logic

## Goal
Centralise the decision function: given ETA, walk minutes, buffer minutes, and quiet hours → `shouldNotify(): boolean`.

## Steps
1. Pure function in `packages/shared/src/utils/leave-now.ts`:
   ```ts
   export function shouldNotify(p: {
     etaMinutes: number;
     walkMinutes: number;
     bufferMinutes: number;
     now: Date;
     quietStartMin: number;
     quietEndMin: number;
   }): boolean { /* … */ }
   ```
2. Trigger fires when `etaMinutes <= walkMinutes + bufferMinutes` and we're outside quiet hours.

## Verification
- Unit tests cover midnight-wrapping quiet hours and edge cases.

## Handoff to next step ([03-serverless-poller.md](./03-serverless-poller.md))
