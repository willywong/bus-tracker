# 05-Tracker-Screen / 01 — Countdown Card

## Context
- Phase 03 `useEta()` returns live minutes.
- Phase 07 Settings will provide `walkMinutes` (hard-code 10 for now).

## Goal
Render the big "Leave in X min" card at the top of the Tracker screen using `@expo/ui` `Text` + `glassEffect` modifier.

## Prerequisites
- `useEta()` (Phase 03).
- Glass guard (Phase 04 step 03).

## Steps
1. `apps/mobile/app/index.tsx`:
   ```tsx
   import { Host, VStack, Text } from '@expo/ui/swift-ui';
   import { glassEffect, padding } from '@expo/ui/swift-ui/modifiers';
   import { useEta } from '@/hooks/useEta';

   export default function Tracker() {
     const { minutesToStop } = useEta({ stopId: 'HOTEL_LISA_DE_INN' });
     const leaveIn = Math.max(0, (minutesToStop ?? 0) - 10);
     return (
       <Host style={{ flex: 1 }}>
         <VStack spacing={16}>
           <Text
             size={64}
             modifiers={[
               padding({ all: 24 }),
               glassEffect({ glass: { variant: 'clear' } })
             ]}
           >
             Leave in {leaveIn} min
           </Text>
         </VStack>
       </Host>
     );
   }
   ```
2. Bound minutes to avoid "Leave in -3 min" — show "Leave now" when ≤ 0.

## Verification
- Screen renders card with glass background on iOS 26 real device; degraded look in Simulator is acceptable.

## Handoff to next step ([02-bus-eta-section.md](./02-bus-eta-section.md))
- Top of Tracker is done. Next step adds the Form+Section rows for current/next bus.
