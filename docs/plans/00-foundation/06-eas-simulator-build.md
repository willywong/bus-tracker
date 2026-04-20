# 00-Foundation / 06 — First EAS Simulator Build

## Context
- Steps 01–05 complete. All native modules declared in `apps/mobile/app.json`. Expo Go cannot execute glass / SQLite / notifications — we need a **development client** built via EAS.

## Goal
Produce a simulator-compatible dev client via `eas build --profile development-simulator --platform ios`, install it into Simulator, and confirm JS hot-reload works.

## Prerequisites
- Steps 01–05 complete.
- An Expo account (free at [expo.dev](https://expo.dev)).
- Xcode installed (Simulator required).

## Steps
1. Install EAS CLI:
   ```bash
   cd /Users/willywong/bus-tracker
   pnpm add -Dw eas-cli
   pnpm exec eas login
   ```
2. Initialise EAS for the mobile app:
   ```bash
   pnpm exec eas init --id auto --scope $(pnpm exec eas whoami | xargs)
   cd apps/mobile
   ```
3. Create `apps/mobile/eas.json`:
   ```json
   {
     "cli": { "version": ">= 13.0.0", "appVersionSource": "remote" },
     "build": {
       "development-simulator": {
         "developmentClient": true,
         "distribution": "internal",
         "ios": { "simulator": true },
         "channel": "development"
       },
       "development-device": {
         "developmentClient": true,
         "distribution": "internal",
         "ios": { "simulator": false },
         "channel": "development"
       }
     }
   }
   ```
4. Kick off the build:
   ```bash
   pnpm exec eas build --profile development-simulator --platform ios
   ```
   Wait for the free-tier queue (5–15 min). When finished, the CLI prompts to install into the currently-open Simulator — accept.
5. Start Metro with the dev client:
   ```bash
   cd /Users/willywong/bus-tracker
   pnpm --filter mobile start --dev-client
   ```
   In Simulator: open the T816 Tracker app → it should connect to Metro automatically.
6. Edit any text in `apps/mobile/app/(tabs)/index.tsx`, save — Simulator hot-reloads.
7. Commit: `git add apps/mobile/eas.json && git commit -m "chore(mobile): eas simulator + device build profiles"`.

## Verification
- EAS build succeeds (artifact URL printed).
- Dev client installs and boots in Simulator.
- JS edits hot-reload within ~1s.
- `require('expo-glass-effect').isGlassEffectAPIAvailable()` returns `true` or `false` at runtime (don't crash).

## Handoff to next step ([07-env-and-secrets.md](./07-env-and-secrets.md))
- Build number + artifact URL are recorded in the EAS dashboard — reference them if something breaks later.
- Dev client stays installed in Simulator until the bundle identifier changes or a new native module is added.
- Last step of Phase 00 remains: document env + secrets scheme.
