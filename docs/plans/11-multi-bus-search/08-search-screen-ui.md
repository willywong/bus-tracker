# 11-Multi-Bus-Search / 08 — Search Screen UI

## Context
- The empty `add-bus.tsx` route exists from task 07. It needs the actual search UI: a search field that calls `/api/routes/search?q=` (debounced) and renders the results in the app's liquid-glass aesthetic.
- The codebase has no existing `TextField` or `TextInput` usage — this is the first one. The settings screen's `<Form><Section>` pattern is the closest reference.

## Goal
Build the search field + debounced API call + results list inside the Add Bus modal. Each result row shows the route code, long name, and (if matched) the stop name. Use native @expo/ui primitives wherever possible — the goal is iOS-native search-in-a-sheet UX, not a hand-rolled RN list.

## Prerequisites
- Tasks 02 + 07 complete — search API live, modal route exists.

## Skills to invoke first
- **`mcp__plugin_context7_context7`** — query docs for:
  - `@expo/ui/swift-ui`: `TextField`, `Section`, `List`, `searchable` modifier (the SwiftUI `.searchable` modifier may already be exposed — if so, prefer it over a hand-built search row), `keyboardType`, `submitLabel`, focus management.
  - `expo-symbols`: `SymbolView` for SF Symbols (preferred over `Image systemName` outside of `Host` since `SymbolView` works in plain RN).
  - `expo-router`: `useLocalSearchParams` and any sheet-aware focus helpers (auto-focusing inputs inside a sheet is finicky on iOS).
  - `react-native`: `TextInput` props for accessibility (only as fallback if @expo/ui's `TextField` is not available in the pinned version).
- **`frontend-design:frontend-design`** — invoke to lock in: the search row treatment (chrome vs. inline), result-row hierarchy (route code prominence vs. long name), matched-stop chip styling, empty/loading/error state copy and visual weight.

If `@expo/ui`'s `searchable` modifier is available, the search field becomes part of a `<List>` instead of a separate row — this is the most native pattern (matches Settings, Mail, Files). Verify and prefer that. The plan below assumes a hand-rolled search row only as a fallback.

## Steps

1. **Create the fetch wrapper** `apps/mobile/services/routesSearch.ts`:
   ```ts
   import { API_BASE_URL } from '@/config/env';
   import type { RouteSearchHit } from '@bus-tracker/shared';

   export async function searchRoutes(
     q: string,
     signal?: AbortSignal,
   ): Promise<RouteSearchHit[]> {
     const url = `${API_BASE_URL}/api/routes/search?q=${encodeURIComponent(q)}`;
     const res = await fetch(url, { signal });
     if (!res.ok) throw new Error(`search ${res.status}`);
     return (await res.json()) as RouteSearchHit[];
   }
   ```

2. **Build the search hook** `apps/mobile/hooks/useRouteSearch.ts`:
   - Debounce `query` by 250 ms (use a `useEffect` + `setTimeout` pair, abort via `AbortController` on each new query).
   - State: `{ results: RouteSearchHit[]; loading: boolean; error: Error | null }`.
   - Empty `query` → reset to `{ results: [], loading: false, error: null }`.
   - Strip whitespace; require ≥ 1 non-space char before firing.

3. **Build the screen** `apps/mobile/app/(tracker)/add-bus.tsx`:
   - **Preferred path** — use `<Host useViewportSizeMeasurement>` containing `<List>` (or `<Form>`) with the `searchable` modifier bound to the `query` state. iOS renders the canonical search bar at the top of the list, with native cancel button and clear-text button, and handles keyboard-avoidance inside the form sheet automatically.
   - **Fallback path** (only if `searchable` isn't exposed in the pinned `@expo/ui` version): RN `View` root, top search row with `SymbolView` (magnifying glass) + RN `TextInput` styled with `surfaceColor.grouped` background, hairline border, `borderRadius: 12`. Auto-focus on mount via `autoFocus` prop. Use `keyboardAvoidingView` to compensate for the form sheet's keyboard behavior.
   - Body: list rendering one row per `RouteSearchHit`:
     ```
     [T816] Pinggiran Subang ↔ MRT Mutiara Damansara
            ✓ stop: MRT Phileo Damansara Pintu A
     ```
     - Route code in monospace, bold, color = `PlatformColor('label')`.
     - Long name in 14 pt, color = `PlatformColor('secondaryLabel')`.
     - If `hit.matchedStops?.length`, render up to 2 stop chips below in a small `HStack` with a `mappin.circle` glyph.
     - Wrap each row in a RN `Pressable` with `surfaceColor.grouped` background, hairline divider between rows.
   - Empty / loading / no-result states: centered helper text.
     - No query: "Search routes by code or stop name."
     - Loading: small `ActivityIndicator` + "Searching…".
     - No results: "No routes match '{query}'."
     - Network error: "Couldn't reach server — try again."

4. **Tap handler** — when the user taps a row, call `setSelectedRoute(hit)` (modal-local state from task 09). For now (without task 09), `console.log` the hit to verify the wiring.

5. **Liquid glass touches**:
   - The modal sheet's background uses iOS's standard grouped background (`PlatformColor('systemGroupedBackground')`).
   - When using `<List>` / `<Form>` from @expo/ui, row chrome is automatic and matches Settings.app exactly — no manual styling needed.
   - Fallback (RN rows): use the existing `surfaceColor.grouped` and `surfaceColor.hairline` from `apps/mobile/components/tracker/tokens.ts`. Search bar gets a subtle inner highlight: `borderColor: surfaceColor.hairline`, `borderWidth: StyleSheet.hairlineWidth`.
   - **Do not** add `glassEffect` to result rows — glass is reserved for floating elements (FABs, the dropdown pill). Sheet content should be flat grouped-list chrome to match iOS HIG.

## Verification
- Open Add Bus → search field auto-focuses, keyboard appears.
- Type `T8` → after 250 ms, results appear.
- Type fast (`T816 Mutiara`) → only one network request fires (the debounced last value).
- Clear the field → results clear immediately.
- Kill the network → error state appears.

## Handoff to next step ([09-stop-picker-step.md](./09-stop-picker-step.md))
- The search returns `RouteSearchHit` objects. Task 09 takes a tap on a result and shows the stops for that route as the second step of the add flow.
