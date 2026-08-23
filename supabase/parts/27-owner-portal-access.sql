-- Owner portal reads.
--
-- `profiles.role = 'owner'` means a GYM owner, scoped to their tenant — the
-- meaning the rest of the policies already assumed via is_owner_of(tenant_id).
-- Reading the live policies, an owner can already see their tenant's profiles,
-- clients, trainers and the tenant row itself. One table was missing.
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
