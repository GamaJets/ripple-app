# Repple Studio as the operating hub

The brief: Studio is the one screen where a gym owner sees the whole business —
accounting, banking, memberships, classes, trainers, revenue — with the systems
a gym already runs pulled in rather than replaced. Members join, book, pick a
trainer and buy packages from either the app or the website.

This document separates what already ships from what does not, because the gap
is smaller than it looks in three places and much larger in two.

---

## Already built, and closer than it appears

| Capability | Where | State |
|---|---|---|
| Memberships, plans, payments record | `29-gym-operating-record.sql`, `gymRecord.ts` | shipping |
| Classes, capacity, attendance | `25-class-attendance.sql`, `30-classes-tenant-scope.sql` | shipping |
| Drop-ins, guest passes, class packs | `31-drop-ins-and-passes.sql`, `gymPasses.ts` | shipping |
| Door log / footfall | `32-door-log.sql`, `gymVisits.ts` | shipping |
| PT sessions + payroll with outcomes | `33-session-outcomes.sql`, `gymSessions.ts` | shipping |
| Equipment register | `34-equipment-register.sql` | shipping |
| **Stripe subscriptions** (platform billing) | `20-billing.sql`, `billing.ts`, `stripe-*` functions | **credential-ready** |
| **Stripe Connect** (clients buy packages from trainers) | `21-connect.sql`, `connect.ts`, `connect-*` functions | **credential-ready** |
| Owner console on the web | `studio-web/` — overview, timetable, sessions, money, door | shipping |

"Credential-ready" means the schema, the edge functions and the client code are
written and the flow activates when the Stripe keys are set as Supabase
secrets. **Buying a training package in the app is not new work — it is
unfinished configuration.** Same for selecting a trainer: the directory and
availability tables exist (`23-trainer-directory.sql`, `24-trainer-availability.sql`).

## Not built at all

| Capability | Honest size |
|---|---|
| QuickBooks / Xero sync | large — OAuth app registration, per-provider mapping, reconciliation |
| Bank feeds | large, and **regulated** — see below |
| Email campaigns to members | medium — Resend is already the transactional sender |
| Public web signup / booking / package purchase | medium — `web/` is a marketing site today, not an application |
| Add member / open a membership from Studio | small — the tables exist, the admin UI does not |
| Gym identity on owner sign-up | small — a tenant IS created, just badly named |

---

## Two things to decide before any of it is built

### 1. Credentials never enter the app bundle

`EXPO_PUBLIC_*` and `NEXT_PUBLIC_*` are **inlined into the shipped bundle at
build time**. Anyone who downloads the APK can read them — I extracted strings
from our own APK today to verify its package name, and the same technique reads
any secret compiled in.

So every integration below is server-side only, as Supabase Edge Function
secrets:

- QuickBooks / Xero client secret and refresh tokens
- Stripe secret key and webhook secret
- Any banking credential

Only publishable/public identifiers may sit in the app. This is not a
preference; a leaked accounting refresh token is access to the gym's books.

### 2. "Bank information" needs a decision, not an implementation

Pulling a live bank feed means an aggregator (Plaid, TrueLayer, Lean in the
UAE) and brings regulatory weight: consent flows, data-retention rules, and in
most markets a licensed provider. There is a much cheaper 80% that may be all
the brief actually needs:

- **Accounting-derived cash position** — once QuickBooks or Xero is connected,
  the bank balance it already holds can be displayed without touching a bank.
- **Stripe payouts** — money actually arriving is already visible through
  Stripe, with no aggregator at all.

Recommendation: build the cash view from accounting + Stripe first, and treat a
direct bank feed as a separate decision once there is a customer asking for it.
I have not started either.

---

## Suggested sequence

Ordered by (value / effort), not by how the brief was written.

**1. Name the gym on owner sign-up — small, not blocking.**
Correcting an earlier note of mine: the `provision_profile` trigger
(`06-account-provisioning.sql`) creates a tenant for *every* role whose
`tenant_id` is null, owners included, and `is_owner_of()` resolves correctly
from it. An owner therefore signs up with a working gym already attached — it
is just called "Tim's space". What is missing is an onboarding step to set the
real gym name, currency and session fee, not the tenancy itself.

**2. Turn on Stripe — configuration, not code.**
Packages, checkout and trainer payouts light up. Needs the keys set as Supabase
secrets, price ids created in Stripe, and Connect enabled. Owner-entered
credentials, not mine.

**3. Member admin in Studio — small.**
Add a member, open/close a membership, take a payment. The tables exist; this
is the admin surface over them.

**4. The hub overview — medium, and the thing actually asked for.**
One screen that puts revenue, membership movement, class fill, payroll owed,
door count and cash position side by side, so departments can be seen affecting
each other. Everything it needs is already recorded except cash position.

**5. Public web application — medium.**
`web/` becomes an app, not a brochure: sign up, browse the timetable, book,
pick a trainer, buy a package. Same Supabase, same Stripe Connect flow the app
uses.

**6. Accounting connector — large. Xero or QuickBooks, not both.**
Pick one, ship it, learn from it. Building both at once doubles the mapping
work before either has a user.

**7. Member mailings — medium.**
Resend already sends our transactional mail; campaigns need a list model,
an unsubscribe path and consent tracking.

---

## Rule this hub inherits

Every number on the hub must trace to a row, a real measurement, or something
the user typed. Where an input is missing the hub renders `—` and a prompt to
supply it — never a zero, never a placeholder. An owner deciding staffing from
a fabricated occupancy figure is worse served than one who sees a blank.

This is why `payroll30For` returns `null` while any session is unmarked, and
why an empty week in the attendance series has no fill rate rather than 0%.
The hub aggregates those values; it must not launder them.
