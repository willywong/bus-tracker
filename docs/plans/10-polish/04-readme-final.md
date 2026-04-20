# 10-Polish / 04 — Final Project README

## Goal
A top-level `README.md` someone (including future-you) can use to get the project running in under 15 minutes.

## Required sections
1. **What this is** — one paragraph + screenshot.
2. **Tech stack summary** — link back to `t816-tracker-project-brief.md`.
3. **Prerequisites** — Node 20, pnpm, Xcode, Expo account, HERE key.
4. **Local setup** — `pnpm install`, `apps/api/.env` setup, `pnpm --filter api dev`, `pnpm --filter mobile start --dev-client`.
5. **First EAS build** — reference `docs/plans/00-foundation/06-eas-simulator-build.md`.
6. **Deploy API** — `cd apps/api && vercel deploy --prod`.
7. **Install on iPhone** — reference `docs/plans/09-device-install/`.
8. **7-day re-sign** — reference `docs/RUNBOOK_RESIGN.md`.
9. **Screenshots** — on-device glass screenshots from Phase 09 step 04.

## Verification
- Clone the repo on a fresh machine (or reset-test via a git worktree) and follow the README exactly — app should launch.

## Handoff — Phase 10 complete
Project is shipped. All 11 phase READMEs + 47 task files under `docs/plans/` describe the exact build. The app is on the user's iPhone. Re-sign every 7 days. Done.
