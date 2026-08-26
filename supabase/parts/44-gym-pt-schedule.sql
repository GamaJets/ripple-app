-- ── One-to-ones on the gym's own timetable ──────────────────────────────────
--
-- Phase 1, the half that was still open. The gym's board (studio-web
-- /timetable) showed classes only, so at 18:00 an owner saw three classes and
-- had no way to know that four trainers were also on the floor with clients,
-- or that the studio was holding a class and a one-to-one at the same hour.
-- The booking half of PT lived in the trainer's private calendar; only the
-- outcome and payroll half (33, 36) had ever reached the gym.
--
-- ── WHY `sessions` AND NOT A NEW TABLE ──────────────────────────────────────
--
-- A one-to-one already IS a row in `sessions`: trainer, client, starts_at,
-- duration_min, and the slot's status — plus, since 33-session-outcomes.sql,
-- its tenant, its delivery outcome, the rate snapshotted at delivery, and (36)
-- the payroll run that paid for it.
--
-- The booking and the outcome are the same appointment. A parallel
-- `pt_bookings` table would fork them: payroll prices `sessions`
-- (src/lib/gymSessions.ts), so anything scheduled into a second table is
-- either invisible to payroll, or has to be copied into `sessions` as well —
-- two rows for one hour, which is how a gym ends up paying twice, or not at
-- all. It would also duplicate the tenant backfill, the fill-tenant trigger,
-- the outcome stamping and six RLS policies, and then have to keep all of it
-- in step with the original by hand.
--
-- So this part adds only what a *gym-owned* timetable needs and `sessions`
-- does not already have: where in the building the hour happens, and the right
-- for the gym — not only the trainer — to put a slot on the board and take one
-- off again.

-- ── where on the floor ──────────────────────────────────────────────────────
-- gym_classes has carried `room` since 02-domain-schema.sql. Without the same
-- column here, the single most useful question a merged board can answer —
-- "is the studio double-booked at six?" — cannot be asked at all, because half
-- the things in the room are not on the board.
alter table public.sessions add column if not exists room text;

-- The timetable reads a week at a time, per gym. idx_sessions_tenant
-- (33-session-outcomes.sql) is (tenant_id, starts_at desc) and Postgres scans
-- it backwards for an ascending window, so no second index is added here.


-- ── the gym may schedule, not only observe ──────────────────────────────────
--
-- 33-session-outcomes.sql gave the owner SELECT and UPDATE: they could read
-- the record and correct an outcome that was wrong. There was no INSERT and no
-- DELETE, so an owner could not put a one-to-one on their own timetable at
-- all. The slot had to be created by the trainer, in the trainer's calendar —
-- which is precisely the split this part exists to close.
--
-- WHY THE CHECK REACHES THE TENANT THROUGH `trainers` rather than testing
-- sessions.tenant_id directly, for two independent reasons:
--
--   * trg_sessions_fill_tenant copies tenant_id FROM the named trainer. So a
--     `is_owner_of(tenant_id)` check would be testing a value derived from the
--     row being written: name another gym's trainer and tenant_id becomes that
--     gym's, and the check would be asked about the wrong gym. Asking
--     "is this trainer mine?" cannot be steered that way.
--   * it does not depend on when the BEFORE INSERT trigger runs relative to
--     the WITH CHECK, which is a detail no policy should rest on.
--
-- The inline join is safe to write: `trainers` has trainers_owner_r
-- (23-trainer-directory.sql), so an owner can read the row the join needs, and
-- is_owner_of() has been SECURITY DEFINER since 28-fix-profiles-recursion.sql
-- so it does not re-enter RLS on profiles.
drop policy if exists sessions_gym_owner_i on public.sessions;
create policy sessions_gym_owner_i on public.sessions
  for insert with check (
    exists (select 1 from public.trainers tr
             where tr.id = sessions.trainer_id and is_owner_of(tr.tenant_id)));

-- Taking a slot back off the board. Scoped to the gym that owns it; the
-- protection for slots that have become part of the record is the trigger
-- below, not this policy, for the reason given there.
drop policy if exists sessions_gym_owner_d on public.sessions;
create policy sessions_gym_owner_d on public.sessions
  for delete using (tenant_id is not null and is_owner_of(tenant_id));


-- ── a session that has been marked or paid is a record, not a plan ──────────
--
-- Deleting one destroys the evidence behind a payroll line. The settlement row
-- survives with its amount and its sessions_count, but the sessions it covered
-- are gone, so the run can never be reconciled against the work again — and
-- settleableSessions() only ever knew a session was already paid because the
-- row carried a settlement_id.
--
-- Both the owner's new DELETE right above and the trainer's existing
-- sessions_trainer policy (09-sessions-access.sql, FOR ALL — which has always
-- included DELETE) could do it today.
--
-- WHY A TRIGGER RATHER THAN A NARROWER POLICY: RLS filters rows out silently.
-- A policy of `using (... and outcome is null)` would make the delete affect
-- zero rows and return no error, so a caller that checked only `.error` — the
-- house pattern — would report "removed" for a session that is still there.
-- Raising says no out loud, and says which of the two reasons it was.
--
-- WHY THE current_user TEST, exactly as in 38-tenant-isolation.sql: a
-- SECURITY DEFINER function runs as its owner, an app request runs as
-- `authenticated` or `anon`. action_account_deletion() (41) deletes auth.users
-- and relies on the cascade reaching sessions; that path must not start
-- raising because a trainer once had a session settled. Erasure stays
-- unblocked; the app cannot quietly rewrite payroll history.
-- NOT security definer, and that is the whole point.
--
-- `current_user` inside a SECURITY DEFINER function reports the function's
-- OWNER, not the caller. This was written as definer, which made current_user
-- always 'postgres', so the guard below could never be true and the trigger
-- silently protected nothing — a control that looks real and does nothing,
-- which is the exact class of fault recorded at the end of the runbook.
--
-- Verified against the live database rather than reasoned about:
--   set local role authenticated;
--   select current_user, _probe_invoker(), _probe_definer();
--   -> authenticated | authenticated | postgres
--
-- As an invoker function it needs no elevated rights: it only reads OLD and
-- raises. The guard still lets action_account_deletion()'s cascade through,
-- because that runs as postgres and so fails the in ('authenticated','anon')
-- test — which is the behaviour that was wanted.
create or replace function public.sessions_block_delete_of_record() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    if old.settlement_id is not null then
      raise exception 'That session has already been paid. Reverse the settlement before removing it.'
        using errcode = '42501';
    end if;
    if old.outcome is not null then
      raise exception 'That session has an outcome recorded and is part of the pay record. Undo the outcome first if it should not have one.'
        using errcode = '42501';
    end if;
  end if;
  return old;
end $$;

drop trigger if exists trg_sessions_block_delete_of_record on public.sessions;
create trigger trg_sessions_block_delete_of_record
  before delete on public.sessions
  for each row execute function public.sessions_block_delete_of_record();
