# Phase 08 — "Leave Now" Push Notifications

iOS aggressively suspends apps, so reliable "leave now" pushes must come from the serverless cron, not a background task on the phone. The cron polls the bus position every minute, evaluates ETA vs walk+buffer against stored user settings, and fires via Expo Push when the condition is met (respecting quiet hours).

## Dependencies
- Phase 03 complete (ETA logic reusable in backend).
- Phase 07 complete (user settings persisted; need to be readable by backend — see task 03).

## Success criteria
1. Mobile app registers for Expo push token on first launch and stores it via the backend.
2. Serverless cron (`/cron/leave-now`) runs every minute.
3. Cron loads the user's settings (single-user app — stored in Vercel KV or just env vars acceptable for personal use), pulls realtime + static GTFS, computes ETA, compares to walk+buffer.
4. If trigger fires and current time ∉ quiet hours, send Expo push with "Leave now — bus arrives in X min".
5. Foreground handler shows an in-app banner if the push arrives while app is open.
6. De-duplication: don't fire more than once per 15-minute window for the same vehicle.

## Task order
1. [01-expo-push-setup.md](./01-expo-push-setup.md)
2. [02-leave-now-logic.md](./02-leave-now-logic.md)
3. [03-serverless-poller.md](./03-serverless-poller.md)
4. [04-quiet-hours-gate.md](./04-quiet-hours-gate.md)
5. [05-in-app-banner.md](./05-in-app-banner.md)

## Hand-off to Phase 09
- Notifications work in the Simulator for manual test sends.
- Push token is registered; cron is live on Vercel.
- Ready to install on a real iPhone where notifications fully exercise APNs.
