-- ═══════════════════════════════════════════════════════════════════════════
-- Every signed-in account could read every listed coach's trial start date
-- ═══════════════════════════════════════════════════════════════════════════
-- APPLIED. Verified after: information_schema reports NO select grant on
-- public.trainers.trial_started_at for anon or authenticated, and the
-- anon-executable SECURITY DEFINER set is still exactly leave_my_details and
-- public_coach_page. src/ui/trialAccount.ts already reads through the RPC with
-- a fallback, so the two halves were safe to land in either order.
--
--
-- NOT APPLIED. Written to be applied by hand. Every fact below was read out of
-- the live database on 5 Sep 2026 with pg_policies and
-- information_schema.column_privileges — not out of the parts.
--
-- ── The chain, exactly as it stands live ──────────────────────────────────
--
--   public.trainers, rls enabled. Among its five policies:
--
--     trainers_public_directory_r   FOR SELECT   TO authenticated
--                                   USING (listed = true)
--
--   and, because part 131 took the TABLE-level SELECT away on purpose, the
--   grant is column by column. `authenticated` holds SELECT on:
--
--     bio, brand_color, brand_name, currency, delivery_mode, id,
--     late_cancel_applies, late_cancel_fee, late_cancel_notice_hours, listed,
--     logo_path, offers, public_handle, public_page, session_fee, specialties,
--     tagline, tenant_id, trial_started_at
--
--   Part 2200 added the last of those. It fixed a real defect — every coach on
--   the platform was being told their own trial start date could not be read,
--   29 REST 403s in 24 hours — and it granted the column to `authenticated`.
--
-- A row policy selects ROWS; the grant selects COLUMNS. Put together, the two
-- mean: any account with a session, on any of the three apps, can ask
--
--     GET /rest/v1/trainers?select=id,trial_started_at&listed=eq.true
--
-- and be answered for every coach in the directory.
--
-- ── Why this is the defect part 2200 itself named ────────────────────────
--
-- That part's own footnote refuses to grant the one remaining column for
-- precisely this reason, in these words:
--
--     Part 131 took it off the directory because every signed-in account could
--     otherwise read every listed coach's code, and this table's column-by-column
--     grant exists for that one reason.
--
-- The argument is correct and it was applied to `join_code`. It was not applied
-- to `trial_started_at`, in the same part, four lines further down. This is that
-- omission and nothing else.
--
-- ── What a person suffers ─────────────────────────────────────────────────
--
-- A coach's trial start date is commercial information about a named person:
-- whether they are still inside a free trial, and how long they have been on
-- the platform. It is not directory information — no screen in any of the three
-- apps renders another coach's trial — and the coach never chose to publish it.
-- `trainers.listed = true` is consent to appear in Find a Trainer with a bio, a
-- tagline, specialties and a rate. It is not consent to this.
--
-- The audience is every account with a session, which includes rival coaches:
-- anyone can sign up for the coach app.
--
-- Counted live on 5 Sep 2026: 2 listed trainers, both currently exposed.
--
-- ── The fix, and why it is a revoke plus an RPC rather than a policy ──────
--
-- RLS cannot help here. A policy filters rows and this is a column, which is
-- the whole reason part 131 moved this table to column-by-column grants in the
-- first place. There is no narrower policy to write.
--
-- So the column comes off `authenticated` entirely and the ONE read that needs
-- it — `fetchAccountTrial()` in src/ui/trialAccount.ts, which reads the
-- caller's own row and nobody else's — goes through a definer function that
-- can only ever answer about `auth.uid()`. That is the same move part 2200
-- describes for `join_code`: "read back through `my_join_code()`".
--
-- Ordering is safe in both directions. The app change that accompanies this
-- part calls `my_trial_started_at()` and falls back to the column read when the
-- function is not there yet, so an app shipped before this is applied keeps
-- working, and this applied before the app ships leaves the fallback refused
-- and the RPC answering.
--
-- Idempotent; safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════
-- 1 · The caller's own trial start, and nobody else's
-- ═════════════════════════════════════════════════════════════════════════
--
-- `auth.uid()` is read inside the body and is not a parameter, so there is no
-- id a caller can pass to ask about somebody else. A signed-out caller gets
-- null rather than an error: `fetchAccountTrial()` treats no row as "you have
-- not got a trial", which is the correct answer for an account with no
-- `trainers` row, and the app's own auth gate is what stops a signed-out
-- session reaching this at all.

create or replace function public.my_trial_started_at()
returns timestamptz
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select t.trial_started_at
    from public.trainers t
   where t.id = (select auth.uid());
$function$;

revoke execute on function public.my_trial_started_at() from public, anon;
grant execute on function public.my_trial_started_at() to authenticated;


-- ═════════════════════════════════════════════════════════════════════════
-- 2 · The column comes off the directory
-- ═════════════════════════════════════════════════════════════════════════
--
-- grant-ok: public.trainers.trial_started_at — withheld deliberately, and read
--   back through `my_trial_started_at()`. `trainers_public_directory_r` is
--   `USING (listed = true)` for every authenticated account, so a column grant
--   on this table is a publication to every account on the platform. Part 131
--   is why this table is granted column by column at all; parts 2200 and 2471
--   are the two halves of the same argument.

revoke select (trial_started_at) on public.trainers from authenticated, anon;


-- ═════════════════════════════════════════════════════════════════════════
-- 3 · What to check after applying
-- ═════════════════════════════════════════════════════════════════════════
--
--   · the column is gone from the directory's reach:
--
--       select privilege_type
--         from information_schema.column_privileges
--        where table_schema = 'public' and table_name = 'trainers'
--          and column_name = 'trial_started_at' and grantee = 'authenticated';
--
--     expected: no rows.
--
--   · the anon-executable SECURITY DEFINER set is still exactly two
--     (leave_my_details, public_coach_page).
--
--   · `select * from public.get_advisors('security')` is clean.
