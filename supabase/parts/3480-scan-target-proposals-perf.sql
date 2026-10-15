-- 3480 · scan_target_proposals: advisor fixes (perf lints 0001/0003/0006).
-- auth.uid() wrapped in a scalar subquery so it is evaluated once per statement;
-- the two read policies merged into one with the same meaning (client OR coach);
-- covering indexes for the two foreign keys. coach_open_idx stays (coach inbox).
-- The two SECURITY DEFINER RPCs check the caller in their bodies; execute stays
-- with authenticated only, and scan_targets_changed gets pg_temp pinned last.

drop policy if exists scan_target_proposals_client_r on public.scan_target_proposals;
drop policy if exists scan_target_proposals_coach_r  on public.scan_target_proposals;
drop policy if exists scan_target_proposals_coach_u  on public.scan_target_proposals;
drop policy if exists scan_target_proposals_r        on public.scan_target_proposals;

create policy scan_target_proposals_r on public.scan_target_proposals
  for select using (client_id = (select auth.uid()) or coach_id = (select auth.uid()));
create policy scan_target_proposals_coach_u on public.scan_target_proposals
  for update using (coach_id = (select auth.uid())) with check (coach_id = (select auth.uid()));

create index if not exists scan_target_proposals_client_id_idx on public.scan_target_proposals (client_id);
create index if not exists scan_target_proposals_scan_id_idx   on public.scan_target_proposals (scan_id);

alter function public.scan_targets_changed(uuid,integer,integer,integer,integer,text,boolean) set search_path = public, pg_temp;
revoke execute on function public.finish_coach_session(uuid,uuid,uuid,jsonb,integer,integer) from public, anon;
grant  execute on function public.finish_coach_session(uuid,uuid,uuid,jsonb,integer,integer) to authenticated;
revoke execute on function public.scan_targets_changed(uuid,integer,integer,integer,integer,text,boolean) from public, anon;
grant  execute on function public.scan_targets_changed(uuid,integer,integer,integer,integer,text,boolean) to authenticated;
