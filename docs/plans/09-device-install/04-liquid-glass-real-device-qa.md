# 09-Device-Install / 04 — Liquid Glass Real-Device QA

## Context
- Simulator uses software renderer; glass looks degraded there (brief §4.2, §7).
- This is the first chance to confirm glass actually looks right.

## Goal
Validate every glass surface on the real iPhone and capture baseline screenshots.

## Checklist
- [ ] Native tab bar shows true Liquid Glass blur (not flat colour).
- [ ] Tracker countdown card's `glassEffect` modifier renders with correct translucency + refraction.
- [ ] Map floating ETA card (`GlassView`) blurs the map underneath cleanly.
- [ ] No flicker when scrolling.
- [ ] Dark mode glass tints match system.
- [ ] Landscape + portrait both behave.

## Steps
1. Install via Phase 09 steps 1–3 if not already done.
2. Take screenshots of each glass surface with the phone's Screenshot button; save to `docs/screenshots/on-device/`.
3. Log any glitches as tasks in Phase 10.

## Verification
- Screenshot directory committed; Phase 10 perf/error passes can reference them.

## Handoff — Phase 09 complete
- App is on the phone; glass visuals confirmed.
- Phase 10 wraps up polish.
