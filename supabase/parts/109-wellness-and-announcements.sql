-- ─────────────────────────────────────────────────────────────────────────
-- Three stores that were rendered as if they were real, and one table nobody
-- read.
--
-- `src/ui/wellness.tsx`, `src/ui/habits.tsx` (the water counter) and
-- `src/ui/announcements.tsx` all held their data in a React `useState` and
-- nowhere else. Each of them said so in its own header — "Nothing here
-- persists yet", "Water glass count is session-local (no counter column)", "a
-- trainer's real announcement does not reach any other device" — and each of
-- them was nevertheless read by a screen that presented what it held as the
-- client's own record.
--
-- The sleep log is the expensive one. It does not stop at the Recovery screen:
-- `readinessSleep()` (src/lib/readiness.ts) folds the typed nights in with the
-- nights a watch measured, and the result is the largest figure on the client's
-- home screen. So a client logging last night got a readiness score, closed the
-- app, and reopened it to be told to log a night of sleep — the number having
-- been computed from state that no longer existed. Sleep is the one input to
-- that score a client without a wearable can supply at all.
--
-- The water counter is a smaller version of the same thing, and was already
-- half-fixed: the 'done' tick for the water habit persists to `habit_logs`, and
-- the COUNT it is derived from did not, so a client who drank six glasses saw
-- the habit ticked green above a counter reading zero.
--
-- `announcements` is the opposite failure. The table has existed since
-- 02-domain-schema.sql, with `audience`, `tenant_id`, `author_id` and `body`,
-- and in the whole repository — both apps and the web console — not one query
-- reads or writes it. Meanwhile the client dashboard renders a "From Your
-- Coach" block over the in-memory store, which is fed by a modal on the coach's
-- dashboard that now has to warn the coach, in its own subtitle, that pressing
-- the button does not reach anybody.
--
-- Everything below is additive. No existing row is touched, and no column is
-- dropped or retyped. Two policies on `announcements` are NARROWED, which is
-- discussed where it happens.
-- ─────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · sleep_logs — the nights a client types in by hand
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── Why a row per night rather than a counter per day ──────────────────────
--
-- Unlike water, this is a log: the client can file more than one entry, the
-- Recovery screen lists the last four of them individually with their quality
-- marks, and `readinessSleep()` needs each night separately in order to prefer
-- a device's measurement over a typed one FOR THE SAME DATE. Collapsing to one
-- row per day would either throw away the second entry or average the two into
-- a figure the client never reported, and averaging a night is exactly the move
-- src/lib/readiness.ts spends a paragraph refusing to make.
--
-- ── `at` is the moment the client logged, and it is also the night ──────────
--
-- The in-memory store stamped `new Date().toISOString()` and readiness dates a
-- typed entry by the local day it was logged for. That is preserved rather than
-- improved on here: introducing a separate `night` date column would change
-- what readiness scores, and this migration's job is to stop the data
-- evaporating, not to redefine it. A column for the night the client actually
-- slept is a real improvement and belongs in its own change, with the readiness
-- window updated alongside it.
create table if not exists public.sleep_logs (
  id uuid primary key default gen_random_uuid(),

  -- Cascade: a deleted account's sleep log is nobody's record. This matches
  -- habit_logs, measurements and check_ins, all of which cascade from profiles.
  user_id uuid not null references public.profiles(id) on delete cascade,

  -- When the entry was filed. Defaulted so a writer that omits it still gets a
  -- real timestamp rather than null, which would sort unpredictably and reach
  -- `localDate()` as a value it cannot parse.
  at timestamptz not null default now(),

  -- Hours slept. numeric, not int: the Recovery screen's input is a
  -- `parseFloat`, and a client who slept seven and a half hours types 7.5.
  --
  -- The bounds are not a judgement about how much anybody should sleep. They
  -- are the range in which the number can be a number of hours at all: zero is
  -- refused because the screen already refuses to file an untouched form (that
  -- was a real bug — tapping "Log Sleep" without touching either control filed
  -- a night the client never had, which then became their sleep average), and
  -- 24 is the ceiling a day has.
  hours numeric(4,2) not null check (hours > 0 and hours <= 24),

  -- The 1–5 picker on the Recovery screen. Not nullable and not zero: `q < 1`
  -- is what disables the log button there, so a stored zero could only come
  -- from a writer bypassing the screen, and it would render as five empty marks
  -- that look identical to "worst possible night".
  quality int not null check (quality between 1 and 5),

  created_at timestamptz not null default now()
);

-- The only read there is: this client's nights, newest first.
create index if not exists idx_sleep_logs_user_at
  on public.sleep_logs (user_id, at desc);

comment on table public.sleep_logs is
  'Hand-typed sleep entries. Private to the client — a coach has no policy here; see 109.';

alter table public.sleep_logs enable row level security;

-- ── Owner-scoped, and ONLY owner-scoped ────────────────────────────────────
--
-- No coach-read policy, deliberately, and this is a decision rather than an
-- omission. Sleep read off a device is already gated behind a per-client
-- sharing switch (src/lib/wearables/sleepAccess.ts, and the same question was
-- settled the same way for glucose and for injury documents: the coach sees
-- what the client chose to share, not the file). Granting a coach a blanket
-- read of hand-typed nights here would route around that switch by the back
-- door, and it would do it for the one sleep source a client with no wearable
-- has. If a coach is ever to see these, it goes through the same gate the
-- device nights go through, in the change that builds the screen — not as a
-- policy added speculatively ahead of any reader.
drop policy if exists sleep_logs_own on public.sleep_logs;
create policy sleep_logs_own on public.sleep_logs for all
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- RLS narrows a grant; it does not confer one. A policy with no matching GRANT
-- is inert, and the failure mode is a 42501 on every read with the policy
-- looking perfectly correct in the dashboard.
--
-- The REVOKE is not decoration, and this was checked rather than assumed. This
-- project's default privileges in `public` hand `anon` the full set on every
-- new table, so `create table` alone leaves an unauthenticated caller with
-- SELECT, INSERT, UPDATE and DELETE on a client's sleep log — an anon probe
-- against PostgREST answered `200 []` rather than 401, which is RLS doing the
-- work on its own with nothing behind it. RLS is enough here (auth.uid() is
-- null when nobody is signed in, so the policy matches no row), but "one
-- correct policy is the only thing between an anonymous caller and this table"
-- is not a position to leave a private log in.
grant select, insert, update, delete on public.sleep_logs to authenticated;
revoke all on public.sleep_logs from anon;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · hydration_logs — one glass count per person per day
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── Why not a counter column on habit_logs ─────────────────────────────────
--
-- `habit_logs` is keyed (user_id, habit, done_on) and the water habit already
-- has a row there, so a `count int` on that table is the smaller change and was
-- the first thing considered. It is wrong, for three reasons, and the first one
-- alone settles it:
--
--   1. In `habit_logs` the ROW IS THE TICK. The client's app reads that table
--      as `setDoneIds(new Set(rows.map(r => r.habit)))` — presence means done —
--      and the coach's adherence figures (src/lib/adherence.ts) count rows over
--      a four-week window to answer "how often did they do this". A client on
--      their third of eight glasses is not done. Storing the running count
--      there would require a row to exist before the habit is complete, which
--      would tick the habit green at one glass on the client's screen and count
--      the day as adhered-to on the coach's.
--
--   2. The count exists when the habit does not. `buildChecklist()` only emits
--      a 'water' item when the client has set a goal — `waterGoal` is null
--      until they do, and part 70's whole point was that nobody may invent one.
--      A client with no goal still drinks water and the counter still shows it.
--      There is no habit row to hang the number on.
--
--   3. A count is not a tick and does not behave like one. Removing a glass
--      decrements; un-ticking a habit DELETES the row. Two verbs on one row,
--      with different meanings for "gone".
--
-- So: its own table, one row per person per day, and the water habit's tick
-- stays exactly where it is in `habit_logs`.
create table if not exists public.hydration_logs (
  user_id uuid not null references public.profiles(id) on delete cascade,

  -- The client's LOCAL calendar day, computed on the device, matching the
  -- `today()` helper in src/ui/habits.tsx and the key it already uses for
  -- AsyncStorage. A date, not a timestamptz: "how many glasses today" has no
  -- instant attached to it, and a timestamp here would put a client in Auckland
  -- on the wrong day for most of their morning.
  logged_on date not null,

  -- 0..30. The upper bound is WATER_CAP in src/ui/habits.tsx, which is itself
  -- pinned to clients_water_goal_glasses_check (part 70, 1..30): whatever goal
  -- the database will accept has to be reachable by the counter, or a client
  -- who set 25 could log 20 and never arrive. Zero is allowed because zero is a
  -- real answer — the client pressed minus back down to nothing — and it is not
  -- the same as having no row, which means the day was never logged.
  glasses int not null check (glasses >= 0 and glasses <= 30),

  updated_at timestamptz not null default now(),

  -- The natural key. It is also the conflict target of the upsert the app runs
  -- on every tap, so it has to be a real unique constraint and not just an
  -- index somebody trusts.
  primary key (user_id, logged_on)
);

comment on table public.hydration_logs is
  'Glasses of water per person per local day. The water HABIT tick stays in habit_logs; see 109 for why the count is not a column there.';

alter table public.hydration_logs enable row level security;

-- Owner-scoped, on the same reasoning as sleep_logs. `habit_logs` does carry a
-- coach read (`habit_logs_coach_read`), so a coach can already see whether the
-- water habit was completed on a given day — which is the adherence question
-- they actually ask. The running count is finer-grained than that and has no
-- reader, and a policy written ahead of its reader is a policy nobody tests.
drop policy if exists hydration_logs_own on public.hydration_logs;
create policy hydration_logs_own on public.hydration_logs for all
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.hydration_logs to authenticated;
-- See sleep_logs above: `anon` gets the full set by default privilege on every
-- new table in this project, and a count of how much water somebody drank is
-- not something to leave one policy away from an anonymous caller.
revoke all on public.hydration_logs from anon;

-- Stamped server-side rather than trusted from the writer. Two of a client's
-- devices can both hold a count for today, and the app reconciles them by
-- asking which was written last (src/lib/wellnessSync.ts). A timestamp the
-- writer supplies is a timestamp a wrong device clock can win with.
create or replace function public.touch_hydration_log()
returns trigger language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists touch_hydration_log_t on public.hydration_logs;
create trigger touch_hydration_log_t
  before insert or update on public.hydration_logs
  for each row execute function public.touch_hydration_log();

-- Trigger functions are reachable by nobody; see 51-advisor-tidy.sql.
revoke execute on function public.touch_hydration_log() from public, anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · announcements — the table that existed and had no reader
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── What was already there, and why it does not fit ────────────────────────
--
-- The live database carries three policies on this table, all from
-- 38-tenant-isolation.sql, and every one of them is about a GYM OWNER
-- broadcasting to a TENANT:
--
--     ann_read     for select using (tenant_id = my_tenant())
--     ann_write    for insert with check (author_id = auth.uid()
--                                         and is_owner_of(tenant_id))
--     ann_owner_rw for all    using/check (is_owner_of(tenant_id))
--
-- `is_owner_of(t)` is `profiles.role = 'owner' AND profiles.tenant_id = t` —
-- the tenant clause matters and this used to omit it, which is precisely the
-- lesson parts 106 and 120 exist to teach ("`role = 'owner'` is never an
-- authorisation on its own"). So as it stands a TRAINER
-- cannot insert an announcement at all, and a client reads by tenancy — every
-- announcement in their gym, from anybody, including one written for a
-- different coach's roster. Neither half is what the client dashboard's "From
-- Your Coach" block means. So the existing policies fit the owner's broadcast
-- and do not fit the coach's, and this adds the second scope beside the first
-- rather than bending either into the other.
--
-- ── The discriminator is a column, not a convention ────────────────────────
--
-- `coach_id` null means a tenant-wide announcement, governed exactly as before.
-- `coach_id` not null means it is addressed to one coach's roster. Making that
-- an explicit column rather than inferring it from `audience` or from the
-- author's role is the whole safety of the change: a policy that has to ask
-- "what role did the author have" is a policy that changes meaning when
-- somebody's role changes, and a coach promoted to owner would retroactively
-- broadcast their old notes to the entire gym.
alter table public.announcements
  add column if not exists coach_id uuid references public.profiles(id) on delete cascade;

comment on column public.announcements.coach_id is
  'Null = tenant-wide (owner broadcast, the original meaning). Not null = addressed to that coach''s current roster.';

-- A body has to say something, and it has to fit on a dashboard card. Added
-- with the table empty (verified: zero rows), so it validates immediately
-- rather than being carried as NOT VALID forever. The app trims and refuses
-- blanks too; this is what stops one being stored by anything that does not.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'announcements_body_nonblank') then
    alter table public.announcements
      add constraint announcements_body_nonblank
      check (btrim(body) <> '' and length(body) <= 2000);
  end if;
end $$;

-- The client's read: their coach's announcements, newest first.
create index if not exists idx_announcements_coach_created
  on public.announcements (coach_id, created_at desc)
  where coach_id is not null;

-- ── "Is this person my coach" ──────────────────────────────────────────────
--
-- The mirror of `is_my_client()`, which every coach-side policy in this schema
-- already hangs off. Written once, here, for the same reason 58-coach-checklist
-- gives for reusing `is_my_client` rather than hand-rolling a second EXISTS:
-- two spellings of the same relationship can drift apart, and when they do
-- somebody can write a row they cannot read.
--
-- SECURITY DEFINER, unlike `is_my_client`, and the difference is deliberate.
-- This reads the CALLER'S OWN `clients` row — the one thing they are
-- unambiguously entitled to see — and a definer function makes that
-- independent of how `clients` is policed later. Without it the function
-- silently depends on the `client_self` policy continuing to exist, and the
-- symptom of that dependency breaking is a client's dashboard quietly going
-- empty rather than an error anybody would notice.
--
-- It reads `clients.trainer_id`, which is what `end_coaching()` (part 68)
-- clears. So a client who leaves a coach stops seeing that coach's
-- announcements with no extra bookkeeping — which is the right answer for a
-- broadcast, and deliberately NOT the answer part 69 reached for a training
-- programme. A plan somebody is following stays theirs when they change coach;
-- "the 6pm class is cancelled tonight" from a coach they no longer train with
-- is not news addressed to them.
create or replace function public.is_my_coach(c uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from clients cl
     where cl.id = (select auth.uid()) and cl.trainer_id = c
  );
$$;

revoke execute on function public.is_my_coach(uuid) from public, anon;
grant execute on function public.is_my_coach(uuid) to authenticated;

-- ── The three existing policies, narrowed to `coach_id is null` ────────────
--
-- This is the one narrowing in the file, and it is safe to make now for a
-- reason that will not be true again: nothing in the entire repository reads or
-- writes this table today, and it holds zero rows. Every existing policy
-- therefore governs behaviour that has never once happened.
--
-- Why narrow at all, rather than leave them alone:
--
--   * `ann_read` is `tenant_id = my_tenant()`. Left as it was, a coach's
--     announcement carrying a tenant_id would be readable by EVERY client in
--     the gym, not by that coach's roster — the block on the client dashboard
--     is captioned "From Your Coach", and it would be showing them a message
--     from somebody else's.
--   * `ann_owner_rw` is `for all`, so a gym owner could edit or delete a
--     message a coach sent their own clients, and — since the coach's app reads
--     its own sent list back — do it invisibly.
--
-- The owner's broadcast keeps every capability it had over the rows it always
-- meant.
drop policy if exists ann_read on public.announcements;
create policy ann_read on public.announcements for select
  using (coach_id is null and tenant_id = public.my_tenant());

drop policy if exists ann_write on public.announcements;
create policy ann_write on public.announcements for insert
  with check (coach_id is null and author_id = (select auth.uid())
              and public.is_owner_of(tenant_id));

drop policy if exists ann_owner_rw on public.announcements;
create policy ann_owner_rw on public.announcements for all
  using      (coach_id is null and public.is_owner_of(tenant_id))
  with check (coach_id is null and public.is_owner_of(tenant_id));

-- ── The coach writes their own, and can take one back ──────────────────────
--
-- `for all` rather than `for insert`: a coach who broadcast the wrong time for
-- a session needs to be able to delete it, and the alternative — leaving a
-- wrong message on forty dashboards permanently — is worse than the write it
-- would be protecting against.
--
-- `coach_id = auth.uid()` AND `author_id = auth.uid()` both appear, because
-- they are two different claims: the first is who the message is addressed on
-- behalf of, the second is who wrote it. Requiring them to agree here means no
-- account can address a roster that is not its own, and none can put another
-- person's name on a message.
--
-- Note what is NOT required: that the writer's `profiles.role` be 'trainer'.
-- A row whose `coach_id` is the writer is readable only by accounts whose
-- `clients.trainer_id` points at that writer, so an account nobody has as their
-- coach can write these all day and no other person can read one. Gating on
-- role would add a way for the demo to fail — a correctly-linked trainer whose
-- profile row says something else — in exchange for closing nothing.
drop policy if exists ann_coach_rw on public.announcements;
create policy ann_coach_rw on public.announcements for all
  using      (coach_id = (select auth.uid()) and author_id = (select auth.uid()))
  with check (coach_id = (select auth.uid()) and author_id = (select auth.uid())
              and audience = 'clients');

-- ── The client reads, and cannot write ─────────────────────────────────────
--
-- SELECT only, on the same reasoning as `coach_checklist_client_read`: a client
-- who could delete an announcement could remove the one they would rather not
-- have read, and their coach would have no way to tell that from never having
-- sent it.
--
-- `audience = 'clients'` is checked here even though `ann_coach_rw`'s WITH
-- CHECK already forces it on the way in. A read policy that assumes the write
-- policy held is a read policy that inherits every future edit to the write
-- policy, and the cost of stating it twice is nothing.
drop policy if exists ann_client_read on public.announcements;
create policy ann_client_read on public.announcements for select
  using (coach_id is not null and audience = 'clients'
         and public.is_my_coach(coach_id));

-- The grant already exists on this table (all privileges, both roles, from
-- 02-domain-schema). Restated for the same reason the header of
-- 97-subscription-packages gives: RLS narrows a grant and does not confer one,
-- and a reader of this file should not have to go and check that the grant is
-- somewhere else.
--
-- `anon` is left exactly as 02-domain-schema left it, unlike the two new tables
-- above, and the reason is that its grant here is already inert in a way that
-- is easy to confirm and hard to regress: every policy on this table is
-- conditioned on `auth.uid()` through `my_tenant()`, `is_owner_of()` or
-- `is_my_coach()`, and `anon` has EXECUTE on none of those three. An
-- unauthenticated read does not come back empty, it comes back 42501 — which
-- is what an anon probe against PostgREST answered while this was being
-- checked. Narrowing a pre-existing grant on a shared table the night before a
-- demo buys nothing that is not already true.
--
-- One consequence worth writing down, because it looks like a bug from the
-- app's side: a signed-in read here evaluates EVERY permissive policy, since
-- they are OR'd, so `ann_client_read` succeeding does not stop `ann_read`'s
-- `my_tenant()` from being called. `authenticated` has EXECUTE on it (checked),
-- so this is fine — but if that grant were ever dropped, a client's dashboard
-- would start failing on a policy that has nothing to do with them.
grant select, insert, update, delete on public.announcements to authenticated;
