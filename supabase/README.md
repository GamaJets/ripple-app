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

## Applied to live on 2026-08-23

Two things this repo defined had never been applied to the database, and both
were broken in production. Both are now applied and verified:

| Applied | Defined in | Was breaking |
| --- | --- | --- |
| `feedback` table + 3 policies, RLS on | `18-feedback.sql` | the in-app Send Feedback screen (`src/ui/appFeedback.ts`) — every submission failed |
| `all_member_ids()` | `02-domain-schema.sql` | the owner's member-wide promo push (`app/(owner)/promotions.tsx`) |

`all_member_ids()` had `EXECUTE` granted to `anon` on creation (the Supabase
default for a new function). It is owner-gated in its body, so an anonymous
caller got no rows, but EXECUTE is now revoked from `anon` and granted only to
`authenticated`, matching the pattern in part 22.

`owner-metrics` was redeployed (version 7) with the corrected `p_from`/`p_to`
argument names, `verify_jwt` still true, and the deployed source read back and
checked. It still returns no class rows: `class_attendance_summary` gates on
`auth.uid()`, which is NULL under the service role that function uses. Fixing
that means widening the SQL function, which has not been done.

## Secret handling

`notify_on_message()` used to carry the `notify-message` hook secret as a
plaintext literal in its body. It now reads it from Vault at call time and is
mirrored here as `26-message-notifications.sql`; the old value has been rotated.

That secret matters more than it looks: `notify-message` runs with
`verify_jwt: false`, so it is publicly reachable and the secret is its **only**
authentication. Anyone holding it can push notifications to any user.

To rotate it, change the value in **both** places — no code change needed:

| Where | How |
| --- | --- |
| Vault secret `hook_secret` | Dashboard ▸ Project Settings ▸ Vault |
| edge secret `HOOK_SECRET` | Dashboard ▸ Project Settings ▸ Edge Functions ▸ Secrets |

Between saving one and the other, `notify-message` returns 403 and the trigger
swallows it, so pushes are skipped for that window. Messages still send and save.

To verify a rotation end to end without sending anything to anyone — the secret
check happens before the payload check, so a request carrying only the secret
returns `skipped: missing fields`:

```sql
select net.http_post(
  url     := 'https://phgfwzpkkwdysftlgkoq.supabase.co/functions/v1/notify-message',
  headers := jsonb_build_object('Content-Type', 'application/json'),
  body    := jsonb_build_object(
    'secret', (select decrypted_secret from vault.decrypted_secrets where name = 'hook_secret'))) as request_id;

-- then, using the id returned above:
select status_code, content from net._http_response where id = <request_id>;
-- 200 {"ok":true,"skipped":"missing fields"} = the secret is accepted
-- 403 {"error":"forbidden"}                  = the two values disagree
```

## Corrections to earlier notes in this file

- `trainers` **does** have row-level security enabled live, with five policies
  including `trainers_public_directory_r` (`listed = true`). An earlier version
  of this file said it had none — that was true of the repo, not the database.
