# 12-Transit-Network / 04 — Transfers and curated interchanges

**Build impact:** JS-only (Metro reload)

## Context
- None of the feeds has a `transfers.txt` or `parent_station` (spec §1). Footpaths come from three sources. When the same pair appears in more than one, the **most specific source wins** (spec §3.4): curated, then same station, then proximity. The precedence holds even when the curated time is longer.
  1. **Proximity:** pairs within 250 m. `seconds = ceil(haversine × 1.25 / walkSpeed) + 60`.
  2. **Same station:** stops in the same `RailStation` get `180 s`.
  3. **Curated table:** `packages/shared/src/data/rail-interchanges.ts`, which does not exist yet.
- The default walk speed is `WALKING_METERS_PER_MINUTE = 80` (`packages/shared/src/utils/rail.ts:53`). Distances use `haversineMeters` (`packages/shared/src/utils/outlier.ts:6`).
- The grid and `stopsNear` come from task 03. `RAIL_STATIONS` (`packages/shared/src/data/rail-stations.ts:20`) already merges same-name stops within 400 m (`packages/shared/scripts/build-rail-stations.ts:34`). So several curated pairs sit inside one station, and the curated time replaces the generic 180 s:
  - KL Sentral `KJ15`/`MR1` (`rail-stations.ts:84`): 480 s via NU Sentral;
  - Pasar Seni `KG16`/`KJ14` (`:106`);
  - Masjid Jamek `AG7`/`KJ13`/`SP7` (`:94`);
  - Hang Tuah `AG9`/`MR4`/`SP9` (`:63`);
  - Bukit Bintang `KG18A`/`MR6` (`:41`);
  - Putra Heights `KJ37`/`SP31` (`:115`);
  - USJ 7 `BRT7`/`KJ31` (`:178`).
- Spec §3.4 ids were checked against the 2026-10-23 feeds. Rail ids are raw `rapid-rail-kl` stop_ids, and KTM ids are `ktmb` stop_ids. In the network they carry the `rail:` / `ktm:` prefixes (task 01 `namespaceFeedId`).

## Goal
`buildTransfers(net)` fills `net.transfers` (CSR by from-stop: `to`, `seconds`, `kind`).
- Pairs are symmetric.
- Duplicates resolve by source precedence: curated, then station, then walk. Within one source, the smaller time wins.
- A curated interchange table, tested against the fixture stop ids, covers walks that the name merge and the 250 m radius miss. It also overrides same-station defaults with real walk times.

## Prerequisites
- Task 03 (`compileNetwork`, `stopsNear`, `stops.station`).
- Task 00 fixtures.

## Steps

1. **Create `packages/shared/src/data/rail-interchanges.ts`:**
   ```ts
   export interface Interchange { a: string; b: string; seconds: number; note: string; verified: boolean }
   export const RAIL_INTERCHANGES: readonly Interchange[] = [ /* network ids, e.g. 'rail:KJ15' */ ];
   ```
   Seed it exactly from spec §3.4, with every entry `verified: false`. Expand the "A / B" seeds to one entry per stop pair:

   | Seed | Pairs (network ids) | s |
   |---|---|---:|
   | KL Sentral ↔ Monorail (via NU Sentral) | `rail:KJ15`–`rail:MR1` | 480 |
   | KL Sentral ↔ KTM KL Sentral | `rail:KJ15`–`ktm:19100` | 180 |
   | Muzium Negara ↔ KL Sentral | `rail:KG15`–`rail:KJ15` | 360 |
   | Pasar Seni KJ ↔ KG | `rail:KJ14`–`rail:KG16` | 240 |
   | Pasar Seni ↔ KTM Kuala Lumpur | `rail:KJ14`–`ktm:19000` | 420 |
   | Masjid Jamek KJ ↔ AG / SP | `rail:KJ13`–`rail:AG7`, `rail:KJ13`–`rail:SP7` | 180 |
   | Hang Tuah MR ↔ AG / SP | `rail:MR4`–`rail:AG9`, `rail:MR4`–`rail:SP9` | 180 |
   | Bukit Bintang MR ↔ KG | `rail:MR6`–`rail:KG18A` | 240 |
   | Dang Wangi ↔ Bukit Nanas | `rail:KJ12`–`rail:MR8` | 300 |
   | Plaza Rakyat ↔ Merdeka | `rail:AG8`–`rail:KG17`, `rail:SP8`–`rail:KG17` | 300 |
   | Bandaraya ↔ KTM Bank Negara | `rail:AG6`–`ktm:18900`, `rail:SP6`–`ktm:18900` | 360 |
   | Subang Jaya ↔ KTM Subang Jaya | `rail:KJ28`–`ktm:53700` | 180 |
   | Sunway-Setia Jaya BRT ↔ KTM Setia Jaya | `rail:BRT1`–`ktm:53600` | 180 |
   | USJ 7 BRT ↔ LRT | `rail:BRT7`–`rail:KJ31` | 120 |
   | Abdullah Hukum ↔ KTM | `rail:KJ17`–`ktm:52700` | 180 |
   | Putra Heights cross-platform | `rail:KJ37`–`rail:SP31` | 60 |

   - Write each `note` in plain words ("Walk via NU Sentral mall"); the UI shows it.
   - Header comment:
     - the source is spec §3.4;
     - the times are estimates until walked;
     - `verified: true` only after an in-person walk.
   - Put the KTM `stop_name` from the fixture next to each `ktm:` id as a trailing comment. Read it with:
     ```sh
     unzip -p packages/shared/src/transit/__fixtures__/2026-10-23/ktmb.zip stops.txt | grep -E "^(19100|19000|18900|53700|53600|52700),"
     ```

2. **Implement `packages/shared/src/transit/transfers.ts`:**
   ```ts
   export const PROXIMITY_METERS = 250;
   export const STATION_CHANGE_SECONDS = 180;
   export const FIND_STOP_SECONDS = 60;
   export const DETOUR_FACTOR = 1.25;
   export function walkSeconds(meters: number, metersPerMin = WALKING_METERS_PER_MINUTE): number; // ceil(m*1.25/(mpm/60)) + 60
   export function transferPriority(kind: number): number; // interchange/interchangeVerified 2 > station 1 > walk 0
   export function buildTransfersSteps(net: TransitNetwork, curated?: readonly Interchange[]): Generator<void, TransitNetwork['transfers'], void>;
   ```
   - Collect candidate pairs in a `Map<number, {seconds, kind}>` keyed `from * stops.count + to`.
   - Each insert writes **both directions** and follows this merge rule:
     - if the new entry has a **higher** `transferPriority`, it replaces the old one, even when it is slower;
     - at the same priority, keep the smaller `seconds`;
     - a lower priority never replaces.
   1. **Proximity:**
      - For each stop `i`, take `stopsNear(net, lat, lon, 250)` with `j ≠ i`.
      - `kind = TRANSFER_KIND.walk`.
      - Yield every 512 stops.
   2. **Same station:**
      - For each station, take all ordered pairs of its member stop indices.
      - Use 180 s with `kind = station`.
   3. **Curated:**
      - Resolve each `a`/`b` through the network's stop-id map.
      - Use `kind = interchangeVerified` if `verified`, else `interchange`. The verified flag travels as the transfer kind (task 01 `TRANSFER_KIND`).
      - An unresolved id is skipped with `console.warn`; it is a feed change, not a crash. The test below catches it at build time.
   - Emit the CSR sorted by `from`, then by `seconds`, then by `to`, so the output is deterministic for task 05.
   - Call `yield* buildTransfersSteps(net)` at the end of `compileNetwork` (task 03).

3. **Tests** in `packages/shared/src/transit/__tests__/transfers.test.ts`:
   - `walkSeconds(100) === ceil(100*1.25/(80/60)) + 60`.
   - `every curated interchange id exists in the fixture network`: compile all four fixtures for `20261028` and assert every `a`/`b` resolves, including `ktm:19100`, `19000`, `18900`, `53700`, `53600` and `52700`. This is success criterion 2.
   - `transfers are symmetric`: for every `i → j` with `s` seconds and kind `k`, `j → i` exists with the same `s` and `k`.
   - `curated overrides same-station even when slower`: KL Sentral `rail:KJ15 ↔ rail:MR1` is **480 s** with `kind = interchange`, not 180 s.
   - `curated overrides same-station when faster`: Putra Heights `KJ37 → SP31` is 60 s.
   - `curated Pasar Seni KJ14 → KG16 is 240 s, not the 180 s station default`.
   - `same-station beats proximity`: two stops of one synthetic station 50 m apart get 180 s with `kind = station`, not the walk time.
   - `same priority keeps the smaller time`: a synthetic pair with two proximity candidates.
   - `proximity pairs are within 250 m and exclude self`: a synthetic 3-stop network at 0, 200 and 300 m.
   - `stops in different feeds link by proximity`: a feeder stop and a `rail:` stop 120 m apart.
   - `verified curated entries get kind interchangeVerified`: a synthetic table.
   - `CSR is sorted and lengths sum to the pair count`.
   - Log the total pair count and the average degree on the fixtures. Expect tens of thousands of pairs, mostly bus stops.

## Verification
- `pnpm --filter @bus-tracker/shared test`.
- `pnpm type-check`.
- Manual: print the transfers from `rail:KJ14` (Pasar Seni) on the fixture network. They should include `rail:KG16` at 240 s, `ktm:19000` at 420 s, and nearby bus stops within 250 m. Print `rail:KJ15` too: it should list `rail:MR1` at 480 s and `ktm:19100` at 180 s.

## Handoff to next step ([05-network-serialisation.md](./05-network-serialisation.md))
- `compileNetwork` now returns a full `TransitNetwork`, transfers included, and the output is deterministic for the same inputs.
- `RAIL_INTERCHANGES` is in `packages/shared/src/data/rail-interchanges.ts`, with the spec §3.4 ids and all entries `verified: false`.
- Precedence is curated, then station, then walk. Curated times override the same-station default.
