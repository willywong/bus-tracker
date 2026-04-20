# Phase 09 — Install on Real iPhone (Free Apple ID via Xcode)

The iOS Simulator uses a software renderer, so Liquid Glass looks wrong there. This phase moves the app to real hardware using a **free Apple ID** in Xcode (no $99 Developer Account) and validates the glass effects end-to-end.

## Dependencies
- Phase 08 complete (everything that can be built in Simulator works).
- User has an iPhone running iOS 26+, a Lightning/USB-C cable, and Xcode installed on the Mac.

## Success criteria
1. `npx expo prebuild --platform ios` regenerates `ios/` cleanly.
2. Xcode opens the workspace, personal Apple ID added as signing Team.
3. App builds and installs to the user's iPhone with `▶ Run`.
4. On the iPhone: Settings → General → VPN & Device Management → Apple ID certificate trusted.
5. Liquid Glass tab bar, glass countdown card, and map-overlay glass card render correctly on-device.
6. A re-sign runbook is documented for the 7-day certificate refresh.

## Task order
1. [01-prebuild-ios.md](./01-prebuild-ios.md)
2. [02-xcode-free-signing.md](./02-xcode-free-signing.md)
3. [03-resign-runbook.md](./03-resign-runbook.md)
4. [04-liquid-glass-real-device-qa.md](./04-liquid-glass-real-device-qa.md)

## Hand-off to Phase 10
- App is usable on the actual iPhone.
- QA findings from task 04 feed directly into Phase 10 perf/error work.
