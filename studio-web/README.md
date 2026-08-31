# Repple Studio — web

The desk where a gym is run: twenty-two routes covering the floor, the
timetable, the books, the payroll run and the month-end close.

## Running it

    cd studio-web
    npm install
    npm run dev        # http://localhost:3100

`.env.local` holds `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
They are the same values as the `EXPO_PUBLIC_` pair in the repo root `.env` —
publishable, not secret, already inlined into the shipped phone apps. The file
is gitignored anyway.

Sign in with the same account you use in the Repple Studio app. Nineteen of the
twenty-two routes require the `owner` role; `/door` also admits a trainer, and
the four `/coach` screens are a trainer's own book. Anything else is told so by
name rather than shown an empty dashboard.

## Why it can talk to Supabase directly

There is no bespoke API in front of the database. Every table carries row-level
policies, and those policies — not this app — decide what a signed-in person can
read. The web console authenticates as the same user and inherits exactly the
same limits as the phone app, so there is no second permission model to keep in
step.

The role check on each page is therefore not the security boundary; the database
is. It is there so that somebody who types a URL they cannot use gets a sentence
explaining why, instead of a screen of dashes that reads like a broken product —
and so that a page offering buttons never offers one the database will refuse.

## Sharing code with the phone app

`next.config.mjs` sets `experimental.externalDir`, which lets Next compile
TypeScript from outside its own directory. `@lib/*` resolves to `../src/lib/*`,
so the analytics, the money arithmetic and the CSV work run here from the same
source the app uses. Twenty-five of those modules are reached from this console,
among them:

- `gymRecord` — plans, memberships, payments, `money()`
- `gymSessions`, `gymTrainers` — one-to-ones, outcomes, payroll settlement
- `gymSchedule`, `gymPtSchedule` — classes, rosters, the merged timetable board
- `gymRetention`, `memberView`, `clientDrift` — who is drifting, and how sure
- `monthEnd`, `staffView`, `passConversion`, `ownerAnalytics` — the roll-ups
- `csvImport`, `gymExport` — the two doors in and out of the record

180 of the 187 modules in `src/lib` import neither React nor React Native, which
is what makes this possible. Anything reached from here must stay that way — if
a module starts importing `react-native`, this build breaks. **Nothing in this
directory may edit `src/lib`**: it is the phone app's tree, and the console is a
consumer of it.

## The two rules

**A figure with no value renders as `—`, never `0`.** A gym that has recorded no
sessions and a gym with zero sessions are different facts, and the console is
not allowed to blur them. `payroll30For` returns `null` when no session fee is
set, and the KPI says *no session fee set* rather than showing a confident zero.
There is no hardcoded currency anywhere: this is a white-label product and every
amount goes through `money()`, which formats in the tenant's own currency.

**A read that failed is never rendered as a read that came back empty.**
supabase-js RESOLVES on a database error — `{ data: null, error }` — so

    const { data } = await supabase.from('gym_payments').select('*');

turns an RLS refusal into a confident empty answer, and the screen above it then
says "No payments recorded" to an owner who has been paid. Every state that
holds rows on these pages is `T[] | null`, null means *not read, or the read
failed*, and each carries its own error string so the two can be told apart. The
failure branch is a separate sentence, never the table's empty copy.

`node scripts/check-reads.mjs` from the repo root enforces the first half of
that mechanically across both apps and this console; `npm run preflight` runs it.
The second half — that a failed read is not *described* as an empty one — is a
matter of reading the screen, and is where the remaining bugs of this kind live.

## The routes

### The gym — Floor

| Route | Reads | Writes |
| --- | --- | --- |
| `/` Overview | tenant, trainer roster, memberships, 30-day payments, plans, classes, today's visits; rolled up by `gymRollup` and `trainerHealth` | nothing |
| `/members` | one member at a time: memberships, payments, visits, class bookings, one-to-ones, passes, invites — assembled into a dossier by `buildDossiers` | nothing |
| `/retention` | the same dossiers gym-wide, banded by `buildGymRetention`, plus the follow-ups already logged | inserts `member_interventions` — a logged contact and its outcome |
| `/passes` | pass types, passes, visits, plans, memberships; joined by `buildPassConversion` | nothing |
| `/door` | today's visits, who is still inside, active memberships, pass types and passes | check-in, check-out, issue a pass, redeem a pass |

### The gym — Delivery

| Route | Reads | Writes |
| --- | --- | --- |
| `/staff` | trainers, their clients, their sessions and the rota demand; ranked by `buildStaff` | nothing |
| `/classes` | classes in a window and their rosters; fill and show rates kept apart by `classRates` | attendance ticks on a class roster |
| `/timetable` | classes and one-to-one slots for a week, merged by `mergeTimetable`; the equipment register, for the capacity warning while a class is typed | create a class or a weekly series, delete a class, open or remove a one-to-one slot, attendance ticks |
| `/sessions` | one-to-ones on a rolling 30 days, the gym's session fee, past settlements | record a session outcome; settle payroll |

### The gym — Money

| Route | Reads | Writes |
| --- | --- | --- |
| `/money` Plans & payments | the price book, memberships, 30 days of payments — three independent reads that fail independently | create a plan, activate or retire one, open a membership, change its status, record a payment |
| `/revenue` | memberships, plans, payments, promo codes, trainer pack purchases; contracted billing and money actually received are kept strictly apart | nothing |
| `/accounting` | payments, invoices, payroll settlements for a chosen month; cash-basis, reconciled invoice against payment | nothing |
| `/payroll` | a named month's sessions per trainer, the session fee, settlements already made | records a payroll settlement |
| `/close` | the whole month — payments, invoices, sessions, passes — and refuses to call it closed while anything is unmarked | nothing; it is a verdict, not a ledger |

### The gym — System

| Route | Reads | Writes |
| --- | --- | --- |
| `/analytics` | joiners and leavers by month, cohort survival, visits, class rates — the only screen that answers "which way is this moving" | nothing |
| `/equipment` | the register, service state, and the coming week's classes for the capacity check | add kit, take it out of service or put it back, retire it, record a service |
| `/import` | the current member list and price book, to check a pasted sheet against | inserts `membership_plans`; records payments. Members preview but do not import — a membership needs a real account behind it, which is an invite rather than a row |
| `/export` | all eleven parts of the record, each read separately, each able to fail on its own | nothing. Produces one zip; a part that could not be read becomes a named stub, `INCOMPLETE` in every filename, and a warning in the README inside |

### My book — the signed-in trainer, not the gym

Scoped by the coach's own id in every `WHERE` clause, not filtered after the
rows arrive.

| Route | Reads | Writes |
| --- | --- | --- |
| `/coach` My day | their own sessions today and unmarked, their inbound coaching requests, their quiet clients | record a session outcome, answer a coaching request, confirm a session |
| `/coach/roster` My clients | their coaching links and client records, goals, workouts, check-ins, scans, packs sold | nothing |
| `/coach/checklists` | their clients, the checklist lines they set, and the client's ticks for the window | add, edit, reorder, deactivate and delete `coach_checklist_items` |
| `/coach/earnings` | their own month: sessions, the fee, what has already been settled | nothing — a coach is never handed a control that records their own pay |

## What is here besides the routes

    components/Shell.tsx         role-filtered navigation, split by context (the gym / my book)
    components/DataTable.tsx     the sortable table primitive; a missing cell is a dash
    components/PasswordField.tsx masked input with a reveal toggle, matching the app's
    lib/supabase.ts              client + `loadMe()` — id, role, tenant, and `roleUnknown`
    lib/zip.ts                   a dependency-free zip writer, used only by /export

`loadMe` returns three outcomes rather than two. A missing profile row is not
being signed out, and neither is a refused read: `roleUnknown` is what stops an
RLS hiccup telling the actual gym owner "Not your console".

## Before you push

    npm run preflight            # from the REPO ROOT — typechecks the app, runs check-reads over both
    cd studio-web && npx next build
