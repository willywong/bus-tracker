# 05-Tracker-Screen / 02 — Bus ETA Section

## Context
- Countdown card rendered at the top.
- We need rows for the current bus and the next bus (brief §6.1).

## Goal
Add a `Form` with one `Section` containing `HStack` rows for "Current bus ETA" and "Next bus ETA".

## Prerequisites
- Step 01; `useEta()` can accept a vehicle selector.

## Steps
1. Extend `useEta()` to return `current` and `next` (next = second approaching vehicle).
2. Render:
   ```tsx
   <Form>
     <Section>
       <HStack spacing={8}>
         <Image systemName="bus" />
         <Text>Current</Text>
         <Spacer />
         <Text>{current?.minutesToStop ?? '—'} min</Text>
       </HStack>
       <HStack spacing={8}>
         <Image systemName="arrow.right.circle" />
         <Text>Next</Text>
         <Spacer />
         <Text>{next?.minutesToStop ?? '—'} min</Text>
       </HStack>
     </Section>
   </Form>
   ```

## Verification
- Rows show numeric minutes that update every 30s.

## Handoff to next step ([03-status-indicator.md](./03-status-indicator.md))
