# 00-Foundation / 02 — Mobile App Init

## Context
- Step 01 complete: pnpm workspace with `apps/*` + `packages/*`, `tsconfig.base.json`, `turbo.json`, `.gitignore`, git repo initialised. No apps exist yet.

## Goal
Create `apps/mobile` as an Expo SDK 54 TypeScript app with Expo Router file-based routing and NativeWind v4. Verify it boots in Metro.

## Prerequisites
- Step 01 complete.
- `pnpm` working from repo root.

## Steps
1. From repo root:
   ```bash
   pnpm create expo-app apps/mobile --template tabs --yes
   ```
   (The `tabs` template gives Expo Router + file-based routing pre-configured.)
2. `cd apps/mobile` and verify `package.json` lists Expo SDK `~54.0.0`. If the template lags:
   ```bash
   pnpm dlx expo install expo@latest
   pnpm dlx expo install --fix
   ```
3. Set bundle identifier in `apps/mobile/app.json`:
   ```json
   {
     "expo": {
       "name": "T816 Tracker",
       "slug": "t816-tracker",
       "scheme": "t816",
       "ios": {
         "bundleIdentifier": "com.willywong.bustracker",
         "supportsTablet": false
       },
       "newArchEnabled": true,
       "jsEngine": "hermes"
     }
   }
   ```
4. Install NativeWind v4 (used only in the Map screen RN tree):
   ```bash
   cd /Users/willywong/bus-tracker
   pnpm --filter mobile add nativewind tailwindcss@^3
   pnpm --filter mobile add -D @types/react
   ```
   Follow [NativeWind v4 setup](https://www.nativewind.dev/) to add `tailwind.config.js`, `global.css`, and configure `metro.config.js`. Keep it minimal — only the Map screen needs it.
5. Extend TypeScript: `apps/mobile/tsconfig.json`:
   ```json
   {
     "extends": ["expo/tsconfig.base", "../../tsconfig.base.json"],
     "compilerOptions": { "strict": true }
   }
   ```
6. From repo root:
   ```bash
   pnpm --filter mobile start
   ```
7. Press `i` in Metro — app should boot in iOS Simulator (still Expo Go until Step 06; dev client comes later).
8. Commit: `git add apps/mobile && git commit -m "feat(mobile): expo sdk 54 app with expo router + nativewind"`.

## Verification
- `pnpm --filter mobile start` opens Metro without errors.
- Pressing `i` launches the tabs template in Simulator.
- `apps/mobile/package.json` shows Expo ~54.

## Handoff to next step ([03-install-native-deps.md](./03-install-native-deps.md))
- `apps/mobile` exists and runs.
- Expo Router is already wired by the `tabs` template — we'll reshape its routes in Phase 04.
- NativeWind v4 is installed but only styles the Map screen later.
- No native-module dependencies yet; next step installs `@expo/ui`, `expo-glass-effect`, etc.
