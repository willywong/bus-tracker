# 10-Polish / 02 — Error States

## Goal
Cover the obvious failure modes with specific UI, not crashes or blank screens.

## Checklist
- [ ] No network on first launch (static cache missing) → full-screen retry state.
- [ ] Network but realtime endpoint 5xx → Tracker shows "Bus data unavailable — last seen X min ago".
- [ ] Realtime works but traffic proxy fails → fallback to scheduled ETA with "(scheduled)" badge.
- [ ] Cache >24h old → pulsing "Refreshing route data…" banner.
- [ ] Notifications denied → Tracker shows a non-blocking banner with an "Enable in Settings" deep link.

## Verification
- Toggle airplane mode mid-session → all screens remain intelligible.

## Handoff to next step ([03-accessibility.md](./03-accessibility.md))
