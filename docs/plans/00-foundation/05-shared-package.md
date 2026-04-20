# 00-Foundation / 05 — Shared Package

## Context
- Steps 01–04 complete: monorepo, mobile, and API apps all exist and run.
- Both apps will need the same TypeScript types (GTFS rows, bus positions, ETA) and pure utilities (route projection, dwell buffer, parser). We centralise them in one workspace package.

## Goal
Create `packages/shared` exporting typed interfaces and pure utils, importable from both `apps/mobile` and `apps/api` via the path alias `@bus-tracker/shared`.

## Prerequisites
- Steps 01–04 complete.

## Steps
1. ```bash
   mkdir -p packages/shared/src/{types,utils,proto}
   cd packages/shared
   pnpm init
   ```
2. Edit `packages/shared/package.json`:
   ```json
   {
     "name": "@bus-tracker/shared",
     "version": "0.1.0",
     "private": true,
     "type": "module",
     "main": "./src/index.ts",
     "types": "./src/index.ts",
     "exports": {
       ".": "./src/index.ts",
       "./types": "./src/types/index.ts",
       "./utils": "./src/utils/index.ts"
     },
     "scripts": {
       "type-check": "tsc --noEmit"
     },
     "devDependencies": { "typescript": "^5.6" }
   }
   ```
3. `packages/shared/tsconfig.json`:
   ```json
   { "extends": "../../tsconfig.base.json", "include": ["src/**/*"] }
   ```
4. `src/types/bus.ts`:
   ```ts
   export type StopId = 'HOTEL_LISA_DE_INN' | 'PJ210';
   export type RouteId = 'T816' | 'T786' | 'PJ01' | 'PJ02';

   export interface Stop { id: StopId; name: string; lat: number; lng: number; }
   export interface VehiclePosition {
     vehicleId: string;
     tripId: string;
     routeId: RouteId;
     lat: number;
     lng: number;
     bearing?: number;
     speed?: number;
     observedAt: number;
   }
   export interface EtaResult {
     minutesToStop: number;
     source: 'traffic' | 'schedule' | 'hybrid';
     generatedAt: number;
     isStale: boolean;
   }
   ```
5. `src/types/gtfs.ts`: skeleton types for GTFS static rows (`GtfsRoute`, `GtfsStop`, `GtfsTrip`, `GtfsStopTime`, `GtfsShape`). Leave fields unset beyond the minimum; Phase 01 fleshes them out.
6. `src/types/index.ts`: `export * from './bus'; export * from './gtfs';`
7. `src/utils/index.ts`: create empty file with a placeholder export — Phase 01–03 fills in `gtfs-parser.ts`, `route.ts`, `eta.ts`, `protobuf.ts`.
8. `src/index.ts`:
   ```ts
   export * from './types/index.js';
   export * from './utils/index.js';
   ```
9. Add the workspace dep to both apps:
   ```bash
   pnpm --filter mobile add '@bus-tracker/shared@workspace:*'
   pnpm --filter api add '@bus-tracker/shared@workspace:*'
   ```
10. Smoke-test from `apps/mobile/App.tsx` or a scratch:
    ```ts
    import type { Stop, VehiclePosition } from '@bus-tracker/shared';
    ```
    `pnpm --filter mobile exec tsc --noEmit` should pass.
11. Commit: `git add -A && git commit -m "feat(shared): bus-tracker shared types package"`.

## Verification
- Both apps resolve `@bus-tracker/shared` via TypeScript (`tsc --noEmit` passes in each).
- `packages/shared/src/index.ts` exports at least `Stop`, `VehiclePosition`, `EtaResult`.

## Handoff to next step ([06-eas-simulator-build.md](./06-eas-simulator-build.md))
- Shared package is live but mostly empty — Phase 01+ fills in utilities.
- Mobile + API both depend on it via workspace protocol.
- Ready for the first EAS simulator build.
