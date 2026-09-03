-- ═══════════════════════════════════════════════════════════════════════════
-- The fallback that WAS the bug.
--
-- Part 1060 reversed a coalesce and declared two policies fixed. It reversed
-- the right coalesce. It did not remove the branch that the defect lives in,
-- and the header of 1060 describes that branch as the legitimate case.
--
-- ── WHAT WAS WRONG ───────────────────────────────────────────────────────
--
-- `revoke_staff_role()` (part 711) takes a coach off a gym's staff by writing
-- exactly one thing:
--
--     update public.profiles set tenant_id = null where id = p_subject;
--
-- It deliberately KEEPS the `trainers` row, and its own comment gives the
-- reason: deleting it would set `clients.trainer_id` null underneath the
-- history. `trainers.tenant_id` is NOT NULL, so after a revocation the coach
-- has two answers to "which gym are you at" — `profiles.tenant_id` says none,
-- `trainers.tenant_id` goes on naming the gym they left, for ever.
--
-- Part 1060 corrected the write triggers and added `staff_tenant_of()`, which
-- reads `profiles` and only `profiles`. Part 1061 repointed eleven policies at
-- it. Both are right and both are applied.
--
-- What 1060 did NOT do is repair `tenant_of_user()`. It rewrote it as:
--
--     select coalesce(
--       (select p.tenant_id from profiles p where p.id = u),   -- live
--       (select t.tenant_id from trainers t where t.id = u)    -- historical
--     );
--
-- and its header says the fallback now only fires "for a subject who has no
-- profile tenant AND is on a roster, which is the case this function was
-- reaching for in the first place."
--
-- That sentence is a precise description of a coach who has just been revoked.
-- No profile tenant, still on the roster, is not an edge case the function was
-- reaching for — it is the ONLY state `revoke_staff_role()` produces, and it is
-- the state the whole 1060/1061 sweep exists to make safe. So the reversal
-- moved the branch from "always wrong" to "wrong in precisely the case that
-- matters", and the two policies 1060 claimed to fix by that line alone are
-- still wrong today:
--
--     coach_clients_owner_r  →  is_owner_of(tenant_of_user(trainer_id))
--     app_errors_owner       →  is_owner_of(tenant_of_user(user_id))
--
-- ── WHAT SOMEBODY COULD ACTUALLY DO ──────────────────────────────────────
--
-- A gym owner removes a coach from their staff. The coach joins a second gym,
-- or goes independent, and builds a new book of clients there.
--
--   · `coach_clients_owner_r` — the FIRST gym's owner keeps a full read of that
--     coach's roster: the id, name, goal and coaching mode of every client the
--     coach has taken on since leaving, at a gym the first owner has no
--     relationship with. This is the cross-tenant read the white-label promise
--     exists to prevent, and it is the same leak part 1061 closed on
--     `sessions`, `client_purchases` and `connect_accounts` — through the one
--     door 1061 was told had already been shut.
--
--   · `app_errors_owner` — the first gym's owner keeps reading the crash and
--     error reports the coach's phone files afterwards, which carry route
--     names, screen state and message text from their work at the new gym.
--
-- ── LIVE OR LATENT ───────────────────────────────────────────────────────
--
-- LATENT, on the same evidence 1060 gave and re-verified on 4 Sep 2026: of 8
-- `trainers` rows, 8 carry a tenant, 0 have a tenant while their profile has
-- none, and 0 disagree with their profile. No owner has yet removed a coach, so
-- no row is in the drifted state and nothing is being disclosed today. It
-- becomes live on the first call to `revoke_staff_role()`, with no further
-- action by anybody, and it discloses silently and continuously from then on.
--
-- ── THE FIX ──────────────────────────────────────────────────────────────
--
-- The branch goes. "Which gym is this person at" has exactly one live answer in
-- this schema and it is `profiles.tenant_id`; a subject with no profile tenant
-- is at no gym, and the honest answer is null, not the last gym they were at.
-- `is_owner_of(null)` is already false, which is the behaviour these two
-- policies want.
--
-- Two changes, and they say the same thing twice on purpose:
--
--   1. The two policies are re-emitted against `staff_tenant_of()`, which is
--      part 1060's own helper and the form all eleven policies in 1061 now use.
--      After this there is no policy anywhere in the schema that resolves a
--      caller's gym through `tenant_of_user()`, so the next person to read 1061
--      does not have to know this function's history to trust the sweep.
--
--   2. `tenant_of_user()` itself is redefined to delegate to `staff_tenant_of()`
--      so that a future policy written in terms of it cannot reintroduce the
--      defect. Signature, return type, volatility, security and search_path are
--      character-for-character the live ones; only the body changes. It becomes
--      an alias, and that is the intent — it is kept rather than dropped
--      because it is granted to `authenticated` and dropping a name from
--      PostgREST is a bigger change than this defect warrants.
--
-- ── WHAT THIS DELIBERATELY DOES NOT DO ───────────────────────────────────
--
--   · It does not clear `trainers.tenant_id` on revocation, and it does not
--     backfill the column. Part 711 refused that for reasons that have not
--     changed and part 1060 restated them: the column is NOT NULL and it is
--     load-bearing for history. The column stays; the QUESTION moved.
--
--   · It does not touch `revoke_staff_role()`. That function's closing comment
--     asserts clearing the profile tenant "is what actually removes the
--     access". After this part that assertion is finally true for these two
--     policies; before it, it was not.
--
--   · It does not widen either policy. A gym owner reads the same rows they
--     read before for every coach currently on their staff, because for those
--     coaches the two columns agree and the fallback never fired.
--
--   · It does not address the OTHER defect on `coach_clients` — that the row a
--     coach is read through is one the coach can issue to themselves. That is a
--     different mechanism with a different fix and it is part 1901.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── The function ─────────────────────────────────────────────────────────
--
-- Was: coalesce(profiles.tenant_id, trainers.tenant_id) — falling through to
-- the historical column for a subject with no profile tenant, which is exactly
-- a revoked coach.
-- Now: profiles.tenant_id, via part 1060's helper. One answer, from the column
-- `revoke_staff_role()` writes.

create or replace function public.tenant_of_user(u uuid)
returns uuid
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select public.staff_tenant_of(u);
$$;

-- ── The two policies ─────────────────────────────────────────────────────
--
-- Re-emitted in part 1061's form. Each keeps its name, its command, its roles
-- and its shape; the only change is that the gym is resolved by the helper that
-- reads the live column, said out loud rather than hidden one call deeper.

drop policy if exists coach_clients_owner_r on public.coach_clients;
create policy coach_clients_owner_r on public.coach_clients
  for select
  using (public.is_owner_of(public.staff_tenant_of(trainer_id)));

drop policy if exists app_errors_owner on public.app_errors;
create policy app_errors_owner on public.app_errors
  for select
  using (public.is_owner_of(public.staff_tenant_of(user_id)));
