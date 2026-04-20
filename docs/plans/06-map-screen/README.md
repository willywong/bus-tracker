# Phase 06 — Map Screen (React Native Maps + GlassView overlay)

`@expo/ui` has no map primitive, so this is the one screen that uses a React Native tree: `react-native-maps` with Apple MapKit, a polyline for the T816 route, an animated bus marker, the user's stop marker, and a floating `GlassView` overlay card showing the ETA.

## Dependencies
- Phase 01 (route polyline in SQLite).
- Phase 02 (`useBusPosition()` for marker).
- Phase 03 (`useEta()` for overlay card).
- Phase 04 (glass guard).

## Success criteria
1. Map centred on T816 bounding box with user location enabled (request permission).
2. Polyline drawn from cached `shapes.txt` rows.
3. Bus marker tweens smoothly between 30s positional updates (linear interp over 30s).
4. User's preferred stop (from Settings; defaults to `Hotel Lisa De Inn`) marked with a distinct icon.
5. Floating card (`expo-glass-effect` `GlassView` wrapped in glass guard) sits above the tab bar with the live ETA value.

## Task order
1. [01-react-native-maps-setup.md](./01-react-native-maps-setup.md)
2. [02-route-polyline.md](./02-route-polyline.md)
3. [03-animated-bus-marker.md](./03-animated-bus-marker.md)
4. [04-user-stop-marker.md](./04-user-stop-marker.md)
5. [05-glass-overlay-card.md](./05-glass-overlay-card.md)

## Hand-off to Phase 07
- Map is usable; stop selection affects marker and ETA card.
- Selected-stop state is already stored in a React context, ready to be wired to persistent settings in the next phase.
