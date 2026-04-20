# 06-Map-Screen / 01 — React Native Maps Setup

## Context
- Phase 05 complete: Tracker fully functional.
- Map screen is the one RN-tree screen; `@expo/ui` has no map primitive.

## Goal
Render an Apple MapKit map via `react-native-maps` centred on the T816 bounding box.

## Prerequisites
- `react-native-maps` installed.
- User-location permission string already in `Info.plist` (Phase 00 step 03).

## Steps
1. Replace placeholder `apps/mobile/app/map.tsx`:
   ```tsx
   import MapView, { PROVIDER_DEFAULT } from 'react-native-maps';
   import { View } from 'react-native';
   export default function Map() {
     return (
       <View style={{ flex: 1 }}>
         <MapView
           provider={PROVIDER_DEFAULT}
           showsUserLocation
           initialRegion={T816_BBOX}
           style={{ flex: 1 }}
         />
       </View>
     );
   }
   ```
2. `T816_BBOX` computed from the cached polyline (Phase 01) — min/max lat/lng with a small padding.

## Verification
- Simulator shows a map around Petaling Jaya.
- User location blue dot appears once permission granted.

## Handoff to next step ([02-route-polyline.md](./02-route-polyline.md))
