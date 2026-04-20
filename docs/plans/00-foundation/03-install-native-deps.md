# 00-Foundation / 03 — Install Native Dependencies

## Context
- Step 02 complete: `apps/mobile` boots on Expo SDK 54 with Expo Router + NativeWind.
- No native modules installed yet beyond the template defaults.

## Goal
Install every native module the project will need (Expo UI, Glass Effect, SQLite, Notifications, BackgroundFetch, TaskManager, SecureStore, Maps, protobuf, Turf) so the next EAS build carries them all.

## Prerequisites
- Step 02 complete.

## Steps
1. From repo root, install **Expo-managed** native modules (use `expo install` so versions match SDK 54):
   ```bash
   pnpm --filter mobile exec expo install \
     @expo/ui \
     expo-glass-effect \
     expo-sqlite \
     expo-notifications \
     expo-task-manager \
     expo-background-fetch \
     expo-secure-store \
     expo-location \
     expo-device
   ```
2. Install plain JS deps:
   ```bash
   pnpm --filter mobile add \
     react-native-maps \
     protobufjs \
     @turf/nearest-point-on-line \
     @turf/helpers \
     @turf/distance \
     date-fns
   ```
3. Add required plugins to `apps/mobile/app.json`:
   ```jsonc
   {
     "expo": {
       "plugins": [
         "expo-router",
         "expo-glass-effect",
         "expo-sqlite",
         "expo-notifications",
         "expo-task-manager",
         "expo-background-fetch",
         "expo-secure-store",
         ["expo-location", { "locationAlwaysAndWhenInUsePermission": "Allow T816 Tracker to show bus and user location on the map." }]
       ],
       "ios": {
         "bundleIdentifier": "com.willywong.bustracker",
         "infoPlist": {
           "UIBackgroundModes": ["fetch", "remote-notification"]
         }
       }
     }
   }
   ```
4. Smoke-test imports from a scratch file (delete after):
   ```ts
   // apps/mobile/scratch-imports.ts
   import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
   import { Host, Form, Section, HStack, Toggle } from '@expo/ui/swift-ui';
   import { glassEffect } from '@expo/ui/swift-ui/modifiers';
   import * as SQLite from 'expo-sqlite';
   import * as Notifications from 'expo-notifications';
   import MapView from 'react-native-maps';
   import protobuf from 'protobufjs';
   import nearestPointOnLine from '@turf/nearest-point-on-line';
   console.log(GlassView, isGlassEffectAPIAvailable, Host, Form, Section, HStack, Toggle, glassEffect, SQLite, Notifications, MapView, protobuf, nearestPointOnLine);
   ```
   Run `pnpm --filter mobile exec tsc --noEmit` — should pass. Delete the scratch file.
5. Commit: `git add -A && git commit -m "feat(mobile): install native deps for glass, sqlite, maps, notifications, protobuf, turf"`.

## Verification
- `pnpm --filter mobile exec tsc --noEmit` passes.
- `apps/mobile/package.json` lists every dep above.
- `apps/mobile/app.json` plugins array includes every Expo plugin listed.

## Handoff to next step ([04-api-app-init.md](./04-api-app-init.md))
- All native modules are declared; however, **they won't work in Expo Go** — the next EAS build (step 06) bakes them into the dev client.
- Mobile app still runs (no runtime errors) because native modules load lazily; we have not yet imported them from screens.
