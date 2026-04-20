# 07-Settings-Screen / 05 — Traffic Provider Toggle

## Goal
Switch between HERE (default) and TomTom.

## Steps
1. `Picker` with two options.
2. Setting is sent to backend `/traffic-eta?provider=here|tomtom` as a query param.
3. Backend `/traffic-eta` must honour the `provider` param (was HERE-only in Phase 03 step 03 — extend to TomTom now).

## Verification
- Toggling provider changes the `source` field returned by `useEta()`.

## Handoff to next step ([06-quiet-hours.md](./06-quiet-hours.md))
