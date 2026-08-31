-- Owner portal reads.
--
-- `profiles.role = 'owner'` means a GYM owner, scoped to their tenant — the
-- meaning the rest of the policies already assumed via is_owner_of(tenant_id).
-- Reading the live policies, an owner can already see their tenant's profiles,
-- clients, trainers and the tenant row itself. One table was missing.
--
-- ── THAT SENTENCE WAS WRONG, and 38 is where it was caught ────────────────
--
-- It was written from the LIVE policy list, which had drifted from the repo. Of
-- the checked-in policies at this point there was no owner arm on `profiles` at
-- all (only profiles_self and three trainer-scoped ones) and none on `clients`
-- either — `clients_owner_r` turns up as live-only drift in part 142. So an
-- owner reading their own members' profiles got an empty list, which the Studio
-- members search renders as "nobody matches" rather than "you may not ask".
--
-- 38-tenant-isolation.sql section 8 quotes this very line and adds
-- `profiles_owner_r`. The sentence is kept rather than deleted because reading
-- these parts in order is how the schema is learnt, and an unqualified claim
-- here sends somebody looking for a policy that does not exist until 38.
--
-- Without this an owner cannot read sessions at all, so "sessions delivered"
-- and any payroll figure derived from it have nothing behind them. The portal
-- would show zero and the zero would be a permissions artefact rather than a
-- fact about the gym — which is the exact failure this codebase keeps removing.

drop policy if exists sessions_owner_r on sessions;
create policy sessions_owner_r on sessions
  for select using (
    exists (
      select 1 from trainers t
       where t.id = sessions.trainer_id
         and is_owner_of(t.tenant_id)
    )
  );
