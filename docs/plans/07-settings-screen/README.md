# Phase 07 — Settings Screen (@expo/ui Form + persistence)

A pure SwiftUI `Form` screen built with `@expo/ui`. Users tune walk time, notification lead-time buffer, preferred stop, traffic provider, and quiet hours. Values persist in `expo-secure-store` (simple scalars, no secrets — just using the same API for consistency) and feed into the ETA engine and notification logic.

## Dependencies
- Phase 04 (Settings tab mounted).
- `@expo/ui` installed.

## Success criteria
1. `<Host><Form>…</Form></Host>` with one `Section` per setting cluster.
2. Walk time: `Slider` 5–20 min, label shows current value.
3. Notification buffer: `Picker` (0, 1, 2, 3, 5 min).
4. Preferred stop: `Picker` (PJ210 / Hotel Lisa De Inn).
5. Traffic provider: `Toggle` or `Picker` (HERE / TomTom).
6. Quiet hours: two `DateTimePicker`s (start, end).
7. All values persist across cold-start via `expo-secure-store`.
8. A single `SettingsContext` exposes current values to the rest of the app.

## Task order
1. [01-form-shell.md](./01-form-shell.md)
2. [02-walk-time-slider.md](./02-walk-time-slider.md)
3. [03-notif-buffer-picker.md](./03-notif-buffer-picker.md)
4. [04-preferred-stop-picker.md](./04-preferred-stop-picker.md)
5. [05-traffic-provider-toggle.md](./05-traffic-provider-toggle.md)
6. [06-quiet-hours.md](./06-quiet-hours.md)
7. [07-persistence.md](./07-persistence.md)

## Hand-off to Phase 08
- `SettingsContext` shape is finalised and imported by notifications code.
- Walk time, buffer, quiet hours, and preferred-stop values drive the "Leave now" trigger logic.
