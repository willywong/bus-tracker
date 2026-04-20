# 08-Notifications / 03 — Serverless Poller

## Context
- iOS won't run the app in the background reliably (brief §8.5).

## Goal
`GET /api/cron/leave-now` runs every minute: pull realtime, compute ETA server-side, evaluate `shouldNotify`, send Expo push when true.

## Steps
1. Vercel cron entry: `{ "path": "/api/cron/leave-now", "schedule": "* * * * *" }`.
2. Endpoint loads settings + push token from KV (single-user app — one row).
3. Compute ETA server-side using the same `packages/shared` utils.
4. If `shouldNotify && lastSentAt > 15 min ago` → POST Expo push `{ to: token, title: 'T816 bus', body: 'Leave now — bus in X min' }`.
5. Update `lastSentAt` in KV.

## Verification
- Vercel logs show `/cron/leave-now` every minute.
- Manual trigger via `vercel dev` + forcing `shouldNotify` true → notification arrives on Simulator (via `expo push:send`).

## Handoff to next step ([04-quiet-hours-gate.md](./04-quiet-hours-gate.md))
