-- Setup finished, on the account rather than on one phone.
--
-- app/(client)/onboarding.tsx marked itself done in AsyncStorage only, so a
-- member who reinstalled or got a new phone was offered "personalise your
-- plan" again for a setup they had finished. This puts the fact on the row.
--
-- Every client who exists when this runs is marked complete: they are past
-- first run by definition, and the new steps (experience, schedule, coach
-- code) are reachable from their own screens. Only accounts created after
-- this are offered the flow.
--
-- Additive only: one column, one backfill of that column, one function.

alter table public.clients add column if not exists onboarded_at timestamptz;

update public.clients set onboarded_at = now() where onboarded_at is null;

comment on column public.clients.onboarded_at is
  'When this member finished (or skipped) first-run setup (part 3570). Null = not yet; existing members were backfilled at the migration.';

create or replace function public.mark_onboarded()
returns timestamptz
language sql
volatile
security definer
set search_path to 'public', 'pg_temp'
as $fn$
  update public.clients
     set onboarded_at = coalesce(onboarded_at, now())
   where id = auth.uid()
  returning onboarded_at;
$fn$;

revoke all on function public.mark_onboarded() from public, anon;
grant execute on function public.mark_onboarded() to authenticated;

comment on function public.mark_onboarded() is
  'Marks the caller''s own setup finished, once. Returns the stamp, or null when the caller has no clients row.';
