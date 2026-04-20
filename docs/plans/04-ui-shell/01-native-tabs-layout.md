# 04-UI-Shell / 01 — Native Tabs Layout

## Context
- Phases 00–03 done; Tracker/Map/Settings screens don't exist yet.
- Expo Router Native Tabs renders iOS 26 Liquid Glass tab bar automatically (verified in docs).

## Goal
Replace the default Expo Router layout with `NativeTabs` in `apps/mobile/app/_layout.tsx`, defining three triggers: Tracker (`index`), Map, Settings.

## Prerequisites
- Phase 00 complete (Expo Router + `expo-router` Native Tabs available).

## Steps
1. Rewrite `apps/mobile/app/_layout.tsx`:
   ```tsx
   import { NativeTabs } from 'expo-router/unstable-native-tabs';
   import { DynamicColorIOS } from 'react-native';

   export default function Layout() {
     return (
       <NativeTabs
         tintColor={DynamicColorIOS({ light: '#000', dark: '#fff' })}
         minimizeBehavior="onScrollDown"
       >
         <NativeTabs.Trigger name="index">
           <NativeTabs.Trigger.Icon sf="house.fill" md="home" />
           <NativeTabs.Trigger.Label>Tracker</NativeTabs.Trigger.Label>
         </NativeTabs.Trigger>
         <NativeTabs.Trigger name="map">
           <NativeTabs.Trigger.Icon sf="map.fill" md="map" />
           <NativeTabs.Trigger.Label>Map</NativeTabs.Trigger.Label>
         </NativeTabs.Trigger>
         <NativeTabs.Trigger name="settings">
           <NativeTabs.Trigger.Icon sf="gear" md="settings" />
           <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
         </NativeTabs.Trigger>
       </NativeTabs>
     );
   }
   ```
2. Ensure `app/index.tsx`, `app/map.tsx`, `app/settings.tsx` exist (can be placeholder `<Host><Text>...</Text></Host>` pages).
3. Remove the default `(tabs)` group from the template if Native Tabs is used at root. (Alternatively keep `(tabs)/_layout.tsx` with NativeTabs — pick one and document.)

## Verification
- Simulator shows the native iOS tab bar with three items.
- Tab switching works; each screen mounts.

## Handoff to next step ([02-theme-tokens.md](./02-theme-tokens.md))
- Navigation structure is set; colors are ad-hoc. Next step centralises them.
