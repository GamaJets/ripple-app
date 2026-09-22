# Repple Apps — Data Layout and Workflow Review for Claude Code

Prepared from the current `repple-redesign` worktree, the existing route map, current screen implementations, `docs/REDESIGN-20-LANES.md`, and the approved mockup board.

## Claude Code mission

Improve how the **existing real data** is prioritized, grouped, explained, and acted on across Repple Client, Repple Coach, and Repple Studio. This is a presentation and workflow redesign, not a backend rewrite.

Work only on branch `repple-redesign`. Never modify `main`. Keep all three apps at version `1.3.0`.

Read these files before editing:

1. `docs/claude-handoff/repple-approved-mockups-high-res.png`
2. `docs/claude-handoff/CLAUDE-CODE-MOCKUP-IMPLEMENTATION.md`
3. `docs/claude-handoff/CLAUDE-CODE-REDESIGN-BRIEF.md`
4. `docs/REDESIGN-20-LANES.md`
5. This report

The mockup board is the visual composition target. This report defines how the product's real data should flow through those compositions.

---

## Executive finding

Repple already contains the data and functionality needed for a strong product. Its primary UX problem is **information hierarchy**, not missing capability.

The apps currently expose many useful facts, actions, and secondary routes at similar visual weight. Users are often asked to interpret the system before they can act. The redesign should make each screen answer these questions in order:

1. **Where am I and whose data is this?**
2. **What is the most important current state?**
3. **What needs action now?**
4. **What is the next best action?**
5. **What supporting detail explains the recommendation?**
6. **Where can I inspect history or administer the system?**

Every primary screen should use this consistent stack:

`context → current state → next action → supporting evidence → history/tools`

The redesign must not fabricate information to fill the layout. Unknown values remain `—`, loading remains loading, partial reads remain identified, and queued/offline writes remain visibly undelivered.

---

## Existing architecture that must remain intact

### Product variants and primary navigation

- **Client:** Home, Train, Meals, Progress, Me
- **Coach:** Home, Clients, Programs, Schedule, Profile
- **Studio:** Overview, Trainers, Brand, Growth, Ops

Keep these stable. Do not promote secondary routes into additional tabs.

### Shared presentation system

Extend rather than replace:

- `src/theme/tokens.ts`
- `src/theme/scale.ts`
- `src/ui/components.tsx`
- `src/ui/kit.tsx`
- the three tab layouts, `app/(client)/_layout.tsx`, `app/(trainer)/_layout.tsx` and `app/(owner)/_layout.tsx` (the review named a `tabNavigation` module under src/ui; on this trunk the tab bars live in the layouts)
- `app/(client)/_layout.tsx`
- `app/(trainer)/_layout.tsx`
- `app/(owner)/_layout.tsx`

The existing kit already contains the right building blocks: `ScreenHeader`, `Section`, `SectionHead`, `Hero`, `KpiRow`, `ListRow`, `Notice`, `PartialRead`, `Cta`, `Ghost`, truthful `fig()` behavior, accessibility grouping, and Dynamic Type accommodations.

### Behaviors that cannot regress

- Existing routes and deep links
- Supabase queries, RPCs, policies, and role boundaries
- Client/Coach/Studio build separation
- Offline outbox and floor-queue behavior
- Write failure, retry, rejection, and partial-read semantics
- White-label tenant accents and identity
- Light mode, dark mode, and high contrast
- Dynamic Type and screen-reader semantics
- Locale, units, date/time zones, and currency
- App version `1.3.0`

Do not replace working providers or data hooks with mock state. Do not remove a working feature because it is absent from the first viewport; move it into progressive disclosure or its existing secondary route.

---

## Cross-app data presentation rules

### 1. One primary question per screen

Each primary screen must have one dominant purpose and one dominant action. A second visually equal hero means neither is a hero.

Examples:

- Client Home: “What should I do next?”
- Client Train: “What am I doing now?”
- Coach Home: “Who needs me today?”
- Coach Schedule: “What is happening on the selected day?”
- Studio Overview: “What needs operational attention?”

### 2. Show a metric with context, source, and time

Never present a number without enough context to interpret it.

Use:

- label
- value and unit
- comparison or target when real
- period, timestamp, or source
- status only when it changes an action

Example: `Adherence · 78% · last 7 days · down 9 points` is useful. `78%` alone is not.

### 3. Separate target, actual, remaining, and forecast

These are different facts and must never be styled as interchangeable.

- Nutrition: target / consumed / remaining
- Training: prescribed / completed / skipped
- Money: charged / received / pending / paid out / cost
- Capacity: available / booked / delivered
- Growth: current / change / forecast

### 4. Put the reason beside the alert

“Needs attention” must explain why and provide a direct action. Do not make users open a record to discover what the warning means.

Use a pattern such as:

`Client name → reason → age/severity → next action`

### 5. Make unknown different from zero

- `0` means a confirmed measured count.
- `—` means unknown or unavailable.
- An empty state means a valid read with no records.
- An error means the read failed.
- A partial read means some sources are unavailable.

Do not collapse these into the same visual result.

### 6. Put sync state beside affected data

Queued, failed, or offline status belongs beside the workout, attendance mark, message, or payment it affects—not only in a global banner.

### 7. Use progressive disclosure

The first viewport should contain the decision, not the database. Put history, settings, administrative tools, integrations, and low-frequency actions lower or behind an existing route.

### 8. Keep filters local and persistent

Date ranges, segments, client status filters, and selected schedule dates should remain visibly attached to the data they change. Avoid hidden global filters.

### 9. Use color as emphasis, never as the only meaning

Every status needs text or an icon in addition to color. Preserve existing accessible labels and selected/expanded states.

### 10. Design for real extremes

Test long names, AED currency, large values, no data, one point, stale data, partial data, offline mode, Dynamic Type, and white-label colors. The design is not approved if it works only with short sample values.

---

## Client app review

### A. Home / Daily Briefing

Primary file: `app/(client)/dashboard.tsx`

#### Current issue

Home includes adaptive next-action logic, weekly progress, daily snapshot, invitations, injuries, notices, sessions, coach content, gym content, history, challenges, and onboarding. These are useful, but too many can compete for attention.

#### Required information order

1. Compact time-of-day greeting and profile control.
2. Real weekly goal/completion state.
3. One adaptive primary action using the existing logic.
4. Urgent injury, write failure, or offline/outbox state when present.
5. Today: next workout/session/check-in.
6. Quiet daily snapshot with no more than three supporting metrics.
7. Coach and gym updates.
8. History, challenges, notices, and setup tools.

#### Implementation direction

- Do not place Meals, Progress, and Program as equal feature tiles above the fold; they already have primary navigation destinations.
- Do not let promotional or motivational content outrank an injury, rejected write, or scheduled session.
- Keep invitation acceptance and coach/gym announcements fully functional, but render them according to urgency.
- Collapse routine secondary content into compact rows.

#### Acceptance test

Within three seconds, a member can identify their current weekly state and the one action Repple recommends next.

### B. Training and active workout

Primary files:

- `app/(client)/workouts.tsx`
- `app/(client)/week.tsx`
- `app/(client)/exercise.tsx`
- `app/(client)/library.tsx`
- `src/ui/ExerciseVideo.tsx`

#### Current issue

Training is one of the richest flows in the app. It supports coach programs, program blocks, recovery logic, calendar selection, manual logging, timed sessions, media, set methods, RPE, watch zones, music, injury rules, personal records, offline writes, and retry states. During an active workout, integrations and secondary metrics can displace the immediate task.

#### Required workflow

`Plan → day → exercise → current set → rest → next set/exercise → session summary → saved/queued/rejected state`

#### Active-workout information order

1. Exercise progress, such as `Exercise 1 of 5`.
2. Real exercise visual or honest named placeholder.
3. Exercise name and coach prescription.
4. Current/next set: reps, load, duration, tempo, RPE, or percentage as applicable.
5. Full-width `Complete Set` action.
6. Rest timer and pause/resume state.
7. Completed sets and next/previous exercise.
8. Watch zones, calories, music, and other integrations.
9. End/finish controls with confirmation where already required.

#### Implementation direction

- Keep every existing set type and unit conversion.
- Media must remain in-app. If unavailable, show the exercise name and truthful unavailable/loading state.
- Never hide offline save state after completion.
- Do not reduce the active workout to a decorative mockup; the input mechanics are the product.

#### Acceptance test

At any point in a workout, the member can answer: “What exercise, what set, what prescription, and what do I tap next?” without scrolling past integrations.

### C. Meals / Nutrition

Primary files:

- `app/(client)/nutrition.tsx`
- `app/(client)/foodlog.tsx`
- `app/(client)/restaurant.tsx`
- `app/(client)/habits.tsx`

#### Current issue

Nutrition combines targets, consumption, coach notes, meal plans, recipes, swaps, grocery lists, cooking mode, preferences, allergens, restaurants, and food logging. The screen can read as several products at once.

#### Required information order

1. Day/date context.
2. Calorie target, consumed, and remaining.
3. Macro status with units and target basis.
4. Full-width `Log Meal` action.
5. Breakfast/Lunch/Dinner/Snacks groups.
6. Coach note or meal-plan instruction.
7. Planned recipes and cooking tools.
8. Grocery list, preferences, allergens, water, and habits.

#### Implementation direction

- Keep “planned” visibly different from “eaten.”
- State where targets came from: coach plan, member settings, or calculated basis.
- If required measurements are unknown, keep the current setup path; never invent targets.
- Let logging be faster than browsing the plan.

#### Acceptance test

A member can see what remains today and log food in one clear action without first understanding the recipe/planning system.

### D. Progress / body / recovery

Primary files:

- `app/(client)/scans.tsx`
- `app/(client)/body-trends.tsx`
- `app/(client)/measurements.tsx`
- `app/(client)/compare.tsx`
- `app/(client)/recovery.tsx`
- `app/(client)/glucose.tsx`
- `app/(client)/devices.tsx`

#### Current issue

Progress includes weight, composition, photos, comparisons, recovery, glucose, device data, training progress, scan corrections, professional sharing, and AI photo review. The user has to assemble a progress story from many modules.

#### Required information order

1. Metric segment: Weight / Body Fat / Photos when supported.
2. Latest real value and timestamp/source.
3. Real change against a real prior value.
4. Minimal trend chart with a visible time range.
5. Add/update measurement action.
6. Measurement history.
7. Photos and comparisons.
8. Recovery, glucose, device sources, and professional export.

#### Implementation direction

- Never draw a confident trend from missing points.
- Put units on every value and preserve conversion behavior.
- Label device, manual, scan-machine, and other sources.
- Separate corrections from new measurements.
- AI-derived commentary must remain clearly identified and must not overwrite measured facts.

#### Acceptance test

The user can understand “where I am, how it changed, over what period, and where the data came from” in the first viewport.

### E. Coach relationship, messaging, and check-ins

Primary files:

- `app/(client)/my-coach.tsx`
- `app/(client)/messages.tsx`
- `app/(client)/coach.tsx`
- `app/(client)/checkin.tsx`
- `app/(client)/feedback.tsx`

#### Required workflow

`Coach identity → current ask/check-in → conversation → shared plan/feedback → relationship administration`

- Put the coach identity and response context first.
- Show an overdue check-in or unread message before discovery and administrative actions.
- Keep AI Coach distinct from the real coach; do not visually merge their authority.
- Place delivery/queued state next to the affected message or check-in.

### F. Scheduling

Primary files:

- `app/(client)/calendar.tsx`
- `app/(client)/bookings.tsx`
- `app/(client)/classes.tsx`
- `app/(client)/pt-sessions.tsx`
- `app/(client)/standing.tsx`
- `app/(client)/attendance.tsx`

#### Required workflow

`Upcoming → choose type → choose date/time → review → confirm → booking state → change/cancel`

- Lead with the next confirmed booking.
- Use one date-selection model across PT, classes, and open slots.
- Always show time zone, status, credits/cost, cancellation window, and coach/class identity before confirmation.
- Keep standing appointments and attendance as secondary history/administration.

### G. Me / profile / settings

Primary files:

- `app/(client)/profile.tsx`
- `app/(client)/settings.tsx`
- `app/(client)/appearance.tsx`
- `app/(client)/notification-prefs.tsx`
- `app/(client)/account.tsx`
- `app/(client)/onboarding.tsx`
- `app/(client)/getting-started.tsx`

#### Required information order

1. Real identity and membership/coach context.
2. Small row of meaningful personal stats.
3. Goals and personal information.
4. Connected apps/devices.
5. Notifications and appearance.
6. Privacy, security, documents, payments, and support.
7. Sign out and destructive account actions at the bottom.

Do not turn account administration into a dashboard. Use compact, hairline-separated rows.

---

## Coach app review

### A. Home and attention queue

Primary files:

- `app/(trainer)/dashboard.tsx`
- `app/(trainer)/dashboard.tsx` (the Clients tab on this trunk; the review called it clients.tsx)

#### Current issue

The Coach dashboard contains deep client details, roster health, departures, invitations, referrals, codes, broadcasts, assignments, nudges, training, meals, summaries, notes, and business information. It can become a command center without a clear command.

#### Required information order

1. Compact greeting and coach identity.
2. Three real operational KPIs: active clients, sessions today, clients needing attention (or nearest truthful equivalents).
3. Today's agenda.
4. Needs Attention queue, worst/most urgent first.
5. Full roster with search and Active/Inactive filter.
6. Invitations and onboarding.
7. Retention/departure, acquisition, referral, and broadcast tools.

#### Attention-row contract

Every row should contain:

- client identity
- one primary reason
- age or due date
- urgency/state in text
- one direct action

Examples of valid reasons are already present in the app: check-in due, low adherence, inactivity, plan ending, unread message, payment/session-credit issue, or missing setup. Do not combine unrelated warnings into an unreadable badge cloud.

#### Acceptance test

A coach can identify the next three people to contact and why without opening three client records.

### B. Client detail / coaching record

Primary files:

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

#### Current issue

The main client record holds attention items, program, injuries, intake, glucose, body state, payments, session credits, contacts, goals, training, schedule, nutrition, checklist, photos, messages, reports, documents, and coaching configuration. It is complete but not quickly scannable.

#### Required information order

1. Client identity, coaching status, and last activity.
2. Needs You: the single highest-priority real issue.
3. Compact outcome/adherence summary.
4. Direct actions: message, log session, update program, review check-in.
5. Current plan and current goal.
6. Training, nutrition, body, recovery, attendance, and check-in summaries.
7. Injuries and safety information positioned before program changes.
8. Payments/session credits as a separate business section.
9. Intake, reports, documents, contact history, and coaching settings.

#### Implementation direction

- Make the main record a summary and action surface, not a duplicate of every detail route.
- Never let money information visually outrank an injury or overdue coaching action.
- Keep “manual lead with no Repple account” visibly different from an active app user.
- Preserve every existing route and permission check.

### C. Program Builder

Primary files:

- `app/(trainer)/builder.tsx`
- `app/(trainer)/templates.tsx`
- `app/(trainer)/library.tsx`
- `app/(trainer)/exercise.tsx`

#### Current issue

The builder is a large, capable surface with client selection, template operations, program metadata, weeks, days, exercises, detailed prescriptions, validation checks, injuries, assignment, dates, and save behavior in one long flow.

#### Required workflow

`Building for → start source → program identity → weeks → days → exercises → prescription → checks → assignment review → save/assign outcome`

#### Implementation direction

- Show the current client/group context persistently.
- Treat templates as a start source, not a parallel editor.
- Use progressive disclosure for advanced prescription fields.
- Keep exercise rows compact and reorderable; editing one exercise must not visually expand every exercise.
- Place injury disclosures before assignment, with existing acknowledgement behavior intact.
- Keep `Program Checks` immediately before final assignment.
- Distinguish Save Draft, Save Template, Save Program, and Assign; do not label different writes as the same action.
- Preserve held/unassignable client logic and partial assignment results.

#### Acceptance test

A coach always knows who the program is for, which week/day/exercise is being edited, what remains invalid, and what the final button will write.

### D. Coach Schedule

Primary files:

- `app/(trainer)/calendar.tsx`
- `app/(trainer)/sessions.tsx`
- `app/(trainer)/log-session.tsx`
- `app/(trainer)/classes.tsx`
- `app/(trainer)/class-checkin.tsx`
- `app/(trainer)/my-register.tsx`

#### Current issue

The calendar supports month navigation, a selected day, booked/open/cancelled slots, checking in, moving, re-offering, late fees, standing appointments, availability generation, calendar busy reads, and Google sync. Administration can compete with today's schedule.

#### Required information order

1. Selected date and compact date strip/month control.
2. Day agenda ordered by time.
3. Each session's client/class, time, status, and one primary action.
4. Add/open-slot action.
5. Unmarked sessions and late-cancellation exceptions.
6. Standing appointments.
7. Availability generation and calendar integration.

#### Implementation direction

- Keep operational actions attached to the session they affect.
- Only expose Move/Cancel/Re-offer/Remove after selecting a session or opening its overflow.
- Show sync source and time zone.
- Do not describe a queued floor action as server-confirmed.

### E. Coach messaging

Primary files:

- `app/(trainer)/messages.tsx`
- `app/(trainer)/chat.tsx`
- `app/(trainer)/broadcast.tsx`
- `app/(trainer)/broadcast-session.tsx`
- `app/(trainer)/templates-messages.tsx`
- `app/(trainer)/nudges.tsx`

#### Required workflow

`Inbox → person/audience → context → compose → review → delivery state`

- Keep one-to-one messages distinct from broadcasts.
- Show audience size before sending a broadcast.
- Put saved messages and nudges inside compose flow rather than presenting them as equal destinations.
- Preserve delivery failure and partial-delivery detail.

### F. Analytics and growth

Primary files:

- `app/(trainer)/analytics.tsx`
- `app/(trainer)/leaderboard.tsx`
- `app/(trainer)/referrals.tsx`
- `app/(trainer)/leads.tsx`
- `app/(trainer)/ad-spend.tsx`

#### Required information order

1. Client outcomes and adherence.
2. Retention and clients at risk.
3. Coach capacity and delivery.
4. Referrals and leads.
5. Acquisition attribution and ad spend.
6. Leaderboards/vanity comparisons last.

Always attach date range, population, and data source to a metric. Do not compare partial populations as if complete.

### G. Money

Primary files:

- `app/(trainer)/money.tsx`
- `app/(trainer)/billing.tsx`
- `app/(trainer)/invoices.tsx`
- `app/(trainer)/receipts.tsx`
- `app/(trainer)/payments.tsx`
- `app/(trainer)/costs.tsx`
- `app/(trainer)/statement.tsx`

#### Current strength to preserve

The current implementation explicitly separates ledgers and warns against false netting. Preserve that accounting honesty.

#### Required information order

1. Period and currency context.
2. Coming in: charged, recorded, pending, overdue.
3. Landed: Stripe payouts and manual receipts, kept separate.
4. Going out: subscription/platform cost, ad spend, recorded business costs.
5. Client-level detail.
6. Statements and transaction history.

Never combine platform charges, manual cash/transfers, payouts, invoices, or costs into a single “revenue” figure unless the existing source supports that calculation and the basis is stated.

---

## Studio app review

### A. Overview

Primary file: `app/(owner)/dashboard.tsx`

#### Current issue

The screen mixes operational warnings, active members, trainer counts, sessions, trends, trainer health, client load, revenue analytics, financial checks, promotions, payroll/classes, notifications, and feedback.

#### Required information order

1. Operational attention/exception state.
2. One primary live operating metric with period/source.
3. Today: sessions, attendance, and delivery exceptions.
4. Trainer health/capacity, worst first.
5. Member load and retention.
6. Revenue/financial summaries.
7. Promotions, notifications, feedback, and administrative links.

### B. Trainers

Primary file: `app/(owner)/trainers.tsx`

- Lead with roster health and exceptions, not the invite form.
- Show each trainer's clients, delivered sessions, capacity, and relevant risk using the same period.
- Keep invitations and pending invitations below the operating roster unless onboarding is incomplete.
- Preserve unknown currency/session-fee states instead of manufacturing value.

### C. Operations

Primary file: `app/(owner)/ops.tsx`

The screen contains several different jobs: session fee, merchant onboarding, member notices, support triage, event history, rota, equipment, exercise library, deletions, and settings.

Group them into:

1. **Needs action:** merchant problem, open support items, deletion clock, service-due equipment.
2. **Member operations:** notices and current events.
3. **Commercial configuration:** session fee and payments.
4. **People and floor:** rota, equipment, exercise library.
5. **Administration:** settings and guide.

Do not show a failed read as an empty operational queue.

### D. Growth

Primary file: `app/(owner)/growth.tsx`

Required order:

1. Trainer retention.
2. Member base and change.
3. Cohorts.
4. Acquisition funnel.
5. Promo/referral performance.

Make “trainer retention” and “member retention” unmistakably different. Label sample size and period.

### E. Brand

Primary file: `app/(owner)/brand.tsx`

- Treat the gym name, palette, and preview as one guided brand configuration flow.
- Preview changes on representative buttons, labels, and status—not only a color swatch.
- Enforce readable `brandInk` behavior and retain the ability to clear a gym override.
- The Repple corporate logo pack supplied in `docs/claude-handoff/logo/` is for Repple marketing; do not force it over a tenant's white-label identity.

---

## Shared component changes Claude should make first

Prefer a small set of reusable improvements over screen-specific styling:

1. **Compact page header** with eyebrow/context, title, optional avatar/global action.
2. **Primary action block** that supports a title, reason, metadata, and one CTA.
3. **Attention row** with identity, reason, age/due date, status text, and action.
4. **Metric summary** with value, unit, comparison, period, and source.
5. **Segmented control** that supports Dynamic Type and accessible selected states.
6. **Dense data row** with optional avatar/icon, two text lines, metadata, disclosure, and local sync state.
7. **Truthful chart shell** for loading, one point, gaps, partial reads, empty state, and error.
8. **Inline sync badge** for queued, retrying, failed, and delivered writes.
9. **Expandable secondary section** for low-frequency settings/tools.
10. **Sticky workflow footer** only where a long editor needs a persistent, unambiguous save/assign action.

Implement these through the existing theme and UI files. Do not create a parallel design system.

---

## Implementation roadmap and phases

### Phase 0 — Baseline protection

- Confirm `repple-redesign` and versions `1.3.0`.
- Inspect path-scoped working-tree changes before editing.
- Record existing providers, reads, writes, routes, permission checks, and offline branches.
- Run the current validation suite.

**Exit:** baseline is understood and no user work is overwritten.

### Phase 1 — Shared hierarchy components

- Implement the shared patterns above in the existing kit.
- Validate light/dark, tenant accents, large text, and screen readers.
- Keep tab navigation stable.

**Exit:** mockup compositions can be built without one-off visual systems.

### Phase 2 — Critical daily flows

Implement in this exact order:

1. Client Home
2. Coach Home/Attention Queue
3. Client active workout
4. Coach Client Detail
5. Coach Program Builder
6. Client Progress
7. Coach Schedule

**Exit:** the seven priority surfaces match the mockup hierarchy and preserve real behavior.

### Phase 3 — Complete Client information architecture

- Meals and food logging
- Coach/check-ins/messages
- Booking/classes/PT
- Profile/onboarding/settings
- Engagement and secondary progress/training routes

**Exit:** every Client primary tab has one clear job and secondary routes remain reachable.

### Phase 4 — Complete Coach and Studio

- Messaging
- Analytics/growth
- Money
- Profile/credentials/brand
- Studio Overview, Trainers, Ops, Growth, Brand

**Exit:** operational data is ordered by actionability, then evidence, then administration.

### Phase 5 — Website and marketing consistency

- Use the supplied corporate logo lockup.
- Keep Member/Coach/Studio color identities distinct.
- Use real or explicitly illustrative product previews.
- Route each audience above the fold.

**Exit:** website story and in-app hierarchy describe the same product.

### Phase 6 — State, accessibility, and regression matrix

For each priority screen verify:

- loading
- ready with data
- ready with no data
- partial read
- read error
- offline
- queued write
- rejected write
- long content and large values
- Dynamic Type
- dark mode
- tenant accent
- VoiceOver labels and order

Run continuously:

```bash
npm run typecheck
npm run check:tabs
npm run check:reads
npm run check:prose
```

Run relevant targeted tests for every changed provider or workflow.

### Phase 7 — Visual approval, then release

- Capture direct mockup-versus-runtime comparisons.
- Show at minimum Client Home, active workout, Meals, Progress, Coach attention, Client Detail, Program Builder, Coach Schedule, and Studio Overview.
- Fix visible hierarchy mismatches before requesting approval.
- Do not start EAS/TestFlight until the user explicitly approves the screenshots.

---

## Claude Code execution checklist

For each screen:

1. Read the complete current file and its path-scoped diff.
2. Write down the existing reads, writes, routes, permissions, and failure states.
3. Identify the screen's one primary question and primary action.
4. Reorder existing data into the hierarchy specified in this report.
5. Move secondary functionality; do not delete it.
6. Use existing real data and honest unknown states.
7. Test state branches, not only the populated happy path.
8. Run typecheck and relevant tests.
9. Capture a runtime screenshot at the approved device size.
10. Compare it directly with the approved mockup before moving to the next priority screen.

## Definition of done

A screen is done only when:

- It visibly follows the approved mockup composition.
- Its real data tells a clear story in the correct order.
- One primary action is unmistakable.
- Existing functionality, routes, permissions, and data contracts still work.
- Unknown, empty, loading, partial, offline, queued, and failed states are truthful.
- White-label, dark mode, Dynamic Type, and accessibility remain correct.
- Relevant tests pass.
- A runtime screenshot has been reviewed against the mockup.

Do not call a screen complete because it was restyled. The flow is complete only when a real user can understand the state and take the correct next action with less effort.
