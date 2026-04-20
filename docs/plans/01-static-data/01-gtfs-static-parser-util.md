# 01-Static-Data / 01 — GTFS Static Parser Utility

## Context
- Phase 00 complete: `packages/shared/src/utils/` is empty. GTFS Static ZIP is available at `https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-mrtfeeder`.
- No code currently downloads or parses the ZIP anywhere.

## Goal
Add `packages/shared/src/utils/gtfs-parser.ts` that takes a ZIP `ArrayBuffer` and returns typed arrays for each GTFS file (`routes`, `stops`, `trips`, `stop_times`, `shapes`, `calendar`).

## Prerequisites
- Phase 00 complete.
- Pick a ZIP library that runs on both Node (backend) and React Native: `fflate` recommended (pure JS, no native bindings).

## Steps
1. `pnpm --filter @bus-tracker/shared add fflate`.
2. Implement `parseGtfsZip(buffer: ArrayBuffer): ParsedGtfs` returning typed rows defined in `types/gtfs.ts`.
3. Implement a small CSV parser tuned for GTFS (no quotes by default, UTF-8, header row). Do **not** reach for a heavy CSV lib.
4. Export `parseGtfsZip` from `utils/index.ts`.
5. Add a `__tests__/` folder with a fixture zip (a tiny hand-crafted 3-file zip) and a smoke test using `node --test`.

## Verification
- `pnpm --filter @bus-tracker/shared test` passes.
- Running against the real data.gov.my ZIP (in a throwaway script) prints non-zero row counts for each of the six files.

## Handoff to next step ([02-t816-filter-and-shape.md](./02-t816-filter-and-shape.md))
- `parseGtfsZip` is pure and isomorphic — works in both Node and RN.
- All GTFS rows are typed; filtering to T816 is a separate, testable step.
