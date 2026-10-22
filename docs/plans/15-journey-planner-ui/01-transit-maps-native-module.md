# 15-Journey-Planner-UI / 01 — Transit Maps Native Module

**Build impact:** Native — npx expo prebuild + Xcode build

## Context
- Spec §5 (`docs/design/transit-and-planner.md`) puts all Apple MapKit work in one local Expo module, `apps/mobile/modules/transit-maps` (Swift, about 250 lines). Place search, walking paths, Look Around and map snapshots are free and keyless; `MKDirections` transit is not used because it returns `directionsNotFound` in Malaysia (spec §1, "Rejected alternatives").
- No local modules exist yet (`apps/mobile/modules/` is absent). Autolinking scans `modules/` by default, so a module there is picked up by `npx expo prebuild`.
- iOS deployment target is 16.4 (`apps/mobile/ios/Podfile` line 25), so `MKLookAroundSceneRequest` / `MKLookAroundSnapshotter` (iOS 16) need no availability guard. The `regionPriority` property on the completer is iOS 18+ and does need `#available`.
- `expo-modules-core` 58.0.23 supports Swift concurrency in `AsyncFunction` closures (`ios/Core/Functions/ConcurrentFunctionDefinition.swift`) and `Record` structs with `@Field` (`ios/Core/Records/Record.swift`, `Field.swift`). `requireOptionalNativeModule` is exported (`build/requireNativeModule.d.ts:18`) so the JS wrapper can no-op on Android and web.
- Street View photos already exist behind an optional key (`components/detail/StopPhoto.tsx:11`, `hasStopPhotos` at :19). Look Around is the first choice for imagery; Street View and then the map snapshot are fallbacks (README scope "Images").
- The Klang Valley box used for KTM filtering is lat 2.70–3.45, lon 101.25–101.95 (spec §3.1). The map opens on `KL_REGION` (`app/index.tsx:33-38`).

## Goal
A typed `transit-maps` module with five calls: `complete`, `resolve`, `walk`, `lookAround`, `snapshot`. It caches images on disk for 30 days and never throws untyped errors into JS. Android and web return empty results instead of crashing.

## Prerequisites
- Phases 12–14 are not required. This task can run first or in parallel with them.
- Xcode 26 with an iOS 26 simulator, plus an iPhone for the Look Around and completer checks.
- Invoke the `expo:expo-module` and `write-swift` skills before writing code. Use `write-swift` for actor isolation and `Sendable` review.

## Steps

1. **Scaffold.** From `apps/mobile`, run `npx create-expo-module@latest --local` and name it `transit-maps` (module name `TransitMaps`). In `modules/transit-maps/expo-module.config.json`, set `"platforms": ["apple"]`. Delete the generated view files (`ios/TransitMapsView.swift`, `src/TransitMapsView*.tsx`) and the `android/` folder. Keep `ios/TransitMaps.podspec` and add `s.frameworks = 'MapKit'`.

2. **Records (Swift).** In `ios/TransitMapsRecords.swift`, define these `Record` structs:
   - `RegionRecord { lat, lng, latDelta, lngDelta }`
   - `PointRecord { lat, lng }`
   - `CompletionRecord { id, title, subtitle }`
   - `CompletionBatch { queryId: Int, results: [CompletionRecord], superseded: Bool }`
   - `PlaceRecord { name, address: String?, lat, lng, category: String? }`. `category` is the `MKPointOfInterestCategory.rawValue`, or `nil` for an address.
   - `WalkRecord { seconds: Double, meters: Double, coords: [[Double]] }`. Each coord is `[lat, lng]`.

3. **Completer (main actor).** Put `@MainActor final class PlaceCompleter: NSObject, MKLocalSearchCompleterDelegate` in `ios/PlaceCompleter.swift`.
   - Create one `MKLocalSearchCompleter`: `resultTypes = [.pointOfInterest, .address]`, `region` = the region passed in. Default to centre 3.10, 101.60 with span 0.75 × 0.70, which is the Klang Valley box. Under `if #available(iOS 18.0, *)`, set `regionPriority = .required`.
   - `func complete(queryId: Int, query: String, region: RegionRecord) async -> CompletionBatch`:
     - Resume any pending continuation with `superseded: true`.
     - Store the new `CheckedContinuation` and set `queryFragment`.
     - `completerDidUpdateResults` maps `results.prefix(8)` to `CompletionRecord`s with ids `c<queryId>-<i>`. It keeps the `MKLocalSearchCompletion` objects in a dictionary holding the last two batches only.
     - `completer(_:didFailWithError:)` resumes with an error.
   - Empty or whitespace queries return an empty batch immediately and never reach the completer.
   - Debouncing is in JS (03, 120 ms). The native side keeps only the latest query.

4. **Module definition.** `ios/TransitMapsModule.swift` declares `Name("TransitMaps")`, then:
   - `AsyncFunction("complete") { (queryId: Int, query: String, region: RegionRecord) async throws -> CompletionBatch in try await completer.complete(...) }`. The completer is a `@MainActor` property created lazily inside `MainActor.run`.
   - `AsyncFunction("resolve") { (id: String) async throws -> PlaceRecord }`:
     - Look up the stored completion. If it is missing, throw `UnknownCompletionException`.
     - Run `MKLocalSearch(request: .init(completion:))`.
     - Take the first `MKMapItem`:
       - `name` comes from `item.name`;
       - `address` comes from `placemark.title`, or `subtitle` from the completion;
       - the coordinate comes from `placemark.coordinate`;
       - `category` comes from `item.pointOfInterestCategory?.rawValue`.
   - `AsyncFunction("walk") { (from: PointRecord, to: PointRecord) async throws -> WalkRecord }`:
     - Use an `MKDirections.Request` with `transportType = .walking` and `requestsAlternateRoutes = false`.
     - Take the first route and read `route.polyline.getCoordinates`.
     - Thin the path to ≤ 200 points.
     - Keep an in-memory LRU of 32 entries, keyed by both ends rounded to 5 dp.
   - `AsyncFunction("lookAround") { (lat: Double, lng: Double, w: Double, h: Double) async throws -> String? }`:
     - Cache key: `lookaround/<lat5>_<lng5>_<w>x<h>.jpg`.
     - `MKLookAroundSceneRequest(coordinate:)`. With no scene, write a `.none` marker (7-day TTL) and return `nil`.
     - Otherwise use `MKLookAroundSnapshotter(scene:options:)` with `options.size = CGSize(w, h)`.
     - Write JPEG at quality 0.8 and return its `file://` URI.
   - `AsyncFunction("snapshot") { (region: RegionRecord, w: Double, h: Double, dark: Bool) async throws -> String }`:
     - Use `MKMapSnapshotter.Options` with `region`, `size`, `mapType = .mutedStandard` and `pointOfInterestFilter = .excludingAll`.
     - Set `traitCollection = UITraitCollection(userInterfaceStyle: dark ? .dark : .light)`.
     - Cache key: `snapshot/<hash>-<dark>.png`.
   - `AsyncFunction("clearCache")` deletes the cache directory. It is for QA only.

5. **Cache.** Use `FileManager.default.urls(for: .cachesDirectory)` plus `transit-maps/`, so iOS may purge it. On module `OnCreate`, sweep files older than 30 days off the main thread (`Task.detached(priority: .background)`). Never cache errors, except Look Around's `.none` marker.

6. **Errors.** Define typed `Exception` subclasses:
   - `OfflineException` (code `ERR_OFFLINE`) for `MKError.serverFailure`, `.loadingThrottled` and `NSURLErrorNotConnectedToInternet`;
   - `ThrottledException` (`ERR_THROTTLED`);
   - `NotFoundException` (`ERR_NOT_FOUND`) for `directionsNotFound` and an empty search.

   JS sees `error.code` and decides what to show; nothing is logged as a crash.

7. **TS wrapper.** `modules/transit-maps/src/TransitMapsModule.ts` calls `requireOptionalNativeModule<TransitMapsNative>('TransitMaps')`. `modules/transit-maps/index.ts` exports:
   ```ts
   export type Region = { lat: number; lng: number; latDelta: number; lngDelta: number };
   export type Completion = { id: string; title: string; subtitle: string };
   export type ResolvedPlace = { name: string; address: string | null; lat: number; lng: number; category: string | null };
   export type WalkPath = { seconds: number; meters: number; coords: { lat: number; lng: number }[] };
   export type MapsErrorCode = 'ERR_OFFLINE' | 'ERR_THROTTLED' | 'ERR_NOT_FOUND' | 'ERR_UNAVAILABLE';
   export const KLANG_VALLEY: Region;
   export function complete(query: string, region?: Region): Promise<{ results: Completion[]; superseded: boolean }>;
   export function resolve(id: string): Promise<ResolvedPlace>;
   export function walk(from: LatLng, to: LatLng): Promise<WalkPath>;
   export function lookAround(lat: number, lng: number, w: number, h: number): Promise<string | null>;
   export function snapshot(region: Region, w: number, h: number, dark: boolean): Promise<string>;
   export function mapsErrorCode(e: unknown): MapsErrorCode;
   ```
   - `complete` keeps a module-scope `queryId` counter. Callers treat `superseded: true` as "ignore this response".
   - With no native module, every call resolves empty or `null`. `walk` and `resolve` reject with `ERR_UNAVAILABLE`.
   - `walk` converts `[lat, lng]` pairs into objects.

8. **Category to SF Symbol.** Add `apps/mobile/services/places/categories.ts`. It is pure (no RN imports) so it runs under `tsx --test`. `placeSymbol(category: string | null): SFSymbol` maps raw values such as:
   - `MKPOICategoryRestaurant` → `fork.knife`
   - `Cafe` → `cup.and.saucer.fill`
   - `Hospital` → `cross.case.fill`
   - `School` / `University` → `graduationcap.fill`
   - `Store` → `bag.fill`
   - `FoodMarket` → `cart.fill`
   - `PublicTransport` → `tram.fill`
   - `Airport` → `airplane`
   - `Hotel` → `bed.double.fill`
   - `Park` / `NationalPark` → `tree.fill`
   - `Museum` → `building.columns.fill`
   - `Parking` → `parkingsign`
   - `GasStation` → `fuelpump.fill`
   - `FitnessCenter` → `dumbbell.fill`
   - `Library` → `books.vertical.fill`
   - `MovieTheater` → `film.fill`
   - `Pharmacy` → `pills.fill`
   - `Nightlife` → `wineglass.fill`
   - `Stadium` → `sportscourt.fill`
   - `null` (an address) → `mappin`
   - unknown → `mappin.circle.fill`

9. **Tests.** Add `apps/mobile/services/places/__tests__/categories.test.ts`:
   - `maps every known category to a symbol`
   - `null is an address pin`
   - `unknown falls back to mappin.circle.fill`

10. **Fill the 13/03 image seam.** Phase 13/03 created `apps/mobile/services/stationImage.ts` with a stub `lookAroundUri(lat, lng)` that returns `null`. Replace the stub:
    - `lookAroundUri(lat, lng, w = 640, h = 360)` calls `lookAround()` and returns `null` on any error.
    - Add `snapshotUri(lat, lng, w, h, dark)`, which calls `snapshot()` over a 600 m box.

    Then, in `components/rail/StationPhoto.tsx` (13/03), extend the source order to Look Around → `StopPhoto` (`aspectRatio={16 / 9}`, the prop 13/03 adds) → `snapshotUri`.
    - `StopPhoto` gets an optional `onUnavailable` callback, fired on a non-`OK` metadata status or an image error (`StopPhoto.tsx:47`, :75). It is also fired at once when there is no key (`hasStopPhotos`, :19). The caller then knows to fall through.
    - Keep the 16:9 `color.fill` placeholder at `radius.group`. There is no `radius.lg`; `theme/design.ts:93-96` has only `row` and `group`.

    04's `PlaceBanner` reuses the same chain.

11. **Dev probe (temporary).** Add a `__DEV__`-only "MapKit probe" row to `app/settings.tsx` About (after the section at :163). It runs each call once and `console.log`s the result. Remove the row before 02 is merged.

## Verification
- `pnpm --filter mobile test` passes, including `categories.test.ts`.
- `pnpm type-check`.
- `cd apps/mobile && npx expo prebuild --platform ios`, then open `ios/BusBuddy.xcworkspace` and ▶ Run. The build has no Swift 6 concurrency warnings in `TransitMaps`.
- Simulator (location set to KLCC), using the probe:
  - `complete("klcc")` returns ≥ 3 results inside the Klang Valley.
  - Typing fast leaves only the last call un-superseded.
  - `resolve(id)` returns coordinates and a category.
  - `walk(KLCC → Pavilion)` returns 10–20 min and > 20 coords.
  - `snapshot` returns a file that renders in an RN `<Image>`.
- Device (iPhone 13):
  - `lookAround` at Bukit Bintang returns a URI or `null` in < 2 s. Record which in the Handoff, since coverage is unverified (spec §9).
  - In airplane mode, `complete` rejects with `ERR_OFFLINE` and a cached `snapshot` still returns.
- Relaunch: a second `lookAround` for the same point returns from cache in < 50 ms, measured with `performance.now()` in the probe.
- Station sheet (13/03), opened for Pasar Seni: the banner shows Look Around where it exists. Otherwise it shows Street View (key set), otherwise a map snapshot. It never shows an empty grey block after loading.

## Handoff to next step ([02-where-to-entry.md](./02-where-to-entry.md))
- `import { complete, resolve, walk, lookAround, snapshot, mapsErrorCode, KLANG_VALLEY } from '@/modules/transit-maps'`. The `@/*` → `./*` path in `apps/mobile/tsconfig.json` covers `modules/`.
- `placeSymbol()` lives in `services/places/categories.ts`.
- `services/stationImage.ts` exports `lookAroundUri` and `snapshotUri`. `StopPhoto` has `onUnavailable` (plus 13/03's `aspectRatio`). `StationPhoto` runs the full three-source chain.
- Record whether Look Around coverage exists in KL. If it doesn't, 03/04 banners go straight to Street View, then snapshot.
- Every later task is JS-only unless it says otherwise. This is the only prebuild in the phase.
