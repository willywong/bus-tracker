# 07-Settings-Screen / 01 — Form Shell

## Context
- Settings tab currently empty.
- All settings use `@expo/ui` for native iOS appearance.

## Goal
Create the shell: `Host` + `Form` with five empty `Section`s (walk time, notifications, preferred stop, traffic provider, quiet hours).

## Prerequisites
- Phase 04 step 01.

## Steps
1. `apps/mobile/app/settings.tsx`:
   ```tsx
   import { Host, Form, Section, Text } from '@expo/ui/swift-ui';
   export default function Settings() {
     return (
       <Host style={{ flex: 1 }}>
         <Form>
           <Section header={<Text>Walk</Text>}>{/* step 02 */}</Section>
           <Section header={<Text>Notifications</Text>}>{/* step 03 */}</Section>
           <Section header={<Text>Preferred Stop</Text>}>{/* step 04 */}</Section>
           <Section header={<Text>Traffic</Text>}>{/* step 05 */}</Section>
           <Section header={<Text>Quiet Hours</Text>}>{/* step 06 */}</Section>
         </Form>
       </Host>
     );
   }
   ```

## Verification
- Screen renders with iOS grouped-form chrome; sections have headers and no content yet.

## Handoff to next step ([02-walk-time-slider.md](./02-walk-time-slider.md))
