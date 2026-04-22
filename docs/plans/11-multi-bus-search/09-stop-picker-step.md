# 11-Multi-Bus-Search / 09 — Stop Picker Step

## Context
- Task 08 lets the user search and tap a route. Tapping currently no-ops. We need step 2: present the route's stops, let the user pick a boarding stop, then commit the new favorite.
- Per the user's decision, this happens **inside the same modal** rather than in a second push — the stop picker swaps in over the search results, with a Back affordance.

## Goal
Add the stop-picker step to `add-bus.tsx`. On route tap → fetch the route bundle → render its stops → on stop tap → `addFavorite(code, stopId)` → dismiss modal → activate the new route.

## Prerequisites
- Tasks 03 + 04 + 08 complete.

## Skills to invoke first
- **`mcp__plugin_context7_context7`** — query docs for:
  - `expo-router`: nested navigation **inside** a sheet vs. a single-screen step state machine. Specifically check whether a child Stack inside a `formSheet` route is supported (would give native push animation between steps) — if so, prefer it over the `useState` approach below.
  - `@expo/ui/swift-ui`: `List`, `Section`, `NavigationStack`, `NavigationLink` — SwiftUI's `NavigationStack` inside a sheet is the canonical iOS pattern for two-step flows.
  - `expo-symbols`: stop-marker glyphs (`mappin.circle`, `mappin.and.ellipse`).
- **`frontend-design:frontend-design`** — invoke to settle the route-header treatment in step 2 (large title vs. inline), how matched stops are visually elevated above the rest, and the empty/loading state copy.

The plan below uses a `useState` step machine for simplicity. If the context7 docs reveal that `NavigationStack`/`NavigationLink` (or a nested Expo Router Stack inside the sheet) is supported on the pinned SDK, **prefer that** — the native push animation matches iOS conventions and keeps the back gesture working without custom handling.

## Steps

1. **Create the per-route fetch + cache** `apps/mobile/services/routeBundle.ts`:
   ```ts
   import { API_BASE_URL } from '@/config/env';
   import type { T816Bundle } from '@bus-tracker/shared';

   const sessionCache = new Map<string, T816Bundle>();

   export async function fetchRouteBundle(
     code: string,
     signal?: AbortSignal,
   ): Promise<T816Bundle> {
     const cached = sessionCache.get(code);
     if (cached) return cached;
     const url = `${API_BASE_URL}/api/route/${encodeURIComponent(code)}`;
     const res = await fetch(url, { signal });
     if (!res.ok) throw new Error(`route ${code}: ${res.status}`);
     const bundle = (await res.json()) as T816Bundle;
     sessionCache.set(code, bundle);
     return bundle;
   }
   ```
   - In-memory cache survives within the modal session so back-and-forth navigation doesn't re-fetch.
   - This is **separate** from the SQLite write that happens in `bootstrapStaticGtfs` after `addFavorite` — we want the stop picker to be instant, then `addFavorite` triggers the durable write.

2. **Extend `add-bus.tsx`** with a step state machine:
   ```tsx
   const [step, setStep] = useState<{ kind: 'search' } | { kind: 'pickStop'; route: RouteSearchHit }>({ kind: 'search' });
   ```
   - `step.kind === 'search'`: render the existing search UI (task 08).
   - `step.kind === 'pickStop'`: render the stop list.

3. **Stop list view** (preferred: `@expo/ui` `<List>` with two `<Section>`s):
   - Top header: native large title with the route code (mono) + long name as subtitle. If using `NavigationStack`, the Back button is automatic; otherwise add a `chevron.left` Pressable on the left.
   - Body: two `<Section>` blocks inside `<List>`:
     - "Matched stops" — only when `step.route.matchedStops?.length > 0`.
     - "All stops" — every stop on the route, sorted by name.
   - Each row: `SymbolView` (`mappin.circle.fill` for matched, `mappin.circle` otherwise) + stop name. Tap → commit.
   - Fallback (no @expo/ui `List`): RN `SectionList` with `surfaceColor.grouped` rows and the same hairline divider recipe.

4. **Loading state**: while the bundle is fetching, show a centered spinner + "Loading stops…". The route header is visible even during loading so the user knows what they're picking.

5. **Commit handler**:
   ```ts
   function handleStopPick(stop: { stop_id: string; stop_name: string }) {
     settings.addFavorite(step.route.code, stop.stop_id);
     settings.setPreferredRouteCode(step.route.code);
     router.back();
   }
   ```
   - The bootstrap (task 05) is subscribed to `favoritedRoutes` and will fetch + merge the route's data into SQLite. The Tracker screen mounts with the new active route immediately; ETAs appear within a few seconds once the merge + first realtime tick complete.

6. **Edge case — already a favorite**: if `settings.favoritedRoutes.includes(step.route.code)`, the row in the search results gets a "Favorited" badge and tapping it just sets it active (skip the stop picker, dismiss). This avoids re-prompting for a stop the user already chose.

## Verification
- Search `T816` → tap → stops load → tap "HOTEL LISA DE INN" → modal dismisses, Tracker shows T816 with that boarding stop, ETA card populates.
- Search `Phileo` → tap a result → stop list loads with MRT Phileo Damansara at the top → tap → modal dismisses, T815 (or whichever) becomes active with that stop.
- Tap a route already in favorites → modal dismisses immediately, that route becomes active.
- Tap Back from stop picker → returns to search results without losing the query.

## Handoff to next step ([10-dropdown-add-button.md](./10-dropdown-add-button.md))
- The Add Bus modal is fully functional in isolation. Task 10 wires the entry point — the "Add bus…" button in the dropdown.
