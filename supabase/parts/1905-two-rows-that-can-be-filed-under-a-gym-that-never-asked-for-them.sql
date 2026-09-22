-- ═══════════════════════════════════════════════════════════════════════════
-- Two rows that can be filed under a gym that never asked for them.
--
-- Both are the same shape and it is the one part 38 named: a row whose
-- `tenant_id` decides who reads it, written by somebody the schema lets choose
-- that value. Neither is a read across the boundary. Both are a WRITE across it,
-- which is the half that gets audited less and shows up on somebody's screen
-- just the same.
--
-- ── ONE: a coach can file themselves onto a gym's staff ───────────────────
--
-- `trainers_self_rw` is `for all using (auth.uid() = id)` — the coach's own row,
-- read and written. `trainers.tenant_id` is NOT NULL and no trigger guards it,
-- which makes it the one identity column in this schema that its subject can
-- set. `clients.tenant_id` has `guard_client_tenant` (part 38);
-- `profiles.tenant_id` and `profiles.role` have `guard_profile_identity`;
-- `sessions.tenant_id` has `guard_session_tenant`. `trainers` has nothing.
--
-- So any signed-in coach can run one ordinary PostgREST call:
--
--     PATCH /rest/v1/trainers?id=eq.<self>   { "tenant_id": "<any gym>" }
--
-- and two policies then act on the value they just chose:
--
--     trainers_owner_r   is_owner_of(tenant_id)
--     trainers_peer_r    my_role() = 'trainer' and tenant_id = my_tenant()
--
-- The target gym's owner console and its coaches read a `trainers` row for
-- somebody who has never worked there, carrying that person's session rate,
-- cancellation policy, brand and logo. Nothing about it looks forged.
--
-- It grants the writer nothing — this is worth being precise about, because it
-- would be easy to over-state. After parts 1060, 1061 and 1900 there is no
-- policy left in this schema that resolves the CALLER's gym through
-- `trainers.tenant_id`; every one of them goes through `staff_tenant_of()`,
-- which reads `profiles`, which the coach cannot change. So this is a write
-- into a gym's staff list and not a read out of it: the gym sees a stranger,
-- the stranger sees nothing.
--
-- What it costs is what a wrong roster costs. `trainers` is what the owner
-- console lists staff from, and a row on it is a person a payroll screen, a
-- rota and a class assignment can all reach for.
--
-- ── TWO: anybody can post into any gym's feedback inbox ───────────────────
--
--     fb_insert   with check (user_id = auth.uid())
--     fb_owner    for select using (is_owner_of(tenant_id))
--
-- `feedback.tenant_id` is nullable and unconstrained on insert. The app fills it
-- from the writer's own profile (`src/ui/appFeedback.ts:24`), which is the
-- correct value and is not enforced anywhere. A signed-in user who supplies a
-- different gym's id has written a row into that gym's owner inbox
-- (`app/(owner)/ops.tsx:494`) under a name and a role of their choosing.
--
-- ── LIVE OR LATENT ───────────────────────────────────────────────────────
--
-- Both LATENT, and for the same reason: they need the target gym's `tenants.id`,
-- and a uuid is not guessable. A user can read their OWN gym's id
-- (`tenants_client_r`, `tenants_trainer_r`) and nobody else's, so this is not a
-- browse-and-choose attack — it is available to somebody who has been handed a
-- gym id, and gym ids travel through join links, invitations and support
-- threads. No forged row exists today: verified on 4 Sep 2026, all 8 `trainers`
-- rows agree with their profile's tenant, and `feedback` holds nothing filed
-- under a gym its author does not belong to.
--
-- Established by reading `pg_policy`, `pg_trigger` and `information_schema`, not
-- by writing anything: this lane's database access is read only.
--
-- ── THE FIX ──────────────────────────────────────────────────────────────
--
-- `guard_trainer_tenant()` is `guard_profile_identity()` with the table changed,
-- deliberately, down to the `current_user in ('authenticated', 'anon')` test and
-- the reason for it: every legitimate way a coach's gym is set —
-- `provision_profile()`, `join_by_code()`, `accept_trainer_invite()`,
-- `accept_invite()` — is SECURITY DEFINER and runs as `postgres`, so the guard
-- is invisible to all of them and refuses only a direct write from the app. The
-- app has no such write: the five places that update `trainers`
-- (`src/ui/coachProfile.tsx`, `src/ui/sessions.tsx`, `src/ui/coachLogo.ts` ×2,
-- `src/ui/coachBrand.ts`) set rate, policy, logo and brand, and none of them
-- names `tenant_id`.
--
-- On INSERT the rule is `= my_tenant()` rather than a flat refusal, because
-- `trainers.tenant_id` is NOT NULL and a rule that no app insert can satisfy is
-- a rule somebody eventually routes around. On UPDATE it is a flat refusal,
-- because a coach's gym changes by joining or by being removed and never by
-- editing the roster row.
--
-- `fb_insert` is re-emitted with the tenant tied to the writer's own, keeping
-- its name, command and roles. `null` stays allowed: the column is nullable, the
-- app leaves it null when a profile read fails, and a null-tenant row is read by
-- nobody, since `is_owner_of(null)` is false.
--
-- ── WHAT THIS DELIBERATELY DOES NOT DO ───────────────────────────────────
--
--   · It does not constrain `feedback.role`, which the app also fills from the
--     writer's profile and which a writer could equally lie about. That is a
--     label on a row already correctly addressed to the writer's own gym, and
--     tying it to `my_role()` would make an owner's console disagree with a
--     record of what somebody's role was at the time they wrote. Named here so
--     it is a decision rather than an oversight.
--
--   · It does not touch `trainers_owner_r` or `trainers_peer_r`. Both are
--     correct policies about a column that is now guarded; the defect was never
--     in the read.
--
--   · It does not backfill or reconcile `trainers.tenant_id` against
--     `profiles.tenant_id`. Part 1900 says why the two are allowed to disagree
--     for a coach who has left, and this must not undo that.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── One: the roster row's gym ────────────────────────────────────────────

create or replace function public.guard_trainer_tenant()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  -- A SECURITY DEFINER function runs as its owner, so provisioning, join codes
  -- and invitations — the legitimate ways a coach's gym is set — all pass. A
  -- direct update from the app does not.
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if new.tenant_id is distinct from public.my_tenant() then
        raise exception 'A coach''s gym is not chosen from the app. It follows the staff record, and that is set by a join code or an invitation.'
          using errcode = '42501';
      end if;
    elsif new.tenant_id is distinct from old.tenant_id then
      raise exception 'A coach cannot move their own roster row between gyms. Joining a gym happens by invitation, and leaving one happens by the owner.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists guard_trainer_tenant_t on public.trainers;
create trigger guard_trainer_tenant_t
  before insert or update on public.trainers
  for each row execute function public.guard_trainer_tenant();

-- ── Two: the feedback row's gym ──────────────────────────────────────────

drop policy if exists fb_insert on public.feedback;
create policy fb_insert on public.feedback
  for insert
  with check (
    user_id = (select auth.uid())
    and (tenant_id is null or tenant_id = public.my_tenant())
  );
