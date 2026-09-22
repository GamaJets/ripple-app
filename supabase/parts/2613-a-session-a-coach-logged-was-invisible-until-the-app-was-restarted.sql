-- A session a coach logged was invisible until the client restarted the app.
--
-- ── The report ─────────────────────────────────────────────────────────────
--
-- "Dayne recorded a workout session for me today and I don't see it in my
-- client app."
--
-- In that instance the write had not landed at all, which is a separate fault.
-- But investigating it turned up a gap that would have hidden a SUCCESSFUL
-- coach write for hours, and that is the worse failure of the two: the coach
-- would have had every reason to believe they had logged it, the client every
-- reason to believe they had not, and nothing on either screen to settle it.
--
-- ── Why the client could not see it ────────────────────────────────────────
--
-- A coach's insert sets `workouts.user_id` to the CLIENT, so the row is part of
-- the client's own log — their streak, their personal records, their week's
-- volume, their weekly report. `workouts_own` lets them read it and
-- `workouts_coach_insert` let the coach write it. Nothing was wrong with the
-- data or the policies.
--
-- What was missing is that the client's phone was never told. src/ui/workoutLog.tsx
-- hydrates on `[reloadTick, authRev]` — mount, a change of account, or an
-- explicit reload — and `workouts` is not in `supabase_realtime`, so there was
-- no third way to find out. The client saw the session on their next cold
-- start or pull-to-refresh, whichever came first.
--
-- ── What this part changes, and what it deliberately does not ─────────────
--
-- `workouts` joins the publication so a client's own rows can be watched. The
-- app subscribes with `filter: user_id=eq.<their id>`, which is evaluated on
-- the server, so a phone is never sent anybody else's sets — and Realtime
-- applies RLS to `postgres_changes` besides, so `workouts_own` is the floor
-- under that filter rather than the filter being the only thing standing there.
--
-- INSERT ONLY, on the app's side. src/ui/workoutLog.tsx subscribes to inserts
-- and ignores any row whose `logged_by` is null or is the member themselves,
-- because that provider inserts optimistically and adopts the ids the server
-- returns — refetching on top of that races the adoption over one list. Only a
-- row somebody ELSE wrote is news.
--
-- REPLICA IDENTITY IS LEFT AT DEFAULT, on purpose. Setting it to FULL would put
-- the whole old row into every UPDATE and DELETE in the WAL, on the
-- fastest-growing table in this database — one row per SET, four sessions a
-- week at twenty sets apiece — to deliver one thing the app does not currently
-- use: enough of a deleted row to tell a coach's deletion from the member's
-- own. A coach deleting a set is therefore not pushed, and the client sees it
-- on their next foreground. That is a stated limitation, not an oversight; the
-- day it matters, this comment is where to start.
--
-- Adding a table to a publication is not a privilege change: nothing here
-- grants anybody a row they could not already select, and every subscriber is
-- still filtered by `workouts_own` / `workouts_coach_read`.
--
-- ── Verified end to end, and one wrong turn on the way ───────────────────
--
-- With this applied, a row inserted for the signed-in member by somebody else
-- reached the app while it sat untouched in the foreground: the subscription
-- delivered it, the debounce collapsed it into one refetch, and the member's
-- own Home went from "0 day streak · 0 of 3 this week" to "1 day streak · 1 of
-- 3 this week" with nothing tapped.
--
-- REPLICA IDENTITY DEFAULT is confirmed sufficient for this, which is the claim
-- made above and it is worth saying it was actually checked. It was briefly set
-- to FULL during the investigation on the theory that Realtime needed the
-- non-primary-key `user_id` present to evaluate `workouts_own`. That was wrong,
-- and it was wrong because the test behind it was invalid: the phone under test
-- was signed in as a DIFFERENT account from the one the rows were being written
-- for, so nothing could ever have arrived. FULL was reverted once the test was
-- corrected and delivery worked without it. Recorded because the next person to
-- see an empty subscription will reach for the same theory.

do $$
begin
  -- Idempotent, because every part in this directory is replayed from scratch
  -- by scripts/build-supabase-setup.mjs into supabase/setup.sql, and
  -- `alter publication ... add table` errors rather than no-ops when the table
  -- is already a member.
  if not exists (
    select 1
    from pg_publication p
    join pg_publication_rel pr on pr.prpubid = p.oid
    join pg_class c on c.oid = pr.prrelid
    join pg_namespace n on n.oid = c.relnamespace
    where p.pubname = 'supabase_realtime'
      and n.nspname = 'public'
      and c.relname = 'workouts'
  ) then
    alter publication supabase_realtime add table public.workouts;
  end if;
end
$$;
