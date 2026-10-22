# 12-Transit-Network / 07 — Feed health, exclusion and Settings → Data sources

**Build impact:** JS-only (Metro reload). The Settings rows use existing `@expo/ui/swift-ui` components only.

## Context
- Spec §3.6: each feed is in exactly one state.
  - `ok`;
  - `expiring` when `validUntil` is within 14 days;
  - `expired` when today is past `validUntil` and the feed has no active services.
  An expired feed is left out of routing (`included: false`), and the planner shows a one-line note. It never silently mixes stale data in.
- Known windows from the 2026-10-23 fixtures:
  - rail ends `20261231`;
  - KTMB runs from `20260818` to early November (calendar `20261106`);
  - bus-kl ends `20270331`;
  - the feeder runs on about 3-week windows.
  KTMB has gone stale before (data.gov.my issue #631).
- Task 02 computes `validFrom`/`validUntil` per feed. Task 06 stores them in `feed_meta` and passes `included` into `compileNetwork` (task 03). Active-service evaluation is `activeServiceIds` (task 03).
- Settings is a SwiftUI `Form` (`apps/mobile/app/settings.tsx:77`). Sections live in `apps/mobile/components/settings/` (`RemindersSection.tsx:34`, `FavoritesSection.tsx`). The About section footer (`settings.tsx:163`–`170`) credits "data.gov.my (Prasarana)".
- `apps/mobile/components/trip/DataSources.tsx` is the trip-sheet footer.
  - It is a React Native `Text`, so it cannot sit inside a SwiftUI `Form`.
  - Its link target and opener (`DATA_GOV_MY`, `openDataGovMy` at `:6`–`:13`) are what to reuse.
- Spec §5: credit "Data: data.gov.my (Prasarana, KTMB), CC BY 4.0" in Settings → Data sources.

## Goal
1. Compute per-feed health with an injectable clock.
2. Exclude expired feeds from the compiled network, and expose `health` (plus a planner note) through `useTransitNetwork()`.
3. Show each feed's state and dates, and the CC BY 4.0 credit, in a new Settings → Data sources section.

## Prerequisites
- Task 06 (`feed_meta`, `refreshTransitNetwork`, `TransitNetworkProvider`).

## Steps

1. **Pure health:** create `packages/shared/src/transit/health.ts`.
   ```ts
   export type FeedHealthState = 'ok' | 'expiring' | 'expired';
   export interface FeedHealth { feed: FeedId; state: FeedHealthState; validFrom: string; validUntil: string; daysLeft: number; included: boolean }
   export type NetworkHealth = Partial<Record<FeedId, FeedHealth>>;   // absent = never downloaded
   export const EXPIRING_DAYS = 14;
   export function daysBetween(fromYmd: string, toYmd: string): number;           // Date.UTC diff, whole days
   export function feedHealth(f: { feed: FeedId; validFrom: string; validUntil: string; hasActiveServicesToday: boolean }, todayYmd: string): FeedHealth;
   export function networkHealth(feeds: readonly Parameters<typeof feedHealth>[0][], nowMs: number): NetworkHealth; // todayYmd via toMalaysiaParts
   export function healthNote(h: NetworkHealth): string | null;
   ```
   Rules, in order:
   1. `expired` when `todayYmd > validUntil` **and** `!hasActiveServicesToday`. A feed past its `validUntil` that still lists services for today, through a `calendar_dates` add, stays usable.
   2. `expiring` when `daysLeft = daysBetween(today, validUntil)` is between 0 and 14 inclusive.
   3. `ok` otherwise.
   - `included = state !== 'expired'`.
   - `healthNote` covers the excluded feeds:
     - rail only: `"Rail timetable from data.gov.my has expired. Showing bus-only routes."` (spec §3.6 wording);
     - KTM only: `"KTM Komuter timetable from data.gov.my has expired. Showing routes without KTM."`;
     - several: `"Some timetables from data.gov.my have expired: <labels>. Routes leave them out."`, with labels from `FEED_INFO[feed].label` (task 01).
   - Export everything from `packages/shared/src/transit/index.ts`.

2. **Wire it in** `apps/mobile/services/transitNetwork.ts` (task 06):
   - Before compiling a date, build `NetworkHealth` for **that** service date. Set `hasActiveServicesToday` from `activeServiceIds(...).size > 0` on the feed read for the date.
   - Pass `included` into `CompileFeeds[f].meta`, so `compileNetwork` skips expired feeds and records `included: false` in `meta.feeds`.
   - Add `export async function loadHealth(deps: NetworkDeps): Promise<NetworkHealth>`, read from `feed_meta` with no zip decoding. It takes `hasActiveServicesToday` from the loaded blob's `meta.feeds[f].included`, falling back to the date check alone when there is no blob.
   - In `useTransitNetwork.tsx`, set `health` from `loadHealth` on load and after each refresh. Add `note: string | null` (from `healthNote`) to the state. Phase 14 shows it.
   - On AppState `active`, recompute `health` with the new date. The UI must notice expiry without a download.

3. **Data sources rows (pure):** create `apps/mobile/components/settings/dataSources.ts`.
   ```ts
   export interface DataSourceRow { feed: FeedId; title: string; detail: string; tone: 'normal' | 'warning' | 'muted' }
   export function dataSourceRows(health: NetworkHealth): DataSourceRow[];
   export const DATA_CREDIT = 'Data: data.gov.my (Prasarana, KTMB), CC BY 4.0';
   ```
   - The order is `FEED_IDS`. `title = FEED_INFO[f].label`.
   - `detail` by state:
     - `ok`: `"Timetable to 31 Dec 2026"`;
     - `expiring`: `"Ends 6 Nov 2026 · check back for an update"` (`warning`; the date comes from `validUntil`);
     - `expired`: `"Ended 31 Dec 2026 · not used for routes"` (`muted`);
     - absent: `"Not downloaded yet"` (`muted`).
   - Format dates as `d MMM yyyy` in English from the `YYYYMMDD` string with a fixed month table. No `Intl` or clock format is involved; these are dates, not times.

4. **Section:** create `apps/mobile/components/settings/DataSourcesSection.tsx`. This is a new SwiftUI section, as spec §3.6 now specifies. Do not use the React Native `DataSources.tsx` footer for it.
   - Use a SwiftUI `Section` with `title="Data sources"`, and `footer={<Text>{DATA_CREDIT}</Text>}`.
   - Add one `LabeledContent` per row:
     - the value is `Text` with `foregroundStyle` secondary;
     - `warning` rows use `hex.warning` (`apps/mobile/theme/design.ts:64`) through `pick(…, scheme)`, the same way `settings.tsx:79` tints with `hex.ink`;
     - `muted` rows use tertiary.
   - The last row is a `Button` "Open data.gov.my" that calls `openDataGovMy`. Export `DATA_GOV_MY` and `openDataGovMy` from `apps/mobile/components/trip/DataSources.tsx` (`:6`, `:9`); they are file-private today. The footer component's behaviour does not change.
   - Insert `<DataSourcesSection />` in `apps/mobile/app/settings.tsx` just above the About section (`:163`). Data comes from `useTransitNetwork().health`.
   - Update the About footer (`settings.tsx:167`) from "data.gov.my (Prasarana)" to "data.gov.my (Prasarana, KTMB)".

5. **Tests:**
   - `packages/shared/src/transit/__tests__/health.test.ts`. The clock is injected through `nowMs`, and every time is MYT midnight + 1 h so the date is unambiguous:
     - `rail on 2026-10-23 is ok (69 days left)`.
     - `rail on 2026-12-17 is expiring (14 days, inclusive boundary)`, and `2026-12-16 is ok (15 days)`.
     - `rail on 2026-12-31 is still expiring (last valid day)`.
     - `rail on 2027-01-01 with no active services is expired and excluded` (success criterion 6).
     - `past validUntil but a calendar_dates add today keeps it usable`.
     - `ktm fixture (ends early November, calendar 20261106) is expiring on 2026-10-23`.
     - `healthNote wording for rail-only, ktm-only and multiple`.
     - `MYT date, not UTC`: 2026-12-31T17:00Z is 2027-01-01 in MYT, so the result is expired.
   - `apps/mobile/components/settings/__tests__/dataSources.test.ts`:
     - `rows follow FEED_IDS order with labels`;
     - `expiring row is warning with end date`;
     - `expired row says not used for routes`;
     - `missing feed says not downloaded yet`;
     - `DATA_CREDIT is the CC BY 4.0 line`.
   - `apps/mobile/services/__tests__/transitNetwork.test.ts`: add `an expired feed is compiled out (meta.feeds.rail.included === false, no rail: stops)`, with `now` at 2027-01-02 against a synthetic rail zip that ends 20261231.

## Verification
- `pnpm --filter @bus-tracker/shared test`.
- `pnpm --filter mobile test`.
- `pnpm type-check`.
- Manual (iPhone):
  1. Settings shows **Data sources** with four rows, KTM marked as ending in early November ("Ends 6 Nov 2026", from calendar `20261106`), and the footer "Data: data.gov.my (Prasarana, KTMB), CC BY 4.0". "Open data.gov.my" opens the in-app sheet.
  2. Set the device date to 2027-01-02 and relaunch offline. The rail row reads "Ended 31 Dec 2026 · not used for routes", and `useTransitNetwork().health.rail.state === 'expired'`. Log `note`. Restore the date.
  3. Check with VoiceOver: each row reads as "Rapid KL rail, Timetable to 31 Dec 2026".

## Handoff to next step ([../13-rail-experience/README.md](../13-rail-experience/README.md) and [../14-journey-engine/README.md](../14-journey-engine/README.md))
- `useTransitNetwork()` returns `{ network, health, status, note }` app-wide. Phases 13 and 14 read it and never write to it.
- Expired feeds are absent from `network`, and `meta.feeds[f].included` says so. `note` carries the one-line planner message.
- Carried forward:
  - rail and bus-kl have no holidays;
  - every curated interchange is `verified: false`;
  - KTM has no shapes, so legs draw straight;
  - curated interchange times override same-station defaults (task 04);
  - KTMB realtime is resolved in task 00 Results.

## Implementation notes
- **A feed past `validUntil` that still runs today is `expiring`, not `ok`.** Step 1 rule 2 limits `expiring` to `daysLeft` 0–14, which would have shown "Timetable to 31 Dec 2026" on 2 January. Now `expiring` covers `daysLeft <= 14`, including negative values. In practice this case barely happens: `readFeedSteps` already stretches `validUntil` to the latest added `calendar_dates` day.
- **Health is judged on the service date, not the calendar date.** In the app, both the compile and `loadHealth` call `feedHealth` with the service date (the MYT date of `now − 4 h`, from `serviceDatesFor`). That keeps health in step with the blob that is loaded between 00:00 and 04:00. `networkHealth(feeds, nowMs)` exists as specified (MYT calendar date) and is used by the tests. The app does not call it.
- **`loadHealth(deps, loaded?)` takes an optional second argument:** the meta of the network already in memory. When that meta is for today, the blob is not read. Otherwise `loadHealth` reads only the blob's META section (`readNetworkMeta`). It reads `feed_meta` through a new `loadFeedInfo(db)` in `db/networkStore.ts`, which selects every column except `zip`.
  - `hasActiveServicesToday` comes from the blob's `meta.feeds[f].included` only when the blob's hash for that feed matches `feed_meta`.
  - Otherwise it is `today <= validUntil`, the date check alone.
- **`health` is `NetworkHealth | null`.** It is null until the first read from the database, and `note` is null while `health` is null.
  - The provider recomputes health in three places: after the first load, after each refresh, and on every AppState `active`. On a new service day it recomputes after the new day's blob loads.
  - Dev and release builds both log `[transit-network] health: rail ok to 20261231, … · note: …` each time health is recomputed.
- **The section reads the hook itself.** `<DataSourcesSection />` calls `useTransitNetwork()` instead of taking a prop, which keeps the `settings.tsx` change to one line. While `health` is null the section shows only the footer and the "Open data.gov.my" button, never four "Not downloaded yet" rows.
- **`formatYmd`** is exported from `components/settings/dataSources.ts` alongside `dataSourceRows`.
- **Excluding a feed does not trigger a rebuild on its own.** `rebuildReason` still compares hashes only. For a given service date, `included` depends only on the feed's contents, so a blob built for a date is never wrong about that date. The one gap: a blob built by 12/06 code, where every feed was included, is kept until a feed's hash changes or its date is pruned. Since 12/06, no fixture feed has passed its end date.
- **An expired feed is still read** for the date being compiled, because `activeServiceIds` needs its calendar. Only `compileNetwork` leaves it out.
- **A single expired bus feed** gets the generic "Some timetables…" wording, with one label. The spec words only the rail-only and KTM-only cases.
- **For 13/x and 14/x:** read `useTransitNetwork().note` for the planner line, and `meta.feeds[f].included` (or `excludedFeeds(net)` in `modes.ts`) to tell which feeds a network leaves out. Neither phase writes to the hook.
- **Tests:**
  - `health.test.ts` has 11 tests;
  - `dataSources.test.ts` has 6, adding a `formatYmd` check;
  - `transitNetwork.test.ts` gains 2: the expired-feed compile, and `loadHealth` falling back to dates alone with no blob.
