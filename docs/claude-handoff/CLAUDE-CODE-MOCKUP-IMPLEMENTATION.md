# Claude Code Instructions — Build the Approved Repple Mockups Into the Existing App

## Mission

Implement the approved Repple mockup designs inside the **existing application that is already working**. This is a frontend redesign and workflow simplification, not a rewrite.

Work only on branch `repple-redesign`. Never modify, merge into, reset, rebase, or check out files from `main`.

Keep all three apps at version `1.3.0`:

- Repple Client
- Repple Coach
- Repple Studio/Owner

## Read these files first

1. `docs/claude-handoff/repple-approved-mockups-high-res.png`
2. `docs/claude-handoff/CLAUDE-CODE-REDESIGN-BRIEF.md`
3. `docs/REDESIGN-20-LANES.md`

The high-resolution mockup board is the visual source of truth. Use it as a **composition target**, not as loose inspiration.

## Definition of success

The existing app must keep functioning exactly as it does now, but its visible composition, hierarchy, spacing, navigation, controls, and flows must closely match the approved mockups.

Success requires all of the following:

- The priority runtime screens clearly look like the approved mockups.
- Existing backend logic, routes, permissions, and real data contracts still work.
- No production data is fabricated to make a screen look complete.
- Loading, partial, empty, offline, queued-write, and error states remain truthful.
- Client, Coach, and Studio variants remain separate and correctly permissioned.
- White-label brand identity and accent colors continue to work.
- Light mode, dark mode, accessibility, Dynamic Type, locale, units, and currency remain correct.
- TypeScript and relevant checks pass.
- Side-by-side screenshots are approved before any TestFlight build starts.

## Rules that cannot be violated

### Preserve working functionality

Do not replace existing providers, hooks, data stores, write paths, or route contracts just to simplify a screen. Keep the current handlers and state transitions. Change the presentation layer around them.

Do not remove a working feature. If it does not belong in the mockup's primary viewport, move it under progressive disclosure, a secondary section, or an existing secondary route.

### Preserve real data behavior

Every metric, chart, count, avatar, session, exercise, payment, client, and message must come from the app's existing real data sources.

When data is unknown:

- Show `—`, an honest empty state, or the existing failure language.
- Never use a plausible-looking fake number.
- Never use mock client names, progress values, meals, balances, or workout results in production code.
- Preview-only seed data may exist only outside the workspace, such as under `/private/tmp`.

### Preserve offline and write semantics

Keep existing outbox/queue behavior. A queued write must still be described as saved on the device but not yet delivered. A rejected write must not be described as saved.

### Preserve white-labeling

Use theme values such as `t.brand`, `t.brandInk`, `t.bg`, `t.surface`, `t.surface2`, `t.ink`, `t.ink2`, `t.ink3`, and `t.ring`.

Do not hardcode Repple green into shared production components. The default Repple variant should appear green, while another stored brand accent must continue to render correctly.

### Preserve accessibility

- Keep or improve `accessibilityRole`, `accessibilityLabel`, `accessibilityHint`, and selected/expanded states.
- Maintain at least 44-point interactive targets.
- Ensure larger text can wrap without clipping, overlap, or horizontal scrolling.
- Do not communicate status using color alone.
- Keep contrast coherent in light and dark modes.
- Respect reduced motion where existing animation helpers already do so.

## Do not start over

Before editing any file:

1. Inspect its current working-tree contents.
2. Inspect the current path-scoped diff.
3. Preserve existing uncommitted changes unless they directly conflict with this brief.
4. Identify the current providers, actions, routes, accessibility behavior, and offline/error branches.
5. Keep those behaviors while changing visible composition.

Never use `git reset --hard`, `git clean`, destructive checkout commands, or broad rollback operations.

## Shared design implementation

Use and extend the existing design system rather than creating a second system:

- `src/theme/tokens.ts`
- `src/theme/scale.ts`
- `src/ui/components.tsx`
- `src/ui/kit.tsx`
- the tab layouts (`app/(client)/_layout.tsx`, `app/(trainer)/_layout.tsx`, `app/(owner)/_layout.tsx`)
- `app/(client)/_layout.tsx`
- `app/(trainer)/_layout.tsx`
- `app/(owner)/_layout.tsx`

### Visual language to reproduce

The mockups consistently use:

- Clean light canvas with restrained surfaces
- Dark navy/black primary text
- Green accent reserved for progress, status, and the primary action
- Compact page headers
- Small circular avatars
- Minimal card borders and shadows
- Hairline-separated list rows instead of stacks of large cards
- One visually dominant action per screen
- Compact segmented controls and chips
- Rounded full-width primary buttons
- Simple trend charts with a green line and minimal grid treatment
- Bottom tab bars with small icons and labels
- Dark-mode surfaces that preserve the same hierarchy

Do not copy colors as literal hex values from the PNG. Express the design through the existing theme tokens so dark mode and white-labeling remain functional.

## Exact implementation order

Do the work in this order. Do not spend time polishing low-priority utility screens while a priority screen still visibly disagrees with the mockup.

1. Shared design system and tab navigation
2. Client Home
3. Coach Clients/Attention Dashboard
4. Client Training and active workout
5. Coach Client Detail
6. Coach Program Builder
7. Client Progress
8. Coach Schedule
9. Client Meals and Profile
10. Remaining Client routes
11. Remaining Coach routes
12. Studio/Owner surfaces
13. Website
14. Accessibility, responsive, dark-mode, white-label, and regression passes
15. Side-by-side visual approval
16. TestFlight only after written approval

## Screen-by-screen implementation instructions

### 1. Client Home

Primary file:

- `app/(client)/dashboard.tsx`

Target composition from Client mockup page 2 and dark-mode page 20:

1. Compact greeting at the top: `Good morning, <first name>` or the correct time-of-day equivalent.
2. Profile/avatar control at the top right.
3. `Weekly Goal` block with the real completed/target count and a compact progress ring.
4. One full-width green primary action: normally `Start Workout`, using the existing adaptive action logic when recovery or nutrition is genuinely the next action.
5. Offline/outbox and urgent notices immediately after the hero when present.
6. Secondary detail below the first viewport as quiet list rows or sections.

Do not place three equal feature tiles above the fold. Meals and Progress already have primary tabs; Program remains reachable from Train.

Preserve:

- Pull to refresh
- Readiness logic
- Weekly goal calculation
- Coach/gym announcements
- Invitations
- Injury and streak warnings
- Sessions
- Offline/outbox states
- All existing secondary routes

### 2. Client Program Selection and Training

Primary files:

- `app/(client)/workouts.tsx`
- `app/(client)/week.tsx`
- `app/(client)/exercise.tsx`
- `app/(client)/library.tsx`
- `src/ui/ExerciseVideo.tsx`
- Existing exercise/demo/media helpers under `src/ui`

Target composition from Client mockup pages 3–6:

#### Program selection

1. Compact `My Program` header.
2. Current/Past segmented control where the existing route supports it.
3. One program visual/hero using real licensed exercise media or the existing truthful placeholder.
4. Program name, week/day, and focus.
5. Full-width green `Start Workout` action.
6. Quiet secondary `View Program` access.

#### Workout view

1. Compact exercise progress header such as `Exercise 1 of 5`.
2. Exercise visual in the first viewport.
3. Exercise name and prescription directly below the visual.
4. Coach note and set method only when present.
5. Real planned set information and completed-set state.

#### Active workout tracking

1. Exercise progress and visual first.
2. Exercise name, next set prescription, reps, and load.
3. Full-width green `Complete Set` action.
4. Rest timer and pause/resume controls.
5. Next/previous exercise controls.
6. Watch zones, calories, and music below the core workout controls so integrations never displace the main task.
7. Exercise demo opens in-app; do not send a member mid-session to a browser.

Preserve:

- Assigned coach programs and auto-program fallback rules
- Program block/week resolution
- Set rows, supersets, methods, intensity, RPE, tempo, percentage, and rest prescriptions
- Bodyweight/timed-set behavior
- Unit conversion
- Draft recovery
- Offline logging
- Personal-record logic
- Watch and music integrations
- Injury flags
- Finish, save, retry, and rejected-write behavior

If no media exists, show an honest branded placeholder with the exercise name. Do not fabricate exercise photography.

### 3. Client Meals/Nutrition

Primary files:

- `app/(client)/nutrition.tsx`
- `app/(client)/foodlog.tsx`
- `app/(client)/restaurant.tsx`
- `app/(client)/habits.tsx`

Target composition from Client mockup pages 8–10:

1. Compact `Nutrition` or `Meals` header.
2. Real daily calorie/macro target visualization.
3. Clear separation between target, consumed, remaining, and coach instruction.
4. Meal grouping using compact Breakfast/Lunch/Dinner segments or sections.
5. Search/log action that uses the existing food workflow.
6. Meal rows with thumbnail/icon, title, calories, and disclosure.
7. Water and habits remain reachable but do not compete with meal logging.

Unknown body measurements must not produce invented macro targets. Keep the current honest setup state and measurement route.

### 4. Client Progress

Primary files:

- `app/(client)/scans.tsx`
- `app/(client)/body-trends.tsx`
- `app/(client)/measurements.tsx`
- `app/(client)/compare.tsx`
- `app/(client)/recovery.tsx`
- `app/(client)/glucose.tsx`
- `app/(client)/devices.tsx`

Target composition from Client mockup page 7 and Coach progress mockups:

1. Compact `Progress` header.
2. Segments for Weight, Body Fat, and Photos where supported by existing routes.
3. One primary current value with real change from a real prior measurement.
4. Minimal green trend chart.
5. Time-range chips.
6. Measurements, photos, comparisons, recovery, glucose, and devices under progressive disclosure.

Never connect two measurements with an invented trend when the underlying points are missing. Preserve timestamps, units, source labels, and unknown states.

### 5. Client Profile, Settings, and Onboarding

Primary files:

- `app/(client)/profile.tsx`
- `app/(client)/settings.tsx`
- `app/(client)/appearance.tsx`
- `app/(client)/notification-prefs.tsx`
- `app/(client)/account.tsx`
- `app/(client)/onboarding.tsx`
- `app/(client)/getting-started.tsx`
- `app/(client)/devices.tsx`

Target composition from Client mockup pages 1, 18, 19, and 20:

1. Centered avatar, real name, and membership date/status when known.
2. Compact real KPI row.
3. Hairline-separated rows for Profile, Goals, Notifications, Privacy, Connected Apps, Help, and Sign Out.
4. Settings use compact list rows and native controls.
5. Dark mode preserves the exact hierarchy rather than becoming a separate visual system.

### 6. Remaining Client routes

Preserve and restyle without flattening functionality:

- Coach/messages/check-ins: `my-coach.tsx`, `messages.tsx`, `coach.tsx`, `checkin.tsx`, `feedback.tsx`
- Schedule: `calendar.tsx`, `bookings.tsx`, `classes.tsx`, `pt-sessions.tsx`, `standing.tsx`, `attendance.tsx`
- Engagement: `challenges.tsx`, `achievements.tsx`, `consistency.tsx`, `social.tsx`, `referral.tsx`
- Records/tools: `records.tsx`, `progression.tsx`, `history.tsx`, `tools.tsx`

Use the same compact header, list-row, segmented-control, chart, and primary-action patterns from the approved board.

### 7. Coach Dashboard and Client Roster

Primary files:

- `app/(trainer)/dashboard.tsx`
- `app/(trainer)/dashboard.tsx` (the Clients tab on this trunk)

Target composition from Coach mockup pages 2 and 3:

1. Compact greeting and coach avatar.
2. Three truthful KPIs: active clients, workouts/today, adherence or the nearest existing real equivalents.
3. Compact `Today` agenda.
4. `Needs Attention` before business analytics.
5. Client search and Active/Inactive filter.
6. Dense client rows with avatar, name, current status, and disclosure.
7. One green add/invite action.

Do not show counts as zero when their reads failed. Keep the existing truthful unavailable state.

### 8. Coach Client Detail

Primary and linked files:

- `app/(trainer)/client.tsx`
- `app/(trainer)/client-body.tsx`
- `app/(trainer)/client-training.tsx`
- `app/(trainer)/client-week.tsx`
- `app/(trainer)/client-goals.tsx`
- `app/(trainer)/client-nutrition.tsx`
- `app/(trainer)/client-photos.tsx`
- `app/(trainer)/client-attendance.tsx`
- `app/(trainer)/client-intake.tsx`
- `app/(trainer)/client-report.tsx`

Target composition from Coach mockup page 4:

1. Centered client avatar, real name, and truthful online/status label.
2. Three compact progress KPIs.
3. Hairline-separated rows for Notes, Measurements, Nutrition, Check-ins, Messages, Training, Goals, Photos, Attendance, Intake, and Reports.
4. Keep route-level detail available; the profile is the record index, not a replacement for every detail screen.

### 9. Coach Program Builder

Primary files:

- `app/(trainer)/builder.tsx`
- `app/(trainer)/templates.tsx`
- `app/(trainer)/library.tsx`
- `app/(trainer)/exercise.tsx`

Target composition from Coach mockup pages 5 and 6:

1. Compact `Build Program` header.
2. Program name field.
3. Seven round workout-day controls using the active brand color.
4. Simple rows for Exercises, Supersets, and Templates with truthful counts.
5. Persistent full-width green `Save Program` action.
6. Open the existing advanced day/exercise editor only when requested.

Preserve:

- Client selection and assignment
- Overwrite protection
- Injury disclosures and acknowledgements
- Multi-week program blocks
- Templates
- Exercise library/custom exercises
- Drag/reorder
- Sets, methods, intensity, rest, and progression logic
- Multi-client assignment
- Offline/error states

### 10. Coach Schedule

Primary files:

- `app/(trainer)/calendar.tsx`
- `app/(trainer)/sessions.tsx`
- `app/(trainer)/log-session.tsx`
- `app/(trainer)/classes.tsx`
- `app/(trainer)/class-checkin.tsx`
- `app/(trainer)/my-register.tsx`

Target composition from Coach mockup page 11:

1. Compact `Calendar` header.
2. Month grid with a clear selected day.
3. Compact agenda rows underneath.
4. Real time, client, and session/class type.
5. Existing admin operations under `Schedule tools` or existing secondary routes.

The schedule should feel like one operating surface, not a calendar followed by a second full dashboard.

### 11. Remaining Coach routes

Apply the approved visual system without changing contracts:

- Messaging: `messages.tsx`, `chat.tsx`, `broadcast.tsx`, `broadcast-session.tsx`, `templates-messages.tsx`, `nudges.tsx`
- Analytics: `analytics.tsx`, `leaderboard.tsx`, `referrals.tsx`, `leads.tsx`, `ad-spend.tsx`
- Money: `money.tsx`, `billing.tsx`, `invoices.tsx`, `receipts.tsx`, `payments.tsx`, `costs.tsx`, `statement.tsx`
- Profile/setup: `profile.tsx`, `credentials.tsx`, `brand.tsx`, `share-kit.tsx`, `documents.tsx`, `settings.tsx`, `getting-started.tsx`, `assistant.tsx`
- Resources/community: `group.tsx`, `checklists.tsx`, `videos.tsx`, `library.tsx`

### 12. Studio/Owner

Primary files:

- `app/(owner)/dashboard.tsx`
- `app/(owner)/trainers.tsx`
- `app/(owner)/ops.tsx`
- `app/(owner)/growth.tsx`
- `app/(owner)/brand.tsx`
- `app/(owner)/_layout.tsx`

Use the same design system, but preserve Studio-specific permissions and operating data. Do not turn the Studio app into a duplicate Coach app.

### 13. Website

Primary files:

- `web/index.html`
- `web/styles.css`
- Existing static audience, signup, auth, support, legal, and download pages under `web`

The website already has an approved dark-product-direction implementation. Improve it incrementally; do not restart it.

Required hierarchy:

1. Identify Members, Coaches, and Gym/Studio operators above the fold.
2. Give each audience its own clear CTA and destination.
3. Use real product screenshots from the approved/runtime designs.
4. Keep static architecture unless it is genuinely blocking the implementation.
5. Preserve accessibility, metadata, SEO, support, privacy, terms, and account-deletion routes.

## Parallel work rules

Parallelize only when file ownership does not overlap.

Recommended ownership:

- Lane A: shared design system and navigation
- Lane B: Client Home and Training
- Lane C: Client Meals, Progress, Profile, and remaining Client routes
- Lane D: Coach Dashboard and Client Detail
- Lane E: Coach Builder and Schedule
- Lane F: Coach Messaging, Analytics, Money, and Profile
- Lane G: Studio/Owner
- Lane H: Website
- Lane I: accessibility, responsive, dark mode, and white-label review
- Lane J: tests, runtime screenshots, and final integration

One integration owner must review and commit each lane. Do not let two agents edit the same large route simultaneously.

## Validation loop for every batch

After each meaningful path-scoped batch:

1. Run TypeScript.
2. Run the relevant route/read/prose checks.
3. Run targeted logic tests for the changed workflow.
4. Launch the correct app variant.
5. Navigate to the changed screen with real or truthful empty data.
6. Capture the screen.
7. Compare it to the matching mockup page.
8. Fix hierarchy, spacing, action prominence, text wrapping, and state errors.
9. Check a representative large-text setting.
10. Check dark mode and a non-default white-label accent.
11. Commit only the owned files.

Core commands:

```bash
npm run typecheck
npm run check:tabs
npm run check:reads
npm run check:prose
```

Run existing targeted tests in addition to these checks.

## Visual comparison requirements

For each priority screen, provide a pair:

- Left: relevant approved mockup crop
- Right: current simulator/browser runtime screenshot

Required review set:

1. Client Home
2. Client Program Selection
3. Client Workout View
4. Client Active Workout Tracking
5. Client Meals
6. Client Progress
7. Client Profile
8. Coach Dashboard/Clients
9. Coach Client Detail
10. Coach Program Builder
11. Coach Schedule
12. Coach Analytics
13. Studio Dashboard
14. Website Homepage desktop
15. Website Homepage mobile
16. Representative dark-mode Client screen
17. Representative dark-mode Coach screen

Do not use preview-only fake data in the workspace to produce these screenshots. If a simulator needs a visual fixture, keep it outside the workspace and label the screenshot as a preview fixture.

## Git and worktree handling

This worktree has previously suffered from extremely slow broad Git scans and stale `index.lock` files.

- Prefer path-scoped `git diff`, `git diff --check`, add, and commit commands.
- Avoid repeated repository-wide `git status` polling.
- Before removing `index.lock`, verify with `lsof` that no live process owns it.
- Do not interrupt a live commit unless it is confirmed stalled.
- Preserve unrelated staged Studio/Owner changes.
- Use meaningful commits grouped by feature or lane.

## TestFlight rule

TestFlight and EAS uploads are paused.

Do not build, upload, submit, or resume any TestFlight process until the user explicitly approves the side-by-side screenshots.

After approval only:

1. Reconfirm all three app versions are `1.3.0`.
2. Assign unique build numbers.
3. Run final release checks.
4. Build Client, Coach, and Studio independently.
5. Submit each build to its existing App Store Connect application.
6. Report build IDs, submission IDs, processing status, and any required user action.

## Final instruction to Claude Code

Do not report a screen as redesigned merely because typography, colors, or radii changed. It is complete only when its **runtime composition and flow visibly match the approved mockup**, its real data behavior remains intact, and its validations pass.

