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

## Parts 23–25 are dumped from the live database

These were applied by hand in an earlier session and never written down. They
were briefly reconstructed from the app's call sites; that reconstruction was
wrong in ways that would have caused damage, so they are now the database's own
definitions, verified against project `phgfwzpkkwdysftlgkoq`. Applying them to
live is a no-op.

What the reconstruction got wrong, kept here as the reason not to guess:

| Guessed | Actually live | Damage avoided |
| --- | --- | --- |
| `class_bookings.attended` boolean | attendance is `attended_at is not null`; no such column | adding it and repointing the functions would have orphaned every attendance already recorded |
| `class_roster` trainer-only | trainer **or** owner | would have cut owners out of the check-in roster |
| `class_attendance_summary` owner-only | class's own trainer **or** owner | would have broken a trainer viewing their own class analytics |
| `unique (client_id, trainer_id)` | partial unique **where status = 'pending'** | a declined request could never be sent again |
| `coach_clients.trainer_id → profiles` | → `auth.users` | wrong FK target |
| `trainers.offers/specialties/session_fee` NOT NULL + defaults | nullable, no defaults | `add column if not exists` would have skipped it, leaving repo and live disagreeing |

## Live gaps — the drift runs the other way too

Two things this repo defines have **never been applied to the live database**,
and both are broken in production right now:

| Missing live | Defined in | Breaks |
| --- | --- | --- |
| `feedback` table | `18-feedback.sql` | the in-app Send Feedback screen (`src/ui/appFeedback.ts`) — every submission fails |
| `all_member_ids()` | `02-domain-schema.sql` | the owner's member-wide promo push (`app/(owner)/promotions.tsx`) |

Applying just those two is the smallest safe change:

```sql
-- paste 18-feedback.sql, then the all_member_ids() block from 02-domain-schema.sql
```

## Not mirrored here, deliberately

`notify_on_message()` — a live trigger function that calls the `notify-message`
edge function — carries the hook secret **as a plaintext literal in its body**.
It is not reproduced in this repo because that would commit the secret to git.
It should be rewritten to read the value from Vault and the secret rotated; the
old value is readable by anything that can read `pg_proc`.

## Corrections to earlier notes in this file

- `trainers` **does** have row-level security enabled live, with five policies
  including `trainers_public_directory_r` (`listed = true`). An earlier version
  of this file said it had none — that was true of the repo, not the database.
