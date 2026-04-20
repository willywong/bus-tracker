# 10-Polish / 03 — Accessibility

## Goal
VoiceOver reads every screen intelligibly.

## Checklist
- [ ] Tracker countdown: VoiceOver says "Leave in 7 minutes, current bus arrives in 17 minutes".
- [ ] Map markers announce their label on focus.
- [ ] Settings controls read label + current value + hint ("Walk time, 10 minutes, adjustable slider, swipe up or down to change").
- [ ] Dynamic Type scales reasonably up to Extra-Large.

## Steps
1. Enable VoiceOver (triple-click side button).
2. Walk through each screen; note anything unclear.
3. Fix via `accessibilityLabel`, `accessibilityHint`, `accessibilityValue` on RN views; SwiftUI primitives via @expo/ui usually inherit correct traits.

## Handoff to next step ([04-readme-final.md](./04-readme-final.md))
