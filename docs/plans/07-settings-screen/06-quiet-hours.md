# 07-Settings-Screen / 06 — Quiet Hours

## Goal
Two `DateTimePicker`s (time-only) for quiet-hours start/end. Defaults: start 22:00, end 06:00.

## Steps
1. `import { DateTimePicker } from '@expo/ui/swift-ui'` (or `@expo/ui`).
2. Store as minute-of-day integers (0–1439) so comparisons work across midnight.
3. Helper `isWithinQuietHours(now, start, end)` handles wrapping ranges.

## Verification
- Setting quiet 22:00–06:00 triggers helper to return true at 23:30 and 05:00.

## Handoff to next step ([07-persistence.md](./07-persistence.md))
