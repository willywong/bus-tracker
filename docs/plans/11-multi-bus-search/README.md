# Phase 11 — Multi-Bus Favorites + Search

The Tracker dropdown stops being a hard-coded `T816 / T815` toggle and becomes the user's curated list of favorite buses. A new "Add bus…" item at the bottom of the dropdown opens a modal sheet with a search field — users search by route code (`T816`) or by stop name (`MRT Phileo Damansara`), pick a route, then pick a boarding stop, and the bus is appended to their favorites and persisted across launches.

The change cascades through every layer:

- **Shared package**: `filterToT816` becomes the generic `filterToRoutes`; `RouteId` widens from a closed string-literal union to `string`; a new `searchRoutes` helper powers server-side search.
- **API**: two new Edge endpoints — `GET /api/routes/search?q=` and `GET /api/route/:code` — let the mobile look up routes on demand without shipping the full feed.
- **Mobile data layer**: bootstrap fetches **per-favorite** route bundles and merges into SQLite; realtime polling targets the dynamic favorites list; SecureStore gains a `bt.favoritedRoutes` key.
- **Mobile UI**: the Tracker tab is wrapped in a route group with a `Stack` so `/add-bus` opens as a modal sheet; the existing `RouteSwitcher` glass Menu gets an "Add bus…" item; Settings gets remove + reorder for the favorites list; a new empty-state hero appears for users with no favorites.

## Dependencies

- Phases 00–10 complete. The existing GTFS pipeline, `useSettings`, `RouteSwitcher`, Tracker screen, and Settings screen are all reused — this phase modifies them rather than replacing them.
- `@expo/ui` and `expo-glass-effect` already installed and linked. No new native modules.

## Scope decisions (locked)

- **Feed scope**: MRT feeder only (`rapid-bus-mrtfeeder`). City buses (`rapid-bus-kl`) and rail (`rapid-rail-kl`) are explicitly **out of scope**.
- **Search architecture**: server-side search + per-route detail fetch. Mobile only ever holds GTFS data for the routes in the user's favorites list.
- **Add flow**: two steps in the same modal — pick route → pick boarding stop.
- **Navigation**: Expo Router `Stack` with `presentation: 'modal'`, scoped to the Tracker tab.
- **Migration**: empty by default. No pre-seed of T816/T815 for existing users; first-launch Tracker shows an "Add your first bus" CTA.
- **List operations**: remove + reorder favorites, edit per-route boarding stop — all in Settings.
- **Direction handling**: stops merged across directions (matches today's `getStopsForRoute` behavior).
- **Search match**: route short name + route long name + stop name (all three).

## Success criteria

1. Fresh install shows an "Add your first bus" CTA on Tracker; tapping it opens the search modal.
2. `GET /api/routes/search?q=T8` returns ≥ 1 result within 200 ms warm; `GET /api/routes/search?q=Phileo` returns routes that pass through MRT Phileo Damansara.
3. `GET /api/route/T816` returns a single-route bundle (T816Bundle shape with `routes.length === 1`).
4. Tapping a route in search results shows that route's stops; tapping a stop dismisses the modal and the new bus becomes the active route on Tracker with that boarding stop.
5. Dropdown lists all favorites (in user-defined order) plus "Add bus…" at the bottom.
6. Settings → Favorite buses supports swipe-to-delete, drag-to-reorder, and per-route boarding-stop selection.
7. Removing the active route falls back to the next favorite; removing all leaves the empty-state CTA.
8. Force-quit + relaunch preserves favorites, order, and active route.
9. Realtime poll continues to drive ETAs for the active route after favorites change. No regression in T816 + T815 ETA quality.
10. All changes are JS-only — no `expo prebuild` required.

## Skills to invoke during UI/UX work

Tasks 07–12 touch the UI layer. Before writing any of these files, the implementer must invoke the appropriate skills so component choices reflect current Expo / @expo/ui / expo-router APIs rather than stale assumptions:

- **`mcp__plugin_context7_context7`** (`resolve-library-id` + `query-docs`) — fetch live docs for `expo-router` (presentation modes, sheet detents), `@expo/ui` (Swift UI primitives like `Sheet`, `TextField`, `List`, `Picker`, `NavigationStack`), `expo-symbols` (SF Symbol catalogue), `expo-glass-effect` and `react-native-gesture-handler` (`Swipeable`, drag-reorder primitives). Do this before locking in a component choice — the plan files describe intent, not the final API surface.
- **`frontend-design:frontend-design`** — when laying out the Add Bus modal, search results list, stop picker, and Settings favorites list, invoke this skill to keep the visual quality consistent with the existing tracker UI rather than producing generic React Native styling.
- **`feature-dev:feature-dev`** — kept active throughout phase 11 implementation to maintain the codebase-aware, ask-before-assuming workflow used during planning.

Default to **iOS-native primitives** wherever possible — prefer @expo/ui native list/section/menu over hand-rolled RN cards. The plan files indicate the *direction*; the live docs (via context7) determine the *exact API*.

**Modal presentation note**: v1 of the Add Bus screen ships with `presentation: 'modal'` (full-screen) so we can evaluate the flow first. The follow-up upgrade to `presentation: 'formSheet'` (native iOS half-sheet with detents) is documented inline in task 07; flip the switch after a UX review.

## Task order

1. [01-shared-package-generalization.md](./01-shared-package-generalization.md) — `filterToT816` → `filterToRoutes`; widen `RouteId`; add `searchRoutes`.
2. [02-api-routes-search-endpoint.md](./02-api-routes-search-endpoint.md) — `GET /api/routes/search?q=`.
3. [03-api-route-detail-endpoint.md](./03-api-route-detail-endpoint.md) — `GET /api/route/:code`.
4. [04-mobile-favorites-store.md](./04-mobile-favorites-store.md) — `favoritedRoutes[]` in `useSettings`.
5. [05-mobile-incremental-bundle.md](./05-mobile-incremental-bundle.md) — bootstrap fetches per-favorite + merges into SQLite.
6. [06-realtime-multi-route.md](./06-realtime-multi-route.md) — dynamic route codes in `realtime.ts`.
7. [07-add-bus-modal-route.md](./07-add-bus-modal-route.md) — `(tracker)` route group + `/add-bus` modal.
8. [08-search-screen-ui.md](./08-search-screen-ui.md) — search field + results list.
9. [09-stop-picker-step.md](./09-stop-picker-step.md) — second step of the add flow.
10. [10-dropdown-add-button.md](./10-dropdown-add-button.md) — "Add bus…" Menu item in `RouteSwitcher`.
11. [11-settings-favorites-management.md](./11-settings-favorites-management.md) — remove + reorder + per-route stop edit in Settings.
12. [12-empty-state-and-polish.md](./12-empty-state-and-polish.md) — empty Tracker hero + edge-case polish.

## Hand-off (post phase)

- Tracker, Map, Settings, and the GTFS pipeline are no longer T816-coupled. Adding a new RapidKL feed (e.g. `rapid-bus-kl`) becomes a localized change to the API layer (a new endpoint + a feed-aware `GtfsBundleService`) without touching the mobile data layer or UI.
- The `RouteId` union has been widened. Future code reviews should treat it as a free-form string — no exhaustive-switch patterns.
- Map screen still renders only the active route's polyline. Multi-route map layers are deferred to a follow-up phase.
