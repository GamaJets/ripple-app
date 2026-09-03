-- ═══════════════════════════════════════════════════════════════════════════
-- A function added four hours ago handed anonymous callers a yes/no on whether
-- a uuid belongs to a registered person.
--
-- ── How this got here ─────────────────────────────────────────────────────
--
-- Part 1901 closed a real hole: a coach could read any user's profile by
-- writing themselves a `coach_clients` row, because the write policy
-- constrained only `trainer_id` and the profile read policy then trusted the
-- row the reader had just written. The fix introduced
-- `coach_roster_row_is_earned()` and granted EXECUTE to `authenticated`,
-- because an RLS policy's function call IS permission-checked against the
-- querying role, so the policy stops working without that grant.
--
-- What it did not do is REVOKE. Postgres grants EXECUTE on a new function to
-- PUBLIC by default, and in a Supabase project PUBLIC includes `anon` — the
-- role every unauthenticated PostgREST request runs as. So the helper became
-- callable at `/rest/v1/rpc/coach_roster_row_is_earned` by anybody at all.
--
-- ── Why that matters, given the body is scoped to auth.uid() ──────────────
--
-- Two of its three branches are scoped and return false for a caller with no
-- session. The FIRST branch is not scoped and does not mention `auth.uid()`:
--
--     not exists (select 1 from public.profiles p where p.id = p_client)
--
-- It is there for the legitimate case of a coach typing a client's name in by
-- hand — a roster row about nobody's account, with nothing to disclose. But
-- read from outside, that is an oracle: pass a uuid, and `true` means no such
-- account exists while `false` means one does. A SECURITY DEFINER function
-- bypasses RLS by construction, so `profiles` being otherwise well-protected
-- does not help.
--
-- It is a narrow leak — uuids are not guessable, so this confirms an id
-- somebody already holds rather than enumerating the table — and it is the
-- kind of thing that is worth closing in the same night it was opened, before
-- it becomes a line nobody remembers writing. It was found by running
-- `get_advisors` after applying, which is the habit this file is really an
-- argument for: a part that adds a function is not finished when the function
-- is correct.
--
-- ── The other seventeen ───────────────────────────────────────────────────
--
-- The same advisor named seventeen more definer functions reachable by `anon`.
-- Each was checked rather than swept:
--
--   · THIRTEEN are trigger functions, confirmed attached to live triggers and
--     returning `trigger`. Calling one over RPC raises "trigger functions can
--     only be called as triggers", so none is exploitable — but a trigger
--     function has no business being in the RPC surface at all, and EXECUTE is
--     not consulted when a trigger fires, so revoking from every role costs
--     nothing. Part 1011 already established exactly this on
--     `gym_event_cost()`; these are its thirteen siblings, left behind.
--
--   · TWO are real RPCs that scope internally — `class_attendance_summary`
--     on both `auth.uid()` and the gym, `my_gym_payment_readiness` on
--     `my_tenant()`. For an anonymous caller both resolve to nothing and both
--     return no rows. They lose `anon` and keep `authenticated`, because
--     relying on an empty answer is relying on the body never changing.
--
--   · TWO are deliberately public and are LEFT ALONE: `public_coach_page()`
--     is the coach's public profile page and `leave_my_details()` is the
--     enquiry form on it. Both are reached by people who have not signed in;
--     that is what they are for. Revoking either would break a real feature,
--     which is why this file lists them rather than quietly sweeping the whole
--     advisor category.
--
-- Idempotent: every statement is a REVOKE or a GRANT, and both are safe to
-- re-run. Nothing here changes a function body, a policy or a row.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── The one added tonight ────────────────────────────────────────────────
--
-- `authenticated` keeps EXECUTE and must: `cc_own`'s WITH CHECK calls this,
-- and an RLS policy whose function the querying role may not execute fails the
-- write outright rather than falling back to permissive.
revoke all on function public.coach_roster_row_is_earned(uuid) from public;
revoke all on function public.coach_roster_row_is_earned(uuid) from anon;
grant execute on function public.coach_roster_row_is_earned(uuid) to authenticated;

-- ── The thirteen trigger functions ───────────────────────────────────────

revoke all on function public.gym_event_equipment_status() from public, anon, authenticated;
revoke all on function public.gym_event_export() from public, anon, authenticated;
revoke all on function public.gym_event_invoice() from public, anon, authenticated;
revoke all on function public.gym_event_membership_status() from public, anon, authenticated;
revoke all on function public.gym_event_month_close() from public, anon, authenticated;
revoke all on function public.gym_event_notice_posted() from public, anon, authenticated;
revoke all on function public.gym_event_payment() from public, anon, authenticated;
revoke all on function public.gym_event_plan_changed() from public, anon, authenticated;
revoke all on function public.gym_event_settlement() from public, anon, authenticated;
revoke all on function public.gym_visits_no_double_entry() from public, anon, authenticated;
revoke all on function public.profiles_queue_file_purge() from public, anon, authenticated;
revoke all on function public.sessions_fill_rate_currency() from public, anon, authenticated;
revoke all on function public.trainer_availability_default_tz() from public, anon, authenticated;

-- ── The two that a signed-in person genuinely calls ──────────────────────

revoke all on function public.class_attendance_summary(timestamp with time zone, timestamp with time zone) from public;
revoke all on function public.class_attendance_summary(timestamp with time zone, timestamp with time zone) from anon;
grant execute on function public.class_attendance_summary(timestamp with time zone, timestamp with time zone) to authenticated;

revoke all on function public.my_gym_payment_readiness() from public;
revoke all on function public.my_gym_payment_readiness() from anon;
grant execute on function public.my_gym_payment_readiness() to authenticated;
