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
> ~~One claim above the line could **not** be settled from the repo: "Email
> confirmation is currently OFF" is a Supabase dashboard toggle with no
> representation in this tree. `docs/LAUNCH-CHECKLIST.md:15` still records it as
> turned off on 26 Aug 2026.~~ **Both halves of that were wrong by the time the
> block above was finished.** It WAS settled, at the foot of this same file, in
> the same pass — `GET /auth/v1/settings` returns `mailer_autoconfirm: false`,
> so confirmation is on. And `docs/LAUNCH-CHECKLIST.md:15` has read
> "~~Turn email confirmation back on~~ — DONE, verified 8 Sep 2026" since
> earlier that day. A document contradicting itself six hundred lines apart is
> the same failure as a document contradicting the code, and it is the reason
> the header of a long file has to be re-read whenever its foot is edited.

> **Re-verified 8 Sep 2026, later the same day.** The pass above held for a few
> hours. Every claim below was re-checked against the working tree and
> `git log` tonight. **The important thing about tonight's changes is that
> almost none of them are corrections** — the eleven above were *errors*, and
> what follows is mostly *work landing*, which is a different fact about the
> document and must not be recorded as the same one. Landed since the block
> above was written: realtime in the console (its open item #1) and a follow-up
> defect in it; waitlist promotion from the owner console (#2, `supabase/parts/2610`,
> applied); an accessibility coverage figure that is measured rather than
> asserted; and an enumeration of the writes that still fail quietly, which the
> pass above recorded as *not answerable from the repo*. Two entries were
> genuinely **wrong** rather than superseded, and both are marked as wrong where
> they sit: the paragraph immediately above, and R072's "what is still absent:
> `studio-web/`".
>
> One item moved in the other direction — nothing was built, and the reason was
> written down instead. Load testing per role (#9) stays open, with
> `supabase/parts/2612` and the argument in its header now standing as the
> artefact this document previously said did not exist.

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

Three bugs of the same family have now been found and fixed on this phase's
tables, and they are worth remembering as the class to look for first:

- **`gym_classes` was readable across gyms** — scoped to any signed-in user
  rather than to the tenant (fixed in `30-classes-tenant-scope.sql`).
- **`sessions` had no tenant at all**, so a gym could not see the one-to-ones
  delivered on its own floor. Worse, "delivered" was inferred as *booked, and
  the clock has since passed* — which counted no-shows and slots nobody had
  cancelled, and then multiplied them by the session fee. The gym was being
  shown a payroll figure that included work that never happened
  (`33-session-outcomes.sql`).
- **A class could be posted onto another gym's timetable** — added 8 Sep 2026,
  and the first of the three that is a *write* rather than a read.
  `gym_classes_fill_tenant` filled a blank `tenant_id` rather than overriding a
  supplied one, so a coach — or any member, in two REST calls — could name
  somebody else's tenant on insert and put a 06:00 class on their board, or take
  one of their own off a gym's board by pointing it elsewhere.
  `supabase/parts/2611-a-coach-could-post-a-class-onto-another-gyms-timetable.sql`
  is the fix; it records that it was applied to the live project and that the
  advisors were re-run clean afterwards. The lesson generalises past this table:
  a trigger that fills a blank is not a trigger that enforces a value, and every
  read policy on `gym_classes` trusts the column that trigger writes.

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
| **Session approval** | **DONE** (corrected on 25 Aug; still true, but every line number in that row has since moved). | `app/(client)/pt-sessions.tsx:164` takes `approveSession` from `useSessions()`; `src/ui/sessions.tsx:754` calls the RPC (`:726` on the morning pass — it moved again the same day); the RPC is `supabase/parts/22-session-approvals.sql:36`. A dispute is now its own answer alongside it (`supabase/parts/241`, `src/lib/sessionDispute.ts`). |
| **Trainer rota** — who is on the floor when | **DONE — the 25 Aug entry ("No rota or shift table anywhere") was wrong.** Table, rules, screen, and what an hour costs. | `supabase/parts/43-trainer-rota.sql` creates `gym_shifts`; `supabase/parts/196-a-rota-that-cannot-be-costed.sql` adds the costing; `src/lib/gymRota.ts:324` `buildRota`, `:407` `coverage` (UNCOVERED vs IDLE), `:581` `rotaCost`; the screen is `app/(owner)/rota.tsx`. |
| **CSV import** — members, plans, historical payments | **DONE — the 25 Aug entry ("plans do not import") was wrong.** All three kinds. | `src/lib/csvImport.ts:816` exports `previewPlans`, alongside `previewMembers` (`:380`) and `previewPayments` (`:661`); `studio-web/app/import/page.tsx:64` types `Kind` as `'payments' | 'members' | 'plans'`, `:238` calls `previewPlans`, and `:541` inserts into `membership_plans`. |

**Phase 1 has no remainder.** The 25 August version of this section said the
remainder was "PT scheduling, the trainer rota, and plan import"; all three were
built, and two of them were built before that sentence was written.

~~One narrow thing the code itself flags as absent is carried down to *What is
genuinely open* below rather than left here: an owner freeing a PT hour from the
console cannot promote the waitlist, because `promote_session_waitlist` is
authorised on `trainer_id = auth.uid()`.~~ **Closed 8 Sep 2026 — this is work
landing, not a claim that was wrong.** It was accurate when written:
`supabase/parts/126-the-late-fee-and-the-waitlist.sql:368` really does test
`s.trainer_id = v_uid` and nothing else. `supabase/parts/2610-a-gym-could-free-a-pt-hour-and-not-hand-it-on.sql:254`
replaces that function with a second arm — `public.is_owner_of(s.tenant_id)` at
`:290`, the same predicate as `sessions_gym_owner_u`, which is what let the desk
empty the slot in the first place — and the part records that it was applied to
the live project and re-verified afterwards. The owner arm, and only the owner
arm, also writes the promoted member their notification, because the console is
not a handset and the two app paths send their own.

The desk's side of it is `handOn` at `studio-web/app/timetable/page.tsx:1247`,
which reads the RPC's three answers through `src/lib/waitlistPromotion.ts` —
`readPromotion` (`:77`), `mayReoffer` (`:92`), `promotionText` (`:121`) — the
same module `promoteWaitlist` in `src/ui/sessions.tsx` reads them with, so the
coach's screen and the desk cannot drift apart on what a null means. A raise is
"failed", never "the queue was empty", and the offer-it-to-the-next-caller
sentence is gated on the proven-empty answer alone. Part 144's narrowing
survives: the gym is given the answer, never the queue.

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

- **Staff.** `src/lib/staffView.ts:104` really does import `trainerHealth` from
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
| Payroll runs, at the rate set, with an approval step | `src/lib/gymSessions.ts:676` `recordSettlement`; per-coach rates on `gym_trainer_pay` (`supabase/parts/183`) rather than one `session_fee` for everybody; `src/lib/gymPay.ts:981` `reverseSettlement`, which refuses without a written reason (`:1038` writes it, `:1137` refuses without it); the screen is `studio-web/app/payroll/page.tsx:40`. |

What is outstanding here is not code. Stripe **Accounts v1 is enabled in TEST
and not in LIVE**, which blocks coach onboarding — it is item 11 of
`docs/LAUNCH-CHECKLIST.md:539`, and it is a person in a dashboard.

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
setting, not a missing module (`docs/LAUNCH-CHECKLIST.md:539`). **Phase 5
should mostly not be started yet, and the roadmap already says why**: "Only
meaningful once phases 1–4 have produced enough record to stand on", and
"Seasonality — needs a full year before it says anything at all."

One correction to that, because this section previously named revenue
projection as unstarted and it is not: `app/(owner)/revenue.tsx:426` draws a
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

- **Revenue projection — part-built.** `app/(owner)/revenue.tsx:148` is the
  gate and `:426` is the chart it gates, from
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
common case.

**FINISHED 11 Sep 2026, and the two sentences that used to close this
paragraph were both wrong.** They read "There is no roll-up and no drill-down,
and per-site staff, timetables and pricing are not modelled", and this file
contradicted itself about both four hundred lines further down — which is the
exact failure its own header describes, at the worst possible distance.

- **Roll-up and drill-down are built.** `studio-web/app/sites/page.tsx` renders
  them, fed by `owner_site_figures()` (`supabase/parts/2614`) through
  `studio-web/lib/siteFigures.ts`, with the arithmetic in
  `src/lib/siteRollUp.ts` — 629 tested lines that already existed and had no
  caller. Drill-down turned out NOT to mean switching which tenant the session
  is scoped to: `drillInto` had already designed it as three honest sentences,
  which needs no policy change and so no new SQL.
- **Per-site staff, timetables and pricing were modelled all along**, by part
  290's own decision that A SITE IS A TENANT. `trainers`, `gym_classes`,
  `sessions` and `profiles` all carry `tenant_id`; session fee, currency, pay
  policy and invoice numbering all live on `tenants`. Verified against the live
  schema.

The sentence about `gym_classes.branch` is true and stays: it is free text
inside one gym, and part 290 argues explicitly that it must never become the
multi-site key. It simply was never evidence that per-site anything was
missing.

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
  that pass, across `app/`, `src/` and `studio-web/`, was **9**. *The nine line
  numbers below are as they stood that morning and are kept as the record of
  what was found; every one of the blocks has since been removed, so following
  a number now lands on whatever moved up into it. The count is the claim, not
  the line.*
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
  **Substantially done, and the remainder is now counted.** `writeFailedText` is
  used across 16 files — **all sixteen under `studio-web/`**, where it is defined
  (`studio-web/lib/supabase.ts:320`). The trees named here were wrong: there are
  **zero** callers in `app/` or `src/`, so whatever the three phone apps do about
  a write that fails, they do not do it through this helper, and this document
  does not say what they do instead. (The earlier "15" was right when written.)
  `assertWrote` — a write that reports success
  while changing no rows — across 21 non-test modules in `src/lib` (26 if you count the five test files, which is the same error this document warns about — counting the test of a thing as an instance of it).

  ~~Not claimed complete — nothing enumerates the writes that still do not.~~
  **That is no longer true, and this is work landing rather than a correction.**
  `supabase/functions/` was the tree no gate looked at: outside
  `scripts/check-writes.mjs`'s roots, outside `scripts/check-reads.mjs`'s, and
  deliberately outside `src/lib/silentCatch.test.ts`'s. It is the worst place
  for a silent write, because a webhook handler whose UPDATE matched zero rows
  logs nothing — there is no error to log — returns 200 to Stripe, and the
  delivery is marked succeeded and never retried. `src/lib/edgeWrites.test.ts`
  enumerates them and holds them as a **per-file ratchet** that can only go
  down: 35 unguarded when it was written, **15 now**, listed at
  `src/lib/edgeWrites.test.ts:426` with a written reason each —
  `stripe-webhook` 12, `calendar-sync` 2, `wearable-day` 1. Running it prints
  the count (`npx tsx src/lib/edgeWrites.test.ts`), and it is in the `test`
  script. What the ratchet deliberately does **not** check is whether a bound
  count is then read; that is a dataflow question, and its header names the two
  writes in `src/lib/gymPay.ts` that ask for `{ count: 'exact' }` and never look
  at it.

  Seven edge-function sources changed today under two commits (`37c2c8a`,
  `03a7d9f`). **Whether they were deployed is not verifiable from this tree** —
  a function's source and the function running on the project are different
  facts, and nothing in the repo records the second.
- ~~**Move the repo off the iCloud Desktop.**~~ **Done.** The repo is at
  `/Users/timothyrodgers/repple-app`, which is not under Desktop or iCloud
  Drive. The lesson stays worth keeping: files evicted to `dataless` read as
  empty, which produced one wrong conclusion in this codebase.
- Accessibility pass across all three apps. **Underway, not finished — and
  coverage is now a measured number rather than an impression.** That is the
  change since the block at the top of this file, and it is work landing plus a
  measurement, not a status that was wrong.

  *What was fixed.* `scripts/check-a11y.mjs` grew a fourth rule
  (`scripts/check-a11y.mjs:90`) for the defect no English-language review could
  ever have found: `BACK_ICON` resolves to `'back'` left-to-right and
  `'chevron'` right-to-left, and `ICON_NAMES` in `src/ui/kit.tsx` calls the
  second one "More" — so a hundred back buttons across the three apps announced
  "Back" in English and **"More" in Arabic**, the same file, a confidently wrong
  word, in the direction nobody develops in. All hundred were named: 58 in
  `app/(client)`, then the last 43 in `app/(trainer)` and `app/(owner)`. Two of
  the 43 were not back buttons at all — the month stepper on
  `app/(trainer)/calendar.tsx` — and say "Previous month" / "Next month". Rules
  3 and 4 now carry nothing standing, so a hit on either is a regression.
  `node scripts/check-a11y.mjs` reports **47 standing offences, across 23 keys
  in 21 files**, all under `app/`. The standing list carried **64 keys** at
  commit `82d11ef` and carries 23 now — counted out of the file at each commit,
  because the two numbers the gate prints are occurrences and the two in the
  list are keys, and mixing them is how a "90" and a "47" end up in the same
  sentence describing different things.

  *What coverage actually is.* Counted tonight by re-running the gate's three
  element rules over `app/(client)`: **762 elements carry an `onPress`,
  `onLongPress` or `onValueChange`, and 101 of them — 13% — are elements one of
  the rules can reach a verdict on** (34 childless `Pressable`s for Rule 1, 59
  `Ghost`s drawing a mirroring icon for Rule 4, 8 field-only labels for Rule 3).
  **473 are touchables that no rule examines and that carry no
  `accessibilityLabel` at all.** That is not a criticism of the gate — its own
  header says a touchable *with* children is invisible to it and explains why a
  broader rule would be deleted within a week — but it is the honest size of
  the claim. A gate passing is not a pass having been made.

  ~~*And a gate that runs nowhere.* `check:a11y` is defined in `package.json`
  and is in **no** run list.~~ **CLOSED by `4b72fcc`, "The accessibility gate
  that was wired into nothing".** `check:a11y` is now the 25th entry in
  `check:all` (`package.json:79`, between `check:numbers` and `check:contrast`),
  and `check:all` is what `scripts/publish.sh:116` and
  `.github/workflows/ci.yml:104` both run — so all four of its rules are
  enforced on every CI run and immediately before every OTA. Verified by eye in
  the publish of 10 Sep 2026, which printed `check:a11y` between the two.
  Neither it nor `check:contrast` uses `scripts/gate-floor.mjs`; that part
  still stands and is not a defect. What this paragraph used to be about — the
  failure `check:all`'s own note in `package.json` was written for, "a gate
  nobody runs is not a gate, it is a file" — is no longer true of this gate.
  The **coverage** claim above it is untouched by any of that: a gate that now
  runs still only reaches a verdict on 13% of the touchables.
- Load and permission testing per role. **Permission side partly covered**
  (`src/lib/staffRoles.test.ts`, `src/lib/consoleRoutes.test.ts`); **load
  testing is still open, and is now open for a written reason rather than for
  none.** ~~Load testing has no artefact in this repo.~~ It has one:
  `supabase/parts/2612-four-lookups-with-no-index-and-the-last-policy-that-asked-per-row.sql`,
  applied to the live project on 8 Sep 2026, which fixed the last
  `auth_rls_initplan` policy (1 → 0) and four unindexed lookups that had a real
  caller — leaving 92 of the advisor's 96 alone on the argument that an index
  nothing filters on is paid for on every write, forever. Its header
  (`supabase/parts/2612-four-lookups-with-no-index-and-the-last-policy-that-asked-per-row.sql:224`)
  is the artefact, and its conclusion is why no generator was written:

  > 159 tables in `public` holding 4,079 live rows between them, of which 114
  > hold zero. 437 indexes exist and 190 have never been scanned. No real gym
  > has ever used this system.

  So a load test here needs a **population** before it needs a generator; it
  must be driven through PostgREST as each app role, because the quals that
  cost anything are the RLS policies and a superuser connection never runs
  them; and it must not read `unused_index` as "unused" — on this database that
  lint means *untested*, and dropping on it would remove precisely the indexes
  the first real gym needs. The item stays open.

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
| R064 · payroll page with settlement | "same flow as the app" | Substantially built. `/sessions` computes `payrollByTrainer`, `payrollTotal` and `settlementBlocker`, and marks outcomes. What is genuinely missing is recording that a settled payroll was *paid*. **Remainder closed — checked 8 Sep 2026.** Recording a settlement *is* the record of payment: `supabase/parts/36-payroll-settlements.sql:32` gives `payroll_settlements` a `method` (`transfer` / `cash` / `payroll` / `other`), `settled_at`, `settled_by`, and an `amount_cents` snapshot that a later change to the session fee cannot rewrite. `studio-web/app/payroll/page.tsx:301` is where the desk picks the method (`:1813` is the control); `src/lib/gymSessions.ts:676` `recordSettlement` writes it; `supabase/parts/183` adds `reversed_at` / `reverse_reason` under a CHECK, so taking a run back is a second recorded fact rather than an erasure. |

Two of the four were wholly done at the time of writing; two were narrower than
described, **and as of 8 Sep 2026 all four are done**. R065 (CSV import screen)
and R072 (realtime) were checked at the same time and were genuinely absent
**at the moment of writing**.

R065 stopped being true six minutes later: this section landed in `529f4fd`
at 15:31 and the importer shipped in `5d0506a` at 15:37 the same afternoon.
Worth leaving visible rather than quietly editing, because it shows the real
failure mode with a document like this — not that anyone checked carelessly,
but that a status written down is only true at the instant it is written.

**8 September 2026 is the largest demonstration of that paragraph so far, and
it is worth separating the two things that happened on it.** In the morning,
eleven claims were found *wrong* — errors, every one under-reporting the
codebase, two of which had already survived a re-verification. By that evening a
further set of claims had gone stale for the opposite and much better reason:
they were accurate when written and the work then landed. Realtime in the
console, waitlist promotion from the console, the accessibility coverage
figure, the enumeration of quiet writes — none of those was a mistake by
anybody; the plan simply aged while the code moved under it, inside one day.
Conflating the two would misrepresent both, so this file marks them
differently: **wrong** claims are struck out and named as wrong, and work that
landed is dated and called landing. The remedy is the same either way and it is
this document's one standing rule — grep before you write, and re-grep before
you brief.

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
  (`src/ui/messaging.ts:663`, inside `useThread` at `:650`, subscribing to
  INSERTs on `messages` filtered to the client — both line numbers re-read on
  8 Sep 2026, having drifted since the previous pass). Since part 220 there is
  also `src/ui/realtime.ts:91` `useLive`, used by the class timetable
  (`src/ui/classes.tsx:352–353`), the PT calendar and approvals
  (`src/ui/sessions.tsx:476–477`) and the notification inbox
  (`src/ui/notifications.tsx:382`). Every one of them is a **debounced refetch,
  never a patch from the payload** — the counts come from `class_counts()`, a
  security-definer aggregate, so a payload a client receives means only that
  something changed. Losing realtime degrades those screens to what they did
  before and nothing renders off a channel.
- ~~**What is still absent:** `studio-web/`. `grep -rn "\.channel("` over the
  console returns nothing, so every owner screen is still load-and-refresh.
  That is the honest remaining half of R072, and it is carried below.~~
  **Closed 8 Sep 2026, hours after that sentence was written — and this one was
  briefly WRONG as well as superseded**, because it was still being repeated as
  current in the open list at the foot of this file after the code had landed.
  Two states, one document: R072 is done on both halves.

  `studio-web/lib/live.ts` is the console's own `useLive` (`:237`), a port of
  `src/ui/realtime.ts` rather than an import of it — the two cannot be the same
  program, since the console is React 19 under Next with its own Supabase
  client and `studio-web/tsconfig.json` deliberately does not map `src/ui`.
  `studio-web/components/Fetched.tsx:234` `useLiveFetched` is what the screens
  take, and three subscribe: `/timetable` (`studio-web/app/timetable/page.tsx:265`),
  `/classes` (`studio-web/app/classes/page.tsx:327`) and `/sessions`
  (`studio-web/app/sessions/page.tsx:248`). Same discipline as the phone apps —
  a debounced refetch, never a patch from the payload, so losing the socket
  degrades a screen to what it did before. It adds the half a desk needs and a
  phone does not: a dropped socket is reported as a *state* and the screen falls
  back to a poll, because a tab looked at across a room that silently stops
  updating is indistinguishable from a quiet gym.

  `/door` stays a poll **on purpose and not as a remainder**:
  `studio-web/app/door/page.tsx:404` records that `gym_visits` — the arrivals,
  which are the whole point of that screen — is in neither `supabase/parts/10`
  nor `supabase/parts/220`, so it is not in the publication, and a subscription
  to an unpublished table succeeds, reports itself subscribed, and never fires.
  That was decided from part 220's header and confirmed against
  `pg_publication_tables` on LIVE.

- **A defect inside the fix, found and fixed the same night.** Worth recording
  because the class of it will recur: **a realtime filter on any column other
  than the primary key silently drops every DELETE.** Logical decoding writes
  only the REPLICA IDENTITY columns into the WAL record for a deleted row, and
  every table in this project's publication has the default identity
  (`relident = 'd'`, checked against the live database) — so there is no
  `tenant_id` in the record for the broker to compare and `tenant_id=eq.<uuid>`
  can never evaluate true. Not hypothetical: `deleteClass` in
  `src/lib/gymSchedule.ts` is wired to this console's own `/timetable`, and
  `sessions` rows are hard-deleted when a coach releases a slot. A tab that had
  said "Updating as the gym changes" for an hour would have gone on showing a
  class that no longer existed, while the desk two feet away went on selling
  places in it. The fix is a second, **unfiltered** binding with
  `event: 'DELETE'` on the same table — `studio-web/app/timetable/page.tsx:280`
  and `:281`, `studio-web/app/classes/page.tsx:339`,
  `studio-web/app/sessions/page.tsx:259` — which costs one debounced refetch of
  this gym's own rows, because the payload is never read either way.

The lesson is not that the list was careless in general — most items were
traced to a specific file or a missing table. It is that "no screen does this"
is a claim about the whole codebase, and it was verified against only part of
it. Anything still unstarted should be re-checked against `studio-web/` before
work begins on it.

## Phase 9 — The market, measured rather than assumed

*Compiled 12 Sep 2026 against the published feature and pricing pages of
nineteen products: Hevy, Strong, Fitbod, Whoop, Strava, MyFitnessPal, Ladder,
Caliber (member); Trainerize, TrueCoach, Everfit, PT Distinction, My PT Hub,
Kahunas (coach); Mindbody, Glofox, Wodify, PushPress, TeamUp, Zen Planner,
Gymdesk (gym). This is the first section of this document written from outside
the codebase, and it is ranked by value ÷ effort rather than by phase.*

**Where Repple is ahead, because it changes what counts as a gap.** White-label
is architectural rather than a skin (`src/lib/brands.ts` crosses brand with the
client/coach/owner variant, so a chain gets its own listing) — TrueCoach does
not offer it at any price, Everfit gates it to Enterprise, Trainerize wants
$248/mo per location. Per-tenant currency and timezone run through everything.
Three audiences share one record, which nobody in the set does — Trainerize and
Glofox integrate as two products with the member as two records. The refusal
discipline is itself a differentiator: a month that will not close while
sessions are unmarked, an interventions module that publishes no success rate
because there is no control group, a forecast that will not draw without two
recorded months. And `vision-analyze` reads a meal photo, a physique photo, a
gym machine and an InBody sheet — the last two exist nowhere else in the set.

### The five worth doing first

| # | Gap | Who | Effort | Why |
|---|---|---|---|---|
| **9.1** | **Class cancellation policy, late-cancel and no-show fees** | owner | SMALL | All seven gym platforms have it. `src/lib/classCancel.ts` says in its own header that Repple holds no class policy — "no column for it, no screen where an owner sets one" — while the PT path is complete (`booking.ts`, `cancelDeadline.ts`, `sessionFee.ts`). The arithmetic and the wording already exist; what is missing is a policy column, a setting screen, and reuse of `cancelWarningLine`. It is the mechanic that stops a gym's revenue leaking daily, and the first thing asked in a demo. |
| **9.2** | **Membership freeze with dates, and a commitment term** | owner | SMALL | `memberships.status` already accepts `'frozen'` and `memberView.ts:640` correctly excludes frozen members from absence claims — but there are no `frozen_from`/`frozen_until` columns and no term extension, so a gym that freezes a member either loses the money or keeps billing them. Glofox extends the next payment date by the days paused; Wodify extends the commitment; TeamUp prorates on reactivation. Two date columns and arithmetic on `ends_on`. |
| **9.3** | **Form-check video attached to a SET** | coach + member | SMALL–MEDIUM | The single feature that decides remote-coaching deals, and TrueCoach's whole reputation. Repple has ~90% of the plumbing: `messageAttachments.ts` already allows video with upload, downscale, signing and RLS — it simply has no foreign key to a workout, an exercise or a set. `exercise_videos` is the coach's demo library, the opposite direction. Notably NONE of the six coach platforms ships side-by-side comparison, drawing or voiceover. |
| **9.4** | **Kisi / HybridAF door access** | owner + member | MEDIUM | Roadmap #3, and lower effort than it looks: `gym_visits` already exists as the destination (`supabase/parts/32`, `/door` console, `sweep-stale-visits`), so this is one vendor's REST API, a membership→access-group sync, and a webhook that writes the unlock. 24/7 access is the most common single reason a gym rules a platform out, and Repple's whole retention model already depends on the door log this would fill automatically. |
| **9.5** | **A check-in / intake form the coach or gym owns** | coach + owner | MEDIUM | `check_ins` is a fixed seven-column table. Everfit, PT Distinction, My PT Hub, TrueCoach, Trainerize and TeamUp all let the coach ask their own questions, several with automatic re-asking on a schedule. A coach cannot migrate an existing practice onto a platform that will not let them ask their own questions, so this gates every competitive switch rather than just new signups. |

### The strategic opening

Every strength logger in the set — Hevy, Strong, Fitbod, Caliber — adapts on
LOGGED PERFORMANCE, a lagging indicator, and Fitbod explicitly refuses HRV,
sleep and readiness as programming inputs even when a device supplies them.
Whoop measures recovery superbly and cannot program a lifting session.

Repple already owns both halves and joins neither: `readiness.ts` (a
transparent 0–100 from sleep, the device's own recovery verdict, hydration and
short-term load), `readinessBreakdown.ts`, `hrvTrend.ts` and live
WHOOP/Oura/Apple Health/Health Connect connections on one side; `progression.ts`
and `builderProgression.ts` on the other. **Letting today's readiness modulate
the progression suggestion — stated as a reason, never silently — is a
medium-effort feature no competitor in any of the three categories has**, and it
is defensible in exactly the refusing style the rest of this codebase uses.

### Deliberately NOT to build

- **A muscle-recovery auto-programmer to match Fitbod.** `muscleRecovery.ts`
  refuses the word "recovered" and explains why in its header. That refusal is
  worth more than parity.
- **Anything chasing Whoop's 2026 passive MSK load.** That is hardware
  research, not a feature.

### The rest, ranked

Author-once automation sequences (PT Distinction gives them away free at
$19.90/mo) · retail POS and inventory · a public API and Zapier (TeamUp's is
free on every plan) · family accounts with shared billing (locks Repple out of
martial arts and kids' gymnastics) · **import from Strong/Hevy CSV — a weekend
of work, and a lifter with three years of history will not retype it** · staff
time clock · spot booking · whiteboard and in-gym TV · kiosk check-in ·
structured hold and cancel reason codes (the input `memberChurn.ts` and
`gymRetention.ts` are already built to consume) · Apple Watch companion ·
accrual-basis accounting · ClassPass or Wellhub listing.

## Deferred by the owner

- **R085 · Arabic alongside English** — deferred 25 Aug 2026. Approved in the
  bulk review, then set aside on reflection. It is a business decision about
  which market to serve first rather than a backlog item, and it is one of the
  fourteen large items, so parking it removes roughly a week from the
  outstanding work. Not cancelled; not scheduled.

---

## What is genuinely open

*Recompiled 8 Sep 2026, late — the second compilation that day. This is the list
the next lanes should be briefed from, so every entry names the thing that is
absent: the file that does not exist, the export that is not there, the grep
that returned nothing. Anything not on this list was found to exist; anything
that could not be settled either way is in the last group and is labelled as
such.*

> **Two of the twelve entries in the morning list expired the same day.**
> Realtime in the console (#1) and waitlist promotion from the owner console
> (#2) were both built, and both are struck out below rather than deleted —
> they are the second and third demonstrations in one file of the R065 lesson,
> which is that **a status is only true at the instant it is written**. The
> first was the nine `catch {}` blocks, which a parallel lane closed while the
> morning list was still being typed. Three expiries in one day is not
> carelessness; it is what a plan looks like beside a codebase that is being
> worked. Re-grep before briefing anything here. That instruction is the whole
> point of this document.

> **What is deliberately NOT on this list.** Two defect hunts ran tonight, one
> over the client app and one over the console, and each produced a list of
> *suspected* items that were not proven. None of them is recorded here.
> An unproven suspicion is not a status, and this file's failure mode has always
> been a sentence that outlived the fact behind it — importing a dozen more
> would be the same mistake, taken deliberately.

### Open, with the evidence that it is open

| # | Open item | Why it is open |
|---|---|---|
| ~~1~~ | ~~**Realtime in the console.**~~ **DONE, hours after this row was written.** | `studio-web/lib/live.ts:237` `useLive`, taken by `studio-web/components/Fetched.tsx:234` `useLiveFetched`; `/timetable`, `/classes` and `/sessions` subscribe. `/door` stays a poll because `gym_visits` is not in the publication and cannot be — see R072 above. A DELETE-dropping filter was found and fixed in the same night. |
| ~~2~~ | ~~**Waitlist promotion from the owner console.**~~ **DONE.** | `supabase/parts/2610-a-gym-could-free-a-pt-hour-and-not-hand-it-on.sql:254` gives `promote_session_waitlist` an owner arm (`is_owner_of(s.tenant_id)`, `:290`), applied to the live project; `studio-web/app/timetable/page.tsx:1247` `handOn` reads its three answers through `src/lib/waitlistPromotion.ts`. The gym gets the answer, never the queue. |
| 3 | **Door access hardware** (Phase 7). | No integration of any kind. `grep -rniE "turnstile\|kisi\|brivo\|door access"` over `src`, `studio-web` and `supabase/parts` hits only prose and one feature keyword (`src/lib/features.ts:136`). The member's entry barcode (`app/(client)/access`) is a barcode a person or a scanner reads. |
| ~~4~~ | ~~**Multi-site roll-up and drill-down** (Phase 6).~~ **DONE, 11 Sep 2026 — and the line below was wrong when written.** | "No cross-site aggregate exists anywhere" was false: `src/lib/siteRollUp.ts` is 629 tested lines of exactly that arithmetic — what a total may be made of, currencies that cannot be added, zones whose "this month" are different months, and the four distinct reasons a gym contributed nothing. It had no caller because nothing could supply it figures. `supabase/parts/2614` now does: `owner_site_figures()` returns one row per owned gym — name, currency, timezone, active members, coaches, money taken — AGGREGATES ONLY, so it widens what an owner may count about their second gym and never what they may see in it. Verified on the live project against a temporary fixture: two sites for the recorded owner, one for a different owner, none for a member. **DONE 11 Sep 2026.** `studio-web/app/sites/page.tsx` is the screen: the roll-up when there is more than one gym, one line per gym always, and `drillInto` per line. Drill-down turned out NOT to mean switching which tenant the session is scoped to — `siteRollUp.drillInto` had already designed it as the three honest sentences (this is the gym you are signed in to / these are that gym's totals and its members are not on this sign-in / this gym is recorded and not readable), which needs no privilege change and so no new SQL. A single-site owner sees one row and no totals. |
| ~~5~~ | ~~**Per-site staff, timetables and pricing** (Phase 6).~~ **NOT OPEN — it was modelled all along, by part 290's own decision.** | "Not modelled" was wrong. A SITE IS A TENANT, so per-site is per-tenant, and `trainers`, `gym_classes`, `sessions` and `profiles` all carry `tenant_id` while session fee, currency, pay policy and invoice numbering all live on `tenants` — confirmed against the live schema on 11 Sep 2026. Per-site staff, timetables and pricing exist by construction and always did. The sentence about `gym_classes.branch` is true and is the reason the row looked open: branch is a label for a place WITHIN one gym and must never become the site key. Nothing to build; what an owner could not do was REACH the second tenant, which is #4. |
| 6 | **Class re-timing value** (Phase 5). | The inputs exist — `app/(owner)/class-analytics.tsx:1` reads fill rates per class × branch × trainer × time from `class_attendance_summary` — and nothing converts a fill rate into what moving a quiet slot is worth. No module in `src/lib` does. |
| 7 | **Capacity modelling** (Phase 5). | `src/lib/gymEquipment.capacityFor` returns *stated* capacity from the register (and `null` where nothing is recorded). There is no model over it, and by this document's own rule it should not be built against an empty database. |
| 8 | **Seasonality** (Phase 5). | `grep -rniE "seasonality" src studio-web` returns nothing outside comments. Needs a full year of a real gym's record before it can say anything, so this is blocked on time, not on effort. |
| 9 | **Load testing per role** (Phase 8). **Still open — but no longer for want of an artefact.** | `grep -rniE "load test\|k6\|artillery"` over `scripts`, `src`, `studio-web` and `supabase` hits this document and a lockfile. What now exists is the written reason not to generate load yet: `supabase/parts/2612-four-lookups-with-no-index-and-the-last-policy-that-asked-per-row.sql:224` records 4,079 live rows across 159 tables, 114 of them empty, and 190 of 437 indexes never scanned. A load test needs a **population** first, must be driven through PostgREST as each app role (a superuser connection runs none of the RLS quals that cost anything), and must not read `unused_index` as "unused". The permission half *is* partly covered (`src/lib/staffRoles.test.ts`, `src/lib/consoleRoutes.test.ts`). |
| 10 | **Stripe Accounts v1 in LIVE.** Blocks coach onboarding. | Not a code item: `docs/LAUNCH-CHECKLIST.md:539`. `supabase/functions/connect-onboard/index.ts` calls `stripe.accounts.create` and the LIVE account cannot answer it. A person in a dashboard. |
| 11 | **Fitbit and Garmin sleep.** | Not a gap in the read path — `src/lib/wearables/sleep.ts:46` would include either the day it could. Fitbit has no client id in `app.json`, `eas.json` or `.env`, so `isConfigured()` is false; Garmin is `special: 'partnership'` and needs Garmin's approval. Both refuse by name and reason (`src/lib/wearables/cloudProvider.ts:195`) rather than returning an empty night. Garmin's nights already arrive on iPhone through Apple Health. |
| 12 | **R085 · Arabic alongside English.** | Deferred by the owner, not open in the backlog sense. Kept here so the list is complete — see *Deferred by the owner* below. |

**The list to brief from, in one line:** items **3, 4, 6, 7, 8 and 9** are
open in the ordinary sense. **4 and 5 are both closed** — 4 was finished on
11 Sep 2026 and 5 was never open — and the clause that used to end this
sentence, "4 and 5 are the only ones that are a straightforward build", was
left over from before both closed and is gone. The list to commission from is
**3, 6, 7, 8, 9**; **10** is a person in a Stripe dashboard; **11** is
two vendors, not two gaps; **12** is deferred by the owner. Numbering is kept
stable — rows 1 and 2 are struck rather than removed — so a brief that already
says "#9" still means load testing. Of the seven, **6, 7 and 8 should not be
worked yet** for the reason in the next section, and **4 and 5** are the only
ones that are a straightforward build. ~~Two more pieces of work sit in *Partly
done* below rather than here, and both are small: wiring `check:a11y` into a run
list, and~~ **one** more piece of work sits in *Partly done* below rather than
here, and it is not small: the 87% of the client app's touchables no
accessibility rule examines. Wiring `check:a11y` into a run list was the other
half of that sentence and was done in `4b72fcc`.

### Deliberately not started, and correctly so

Not on the list above because the reason they are unbuilt is stated policy
rather than an oversight: everything in Phase 5 beyond the revenue forecast
needs a real gym's record behind it, and this document's own rule is that a
projection built on a thin record is the most expensive output a business tool
can produce. Items 6–8 are listed above so nobody re-discovers them; they are
not ready to be worked.

### Partly done — do not brief either half as "open"

- **Built but not wired — a 13-entry ratchet this document has never cited.**
  `npm run check:dead-exports` holds the list at
  `scripts/check-dead-exports.mjs`, and it is precisely the class of finding
  this file says it values most: work whose hard part is already written and
  which nothing reaches. It was 14 until 12 Sep, when `scheduleDailyReminder`
  was wired — a member who picked all seven days had been getting seven WEEKLY
  notifications instead of one daily one, which is fine until the 64-slot iOS
  budget silently drops the overflow.
  Still open and worth pulling forward: `markMyOutcome` (a coach recording
  their own session outcome), `setAttendance`, `fetchEndRecord`, `pauseSeries`
  (pause a DATE RANGE — only pause-for-days is reachable), `packageCurrencies`,
  `fetchJoinCodeStats`, `useMrrHistory`, `ZoneStrip`, `Sparkline`, `DeltaBadge`.
- **Localisation is further along than "R085 · Arabic — deferred" implies.**
  `check:translations` passes over 1,166 catalogue rows (583 de, 583 es) from
  `supabase/parts/791` and `792`, with `src/lib/catalogueLocale.ts` refusing to
  present a fallback English name as a translation. The RTL LAYOUT sweep is
  done and gated too — `scripts/check-rtl.mjs` records 83 physical properties
  converted across the three apps and the shared kit, with `src/ui/direction.ts`
  as the one place that asks which way the reader reads. What is missing is
  Arabic STRINGS, not Arabic support.

- **Accessibility pass** (Phase 8). ~~What is not established anywhere in this
  repo is *coverage*.~~ **It is established now, and the number is small.**
  Counted over `app/(client)` by re-running the gate's three element rules:
  762 elements carry an `onPress`, `onLongPress` or `onValueChange`; **101 of
  them (13%) are elements a rule can reach a verdict on**; **473 are touchables
  that no rule examines and that carry no `accessibilityLabel` at all**. Real
  work landed against it — a fourth rule in `scripts/check-a11y.mjs`, all 100
  mirroring-icon back buttons named across the three apps (58 + 43), and the
  standing list down from 90 to 47 — but 13% is the size of the mechanical
  claim, and the remaining 87% needs a person with a screen reader, not a
  regex.

  **Two second-order facts a brief should carry — the first of which has since
  been fixed.** ~~First, `check:a11y` is defined in `package.json` and is in
  **no** run list.~~ It is in `check:all` as of `4b72fcc` (`package.json:79`),
  and `check:all` is what `scripts/publish.sh:116` and
  `.github/workflows/ci.yml:104` run, so a regression on any of its four rules
  now fails CI and refuses an OTA. `scripts/check-contrast.mjs`, the other half
  of the same pass, was already there and still is. ~~Second — **and this one is
  still true** — its `ROOTS` are `['app', 'src']`, which excludes the
  console.~~ **Closed 11 Sep 2026.** Rule 5 sweeps `studio-web` for a `<button>`
  with no accessible name; Rule 2 is still correctly excluded there, because a
  unitless `line-height` in a browser is right and is the very behaviour React
  Native lacks. It finds NOTHING today — all 44 console files were checked and
  every candidate turned out to be named — so it is a ratchet rather than a
  repair, and it was proved to fire by planting an unnamed button rather than
  being trusted for returning nothing. Neither is a new roadmap
  item; both are why "the gates exist" was never the same claim as "the pass was
  made".
- **Surfacing write failures** (Phase 8). ~~Nothing enumerates the writes that
  still fail quietly, so "how much is left" is not answerable from the repo.~~
  **It is answerable now.** `writeFailedText` across 16 files, `assertWrote`
  across 26 in `src/lib`, and — the part that was missing — `supabase/functions/`
  is enumerated and ratcheted per file by `src/lib/edgeWrites.test.ts:426`:
  **15 unguarded update/deletes remain**, down from 35, each carrying a written
  reason. The ratchet only goes down and a new one in a file that has none
  fails. Still "partly", for a reason its own header states: the check cannot
  tell whether a bound count is then *read*.
- ~~**The nine remaining `catch {}` blocks**~~ — **closed during the morning
  sweep** by a parallel lane, with `src/lib/silentCatch.test.ts` added to stop
  new ones arriving unexplained. **Re-checked tonight and still zero:** the same
  grep over `app/`, `src/` and `studio-web/` returns 16 lines, all of them
  either prose describing the removed defect or string fixtures inside
  `src/lib/silentCatch.test.ts`. Recorded here rather than deleted because the
  entry was written, verified, and obsolete within a single pass.

### Could not be verified from this repo — both since settled

*Re-read 8 Sep 2026, late: both still read as settled, and neither has moved.
The only thing that had to change is at the top of this file, where the header
went on saying the first of them was unsettled after this section had settled
it. The section was right; the header was stale by six hundred lines.*

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

---

## 12 Sep 2026 — discoverability, audited rather than assumed

The brief was the owner's own sentence: *"we have a lot of functions on there
but the users don't know how to use the app to its highest potential nor do they
know where to intuitively look for things."* Two audits ran, one per app, against
four questions with a file-and-line answer required for every claim: can a
person reach this screen, can they find it by searching, does it offer a next
step when it is empty, and does it explain a figure it computes.

**The good news first, because it changes what is worth building.** There are no
orphaned screens in either app. `scripts/check-reachable.mjs` passes, and a
route-by-route grep confirms it: every `app/(client)` and `app/(trainer)` screen
is named by a push, a hub row, or the feature catalogue, and every route in
those lists resolves to a file. The five client screens absent from both
`HUB_GROUPS` and `CLIENT_FEATURES` are the five tab bar entries, which is
correct. The coach app has no missing `TRAINER_NAV` entry at all — the routes
not in it (`chat`, `client`, `exercise`, `class-checkin`, `explore`) each need a
parameter a bare push cannot supply, verified per file.

So the problem was never navigation. It was what happens after somebody arrives.

### Closed

- **Eleven coach screens that dead-ended on an empty roster.** Each wrote its
  own "Nobody is on your book yet" and stopped, and all eleven are reachable
  from `TRAINER_NAV` and Explore before a coach has a single client.
  `src/ui/EmptyRoster.tsx` is now the one sentence and the one control, landing
  on `/(trainer)/dashboard?start=invite` — the Clients tab with the invite sheet
  open, not the tab with the control still to find. `builder` (twice),
  `log-session` and `leaderboard` got the same destination.
- **Six screens computing a figure with no help card.** `standards`,
  `consistency`, `goal`, `coach-money`, `coach-analytics`, `coach-register`.
  Every line was written from the function rather than from the words on the
  screen, which caught two errors in the first draft: `currentStreak` counts
  days and not weeks, and `projectionOf` uses the first and latest readings
  since the goal was set and not a line through recent ones.
  `CLIENT_SCREEN_HELP_KEYS` is a third list so `CLIENT_HELP_KEYS` keeps meaning
  one card per tab.
- **Five client empty states that named a remedy and offered none.**
  `records`, `body-trends`, `activity`, `standards`, `trends`. Each control is
  on the whole-and-empty arm only — `check:whole` caught the first version of
  the `activity` gate letting `'partial'` through, and was right to.
- **Three catalogue entries that could not be found by the words people type.**
  Watch & Devices sold itself as "Apple Watch, WHOOP, Garmin…" on keywords that
  contained none of those brands; Classes and Book a Session are the two screens
  a member cancels from and neither carried the word "cancel".
- **The Your Gym group on Me**, and the eight rows of grey chevrons it shipped
  with. `HUB_ICON` now falls back to `src/lib/features.ts`, which carries an
  icon for every route because Explore renders it — so a hub row added without a
  bespoke icon gets the one Explore shows for the same destination.
- **Strong and Hevy import, in the empty state as well as the loaded screen.**
  It sat below the history charts, which a member with nothing logged never
  reaches — and that empty state is precisely the arrival screen for somebody
  with three years in another app.
- **A pause for the dates you are actually away.** `pause_my_session_series`
  has taken a from/to since part 244 and nothing could reach it; the sheet
  offered three durations, all starting today. `pauseSeries` comes off the
  dead-export ratchet.

### Recommended next, and deliberately not started

A global search affordance. Explore is reachable from the Me hub and from the
Getting Started card, and it is the one screen that answers "where is the thing
I am looking for" — but a member has to already know it exists. A persistent
entry point on every tab header is a change to the app's chrome rather than a
gap in a screen, so it is the owner's call and not a defect to be quietly
fixed.
