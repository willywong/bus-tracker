# 00-Foundation / 04 — API App Init (Hono on Vercel Edge)

## Context
- Steps 01–03 complete. Monorepo + mobile app done. No backend exists yet.

## Goal
Create `apps/api` as a Hono-on-Vercel-Edge app with a `GET /health` route, runnable locally via `vercel dev`.

## Prerequisites
- `vercel` CLI (install globally if missing: `pnpm add -g vercel`).

## Steps
1. From repo root:
   ```bash
   mkdir -p apps/api/src/routes apps/api/cron
   cd apps/api
   pnpm init
   ```
2. Edit `apps/api/package.json`:
   ```json
   {
     "name": "api",
     "version": "0.1.0",
     "private": true,
     "type": "module",
     "scripts": {
       "dev": "vercel dev --listen 3001",
       "deploy": "vercel deploy --prod"
     },
     "dependencies": {
       "hono": "^4.6.0"
     },
     "devDependencies": {
       "@types/node": "^20",
       "typescript": "^5.6",
       "vercel": "^37"
     }
   }
   ```
3. Install:
   ```bash
   cd /Users/willywong/bus-tracker
   pnpm install
   ```
4. Create `apps/api/tsconfig.json`:
   ```json
   {
     "extends": "../../tsconfig.base.json",
     "compilerOptions": {
       "module": "ESNext",
       "moduleResolution": "Bundler",
       "types": ["node"]
     },
     "include": ["src/**/*", "cron/**/*"]
   }
   ```
5. Create `apps/api/api/index.ts` (Vercel serves anything under `/api/` as a function):
   ```ts
   import { Hono } from 'hono';
   import { handle } from 'hono/vercel';

   export const config = { runtime: 'edge' };

   const app = new Hono().basePath('/api');

   app.get('/health', (c) => c.json({ ok: true, at: new Date().toISOString() }));

   export default handle(app);
   ```
6. Create `apps/api/vercel.json`:
   ```json
   {
     "$schema": "https://openapi.vercel.sh/vercel.json",
     "functions": { "api/*.ts": { "runtime": "edge" } }
   }
   ```
7. From `apps/api`:
   ```bash
   pnpm dev
   ```
   (On first run, `vercel dev` may ask to link the project — create a new Vercel project linked to this dir.)
8. `curl http://localhost:3001/api/health` → `{"ok":true,"at":"…"}`.
9. Commit: `git add apps/api && git commit -m "feat(api): hono on vercel edge with /health"`.

## Verification
- `curl localhost:3001/api/health` returns JSON `{ok: true}`.
- `pnpm --filter api dev` can be run from repo root.

## Handoff to next step ([05-shared-package.md](./05-shared-package.md))
- API runnable locally; no real routes yet.
- Vercel project link exists under `apps/api/.vercel/` — gitignored.
- Next task adds `packages/shared` that both `apps/mobile` and `apps/api` will import.
