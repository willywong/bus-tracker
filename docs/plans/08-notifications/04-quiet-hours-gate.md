# 08-Notifications / 04 — Quiet Hours Gate

## Context
- Cron runs every minute.
- Quiet hours already implemented in `shouldNotify`; this task verifies the gate end-to-end and adds a safety valve.

## Goal
Ensure no push fires during quiet hours, even on clock drift / timezone mistakes.

## Steps
1. Cron uses `Asia/Kuala_Lumpur` via `Intl.DateTimeFormat` — verify no UTC/local mix.
2. Add hard-coded fallback: never send between 00:00 and 05:00 local regardless of user config.

## Verification
- Change phone time to 03:00 local (or spoof `now` in an integration test) → no push.

## Handoff to next step ([05-in-app-banner.md](./05-in-app-banner.md))
