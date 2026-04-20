# 07-Settings-Screen / 07 — Persistence

## Context
- All five settings exist as local state; values are lost on app restart.

## Goal
Persist all settings via `expo-secure-store` and expose via a `SettingsContext`.

## Prerequisites
- `expo-secure-store` installed.

## Steps
1. `apps/mobile/hooks/useSettings.ts`:
   - On mount, read all keys from secure store.
   - On change, write-through.
2. Wrap the app in a `SettingsProvider` at `app/_layout.tsx` above `NativeTabs`.
3. Replace local `useState` in Settings form with context getters/setters.

## Verification
- Change a setting → kill app → reopen → value preserved.

## Handoff — Phase 07 complete
- Settings persist.
- Phase 08 notifications read these values.
