-- ═══════════════════════════════════════════════════════════════════════════
-- The gate part 109 asked for, built — not the blanket read it refused.
--
-- ── What was refused, and by whom ─────────────────────────────────────────
--
-- Backlog item "Coach #33" asked to show a coach their client's own water and
-- sleep logs. The first attempt was to add a coach-read policy to `sleep_logs`
-- and `hydration_logs`. That was refused, in the words part 109 had already
-- written on the policy it declined to add:
--
--     Granting a coach a blanket read of hand-typed nights here would route
--     around that switch by the back door, and it would do it for the one
--     sleep source a client with no wearable has. If a coach is ever to see
--     these, it goes through the same gate the device nights go through, in
--     the change that builds the screen — not as a policy added speculatively
--     ahead of any reader.
--
-- The refusal was reviewed and upheld: "Deny as written — build the gate
-- instead. The need is real; the route is wrong. It'd be the only sleep source
-- skipping the member-controlled sharing switch, for exactly the clients with
-- no wearable."
--
-- This is the gate. It is not a widening of 109; it is 109's own condition
-- being met, and it arrives WITH its reader (app/(trainer)/client-body.tsx) so
-- that nothing here is a policy nobody has exercised.
--
--
-- ── One correction to the record, because it changes what "the same gate"
--    can mean ───────────────────────────────────────────────────────────────
--
-- Part 109 cites `src/lib/wearables/sleepAccess.ts` as the per-client sharing
-- switch that device sleep already passes through. It is not one. That file
-- decides whether to raise the iOS HealthKit permission sheet once per device;
-- it is about what the PHONE may read out of Health, and has nothing to say
-- about what a coach may read out of Postgres. The whole ledger was searched
-- for the switch it describes, and the result is worth stating plainly rather
-- than leaving for the next reader to rediscover:
--
--   · `clients.glucose_shared` (part 102) is the ONLY member-controlled
--     coach-visibility switch in this schema.
--   · `device_sleep_nights` (part 154) carries exactly one policy,
--     `device_sleep_nights_own`, and no coach may read it by any route. Its own
--     table comment says "a coach reads device sleep through the sharing
--     switch, never here; see 153" — but part 153 is about coach branding, the
--     number is a stale reference to an earlier draft of 154 itself, and no
--     such switch was ever built.
--
-- So there is no device-sleep gate for hand-typed sleep to join. There is a
-- SHAPE — part 102's, which is also the shape parts 96, 1000 and 1140 use for
-- injuries, injury-document OCR and body-scan sheets — and this follows it
-- exactly rather than inventing a second vocabulary for the same consent.
--
--
-- ── Why one column for sleep AND water, and why it is named for neither ────
--
-- `wellness_shared`, not `sleep_shared` plus `water_shared`. Two switches over
-- two tables written by one screen is how a member ends up believing they have
-- stopped sharing because they turned off the one they remembered. The member
-- is answering a single question — may my coach see what I log about myself —
-- and there is one control for it.
--
-- The name is deliberately about the MEMBER'S OWN LOGS rather than about
-- sleep, because that is the set it governs and the set it will still govern
-- when device nights get a coach-side reader. When that change is written, it
-- hangs on THIS column: a member who has turned this on has answered the
-- question for their sleep, and asking them a second time with different words
-- would be the parallel switch this file exists to avoid.
--
-- No policy is added to `device_sleep_nights` here, and that is the same
-- restraint part 109 showed. There is no coach-side reader of device nights in
-- this change, and 109's own sentence — "a policy written ahead of its reader
-- is a policy nobody tests" — applies to this file as much as it applied to
-- the one it refused.
--
--
-- ── What the member gets, and what "off" has to mean ───────────────────────
--
-- Off by default, on the same reasoning part 102 gives: a member who types
-- four hours and a quality of one is recording the worst week of their year,
-- and a coach learning about it should be that member's decision made on
-- purpose, not a consequence of having a coach.
--
-- Turning it off hides the history as well as the next night. A share that
-- cannot be taken back is not a share — so the policies below test the flag on
-- every row, every read, rather than stamping rows as shared when they are
-- written.
--
-- `c.trainer_id = auth.uid()` is the second half of it and carries no extra
-- bookkeeping: `end_coaching()` (part 68) clears `trainer_id`, so a coach who
-- is no longer theirs stops reading these the moment the relationship ends,
-- with the member's own switch left exactly as they set it.
--
-- The member's control lives in app/(client)/devices.tsx, beside the sleep
-- sources — reachable whether or not they own a wearable, which is the point.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── The switch ─────────────────────────────────────────────────────────────
--
-- On `clients` rather than `profiles`, exactly as `glucose_shared` is: sharing
-- only means anything when there is somebody to share with, and `trainer_id`
-- — the other half of every policy below — lives here too.
alter table public.clients
  add column if not exists wellness_shared boolean not null default false;

comment on column public.clients.wellness_shared is
  'Member-controlled. False by default. True lets the member''s CURRENT coach read the sleep and water the member typed themselves (sleep_logs, hydration_logs). Only the member may change it; see clients_wellness_consent_is_the_clients. Device-measured nights are not governed by it yet because nothing reads them coach-side — when something does, it hangs here rather than on a second switch.';


-- ── Only the member may move it ────────────────────────────────────────────
--
-- The same mechanism as part 96 (`clients.injuries`), part 102
-- (`clients.glucose_shared`) and part 127 (`clients.intake`), for the same
-- reason: row-level security cannot restrict WHICH COLUMNS an update touches,
-- and `clients_trainer_update` lets a coach write their own client's row. A
-- consent column a coach can set is not a consent column — it is a coach
-- granting themselves the access it exists to withhold, silently, with the
-- member's app still showing the switch turned off.
--
-- auth.uid() IS NULL is the service role and migrations, which are server-side
-- and trusted; every request through PostgREST carries a uid, so a coach is
-- always caught.
create or replace function public.clients_wellness_consent_is_the_clients()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if new.wellness_shared is distinct from old.wellness_shared
     and auth.uid() is not null
     and auth.uid() <> old.id then
    raise exception 'Only the member may choose to share their sleep and water logs'
      using errcode = '42501';
  end if;
  return new;
end $fn$;

-- A trigger fires on the table's own authority and EXECUTE is never consulted
-- when it does, so nothing here needs to be callable by a request. Postgres
-- grants EXECUTE on a new function to PUBLIC, and in a Supabase project the
-- ALTER DEFAULT PRIVILEGES on schema `public` grant it to `anon` and to
-- `authenticated` SEPARATELY as well — so revoking PUBLIC alone leaves it
-- answering at /rest/v1/rpc/. All three are named. See part 141 §2, and
-- scripts/check-grants.mjs for the nine trigger functions this was measured on.
revoke execute on function public.clients_wellness_consent_is_the_clients() from public;
revoke execute on function public.clients_wellness_consent_is_the_clients() from anon;
revoke execute on function public.clients_wellness_consent_is_the_clients() from authenticated;

drop trigger if exists clients_wellness_consent_guard on public.clients;
create trigger clients_wellness_consent_guard
  before update on public.clients
  for each row execute function public.clients_wellness_consent_is_the_clients();


-- ── The nights the member typed ────────────────────────────────────────────
--
-- SELECT only. `sleep_logs_own` keeps every other verb with the member, and a
-- coach who could delete a night could remove the one their client would
-- rather not have been asked about — which is the reasoning 109 applied to
-- announcements and 96 applied to injuries.
--
-- Additive: `sleep_logs_own` is untouched and still grants the member
-- everything. Two permissive policies on one table are OR'd, so the member
-- keeps full access to their own rows whatever this one says.
--
-- The subquery reads `clients` as the CALLER, under RLS, which is what makes
-- it safe to spell inline rather than behind a definer helper: a coach may
-- already read their own clients' rows (`clients_trainer_read`) and nobody
-- else's, so this can only ever answer about a relationship the caller is
-- entitled to see. This is `glucose_trainer_read` with one column changed.
drop policy if exists sleep_logs_coach_read on public.sleep_logs;
create policy sleep_logs_coach_read on public.sleep_logs
  for select using (
    exists (
      select 1 from public.clients c
       where c.id = sleep_logs.user_id
         and c.trainer_id = (select auth.uid())
         and c.wellness_shared
    )
  );

comment on table public.sleep_logs is
  'Hand-typed sleep entries. The member''s own, always. A coach reads them only while that member has turned wellness_shared on for them and is still their client — see sleep_logs_coach_read and part 2670.';


-- ── And the water ──────────────────────────────────────────────────────────
--
-- The same switch, for the reason given in the header: one question, one
-- answer. A coach can already see whether the water HABIT was ticked on a day
-- (`habit_logs_coach_read`, which is the adherence question); this is the
-- running count, which is finer and is the member's to offer.
drop policy if exists hydration_logs_coach_read on public.hydration_logs;
create policy hydration_logs_coach_read on public.hydration_logs
  for select using (
    exists (
      select 1 from public.clients c
       where c.id = hydration_logs.user_id
         and c.trainer_id = (select auth.uid())
         and c.wellness_shared
    )
  );

comment on table public.hydration_logs is
  'Glasses of water per person per local day. The water HABIT tick stays in habit_logs; see 109 for why the count is not a column there. A coach reads these only through wellness_shared — see hydration_logs_coach_read and part 2670.';


-- ── Grants ─────────────────────────────────────────────────────────────────
--
-- RLS narrows a grant; it does not confer one. Part 109 already granted the
-- four verbs on both tables to `authenticated` and revoked `anon`, and a
-- coach is `authenticated` — so the policies above are live without anything
-- further. These statements are restated rather than assumed, because 109's
-- own note records what was measured: this project's default privileges in
-- `public` hand `anon` the full set on every new table, and the two tables
-- below hold a member's sleep and a member's water. Re-revoking is free; being
-- wrong about it is not.
grant select on public.sleep_logs to authenticated;
revoke all on public.sleep_logs from public;
revoke all on public.sleep_logs from anon;

grant select on public.hydration_logs to authenticated;
revoke all on public.hydration_logs from public;
revoke all on public.hydration_logs from anon;
