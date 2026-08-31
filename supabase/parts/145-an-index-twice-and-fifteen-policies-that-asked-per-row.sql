-- ─────────────────────────────────────────────────────────────────────────
-- The index that existed twice, and fifteen policies that asked who you were
-- once per row.
--
-- Both of these are performance only. Neither changes who can read or write
-- anything, and the second one is written so that it demonstrably cannot.
--
-- ── 1 · idx_exercise_videos_exercise_id ───────────────────────────────────
--
-- exercise_videos carried two indexes on the same column. "Reported identical"
-- is not the same as identical, so they were compared field by field out of
-- pg_index rather than by name: same table, same access method (btree), same
-- indkey (2 — exercise_id), same operator class (3126), same indoption (0, so
-- same sort direction and NULLS ordering), same collation (100), both
-- non-unique, both non-primary, both valid, neither partial (indpred null),
-- and neither backing a constraint. They are the same index twice.
--
-- Which one to drop was decided by evidence, not by name. 49-exercise-video-
-- library.sql declares idx_exercise_videos_exercise, and that is the one the
-- planner has actually been using: 974 scans against 0 for the other. The
-- orphan is the live-only one that no file ever declared, it has never served
-- a query, and dropping it puts the database back in agreement with the repo.
--
-- ── 2 · fifteen auth_rls_initplan policies ────────────────────────────────
--
-- Each of these called auth.uid(), auth.jwt() or auth.role() unwrapped inside
-- a policy predicate, which makes Postgres re-evaluate it for every row it
-- tests. Wrapping the call in a scalar subquery turns it into an InitPlan:
-- computed once per statement, then compared against each row.
--
-- This is safe here for a reason worth writing down rather than assuming.
-- Hoisting an expression out of a per-row loop is only sound if the expression
-- is row-independent AND constant for the statement. All three auth functions
-- were checked in pg_proc and all three are STABLE, which is exactly that
-- guarantee. None of them reads a column, so none of them can vary by row.
--
-- The rewrites are otherwise character-for-character faithful, including the
-- two details that would have been easy to smooth over and would have changed
-- behaviour if they had been:
--
--   · mi_invitee_read uses NULLIF where its two siblings use COALESCE. NULLIF
--     turns an empty email claim into NULL, so the comparison is NULL and the
--     row is refused; COALESCE turns it into '' and compares. Preserved as
--     found — member_invites keeps NULLIF, coach_invites and trainer_invites
--     keep COALESCE.
--   · coach_checklist_coach_write and workouts_coach_insert also call
--     is_my_client(), which takes a COLUMN as its argument and therefore is
--     row-dependent and cannot be hoisted. Only the auth.uid() half moves.
--     Same for profiles_trainer_r_clients, where the auth.uid() being hoisted
--     is the one inside the EXISTS.
--
-- Verified, not assumed. The same harness described in 144: fixtures seeded on
-- all eleven affected tables, all 20 real users impersonated, and for each one
-- the exact set of visible rows recorded on 13 tables before and after all
-- fifteen rewrites — then 21 write probes per user covering the INSERT-only
-- policies (fb_insert, workouts_coach_insert) that a read sweep cannot reach.
-- Zero users saw a different row set on any table. Zero write outcomes
-- changed. The probes discriminated: coaches could insert a workout for their
-- own client and were refused for a stranger, users could insert their own
-- feedback and were refused somebody else's, and those answers were identical
-- on both sides of the rewrite. Whole thing inside a rolled-back transaction.
--
-- session_waitlist_service_rw is the one case with no rows to test against —
-- session_waitlist and sessions are both empty. It got a different proof, and
-- a complete one: its predicate references no column at all, so it is constant
-- for the whole statement, and both forms were evaluated under anon,
-- authenticated and service_role and agreed in all three — including the TRUE
-- case, which is the one that matters. (service_role holds BYPASSRLS anyway,
-- so this policy has never been what grants it access.)
--
-- Idempotent, drop-and-create. A no-op against live, where it has been run.
-- ─────────────────────────────────────────────────────────────────────────

-- ═══ 1 · the duplicate index ══════════════════════════════════════════════

drop index if exists public.idx_exercise_videos_exercise_id;

-- ═══ 2 · auth.<fn>() hoisted to an InitPlan, fifteen times ════════════════

-- NULLIF, not COALESCE. See the header.
drop policy if exists mi_invitee_read on public.member_invites;
create policy mi_invitee_read on public.member_invites for select
  using (lower(email) = lower(NULLIF(((select auth.jwt()) ->> 'email'::text), ''::text)));

drop policy if exists ci_invitee_read on public.coach_invites;
create policy ci_invitee_read on public.coach_invites for select
  using (lower(email) = lower(COALESCE(((select auth.jwt()) ->> 'email'::text), ''::text)));

drop policy if exists ti_invitee_read on public.trainer_invites;
create policy ti_invitee_read on public.trainer_invites for select
  using (lower(email) = lower(COALESCE(((select auth.jwt()) ->> 'email'::text), ''::text)));

drop policy if exists fb_insert on public.feedback;
create policy fb_insert on public.feedback for insert
  with check (user_id = (select auth.uid()));

drop policy if exists fb_own on public.feedback;
create policy fb_own on public.feedback for select
  using (user_id = (select auth.uid()));

drop policy if exists settlements_trainer_read on public.payroll_settlements;
create policy settlements_trainer_read on public.payroll_settlements for select
  using (trainer_id = (select auth.uid()));

-- Only the auth.uid() inside the EXISTS hoists; my_role() stays where it is.
drop policy if exists profiles_trainer_r_clients on public.profiles;
create policy profiles_trainer_r_clients on public.profiles for select
  using ((my_role() = 'trainer'::text) and (exists (select 1 from coach_clients
    where coach_clients.trainer_id = (select auth.uid()) and coach_clients.id = profiles.id)));

drop policy if exists session_waitlist_service_rw on public.session_waitlist;
create policy session_waitlist_service_rw on public.session_waitlist for all
  using ((select auth.role()) = 'service_role'::text);

drop policy if exists coach_checklist_client_read on public.coach_checklist_items;
create policy coach_checklist_client_read on public.coach_checklist_items for select
  using (client_id = (select auth.uid()));

-- is_my_client() takes a column and cannot be hoisted. Only the uid half moves.
drop policy if exists coach_checklist_coach_write on public.coach_checklist_items;
create policy coach_checklist_coach_write on public.coach_checklist_items for all
  using ((coach_id = (select auth.uid())) and is_my_client(client_id))
  with check ((coach_id = (select auth.uid())) and is_my_client(client_id));

drop policy if exists coach_exercises_self on public.coach_exercises;
create policy coach_exercises_self on public.coach_exercises for all
  using (coach_id = (select auth.uid()))
  with check (coach_id = (select auth.uid()));

drop policy if exists workouts_coach_insert on public.workouts;
create policy workouts_coach_insert on public.workouts for insert
  with check (is_my_client(user_id) and (logged_by = (select auth.uid())));

drop policy if exists goal_targets_own on public.goal_targets;
create policy goal_targets_own on public.goal_targets for all
  using (client_id = (select auth.uid()))
  with check (client_id = (select auth.uid()));

drop policy if exists planned_days_own on public.planned_days;
create policy planned_days_own on public.planned_days for all
  using (client_id = (select auth.uid()))
  with check (client_id = (select auth.uid()));

-- 38-tenant-isolation.sql created this with a bare auth.uid(). 144 dropped its
-- duplicate exvid_write, which already had the hoisted form; this brings the
-- survivor up to it so nothing was lost in the trade.
drop policy if exists exvid_trainer_rw on public.exercise_videos;
create policy exvid_trainer_rw on public.exercise_videos for all
  using (trainer_id = (select auth.uid()))
  with check (trainer_id = (select auth.uid()));
