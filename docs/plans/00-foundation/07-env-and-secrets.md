# 00-Foundation / 07 — Environment & Secrets

## Context
- Steps 01–06 complete. Monorepo is fully bootstrapped; EAS build runs; shared package importable.
- Next phases will call HERE Maps (needs a key) and data.gov.my (no key). We lock down the secret-handling convention **before** any code references keys, so no key ever ends up in the mobile bundle.

## Goal
Define a clear separation: **server-only secrets in `apps/api`**; **public URLs only in mobile via `EXPO_PUBLIC_*`**. Commit `.env.example` files; never commit `.env`.

## Prerequisites
- Steps 01–06 complete.
- User has created a free HERE Maps account at https://developer.here.com and grabbed an API key (or deferred to Phase 03 when it's first needed — in that case, this task just establishes the scheme).

## Steps
1. Create `apps/api/.env.example`:
   ```
   HERE_API_KEY=
   TOMTOM_API_KEY=
   KV_REST_API_URL=
   KV_REST_API_TOKEN=
   KV_URL=
   EXPO_ACCESS_TOKEN=
   ```
2. Create `apps/mobile/.env.example`:
   ```
   EXPO_PUBLIC_API_BASE_URL=https://t816-tracker-api.vercel.app
   ```
   For local dev set `EXPO_PUBLIC_API_BASE_URL=http://localhost:3001` in `apps/mobile/.env.local`.
3. Expose `API_BASE_URL` from a single module `apps/mobile/config/env.ts`:
   ```ts
   export const API_BASE_URL =
     process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';
   ```
4. In `apps/api/api/index.ts` read server-only envs directly: `process.env.HERE_API_KEY`. Never export these to the client.
5. Ensure root `.gitignore` contains:
   ```
   .env
   .env.local
   apps/*/.env
   apps/*/.env.local
   ```
6. Add Vercel env vars via CLI (when the API is first deployed — deferred to Phase 08, but document here):
   ```bash
   vercel env add HERE_API_KEY production
   vercel env add HERE_API_KEY preview
   vercel env add HERE_API_KEY development
   ```
7. Commit: `git add . && git commit -m "chore: env + secrets conventions (.env.example only)"`.

## Verification
- `grep -r 'HERE_API_KEY' apps/mobile/` returns nothing.
- `grep -r 'EXPO_PUBLIC_' apps/api/` returns nothing.
- `.env.example` files exist in both apps; real `.env` files are gitignored.

## Handoff — Phase 00 complete
Deliverables in place:
- pnpm + Turborepo monorepo with three workspaces (`apps/mobile`, `apps/api`, `packages/shared`).
- Expo SDK 54 mobile dev client installed in iOS Simulator via EAS.
- Hono-on-Vercel-Edge API with `/api/health`.
- Shared types + utils barrel importable in both apps.
- Secret-handling convention documented and gitignored.

Phase 01 begins with [../01-static-data/README.md](../01-static-data/README.md), which implements the GTFS static parser in `packages/shared/utils/gtfs-parser.ts` and connects it to both the API (serving filtered T816 data) and the mobile app (caching it in SQLite).
