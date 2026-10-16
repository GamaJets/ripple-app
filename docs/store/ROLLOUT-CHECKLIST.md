# Production rollout checklist (client, coach, Studio)

Nothing here is done automatically. Every store step is the owner's call.

## Before building
- [ ] `main` is green (CI app job, plus the Studio web build).
- [ ] `npm run check:all` passes locally. It includes check:lint, release-version and version-bump.
- [ ] The version in `app.config.ts` is bumped if the release is a store version. Build numbers come from EAS (`appVersionSource: remote`, `autoIncrement`).
- [ ] Every DB part the release relies on is applied live (`list_migrations`), additive only.
- [ ] Edge functions the release calls are deployed (`list_edge_functions`).
- [ ] The Supabase advisors have no new ERROR findings.
- [ ] Sentry DSN set, if crash reporting is wanted for this release (see PR #15).

## Build
- [ ] `eas build --profile production|production-coach|production-owner --platform all`
- [ ] Every build reports FINISHED, with the expected build numbers.

## Test tracks
- [ ] iOS: `eas submit --platform ios --id <build> --profile <same>` → TestFlight.
- [ ] Android: `eas submit --platform android --id <build> --profile <same>` → **internal** track (eas.json pins `track: internal`).
- [ ] Smoke test on a real phone for each app: sign in, the main tab of each variant, log a set (client), build and assign a program (coach), the dashboard and analytics (Studio), push received, offline logging recovers.
- [ ] Crash-free over at least 24h of internal testing (Sentry, or Play vitals and TestFlight crashes).

## Store listing
- [ ] Copy from `docs/store/client.md`, `docs/store/coach.md` and `docs/store/studio.md` pasted into App Store Connect and Play Console. Check the limits (name 30, subtitle 30, keywords 100, short description 80).
- [ ] Screenshots from `scripts/store-screenshots.sh <app>` (6.9" and 6.5" iPhone, Play phone; iPad only if shipped on iPad).
- [ ] Privacy: App Privacy (iOS) and Data safety (Play) match `docs/LAUNCH-CHECKLIST.md`. Health data comes from HealthKit or Health Connect and is never used for ads.
- [ ] Review notes give App Review a demo account for each app (coach and Studio need data to show).
- [ ] Support and privacy policy URLs resolve.

## Going to production (owner decision)
- [ ] iOS: submit for review, with **manual release** or phased release (7 days).
- [ ] Android: promote internal → production with a **staged rollout** (10% → 50% → 100%), watching vitals at each step.
- [ ] Halt criteria are agreed up front: crash rate above 1%, a broken sign-in, or a data-write failure. Halt the staged rollout or pause the phased release, then fix and rebuild.

## After release
- [ ] OTA updates only for JS-only fixes, on the matching channel (`production`, `coach-production`, `owner-production`; see docs/OTA-UPDATES.md). Native changes need a new build.
- [ ] Tag the release commit (`v1.3.0`).
