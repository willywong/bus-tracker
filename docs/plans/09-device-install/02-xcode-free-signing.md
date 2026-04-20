# 09-Device-Install / 02 — Xcode Free Signing

## Goal
Sign and install on the user's iPhone using a free Apple ID (no paid Developer account).

## Steps
1. In Xcode, open `apps/mobile/ios/T816Tracker.xcworkspace`.
2. Select the app target → **Signing & Capabilities** → uncheck "Automatically manage signing" if it complains, then re-check.
3. **Team**: select personal Apple ID (add via Xcode → Settings → Accounts if absent).
4. Bundle identifier must be unique: already set to `com.willywong.bustracker` in Phase 00 step 02.
5. Plug iPhone via USB; trust computer on the phone.
6. Select device in toolbar → **▶ Run**.
7. On iPhone: Settings → General → VPN & Device Management → trust personal certificate.

## Verification
- App icon appears on Home Screen; launches without "untrusted developer" dialog.

## Handoff to next step ([03-resign-runbook.md](./03-resign-runbook.md))
