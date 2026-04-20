# 00-Foundation / 01 — Monorepo Skeleton

## Context
- Repo at `/Users/willywong/bus-tracker` is completely empty (no `package.json`, no `.git`).
- User decisions: **pnpm + Turborepo + TypeScript**. Docs at `docs/plans/` already scaffolded (you're reading them).

## Goal
Stand up the pnpm + Turborepo workspace skeleton so `apps/*` and `packages/*` can be added by subsequent tasks.

## Prerequisites
- Node.js ≥ 20 installed (`node --version`).
- pnpm ≥ 9 installed (`npm install -g pnpm` if missing).
- Git installed.

## Steps
1. `cd /Users/willywong/bus-tracker`.
2. `git init` and add `.gitignore`:
   ```
   node_modules/
   .turbo/
   dist/
   .env
   .env.local
   .DS_Store
   ios/
   android/
   .expo/
   *.tsbuildinfo
   ```
3. `pnpm init` → edit resulting `package.json` to:
   ```json
   {
     "name": "bus-tracker",
     "private": true,
     "packageManager": "pnpm@9.12.0",
     "scripts": {
       "dev": "turbo run dev",
       "build": "turbo run build",
       "lint": "turbo run lint",
       "type-check": "turbo run type-check"
     },
     "devDependencies": {
       "turbo": "^2.1.0",
       "typescript": "^5.6.0"
     }
   }
   ```
4. Create `pnpm-workspace.yaml`:
   ```yaml
   packages:
     - "apps/*"
     - "packages/*"
   ```
5. Create `turbo.json`:
   ```json
   {
     "$schema": "https://turbo.build/schema.json",
     "tasks": {
       "dev": { "cache": false, "persistent": true },
       "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
       "lint": {},
       "type-check": { "dependsOn": ["^build"] }
     }
   }
   ```
6. Create `tsconfig.base.json`:
   ```json
   {
     "compilerOptions": {
       "target": "ES2022",
       "module": "ESNext",
       "moduleResolution": "Bundler",
       "strict": true,
       "esModuleInterop": true,
       "skipLibCheck": true,
       "resolveJsonModule": true,
       "jsx": "react-native",
       "baseUrl": ".",
       "paths": {
         "@bus-tracker/shared": ["./packages/shared/src/index.ts"],
         "@bus-tracker/shared/*": ["./packages/shared/src/*"]
       }
     }
   }
   ```
7. `echo "20" > .nvmrc`.
8. `pnpm install` — should install just `turbo` and `typescript` at the root.
9. Commit: `git add . && git commit -m "chore: monorepo skeleton with pnpm + turbo"`.

## Verification
- `pnpm install` exits 0.
- `pnpm turbo --version` prints a version.
- `cat pnpm-workspace.yaml` shows `apps/*` and `packages/*`.

## Handoff to next step ([02-mobile-app-init.md](./02-mobile-app-init.md))
- Monorepo root is runnable but empty: no workspaces exist yet under `apps/` or `packages/`.
- Node ≥ 20, pnpm ≥ 9, `turbo` installed at root.
- `tsconfig.base.json` ships the path alias `@bus-tracker/shared` — tasks 02, 04, 05 will extend this base.
- Git initialised with one commit.
