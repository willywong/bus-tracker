# 07-Settings-Screen / 02 — Walk Time Slider

## Context
- Form shell in place.

## Goal
Inside the Walk section: `Slider` 5–20 min + label showing current value.

## Steps
1. `HStack` with `Text "Walk time"`, `Spacer`, `Text "{value} min"`.
2. Below it, `Slider value={value} min={5} max={20} step={1} onValueChange={setValue}`.

## Verification
- Slider moves; text updates live.

## Handoff to next step ([03-notif-buffer-picker.md](./03-notif-buffer-picker.md))
