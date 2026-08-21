# Database

There are **no CLI migrations here.** Schema is applied by pasting SQL into the
Supabase dashboard. The CLI is used only to deploy `functions/`. Knowing which
is which is the whole point of this file.

## How to apply the schema

Supabase project ref `phgfwzpkkwdysftlgkoq` (`.temp/linked-project.json`).

**Fresh project, or re-syncing everything:**

1. Supabase dashboard ▸ **SQL Editor** ▸ **New query**
2. Paste all of **`setup.sql`** and Run.

Every statement is `create ... if not exists`, `create or replace`, or
`drop policy if exists`, so it is safe to run again on a live database.

**One change on its own:** paste that single file from `parts/`. If you touch
anything numbered at or below another file you also plan to run, run them in
number order.

## Layout

- **`setup.sql`** — GENERATED. Every part concatenated in order. Never hand-edit.
- **`parts/`** — the real source. One concern per file. The number prefix is the
  dependency order and is load-bearing.
- **`functions/`** — 14 edge functions, deployed with the CLI, not the SQL editor:
  `supabase functions deploy <name>`.

After editing anything in `parts/`, rebuild:

```
node scripts/build-supabase-setup.mjs
```

`--check` fails if `setup.sql` is stale. Edit the part, never the bundle — the
bundle previously drifted 101 statements ahead of its parts, which is why this
script exists.

## Ordering rules that are not obvious

- **`22-session-approvals.sql` must stay last.** It re-creates the
  `sessions_client_read` policy that `09-sessions-access.sql` creates wide,
  narrowing it so a client can only read their trainer's `available` slots
  instead of every slot including who is booked into it. Run 09 after 22 and
  that leak reopens.
- `01-schema.sql` and `02-domain-schema.sql` create the tables everything else
  references. They come first for a reason.
- `20-billing.sql` and `21-connect.sql` both need `profiles` from `01`.

## Reconstructed parts (23–25) — read before applying

Parts `23`–`25` were **reconstructed from the app's call sites**, not dumped from
the live database. Six objects and five columns the app uses at runtime had never
been written down here:

| Added in | What | Why it was invisible |
| --- | --- | --- |
| `23` | `trainers.listed / tagline / offers / specialties / session_fee` | the client directory query filters on `listed`; without the column the whole find-a-coach flow returns nothing |
| `23` | `coach_requests` table | the directory's "request coaching" write |
| `23` | `coach_clients` table | the trainer's roster; `roster.tsx` swallows the error and keeps an optimistic local copy |
| `24` | `trainer_availability` table | `availability.ts` falls back to per-device AsyncStorage, so a schedule survived on one device and nowhere else |
| `25` | `class_bookings.attended / attended_at` | there was nowhere to record who turned up |
| `25` | `class_roster`, `set_class_attendance`, `class_attendance_summary` | all three RPCs the check-in and owner-analytics screens call |

**Before applying these to the live database**, dump what is actually there and
compare — these tables may already exist, created by hand:

```sql
select table_name, column_name, data_type
  from information_schema.columns
 where table_name in ('coach_clients','coach_requests','trainer_availability','trainers','class_bookings')
 order by table_name, ordinal_position;

select proname, pg_get_function_identity_arguments(oid)
  from pg_proc where proname in ('class_roster','set_class_attendance','class_attendance_summary');
```

`create table if not exists` will not reshape a table that already exists, but
`create or replace function` **will** overwrite a live function body. If the
dumps disagree with parts 23–25, reconcile before running, not after.

### Decisions baked into these parts

- **`class_attendance_summary(p_from, p_to)`** — the app sent `p_from`/`p_to`
  while `functions/owner-metrics` sent `from_ts`/`to_ts`. PostgREST binds
  arguments by name, so those two could never have shared one signature. The
  app's naming won and the edge function was corrected; **`owner-metrics` needs
  redeploying** for that fix to take effect.
- **`class_attendance_summary` is owner-scoped** — it crosses trainers, so a
  signed-in caller must have `profiles.role = 'owner'`. This depends on the
  `role = 'owner'` question that `docs/OWNER-PORTAL.md` is still blocked on. If
  that resolves to "platform admin", a gym owner will need a different check.
- **`coach_clients.id` is not a foreign key.** Coaches add clients by hand who
  have no auth account; making it reference `profiles` would reject exactly those.

## Still open

- **`trainers` has no row-level security at all** — no `enable row level
  security`, no policies, so with the anon key any signed-in user can read and
  write every trainer's row. Adding RLS here is a behaviour change that needs
  testing against the live database, so it is deliberately not in these parts.
- Parts `01`–`22` were made idempotent (`create table`/`create index` now carry
  `if not exists`). Before that, re-running `setup.sql` aborted on the first
  `create table tenants`, despite the runbook promising it was safe to re-run.
