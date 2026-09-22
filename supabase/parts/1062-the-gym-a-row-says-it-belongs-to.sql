-- ═══════════════════════════════════════════════════════════════════════════
-- The gym a row says it belongs to, written by the person the row is about.
--
-- ── WHAT WAS WRONG ───────────────────────────────────────────────────────
--
-- This schema pins identity columns with BEFORE triggers, not with policies,
-- and it does so because a row policy can only say WHICH ROWS you may touch —
-- it cannot say which COLUMNS of them. Two such guards already exist and are
-- exactly right:
--
--   · `guard_profile_identity` refuses an end-user change to `profiles.role`
--     or `profiles.tenant_id`. "A profile cannot move itself between gyms."
--   · `guard_client_trainer_link` refuses an end-user change to
--     `clients.trainer_id`. "A client cannot set their own coach."
--
-- Both are right, both are load-bearing, and between them they cover the two
-- columns somebody thought to protect. `clients.tenant_id` and
-- `sessions.tenant_id` were not on the list, and both are freely writable by an
-- ordinary account through policies that were only ever checking WHOSE row it
-- is:
--
--   · `client_self` is `FOR ALL using (id = auth.uid())`, so a member may
--     UPDATE every unguarded column of their own `clients` row.
--   · `clients_trainer_update` is `using/with check (trainer_id = auth.uid())`,
--     so a coach may UPDATE every unguarded column of their clients' rows.
--   · `sessions_trainer` is `FOR ALL using/with check (trainer_id =
--     auth.uid())`, so a coach may write every unguarded column of their own
--     sessions, at INSERT as well as UPDATE.
--
-- `trg_sessions_fill_tenant` fires BEFORE INSERT ONLY, and only when the caller
-- left the column null. A caller who supplies a value keeps it.
--
-- ── WHAT SOMEBODY COULD ACTUALLY DO ──────────────────────────────────────
--
-- `tenant_id` on these two tables is not a label. It is the left-hand side of
-- the owner policies — `clients_owner_r` is `is_owner_of(tenant_id)`,
-- `charges_owner_r` joins `clients.tenant_id`, and `sessions_gym_owner_r/u/d`
-- are all `tenant_id is not null and is_owner_of(tenant_id)`. Writing it is
-- choosing who may read the row.
--
--   1 · Defeating a refusal the product makes on purpose. `revoke_staff_role()`
--       will not remove a coach who still has clients on their book, and its
--       error message explains precisely why: "Removing them from the staff
--       would NOT remove their access to those clients' training and health
--       record, because that access follows the book and not the gym." The
--       count it refuses on is
--
--           clients c where c.trainer_id = p_subject and c.tenant_id = v_tenant
--
--       A coach who blanks `tenant_id` on their clients drops that count to
--       zero. The owner's removal then succeeds, the owner is told it
--       succeeded, and the coach keeps a complete read of those people's health
--       history for ever — because `is_my_client()` follows `clients.trainer_id`,
--       which the existing guard protects and which nobody had to touch. The
--       refusal is turned into its own bypass, and the gym is told the opposite
--       of what happened.
--
--   2 · Cross-tenant disclosure, in one UPDATE. A coach — or a member on their
--       own row — sets `tenant_id` to another gym's uuid. That gym's owner can
--       now read the client row and, through `charges_owner_r`, the charges
--       against it. Repple is white-label; this is the one thing the tenant
--       column exists to prevent.
--
--   3 · Cross-tenant WRITE, on sessions. `sessions_gym_owner_u` and
--       `sessions_gym_owner_d` are UPDATE and DELETE. A coach who points a
--       session's `tenant_id` at another gym hands that gym's owner the ability
--       to alter or delete it.
--
--   4 · Hiding from your own gym. Blanking `sessions.tenant_id` removes the
--       session from `sessions_gym_owner_r`, which requires `tenant_id is not
--       null`. Sessions the gym is owed a cut of stop appearing in the gym's
--       own reporting.
--
-- None of this needs anything but a signed-in account and one PostgREST call.
--
-- ── WHY IT IS SHAPED THIS WAY ────────────────────────────────────────────
--
-- The `current_user in ('authenticated', 'anon')` test is copied deliberately
-- from the two guards already in the schema rather than invented. Under
-- PostgREST every signed-in request runs as the shared `authenticated` role and
-- every unauthenticated one as `anon`, so those two names are the complete set
-- of end-user callers. A SECURITY DEFINER function runs as its OWNER, so
-- `current_user` inside one is not in that set and the guard stands aside —
-- which is what makes the legitimate paths keep working without being
-- enumerated here. `join_by_code()`, `accept_member_invite()`,
-- `accept_trainer_invite()`, `link_coaching()`, `provision_profile()` and
-- `_materialise_session_series()` are all SECURITY DEFINER and all pass
-- untouched.
--
-- This is the one place `current_user` is a sound test, and it is worth saying
-- why, because the same expression in a POLICY would be a serious defect: a
-- policy written `current_user = ...` would be comparing against the shared
-- role every signed-in request already has, and would therefore grant to
-- everybody. Here it is not deciding whether a caller is a particular PERSON —
-- `auth.uid()` does that. It is deciding whether the write arrived through the
-- REST surface or through a function that has already done its own checking,
-- and role identity is exactly the right question for that.
--
-- UPDATE refuses a change; INSERT computes the value instead. The asymmetry is
-- deliberate. Forcing the value on UPDATE would silently re-stamp a historical
-- session onto whatever gym its coach is at TODAY the next time anybody touched
-- it — moving last quarter's revenue between two gyms' books as a side effect
-- of marking an outcome. Refusing on UPDATE keeps history where it was written.
-- On INSERT there is no history to preserve and no reason to accept a value
-- from the caller at all: `staff_tenant_of()` computes exactly what
-- `trg_sessions_fill_tenant` would have computed, so the row lands where it
-- belongs whether the caller sent a tenant, sent the wrong one, or sent none.
--
-- On `clients` the INSERT rule is a flat refusal of a non-null tenant rather
-- than a computed value, because a member does not choose their gym by
-- inserting a row — they join one, and joining is `join_by_code()` or an
-- invitation, both of which are SECURITY DEFINER and both of which set the
-- column themselves.
--
-- Independent coaches are unaffected in every branch: `staff_tenant_of()`
-- returns null for them, a null tenant is what their rows already carry, and
-- every owner policy on both tables fails closed on null.
--
-- ── WHAT THIS CHANGES FOR ANY EXISTING SCREEN ────────────────────────────
--
-- Nothing that was doing the right thing. The coach app and the member app do
-- not send `tenant_id` on either table — it is a column the database fills —
-- so the INSERT branches compute the value those rows were already getting, and
-- the UPDATE branches refuse a write neither client makes. A screen that DID
-- start sending a tenant would now get a 42501 with a sentence explaining it,
-- which is the correct outcome and the reason the message is written for a
-- person rather than a log.
--
-- Idempotent and safe to re-run: `create or replace function` replaces the
-- bodies in place, and each trigger is dropped with `if exists` before being
-- created, so a second run lands on the same two triggers.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── clients ──────────────────────────────────────────────────────────────
--
-- SECURITY INVOKER on purpose — the same as the two guards it sits beside. The
-- whole mechanism depends on `current_user` still being the CALLER's role when
-- this runs; making it SECURITY DEFINER would set `current_user` to the owner
-- and the guard would disable itself on every call.

create or replace function public.guard_client_tenant()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if new.tenant_id is not null then
        raise exception 'A member cannot file themselves under a gym. Joining a gym happens by a join code or an invitation.'
          using errcode = '42501';
      end if;
    elsif new.tenant_id is distinct from old.tenant_id then
      -- Blanking this is how a coach makes revoke_staff_role() believe their
      -- book is empty. Pointing it elsewhere is how a row reaches another
      -- gym's owner. Both are the same write, so both are refused here.
      raise exception 'A client''s gym cannot be changed from the app. It follows the membership, and the membership is changed by joining or by the gym owner.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists guard_client_tenant_t on public.clients;
create trigger guard_client_tenant_t
  before insert or update on public.clients
  for each row execute function public.guard_client_tenant();

-- ── sessions ─────────────────────────────────────────────────────────────

create or replace function public.guard_session_tenant()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      -- Computed, never accepted. This is the value trg_sessions_fill_tenant
      -- would have reached for anyway; taking it here as well means a caller
      -- who supplies a tenant does not get to keep it. Null for an independent
      -- coach, which every owner policy on this table fails closed on.
      new.tenant_id := public.staff_tenant_of(new.trainer_id);
    elsif new.tenant_id is distinct from old.tenant_id then
      -- Refused rather than recomputed: a session belongs to the gym it was
      -- delivered under, and re-stamping it on a later edit would move settled
      -- revenue between two gyms' books.
      raise exception 'A session''s gym is set when the session is created and does not move afterwards.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists guard_session_tenant_t on public.sessions;
create trigger guard_session_tenant_t
  before insert or update on public.sessions
  for each row execute function public.guard_session_tenant();
