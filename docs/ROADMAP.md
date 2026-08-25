# Roadmap

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

- **PT session scheduling** — one-to-ones and classes on one timetable. The
  outcome and payroll half is done; the booking half still lives in the
  trainer's own calendar rather than the gym's.
- **Session approval** — schema exists (`22-session-approvals.sql`) and the
  owner can now mark an outcome, but the client-side approval loop that
  table was built for is still unwired.
- **Trainer rota** — who is on the floor when, against class and PT load.
- **Equipment register** — what the gym owns, servicing due, what is out of
  action. Feeds capacity honestly: a class capacity of 14 is a lie if six
  rowers are broken.
- **CSV import** — members, plans and historical payments. Without this a gym
  starts from nothing and never gets a comparison year.

---

## Phase 2 — Read: make the record legible

Getting the data in is worth little if the three audiences cannot see it.

- Studio web: members, staff, retention and a real month-end close view.
- Coach: the client book sorted by who is drifting, not alphabetically.
- Member: a history that reads well going back, not just today.
- Exports everywhere. It is the gym's record; leaving must be possible.

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

The tests in `src/lib/coverage.test.ts` exist mainly to hold this line, and are
written so they fail when the rule is broken — verified by mutation, not by
assumption.
