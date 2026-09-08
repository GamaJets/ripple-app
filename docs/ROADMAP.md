# Roadmap

> **Launch gate:** [LAUNCH-CHECKLIST.md](LAUNCH-CHECKLIST.md) lists what has to
> be put back before the apps go public. **Email confirmation is ON** —
> confirmed against the live project on 8 Sep 2026, not inferred from this
> file. See the note below.

The plan for turning three apps and a database into the thing the marketing
site claims: one operating record, read three ways.

This file is the tracked version. It exists because the roadmap previously
lived only in chat scrollback, which is not a place a plan survives.

**Status is claimed only where it is verifiable in this repo** — a module that
exists, a migration that is written, a test that runs. "Planned" means exactly
that, and nothing here should be read as shipped to users: at the time of
writing all three apps are in first-release review, and none of the Studio
features below have been used by a real gym.

> **Verified 8 Sep 2026.** Every status claim in this file was re-checked
> against the working tree on branch `overnight-wave`. **Eleven were wrong, all
> eleven in the same direction** — the document said something was missing, or
> smaller, than what the code already held. Corrected: Phase 1's PT scheduling,
> trainer rota and CSV plan import; Phase 3, which had no status line at all
> while all four of its bullets were written; Phase 5's revenue projection,
> named as unstarted in *What is left, honestly* while a gated six-month
> forecast ships in the owner app; Phase 8's `catch {}` count (~108 → **9**) and
> its "move the repo off the iCloud Desktop", already done; the R061 and R064
> remainders in the Correction table; "R072 (realtime) remains genuinely
> absent"; and both TestFlight items.
>
> Confirmed as still correct: Phase 2's seven, Phase 4's four, Phase 5's
> seasonality, capacity and class-re-timing work, Phase 6's absence of a
> roll-up, and Phase 7's door hardware. **Nothing in this file was found to be
> optimistic.** The failure mode is one-directional and has been since the first
> correction: this document under-reports the codebase, it does not over-report
> it. Two of the wrong entries had already survived a re-verification on 25
> August, which is the reason each row now carries a file and, where the code
> has not moved under it, a line. What is left is at the foot of this document,
> under *What is genuinely open*.
>
> One claim above the line could **not** be settled from the repo: "Email
> confirmation is currently OFF" is a Supabase dashboard toggle with no
> representation in this tree. `docs/LAUNCH-CHECKLIST.md:15` still records it as
> turned off on 26 Aug 2026. Treat that as unverified rather than as confirmed
> either way.

---

## The through-line

Every phase serves one of three jobs:

| | |
|---|---|
| **Record** | Capture what actually happened, once, in a form that can be audited. |
| **Read** | Give each of the three audiences the view of that record they need. |
| **Reason** | Only once the record is real: forecast, rank, and recommend from it. |

Reason comes last on purpose. A projection built on a thin record is the most
expensive output a business tool can produce, which is why the code returns
`null` rather than a plausible figure — see *The no-invented-numbers rule*
below.

---

## Phase 1 — The gym's operating record

The gap this closes: a gym had nowhere to record a membership, a payment, a
class or a walk-in. Every financial figure in the owner portal read zero
because the underlying tables did not exist.

### Landed

| Item | Where |
|---|---|
| Membership plans, memberships, payments, invoices | `supabase/parts/29-gym-operating-record.sql`, `src/lib/gymRecord.ts` |
| Classes, timetable series, bookings, attendance | `supabase/parts/30-classes-tenant-scope.sql`, `src/lib/gymSchedule.ts` |
| Trainer roster and the payroll basis | `src/lib/gymTrainers.ts` |
| Owner rollups and trainer health | `src/lib/ownerAnalytics.ts` |
| Studio web console — overview, money, timetable | `studio-web/` |
| **Drop-ins, guest passes and class packs** | `supabase/parts/31-drop-ins-and-passes.sql`, `src/lib/gymPasses.ts` |
| **Door log** — visits that are not class bookings | `supabase/parts/32-door-log.sql`, `src/lib/gymVisits.ts` |
| **Session outcomes and honest payroll** | `supabase/parts/33-session-outcomes.sql`, `src/lib/gymSessions.ts` |
| Studio console — Door and Sessions screens | `studio-web/app/door`, `studio-web/app/sessions` |
| **Equipment register** — and what it does to stated capacity | `supabase/parts/34-equipment-register.sql`, `src/lib/gymEquipment.ts` |

Two bugs of the same family were found and fixed while building this phase,
both worth remembering as the class to look for first:

- **`gym_classes` was readable across gyms** — scoped to any signed-in user
  rather than to the tenant (fixed in `30-classes-tenant-scope.sql`).
- **`sessions` had no tenant at all**, so a gym could not see the one-to-ones
  delivered on its own floor. Worse, "delivered" was inferred as *booked, and
  the clock has since passed* — which counted no-shows and slots nobody had
  cancelled, and then multiplied them by the session fee. The gym was being
  shown a payroll figure that included work that never happened
  (`33-session-outcomes.sql`).

### Still to do

**Re-verified file by file on 8 Sep 2026. Three of the four entries below were
wrong — including two that the 25 August pass had already re-checked and
confirmed as open.** The 25 August wording is kept beside each row rather than
deleted, because what it got wrong is the instructive part: it searched for
`pt_session` and `bookSession`, two identifiers this codebase has never used,
and it searched `supabase/parts/` for the word "rota" while `43-trainer-rota.sql`
was sitting in that directory. One was a naming problem. The other was not.

| Item | Status | Evidence |
|---|---|---|
| **PT session scheduling** — one-to-ones and classes on one timetable | **DONE — the 25 Aug entry ("genuinely open", booking half missing) was wrong.** Both halves. The gym's board is the merge of `gym_classes` and `sessions`, and the desk can create, move, book, unbook and remove a one-to-one slot. | `supabase/parts/44-gym-pt-schedule.sql`; `src/lib/gymPtSchedule.ts:208` `mergeTimetable`, `:547` `createPtSlot`, `:591` `removePtSlot`, `:610` `updatePtSlot`; `studio-web/app/timetable/page.tsx:71` imports all four, and `:1173` `BookTo` puts a named member on an open slot using `bookingFields` — the same row `book_session` would have written. The 25 Aug grep found nothing because neither `pt_session` nor `bookSession` has ever existed here. |
| **Session approval** | **DONE** (corrected on 25 Aug; still true, but every line number in that row has since moved). | `app/(client)/pt-sessions.tsx:164` takes `approveSession` from `useSessions()`; `src/ui/sessions.tsx:726` calls the RPC; the RPC is `supabase/parts/22-session-approvals.sql:36`. A dispute is now its own answer alongside it (`supabase/parts/241`, `src/lib/sessionDispute.ts`). |
| **Trainer rota** — who is on the floor when | **DONE — the 25 Aug entry ("No rota or shift table anywhere") was wrong.** Table, rules, screen, and what an hour costs. | `supabase/parts/43-trainer-rota.sql` creates `gym_shifts`; `supabase/parts/196-a-rota-that-cannot-be-costed.sql` adds the costing; `src/lib/gymRota.ts:324` `buildRota`, `:407` `coverage` (UNCOVERED vs IDLE), `:581` `rotaCost`; the screen is `app/(owner)/rota.tsx`. |
| **CSV import** — members, plans, historical payments | **DONE — the 25 Aug entry ("plans do not import") was wrong.** All three kinds. | `src/lib/csvImport.ts:816` exports `previewPlans`, alongside `previewMembers` (`:380`) and `previewPayments` (`:661`); `studio-web/app/import/page.tsx:64` types `Kind` as `'payments' | 'members' | 'plans'`, `:238` calls `previewPlans`, and `:541` inserts into `membership_plans`. |

**Phase 1 has no remainder.** The 25 August version of this section said the
remainder was "PT scheduling, the trainer rota, and plan import"; all three were
built, and two of them were built before that sentence was written.

One narrow thing the code itself flags as absent is carried down to *What is
genuinely open* below rather than left here: an owner freeing a PT hour from the
console cannot promote the waitlist, because `promote_session_waitlist` is
authorised on `trainer_id = auth.uid()`
(`supabase/parts/126-the-late-fee-and-the-waitlist.sql:368`). `studio-web/app/timetable/page.tsx:1160`
says so on the page rather than implying otherwise, which is the right handling
of a gap and not a substitute for closing it.

This was the third time a roadmap entry claimed something was missing that was
already built (see the correction section below). The 8 September pass makes it
the fourth, and this time the entries had already survived one re-verification.
The pattern is consistent enough to be worth a rule: **before starting any item,
grep for it first** — and grep for what the *code* would plausibly call the
thing, not for what this document called it. The document is a statement of
intent that ages badly, not a record of what exists; the code is the record.

---

## Phase 2 — Read: make the record legible

Getting the data in is worth little if the three audiences cannot see it.

Checked against the code on 26 Aug 2026, because this document has now been
wrong three separate times about what already exists. **Re-checked on 8 Sep
2026: all seven claims still hold, and none of them was wrong.** Three were
spot-checked past the filename, below the table.

**All seven are now built.** What each one refuses is as much the point as what
it shows: a month cannot close while sessions are unmarked, a trainer with no
confirmed delivery is not healthy, a cohort of three has no retention rate, and
a gym with no door log is told nothing about who has lapsed.

| Item | Status |
|---|---|
| **Studio web: members** | **Built.** `studio-web/app/members` + `src/lib/memberView.ts`. Built around what class attendance alone cannot tell you: two members with identical class histories, one of whom moved to the gym floor and one of whom stopped. Only the door log separates them. |
| **Coach: the book by who is drifting** | **Built.** `src/lib/clientDrift.ts` + the Clients screen. Ranks on the break in a person's own pattern, not on a level — a client who fell from 4 days a week to 1 outranks a steady 1-a-week client at the identical current rate. |
| **Member: a history that reads well going back** | **Built.** `app/(client)/history.tsx` + `src/lib/longView.ts`. The ceiling really was 10 weeks; this is months and years, with untrained months reporting null rather than 0 and breaks left visible instead of smoothed into a trend line. |
| **Studio web: staff** | **Built.** `studio-web/app/staff` + `src/lib/staffView.ts`. Puts an evidence gate in front of `trainerHealth`, which scored on bookings whose clock had passed — so a trainer with twenty unmarked sessions came back green. |
| **Studio web: retention** | **Built.** `studio-web/app/retention` + `src/lib/gymRetention.ts`. A roll-up of the per-member read, so the owner's headline and the coach's book cannot name different people. No rate over a cohort where one member moves it by more than ten points. |
| **Studio web: month-end close** | **Built.** `studio-web/app/close` + `src/lib/monthEnd.ts`. Refuses to present a month as closed while sessions are unmarked, because payroll is wrong by exactly those. |
| **Exports everywhere** | **Built both sides.** `src/lib/gymExport.ts` + `studio-web/app/export` for the gym, round-tripped through our own CSV importer. `src/lib/gdpr.ts` for the member — and it was silently capable of exporting an empty array for a table it could not read, which is fixed. |

Spot-checked past the filename on 8 Sep 2026, because "the file exists" is not
the same claim as "it does what the row says":

- **Staff.** `src/lib/staffView.ts:66` really does import `trainerHealth` from
  `ownerAnalytics.ts` and put the evidence gate in front of it — `:259` is the
  count of "sessions whose outcome somebody actually recorded", which is the
  thing the row says was missing before.
- **Month-end close.** `src/lib/monthEnd.ts:16` states the refusal in its own
  header ("A month is not closed while sessions are unmarked"), with
  `monthWindow` at `:100` and `monthEnded` at `:140` behind it.
- **Members.** `studio-web/app/members/page.tsx:1` opens by naming the exact
  distinction the row claims — a member who moved to the gym floor versus one
  who stopped, separable only by the door log — and `src/lib/memberView.ts:593`
  `retentionRead` is what says so when the two records disagree.

One correction of wording rather than of status: the member-history module is
`src/lib/longView.ts`, but there is no export called `longView`. What it
exports is `monthlyHistory` (`:261`), `yearRows` (`:306`) and `peakVolume`
(`:319`). Worth saying, because a grep for this document's own phrasing finds
nothing and would read as an absence.

---

## Phase 3 — Money, properly

- Stripe for card payments and recurring collection.
- Dunning: what happens when a card fails, before the member silently lapses.
- Invoices that reconcile against payments taken.
- Payroll runs from delivered sessions at the rate set, with an approval step.

**Checked on 8 Sep 2026: all four are written.** This section was never given a
status line of its own, and the single sentence below — "Phase 3 needs Stripe
keys" — has been carrying the whole weight of it, which reads as though nothing
had been built. It had.

| Bullet | Evidence |
|---|---|
| Stripe, card and recurring | `supabase/functions/stripe-checkout`, `stripe-portal`, `stripe-webhook`, `gym-checkout`, `gym-onboard`, `connect-onboard`, `connect-checkout`, `connect-refund`. |
| Dunning | `src/lib/billing.ts:74` — "Owner dunning: invoices that failed or are unpaid, newest first". `past_due` sits deliberately *inside* the live band (`src/lib/subscriptions.ts:46`) because a failed card has not ended anything, and `src/lib/subscriptionScope.ts:272` is where that distinction is made. |
| Invoices reconciling against payments | `src/lib/gymInvoices.ts`; `studio-web/app/accounting/page.tsx:21` — the reconciliation lists (invoices marked paid with no payment behind them, payments with no invoice in front of them) are stated there as the reason the page exists at all. |
| Payroll runs, at the rate set, with an approval step | `src/lib/gymSessions.ts:676` `recordSettlement`; per-coach rates on `gym_trainer_pay` (`supabase/parts/183`) rather than one `session_fee` for everybody; `src/lib/gymPay.ts:974` `reverseSettlement`, which refuses without a written reason (`:1043`); the screen is `studio-web/app/payroll/page.tsx:40`. |

What is outstanding here is not code. Stripe **Accounts v1 is enabled in TEST
and not in LIVE**, which blocks coach onboarding — it is item 11 of
`docs/LAUNCH-CHECKLIST.md:489`, and it is a person in a dashboard.

---

## Phase 4 — Retention

Retention is where a gym's economics actually live, and it is a coaching
problem before it is a revenue one.

**All four are built** (checked against the code on 26 Aug 2026; re-checked
8 Sep 2026, and all four still hold). The two claims that carry the most
weight were traced past the filename: `src/lib/interventions.ts:46` states in
its own header that there is no success rate on `FollowUpTally` and why, and
`src/lib/passConversion.ts:31` names `anonymousPasses` and `attributionNote`
as the fields that count the excluded walk-ins out loud (`:312`, `:259`).

| Item | Where |
|---|---|
| Lapse risk per member | `src/lib/clientDrift.ts` — a break in the member's OWN pattern, not a threshold. No baseline means UNKNOWN, never healthy. |
| The intervention loop | `supabase/parts/50-interventions.sql` + `src/lib/interventions.ts`. Judged on a window taken from the member's own rate, and deliberately produces NO success rate — everyone in the table was contacted because they were drifting, so there is no untouched group to compare against. |
| Guest-pass conversion | `src/lib/passConversion.ts` + `studio-web/app/passes`. Passes to anonymous walk-ins are excluded from every denominator rather than counted as failures. |
| Absence detection | `retentionRead` in `memberView.ts`. The membership join is done: absence is only claimed for a member the gym still expects to see, and `absenceUnknownBecause` names frozen and cancelled separately. |

---

## What is left, honestly

*Rewritten 8 Sep 2026 after the sweep described above.*

Phases 1, 2, 3 and 4 are written. Phase 3's blocker is a Stripe dashboard
setting, not a missing module (`docs/LAUNCH-CHECKLIST.md:489`). **Phase 5
should mostly not be started yet, and the roadmap already says why**: "Only
meaningful once phases 1–4 have produced enough record to stand on", and
"Seasonality — needs a full year before it says anything at all."

One correction to that, because this section previously named revenue
projection as unstarted and it is not: `app/(owner)/revenue.tsx:151` draws a
six-month forecast from `metric_history` (`supabase/parts/129`), gated by
`canForecast` at `:148` — which requires at least two *real* recorded months
and a whole read, and otherwise draws no line at all rather than projecting a
flat one. That is the discipline this phase demands, applied already. Class
re-timing value, capacity modelling and seasonality are genuinely unstarted.

There is still no real gym on this. Capacity modelling built against an empty
database would be exactly the invented-figure problem the whole project has
spent its time removing, one level up: a forecast with nothing behind it.

The remaining work that changes anything is in `docs/LAUNCH-CHECKLIST.md`, and
most of it needs a person rather than a commit. What is left in *this* document
is listed at the bottom, under *What is genuinely open*.

---

## Phase 5 — Reason

Only meaningful once phases 1–4 have produced enough record to stand on.

- Revenue projection from the gym's own history.
- Class re-timing value: what moving a quiet slot is worth.
- Capacity modelling against real equipment and staff.
- Seasonality — needs a full year before it says anything at all.

Every one of these must state what it read and decline when the record is too
thin. The Studio marketing page commits publicly to this; the code has to keep
that promise.

**Checked 8 Sep 2026.** One of the four is part-built and three are not:

- **Revenue projection — part-built.** `app/(owner)/revenue.tsx:148–151`, from
  `metric_history` (`supabase/parts/129`), with `src/lib/monthlyHistory.ts:94`
  counting how many points on the chart are real so the forecast cannot assume
  six months a fresh install does not have. This is the owner app, not the
  console.
- **Class re-timing value — not started.** The raw material exists:
  `app/(owner)/class-analytics.tsx:1` reads fill rates per class × branch ×
  trainer × time from `class_attendance_summary`. Nothing turns a fill rate into
  what moving a quiet slot would be worth.
- **Capacity modelling — not started.** `src/lib/gymEquipment.capacityFor` gives
  *stated* capacity from the register and returns `null` where nothing is
  recorded; there is no model over it.
- **Seasonality — not started.** `grep -rniE "seasonality" src studio-web`
  returns nothing outside comments.

---

## Phase 6 — Multi-site

- One owner, several gyms: roll up and drill down.
- Per-site staff, timetables and pricing under one brand.

**Checked 8 Sep 2026: started, and less finished than "started" usually
implies.** `supabase/parts/290` adds `owner_sites` and `my_sites()`, which
record who owns what and grant nothing else — an owner recorded against two
gyms can read one of them and the other's name. `src/lib/ownedSites.ts` exists
to keep the console honest about that (`studio-web/components/Shell.tsx`,
`studio-web/app/page.tsx`, `/close`, `/classes`, `/analytics`), and every copy
function in it returns `null` for a single-site owner so nothing renders in the
common case. **There is no roll-up and no drill-down**, and per-site staff,
timetables and pricing are not modelled: `gym_classes.branch` is free text
inside one gym, and part 290 argues explicitly that it must not be made into
the multi-site key.

---

## Phase 7 — Integrations

- Door access hardware.
- Accounting export (the gym's accountant will ask).
- Wearables beyond Apple Health, where the data is honest enough to use.

**Checked 8 Sep 2026: two of the three are built.**

| Item | Status | Evidence |
|---|---|---|
| Door access hardware | **Genuinely open.** | `grep -rniE "turnstile\|kisi\|brivo\|door access"` over `src`, `studio-web` and `supabase/parts` hits only prose and one feature keyword (`src/lib/features.ts:136`). A member has an entry barcode (`app/(client)/access`) that a human or a scanner reads; nothing talks to a controller. |
| Accounting export | **Built.** | `studio-web/app/accounting/page.tsx` — cash-basis, says so, never subtracts one side from the other and calls it profit, and puts the invoice/payment disagreements on the page as the output. |
| Wearables beyond Apple Health | **Built for the vendors that can be read.** | `src/lib/wearables/registry.ts:33–63` — WHOOP, Oura and Health Connect are connectable; Garmin needs an approved partnership and Fitbit has no client id, and both rows now say so in the catalogue rather than advertising metrics no build has. |

---

## Phase 8 — Hardening

Ongoing rather than final, and partly already underway. Counted and checked
again on 8 Sep 2026; the first three lines were all out of date, one of them
badly.

- **Audit the discarded catches. ~~There are ~108 `catch {}` blocks~~ — that
  number was wrong by an order of magnitude.** The real count at the start of
  this pass, across `app/`, `src/` and `studio-web/`, was **9**:
  `app/(client)/foodlog.tsx:669`, `app/(client)/social.tsx:97`,
  `app/(client)/nutrition.tsx:484`, `app/(client)/scans.tsx:1186`,
  `src/ui/components.tsx:90`, `src/ui/brand.tsx:75`, `src/ui/clientData.tsx:302`,
  and two in `src/lib/wearables/oauthConfig.ts:60` and `:65`.
  `grep -rnE "catch[[:space:]]*(\([^)]*\))?[[:space:]]*\{[[:space:]]*\}"`
  over those three trees returns 16 lines, but **7 of them are prose** — comments
  in `app/_layout.tsx:73`, `src/ui/invites.tsx:11`, `src/lib/connect.ts:150`,
  `src/lib/updateCheck.ts:16`, `src/lib/workoutQueue.ts:20` and two test files
  (`updateCheck.test.ts:30`, `workoutQueue.test.ts:93`) describing a swallowed
  failure that was *removed*. A grep that counts the comment explaining a fix
  as an instance of the bug is how ~108 came to be written down. `studio-web/`
  has none at all. Of the 9 real ones, seven were around `AsyncStorage` reads,
  an image resize and a share sheet; the two in `oauthConfig.ts` guarded env
  lookups. None was a write to the database.

  **And this entry aged in the ninety minutes it took to write it.** A parallel
  lane closed all nine while this sweep was running: re-running the same grep
  at the end of the pass returns 15 lines, of which 12 are the prose above and
  3 are string fixtures inside a new `src/lib/silentCatch.test.ts`. **Zero bare
  `catch {}` blocks remain in shipping code**, and that test now holds the line
  — its rule is not "no empty catch" but "no empty catch without a written
  reason", on the argument that an empty catch with a reason is a decision and
  one without is indistinguishable from an oversight. This is the R065 lesson
  happening again in real time, and it is left visible for the same reason
  R065 is: a status is only true at the instant it is written.
- **Surface write failures to the user** rather than logging and moving on.
  **Substantially done.** `writeFailedText` is used across 15 files in `src/`
  and `studio-web/`, and `assertWrote` (a write that reports success while
  changing no rows) across 26 in `src/lib`. Not claimed complete — nothing
  enumerates the writes that still do not.
- ~~**Move the repo off the iCloud Desktop.**~~ **Done.** The repo is at
  `/Users/timothyrodgers/repple-app`, which is not under Desktop or iCloud
  Drive. The lesson stays worth keeping: files evicted to `dataless` read as
  empty, which produced one wrong conclusion in this codebase.
- Accessibility pass across all three apps. **Underway, not finished.**
  `src/lib/a11y.ts` with `a11y.test.ts` behind it, plus `scripts/check-a11y.mjs`
  and `scripts/check-contrast.mjs` as gates. What is not established is
  coverage — a gate that passes is not the same claim as a pass having been
  made across all three apps.
- Load and permission testing per role. **Permission side partly covered**
  (`src/lib/staffRoles.test.ts`, `src/lib/consoleRoutes.test.ts`); **load
  testing has no artefact in this repo** and should be read as open.

---

## The no-invented-numbers rule

This governs every phase and is not negotiable.

> If a figure cannot be derived from a row someone actually created, it renders
> as `—` with a note saying what is missing. Never a zero, never an estimate
> dressed as a measurement.

In practice:

- Derived money returns `null`, not `0`, when the inputs are absent
  (`gymRecord.summarise`, `gymTrainers.payroll30For`, `gymPasses.passRevenueCents`).
- Rates return `null` when the denominator is unmeasured
  (`gymSchedule.summariseAttendance` — show rate and fill rate).
- An unfinished visit is not a zero-minute visit: `gymVisits.averageDwellMinutes`
  averages only over visits that recorded an exit, and says how many that was.
- An unpriced pass is not a free pass. A deliberately free one is `0`, and the
  two are distinguishable.
- An unmarked session is neither delivered nor cancelled — it is unknown.
  `gymSessions.payrollTotal` refuses to report a period settleable while any
  remain, and `settlementBlocker` says how many need marking.
- An empty equipment register is not an empty gym. `gymEquipment.capacityFor`
  returns `null` when nothing of a category is recorded, never `0` — which
  would tell an owner their class cannot run on the strength of a form nobody
  filled in. "Schedule set but never serviced" is its own state, distinct
  from "no schedule".

The tests in `src/lib/coverage.test.ts` exist mainly to hold this line, and are
written so they fail when the rule is broken — verified by mutation, not by
assumption.

## TestFlight feedback — both now built

Two reports from TestFlight, both feature requests rather than defects. This
section was headed "open" and said neither was scheduled. **Checked 8 Sep 2026:
both are built**, and the heading was wrong. The reports are kept verbatim,
because the wording is what the work was shaped around.

- **Build 24, 22 Aug 2026** — "Need to create a tutorial about the app once u
  download it quickly takes u through the pages / features offered." A first-run
  tour. Worth doing per variant, since the three apps open on different screens.
  **DONE, and per variant as suggested.** `app/tour.tsx` — one card per tab in
  tab order, from the same sections the user guide uses, skippable on every
  card; `tourKey(v)` is scoped to the app variant so installing the coach app
  gets its own tour. Shown once: `app/index.tsx:33` reads `hasSeenTour(VARIANT)`
  and `:47` redirects to `/tour`. Reachable again afterwards from
  `app/guide.tsx:120` and from both getting-started screens
  (`app/(client)/getting-started.tsx:194`, `app/(trainer)/getting-started.tsx:207`).
  A second report in the same week — "too complicated and scary to be used" —
  is quoted at the top of `app/tour.tsx` and answered separately by
  `src/lib/firstRun.ts`, which cut a new client from eight questions across two
  wizards to one.
- **Build 28, 25 Aug 2026** — "Sleep information should be able to come from
  Apple health, whoop, or the other devices that connect to the app."
  **DONE.** The old status line here — "sleep is a field they expose that Repple
  does not yet read" — is wrong, and its supporting detail was wrong too:
  `supabase/parts/153` is *a coach is a brand too* and has nothing to do with
  sleep. The table is created in **`supabase/parts/154-a-night-a-watch-measured-outlives-the-read.sql:150`**
  (`device_sleep_nights`, RLS to the owner, `revoke all … from anon`).
  The read path: `src/lib/wearables/sleep.ts:46` `readSleepFromDevices` walks
  the registry rather than naming a provider, so a device that gains a sleep
  reader is included the day it does; `src/lib/wearables/appleHealth.ts:492` and
  `src/lib/wearables/cloudProvider.ts:189` implement `fetchSleep`;
  `src/ui/deviceSleep.tsx:112` calls it, `:163` reads the stored nights and
  `:237` writes them; `src/ui/readiness.ts:61` consumes it through
  `useDeviceSleep()`. Note `src/lib/readiness.ts` does **not** read
  `device_sleep_nights` itself — it takes `avgSleepHours` as an input (`:67`),
  which matters if anyone greps for the table there and concludes it is unwired.
  **Which providers actually deliver a night:** Apple Health, WHOOP, Oura and
  Health Connect. **Which do not:** Garmin (`special: 'partnership'`, needs
  Garmin's approval — on iPhone its nights arrive through Apple Health anyway)
  and Fitbit (no client id in `app.json`, `eas.json` or `.env`, so
  `isConfigured()` is false). Both refuse by *name and reason* rather than
  returning an empty night — `cloudProvider.ts:195` records each as a gap in
  Repple, not in the person's device. So there is no provider that exposes sleep
  and is going silently unread; there are two that cannot be connected at all,
  and both say why on the screen.

## Correction: four roadmap items were already built

The 100-item review list was assembled by surveying the three apps and the
marketing site. `studio-web/` was surveyed less carefully, and four items were
listed as gaps when the console already covered them. Recording it here so the
same work is not commissioned twice.

| Item | Claimed | Actually |
|---|---|---|
| R054 · desk check-in for walk-ins | "the desk has no way to record one" | Built. `studio-web/app/door` has "Check someone in" with an explicit anonymous/walk-in option, plus check-out. |
| R055 · guest pass with host attribution | "unreachable from any screen" | Built. Same page issues passes and sets `hostMemberId` for guest types. |
| R061 · members page | "no way to look a member up" | Substantially built. `/money` opens memberships, changes their status and records payments. What is missing is a member-centred *view*, not the admin itself. **Remainder closed — checked 8 Sep 2026.** `studio-web/app/members/page.tsx` is that view: one person, and the memberships, payments, door visits, class bookings, one-to-ones, passes and invites the gym holds on them, each section rendering not-loaded / loaded-and-empty / read-failed separately. This document was contradicting itself — Phase 2 above has listed `studio-web/app/members` as **Built** since 26 August while this row went on calling it missing. |
| R064 · payroll page with settlement | "same flow as the app" | Substantially built. `/sessions` computes `payrollByTrainer`, `payrollTotal` and `settlementBlocker`, and marks outcomes. What is genuinely missing is recording that a settled payroll was *paid*. **Remainder closed — checked 8 Sep 2026.** Recording a settlement *is* the record of payment: `supabase/parts/36-payroll-settlements.sql:32` gives `payroll_settlements` a `method` (`transfer` / `cash` / `payroll` / `other`), `settled_at`, `settled_by`, and an `amount_cents` snapshot that a later change to the session fee cannot rewrite. `studio-web/app/payroll/page.tsx:262` is where the desk picks the method; `src/lib/gymSessions.ts:676` `recordSettlement` writes it; `supabase/parts/183` adds `reversed_at` / `reverse_reason` under a CHECK, so taking a run back is a second recorded fact rather than an erasure. |

Two of the four were wholly done at the time of writing; two were narrower than
described, **and as of 8 Sep 2026 all four are done**. R065 (CSV import screen)
and R072 (realtime) were checked at the same time and were genuinely absent
**at the moment of writing**.

R065 stopped being true six minutes later: this section landed in `529f4fd`
at 15:31 and the importer shipped in `5d0506a` at 15:37 the same afternoon.
Worth leaving visible rather than quietly editing, because it shows the real
failure mode with a document like this — not that anyone checked carelessly,
but that a status written down is only true at the instant it is written.

~~R072 (realtime) remains genuinely absent.~~ **That sentence is now wrong, and
was still being repeated as current on 8 Sep 2026.** Realtime exists, and the
precise shape of it matters more than the yes/no:

- **In the database.** Six tables are in the `supabase_realtime` publication:
  `messages` (`supabase/parts/10-messages-setup.sql:22`), and then
  `gym_classes`, `class_bookings`, `sessions`, `session_approvals` and
  `notifications`, added by
  `supabase/parts/220-nothing-in-the-app-updated-live-except-one-message-thread.sql:46–75`
  — each guarded by `to_regclass` so a project missing one of those parts skips
  it quietly.
- **In the phone apps.** The message thread has had a channel all along
  (`src/ui/messaging.ts:650`, `useThread` at `:442`, subscribing to INSERTs on
  `messages` filtered to the client). Since part 220 there is also
  `src/ui/realtime.ts:91` `useLive`, used by the class timetable
  (`src/ui/classes.tsx:352–353`), the PT calendar and approvals
  (`src/ui/sessions.tsx:471–472`) and the notification inbox
  (`src/ui/notifications.tsx:382`). Every one of them is a **debounced refetch,
  never a patch from the payload** — the counts come from `class_counts()`, a
  security-definer aggregate, so a payload a client receives means only that
  something changed. Losing realtime degrades those screens to what they did
  before and nothing renders off a channel.
- **What is still absent:** `studio-web/`. `grep -rn "\.channel("` over the
  console returns nothing, so every owner screen is still load-and-refresh.
  That is the honest remaining half of R072, and it is carried below.

The lesson is not that the list was careless in general — most items were
traced to a specific file or a missing table. It is that "no screen does this"
is a claim about the whole codebase, and it was verified against only part of
it. Anything still unstarted should be re-checked against `studio-web/` before
work begins on it.

## Deferred by the owner

- **R085 · Arabic alongside English** — deferred 25 Aug 2026. Approved in the
  bulk review, then set aside on reflection. It is a business decision about
  which market to serve first rather than a backlog item, and it is one of the
  fourteen large items, so parking it removes roughly a week from the
  outstanding work. Not cancelled; not scheduled.

---

## What is genuinely open

*Compiled 8 Sep 2026, from the sweep described at the top of this file. This is
the list the next lanes should be briefed from, so every entry names the thing
that is absent — the file that does not exist, the export that is not there, the
grep that returned nothing — rather than an impression. Anything not on this
list was found to exist; anything that could not be settled either way is in the
last group and is labelled as such.*

> **One entry expired while this list was being compiled.** The nine `catch {}`
> blocks under Phase 8 were closed by a parallel lane during this sweep, and the
> "partly done" note about them further down is already out of date. Re-grep
> before briefing anything here; that instruction is the whole point of this
> document.

### Open, with the evidence that it is open

| # | Open item | Why it is open |
|---|---|---|
| 1 | **Realtime in the console.** Every `studio-web/` screen is load-and-refresh. | `grep -rn "\.channel("` over `studio-web/` returns nothing. The publication is already there for the six tables an owner screen would want (`supabase/parts/220`), and `src/ui/realtime.ts:91` `useLive` is the pattern — but it is a React Native hook on `src/lib/supabase`, so the console needs its own. This is the surviving half of R072. |
| 2 | **Waitlist promotion from the owner console.** Freeing a PT hour from the timetable opens it to anyone rather than handing it to whoever was first in the queue. | `supabase/parts/126-the-late-fee-and-the-waitlist.sql:368` — `promote_session_waitlist` refuses unless `sessions.trainer_id = auth.uid()`, and an owner is not the trainer. `studio-web/app/timetable/page.tsx:1160` documents the gap on the page. Needs an owner-authorised path in SQL, not a UI change. |
| 3 | **Door access hardware** (Phase 7). | No integration of any kind. `grep -rniE "turnstile\|kisi\|brivo\|door access"` over `src`, `studio-web` and `supabase/parts` hits only prose and one feature keyword (`src/lib/features.ts:136`). The member's entry barcode (`app/(client)/access`) is a barcode a person or a scanner reads. |
| 4 | **Multi-site roll-up and drill-down** (Phase 6). | `supabase/parts/290` records *who owns what* (`owner_sites`, `my_sites()`) and grants nothing else; `src/lib/ownedSites.ts` exists only to stop the console implying a two-gym owner's business is one gym. No cross-site aggregate exists anywhere. |
| 5 | **Per-site staff, timetables and pricing** (Phase 6). | Not modelled. `gym_classes.branch` is free text scoped inside one gym, and `supabase/parts/290` argues at length that it must not be promoted into the multi-site key. |
| 6 | **Class re-timing value** (Phase 5). | The inputs exist — `app/(owner)/class-analytics.tsx:1` reads fill rates per class × branch × trainer × time from `class_attendance_summary` — and nothing converts a fill rate into what moving a quiet slot is worth. No module in `src/lib` does. |
| 7 | **Capacity modelling** (Phase 5). | `src/lib/gymEquipment.capacityFor` returns *stated* capacity from the register (and `null` where nothing is recorded). There is no model over it, and by this document's own rule it should not be built against an empty database. |
| 8 | **Seasonality** (Phase 5). | `grep -rniE "seasonality" src studio-web` returns nothing outside comments. Needs a full year of a real gym's record before it can say anything, so this is blocked on time, not on effort. |
| 9 | **Load testing per role** (Phase 8). | No artefact of any kind in the repo — no load script, no k6/artillery config, nothing under `scripts/`. The permission half of that bullet *is* partly covered (`src/lib/staffRoles.test.ts`, `src/lib/consoleRoutes.test.ts`); the load half is untouched. |
| 10 | **Stripe Accounts v1 in LIVE.** Blocks coach onboarding. | Not a code item: `docs/LAUNCH-CHECKLIST.md:489`. `supabase/functions/connect-onboard/index.ts` calls `stripe.accounts.create` and the LIVE account cannot answer it. A person in a dashboard. |
| 11 | **Fitbit and Garmin sleep.** | Not a gap in the read path — `src/lib/wearables/sleep.ts:46` would include either the day it could. Fitbit has no client id in `app.json`, `eas.json` or `.env`, so `isConfigured()` is false; Garmin is `special: 'partnership'` and needs Garmin's approval. Both refuse by name and reason (`src/lib/wearables/cloudProvider.ts:195`) rather than returning an empty night. Garmin's nights already arrive on iPhone through Apple Health. |
| 12 | **R085 · Arabic alongside English.** | Deferred by the owner, not open in the backlog sense. Kept here so the list is complete — see *Deferred by the owner* below. |

### Deliberately not started, and correctly so

Not on the list above because the reason they are unbuilt is stated policy
rather than an oversight: everything in Phase 5 beyond the revenue forecast
needs a real gym's record behind it, and this document's own rule is that a
projection built on a thin record is the most expensive output a business tool
can produce. Items 6–8 are listed above so nobody re-discovers them; they are
not ready to be worked.

### Partly done — do not brief either half as "open"

- **Accessibility pass** (Phase 8). The gates exist (`scripts/check-a11y.mjs`,
  `scripts/check-contrast.mjs`, `src/lib/a11y.ts` with `a11y.test.ts`). What is
  not established anywhere in this repo is *coverage* — that the pass was
  actually made across all three apps. A gate passing is a different claim.
- **Surfacing write failures** (Phase 8). `writeFailedText` across 15 files,
  `assertWrote` across 26 in `src/lib`. Nothing enumerates the writes that
  still fail quietly, so "how much is left" is not answerable from the repo.
- ~~**The nine remaining `catch {}` blocks**~~ — **closed during this sweep** by
  a parallel lane, with `src/lib/silentCatch.test.ts` added to stop new ones
  arriving unexplained. Recorded here rather than deleted because the entry was
  written, verified, and obsolete within the same pass.

### Could not be verified from this repo — do not brief as either

- ~~**Email confirmation on/off.**~~ **Settled 8 Sep 2026: it is ON.** The
  claim was right that no file in this tree is evidence of it — but the live
  project answers for itself without a dashboard. `GET /auth/v1/settings` is a
  public endpoint and returned `mailer_autoconfirm: false`, which means a new
  signup must confirm before the account works. Both this file's header and
  `docs/LAUNCH-CHECKLIST.md` said OFF, dated 26 Aug 2026, and both were stale by
  a week. The lesson is the one this document keeps re-learning in a new place:
  a setting that lives outside the repo still has an authority you can query, and
  "not verifiable in this repo" is not the same as "not verifiable".
- ~~**Whether the six realtime tables are actually in the publication on the
  LIVE project.**~~ **Settled 8 Sep 2026: all six are in.** `supabase/parts/220`
  adds them inside an exception-swallowing loop (`when others then null`), which
  is right for a bundle that must apply against partial schemas and means a
  failure there would have been silent — so this genuinely was unanswerable from
  the tree. Querying `pg_publication_tables` for `supabase_realtime` on LIVE
  returns exactly `class_bookings`, `gym_classes`, `messages`, `notifications`,
  `session_approvals`, `sessions`. The loop took.

  The same query settles a second thing, and it is the more useful half:
  `gym_visits` is **not** in the publication. A subscription to an unpublished
  table succeeds and reports itself subscribed and then never fires, so the
  console's door screen — the one screen whose arrivals are `gym_visits` — is
  correctly on a poll rather than a socket. That was decided from part 220's
  header and is now confirmed against the database.
