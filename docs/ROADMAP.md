# Roadmap

> **Launch gate:** [LAUNCH-CHECKLIST.md](LAUNCH-CHECKLIST.md) lists what has to
> be put back before the apps go public. Email confirmation is currently OFF.

The plan for turning three apps and a database into the thing the marketing
site claims: one operating record, read three ways.

This file is the tracked version. It exists because the roadmap previously
lived only in chat scrollback, which is not a place a plan survives.

**Status is claimed only where it is verifiable in this repo** — a module that
exists, a migration that is written, a test that runs. "Planned" means exactly
that, and nothing here should be read as shipped to users: at the time of
writing all three apps are in first-release review, and none of the Studio
features below have been used by a real gym.

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

Re-verified against the code on 25 Aug 2026 (evening). Two of the four listed
here were wrong, so the status column now says what was actually checked.

| Item | Status | Evidence |
|---|---|---|
| **PT session scheduling** — one-to-ones and classes on one timetable | **Genuinely open.** The outcome and payroll half is done; the booking half still lives in the trainer's own calendar rather than the gym's. | No `pt_session`/`bookSession` reference in `app/(owner)/` or `studio-web/app/`. `studio-web/app/timetable` covers classes only. |
| **Session approval** | **DONE — this entry was wrong.** Wired end to end. | `app/(client)/pt-sessions.tsx:34` takes `approveSession` from `useSessions()` and splits the list on `approvedAt`; `src/ui/sessions.tsx:25` calls the RPC; the RPC is `supabase/parts/22-session-approvals.sql:36`. |
| **Trainer rota** — who is on the floor when | **Genuinely open.** | No rota or shift table anywhere in `supabase/parts/`; the single grep hit is an unrelated word in `26-message-notifications.sql`. |
| **CSV import** — members, plans, historical payments | **Two thirds done.** Members and payments import; **plans do not**. | `src/lib/csvImport.ts` exports `previewMembers` and `previewPayments` — there is no `previewPlans`. `studio-web/app/import/page.tsx` offers members and payments. |

So Phase 1's real remainder is **PT scheduling, the trainer rota, and plan
import** — not four items.

This is the third time a roadmap entry has claimed something was missing that
was already built (see the correction section below). The pattern is
consistent enough to be worth a rule: **before starting any item, grep for it
first.** The document is a statement of intent that ages badly, not a record
of what exists; the code is the record.

---

## Phase 2 — Read: make the record legible

Getting the data in is worth little if the three audiences cannot see it.

Checked against the code on 26 Aug 2026, because this document has now been
wrong three separate times about what already exists.

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

---

## Phase 3 — Money, properly

- Stripe for card payments and recurring collection.
- Dunning: what happens when a card fails, before the member silently lapses.
- Invoices that reconcile against payments taken.
- Payroll runs from delivered sessions at the rate set, with an approval step.

---

## Phase 4 — Retention

Retention is where a gym's economics actually live, and it is a coaching
problem before it is a revenue one.

- Lapse risk per member, from attendance pattern breaks.
- The intervention loop: surface, contact, record what was tried, measure.
- Guest-pass conversion — `guestsByHost` in `gymPasses.ts` is the first piece.
- Absence detection — `gymVisits.lastSeenDays` is the input; the membership
  join (who is frozen, who cancelled) is still to do.

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

---

## Phase 6 — Multi-site

- One owner, several gyms: roll up and drill down.
- Per-site staff, timetables and pricing under one brand.

---

## Phase 7 — Integrations

- Door access hardware.
- Accounting export (the gym's accountant will ask).
- Wearables beyond Apple Health, where the data is honest enough to use.

---

## Phase 8 — Hardening

Ongoing rather than final, and partly already underway.

- **Audit the discarded catches.** There are ~108 `catch {}` blocks that
  swallow failures; a write that silently fails is worse than one that errors.
- **Surface write failures to the user** rather than logging and moving on.
- **Move the repo off the iCloud Desktop.** Files evicted to `dataless` read as
  empty, which has already produced one wrong conclusion in this codebase.
- Accessibility pass across all three apps.
- Load and permission testing per role.

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

## TestFlight feedback — open

Two reports from TestFlight, both feature requests rather than defects. Neither
is scheduled yet; recording them so they are not lost.

- **Build 24, 22 Aug 2026** — "Need to create a tutorial about the app once u
  download it quickly takes u through the pages / features offered." A first-run
  tour. Worth doing per variant, since the three apps open on different screens.
- **Build 28, 25 Aug 2026** — "Sleep information should be able to come from
  Apple health, whoop, or the other devices that connect to the app." The
  wearable clients already authenticate against HealthKit, WHOOP and Oura for
  heart rate and calories; sleep is a field they expose that Repple does not yet
  read. Closest existing code: `src/lib/wearables/`.

## Correction: four roadmap items were already built

The 100-item review list was assembled by surveying the three apps and the
marketing site. `studio-web/` was surveyed less carefully, and four items were
listed as gaps when the console already covered them. Recording it here so the
same work is not commissioned twice.

| Item | Claimed | Actually |
|---|---|---|
| R054 · desk check-in for walk-ins | "the desk has no way to record one" | Built. `studio-web/app/door` has "Check someone in" with an explicit anonymous/walk-in option, plus check-out. |
| R055 · guest pass with host attribution | "unreachable from any screen" | Built. Same page issues passes and sets `hostMemberId` for guest types. |
| R061 · members page | "no way to look a member up" | Substantially built. `/money` opens memberships, changes their status and records payments. What is missing is a member-centred *view*, not the admin itself. |
| R064 · payroll page with settlement | "same flow as the app" | Substantially built. `/sessions` computes `payrollByTrainer`, `payrollTotal` and `settlementBlocker`, and marks outcomes. What is genuinely missing is recording that a settled payroll was *paid*. |

Two of the four are wholly done; two are narrower than described. R065 (CSV
import screen) and R072 (realtime) were checked at the same time and were
genuinely absent **at the moment of writing**.

R065 stopped being true six minutes later: this section landed in `529f4fd`
at 15:31 and the importer shipped in `5d0506a` at 15:37 the same afternoon.
Worth leaving visible rather than quietly editing, because it shows the real
failure mode with a document like this — not that anyone checked carelessly,
but that a status written down is only true at the instant it is written.
R072 (realtime) remains genuinely absent.

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
