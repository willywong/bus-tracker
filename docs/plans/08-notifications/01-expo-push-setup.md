# 08-Notifications / 01 — Expo Push Setup

## Context
- Phase 07 complete: settings persist.
- `expo-notifications` installed.

## Goal
Request notification permission on first launch, obtain the Expo push token, and send it to the backend for storage.

## Steps
1. On app boot (once), `Notifications.requestPermissionsAsync()` then `Notifications.getExpoPushTokenAsync()`.
2. POST `token` to `apps/api /api/push/register` → store in Vercel KV keyed by a stable device id.
3. Handle denied permission: surface a small banner on Tracker.

## Verification
- Token prints in Metro logs; KV contains one row.

## Handoff to next step ([02-leave-now-logic.md](./02-leave-now-logic.md))
