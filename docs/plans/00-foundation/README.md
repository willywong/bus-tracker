# Phase 00 — Foundation

Bootstrap the monorepo, Expo SDK 54 mobile app, Hono API, shared package, and first EAS simulator build. Nothing downstream can run until this phase completes.

## Starting state
- `/Users/willywong/bus-tracker` exists but is empty (no git, no package.json).
- User has Node.js, pnpm (to be installed if missing), macOS with Xcode, and an Expo account.

## Success criteria
1. `pnpm install` at repo root succeeds.
2. `pnpm --filter mobile start` launches Metro + dev client.
3. `pnpm --filter api dev` serves `GET /health → 200` on `vercel dev`.
4. `eas build --profile development-simulator --platform ios` completes; resulting build installs to iOS Simulator on prompt.
5. `import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect'` resolves.
6. `import { Host, Form, Section } from '@expo/ui/swift-ui'` resolves.
7. Git repo initialized with one commit per task file (optional but recommended).

## Task order
1. [01-monorepo-skeleton.md](./01-monorepo-skeleton.md) — pnpm workspaces + turbo + base tsconfig
2. [02-mobile-app-init.md](./02-mobile-app-init.md) — `pnpm create expo-app`, Expo Router, NativeWind
3. [03-install-native-deps.md](./03-install-native-deps.md) — `@expo/ui`, `expo-glass-effect`, `expo-sqlite`, notifications, maps, protobuf, turf
4. [04-api-app-init.md](./04-api-app-init.md) — Hono on Vercel Edge with `/health`
5. [05-shared-package.md](./05-shared-package.md) — `@bus-tracker/shared` types + utils barrel
6. [06-eas-simulator-build.md](./06-eas-simulator-build.md) — first EAS simulator build
7. [07-env-and-secrets.md](./07-env-and-secrets.md) — HERE key only in API; `EXPO_PUBLIC_API_BASE_URL` for mobile

## Hand-off to Phase 01
- Monorepo is runnable locally.
- Mobile dev client is installed on Simulator.
- API is deployable to Vercel (local `vercel dev` works; deployment deferred to phase 08).
- `@bus-tracker/shared` is importable from both apps.
- `.env.example` committed; `.env` gitignored; `EXPO_PUBLIC_API_BASE_URL` wired into the mobile app.
