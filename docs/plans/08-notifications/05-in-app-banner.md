# 08-Notifications / 05 — In-App Banner

## Goal
When a push arrives while the app is foregrounded, show an in-app banner instead of the system notification.

## Steps
1. `Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldPlaySound: true }) })`.
2. Listen via `Notifications.addNotificationReceivedListener` — render a `GlassGuard` banner at the top of the screen for 6 seconds.

## Verification
- Foreground the app when cron fires → banner visible with "Leave now".

## Handoff — Phase 08 complete
- Notifications are reliable in Simulator.
- Phase 09 installs on real hardware so APNs delivery is validated.
