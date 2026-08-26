# Repple — "Unblock the real thing" runbook

> **Before you launch, read [LAUNCH-CHECKLIST.md](LAUNCH-CHECKLIST.md).**
> Several things are deliberately wrong right now because the apps are not out
> yet — most importantly **email confirmation is switched OFF in Supabase**, so
> anyone can register an address they do not own. None of it will announce
> itself when it stops being acceptable.

Goal: turn the app from demo/local data into a **real backend** where a trainer
account and a client account are two separate logins that share data — the
trainer sees the *actual* client on their roster with real name, goal, weight
change and adherence. This is the trainer↔client data plane going live.

Nothing here touches your app code or requires a new build. It's three things:
run one SQL file, create two accounts, link them in-app. ~15 minutes.

> The app already ships with `USE_SUPABASE = true`, so as soon as the tables and
> RLS below exist, the app reads/writes your real Supabase project. No OTA needed
> for the SQL — but see step 5 for the pending JS OTA that carries the roster +
> publish code.

---

## Step 1 — Apply the database (one paste)

I've bundled every schema/RLS/function file into a single, idempotent script in
dependency order so you don't have to run the 22 parts by hand.

1. Open your Supabase project ▸ **SQL Editor** ▸ **New query**.
2. Paste the entire contents of **`supabase/setup.sql`** and click **Run**.
3. It's safe to re-run any time — every statement is `create ... if not exists`,
   `create or replace`, or `drop policy if exists`.

What it creates: the base multi-tenant schema (tenants/profiles/trainers/clients/
scans/sessions/messages/food_logs), the domain tables the app actually uses
(workouts/measurements/check_ins/habit_logs/coach_nutrition/assigned_programs),
account auto-provisioning (every new signup gets a tenant + a clients/trainers
row), the coach-invite link flow, and the trainer-read RLS so a coach can read a
linked client's real data.

**Verify (run in the SQL editor):**
```sql
select tablename from pg_tables where schemaname='public' order by 1;
-- expect ~30 tables incl. workouts, measurements, check_ins, clients, coach_invites

select proname from pg_proc
 where proname in ('provision_profile','link_coaching','accept_invite','is_my_client');
-- expect all four
```

---

## Step 2 — Create the two accounts

Create both from the app's normal sign-up screen (or two devices / a device +
the simulator). Use two real, different emails you can receive mail at.

- **Client account** — e.g. `client@yourdomain.com`. Sign up normally. Done —
  the app signs everyone up as a client, which is what we want here.
- **Trainer account** — e.g. `coach@yourdomain.com`. Sign up the same way.

> ⚠️ Known gap: the in-app sign-up form **always creates a `client`** (the role
> picker isn't wired into the signup UI yet — `auth.tsx` passes `'client'`
> hard-coded). So right after signing up, the "trainer" is still a client in the
> database. Step 3 promotes it. (If email confirmation is ON in your Supabase
> Auth settings, confirm both addresses before continuing.)

---

## Step 3 — Promote the trainer account to `role = 'trainer'`

The provisioning trigger only fires on INSERT, so flipping the role also needs a
`trainers` row created and the stray `clients` row removed. Run this once in the
SQL editor, with the trainer's email:

```sql
-- Promote coach@yourdomain.com to a trainer
with u as (select id, tenant_id from profiles
           where id = (select id from auth.users where email = 'coach@yourdomain.com'))
update profiles set role = 'trainer' where id in (select id from u);

-- create the trainers row (trigger already ran at signup, so do it explicitly)
insert into trainers (id, tenant_id)
select id, tenant_id from profiles
 where id = (select id from auth.users where email = 'coach@yourdomain.com')
on conflict (id) do nothing;

-- remove the clients row it got as a default-client at signup
delete from clients
 where id = (select id from auth.users where email = 'coach@yourdomain.com');
```

**Verify:**
```sql
select p.role, (t.id is not null) as has_trainer_row, (c.id is not null) as has_client_row
from profiles p
left join trainers t on t.id = p.id
left join clients  c on c.id = p.id
where p.id = (select id from auth.users where email = 'coach@yourdomain.com');
-- expect: trainer | true | false
```

Sign the trainer out and back in so the app picks up the new role and routes to
the **Trainer portal**.

---

## Step 4 — Link them (in-app, no SQL)

This uses the real `accept_invite` → `link_coaching` path, which sets
`clients.trainer_id` and records the coaching relationship.

1. **Trainer** ▸ Dashboard ▸ **Add client** (or **Send invite**). Enter the
   **client's exact email** (`client@yourdomain.com`) and pick the mode
   (online or in-person). Send.
2. **Client** ▸ open the app (signed in as the client). A **"Coaching
   invitation"** card appears on their Home. Tap **Accept**.
3. That's the link. Under the hood: `accept_invite(invite_id)` matched the
   invite to the client's login email, called `link_coaching(coach, client, mode)`,
   set `clients.trainer_id = coach`, and marked the invite accepted.

**Verify:**
```sql
select c.id as client, cl.trainer_id, ci.status
from clients c
join profiles cl on cl.id = c.id
left join coach_invites ci on lower(ci.email) = lower(
  (select email from auth.users where id = c.id))
where c.id = (select id from auth.users where email = 'client@yourdomain.com');
-- expect trainer_id = the coach's id, status = accepted
```

---

## Step 5 — Publish the pending JS (so the roster shows real stats)

The code that (a) publishes the client's name+goal to the shared tables and
(b) makes the trainer roster compute real weight-change / last-active /
adherence is committed but not yet on TestFlight. It's OTA-able JS — no new
native build:

```bash
eas update --branch preview -m "backend: trainer sees real linked client"
```

Then reopen the app on both accounts to pull the update.

> SQL/RLS from steps 1 & 3 is **not** OTA — it only takes effect once run in
> Supabase (which you did in step 1/3). The OTA only carries the JS.

---

## Step 6 — End-to-end check

As the **client**: set your name and goal in Profile, log a workout, and add a
body scan / weight in Progress.

As the **trainer**: open your **roster**. You should now see the real client
(their actual name, not a placeholder), their goal, a weight-change figure
derived from their scans, "last active" from their latest workout, and a
self-reported adherence number. Open the client's detail to confirm the numbers
match what the client entered.

If the client still shows as a placeholder: confirm step 4's `trainer_id` verify
query returns the coach id, confirm the OTA from step 5 was pulled, and confirm
the trainer-read RLS ran (it's `supabase/parts/19-trainer-read-access.sql`).

---

## Notes / honest edges

- **Role in signup UI** is the one real gap this runbook works around. A proper
  fix is to expose a client/trainer choice on the sign-up screen (or an
  owner-issued trainer invite that pre-sets the role). Until then, step 3 is the
  manual promotion.
- **Owner → trainer invites** exist too (`supabase/parts/12-trainer-invites.sql`) if
  you'd rather the platform owner provision trainers into the owner's tenant.
- Everything the app writes is **best-effort and RLS-gated** — if a policy is
  missing the app falls back to demo data rather than crashing, so a partial
  setup degrades gracefully instead of breaking.

## When the toolchain hangs (iCloud eviction)

**Symptom.** `npx tsc --noEmit` or `npx tsx …` hangs indefinitely with no
output. Nothing is wrong with the code.

**Cause.** The repo lives on the iCloud-synced Desktop. When the disk fills,
macOS evicts `node_modules` to the cloud — the files remain listed but their
contents are gone (`ls -lO` shows `dataless`, and they read as empty). The
toolchain then stalls trying to fault 30,000 files back over the network.

Confirm it:

    find node_modules -type f | head -1500 | xargs -I{} ls -lO "{}" | grep -c dataless
    df -h /System/Volumes/Data

**Run the tests without the toolchain.** Node 26 strips TypeScript natively, and
`src/lib` has no `node_modules` dependencies — only the import specifiers need
extensions:

    SP=$(mktemp -d) && cp src/lib/*.ts "$SP"/ && cd "$SP"
    perl -pi -e "s{(from\s+'\./[A-Za-z0-9_\-]+)'}{\$1.ts'}g" *.ts
    node --experimental-strip-types coverage.test.ts
    node --experimental-strip-types logic.test.ts

This runs the real modules — only the import paths are rewritten — so a pass is
a genuine pass. It does **not** replace `tsc`: it will not check types across
the app or `studio-web`.

**The durable fix** is the Phase 8 roadmap item: move the repo off the
iCloud-synced Desktop, or turn off *Optimise Mac Storage* for it.

## The repo lives at ~/repple-app, not on the Desktop

Moved 25 Aug 2026, from `~/Desktop/repple-app` to `~/repple-app`.

**Why.** Desktop & Documents syncing is on, so the old location was inside
iCloud. A `node_modules` of ~30,000 files is a poor thing to hand to a sync
engine, and the working theory is that this is what produced the hollow
install that cost most of a day: 797 packages present as manifests and stubs,
`react-native` at 568 KB instead of 84 MB, `typescript` at 100 KB instead of
23 MB. `tsc` appeared to hang because it was never a working binary, and
`expo config --json` exited 1 with nothing on stdout or stderr. `npm ci`
repaired it in minutes once the cause was understood.

That diagnosis is not proven — iCloud eviction leaves `.icloud` placeholders
and there were none. But an interrupted install inside a folder a sync daemon
is actively rewriting is the likeliest story, and the fix costs nothing.

**How it was done safely.** `~/Desktop` and `~` are the same APFS volume, so
`mv` is `rename(2)`: a metadata operation where no file content is copied. It
either succeeds completely or changes nothing — there is no partial state to
recover from. Checked first that the working tree was clean, that no `.icloud`
placeholders existed, and that nothing was running from inside the tree.
Verified after: 57,629 files before and after, identical git HEAD, `tsc` clean,
337 assertions passing, `expo config` resolving.

**What needs rebuilding.** Nothing in git, node_modules or the Pods project —
all checked and clean. Xcode's DerivedData still refers to the old path, so
the first iOS build after the move rebuilds from scratch. That is time, not
loss.

**If a tool still points at the old path**, it is holding a cached absolute
path — restart it rather than recreating the directory. Claude Code sessions
started before the move need reopening at `~/repple-app`.

## Two ways a security control can look real and do nothing

Both found on 25 Aug 2026 while closing a set of cross-tenant leaks. They share
a shape worth recognising, because reading the migration files will not reveal
either one.

**A policy on a table without RLS enabled is inert.** `tenants` and
`exercise_videos` both carry policies written in `28-fix-profiles-recursion.sql`.
Neither table had `enable row level security`, so Postgres never consulted
them and Supabase's default grants applied in full. Reading the migrations,
the tables look protected.

*(As it turned out, RLS had been switched on for all four tables through the
dashboard, so this was never live — but rebuilding from `setup.sql` would have
reintroduced it, and nothing in the repo said so.)*

**`revoke execute ... from anon` does nothing on its own.** Postgres grants
EXECUTE to PUBLIC on every function it creates, and `anon` resolves through
that grant. Revoking from `anon` leaves PUBLIC untouched. This was verified
against the live database: after the revoke,
`has_function_privilege('anon', oid, 'EXECUTE')` was still true. Two
pre-existing revokes in parts 02 and 22 had the same flaw and had presumably
never worked.

    revoke execute on function f(...) from public, anon;
    grant  execute on function f(...) to authenticated;

**The lesson underneath both:** applying a security fix is not the same as it
taking effect. Query the database afterwards and confirm the thing you
intended is true — `apply_migration` returning `{"success": true}` only means
the statements ran.

Useful checks:

    -- is RLS actually on?
    select tablename, rowsecurity from pg_tables where schemaname = 'public';

    -- can anon really not call this?
    select proname,
           has_function_privilege('anon', oid, 'EXECUTE') as anon,
           has_function_privilege('authenticated', oid, 'EXECUTE') as authed
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public';
