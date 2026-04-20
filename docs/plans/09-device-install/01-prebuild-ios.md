# 09-Device-Install / 01 — Expo Prebuild iOS

## Context
- Phase 08 complete: the simulator app is fully working.
- To install via Xcode we need the native `ios/` directory generated.

## Goal
Run `expo prebuild` to emit `apps/mobile/ios/*.xcworkspace`.

## Steps
1. `cd apps/mobile && npx expo prebuild --platform ios --clean`.
2. Verify `ios/T816Tracker.xcworkspace` exists.
3. Add `apps/mobile/ios/` to `.gitignore` — it's regeneratable.

## Verification
- Workspace opens in Xcode without errors (`open ios/*.xcworkspace`).

## Handoff to next step ([02-xcode-free-signing.md](./02-xcode-free-signing.md))
