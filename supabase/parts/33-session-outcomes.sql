-- ── What actually happened in a PT session ──────────────────────────────────
--
-- Phase 1. Two problems with `sessions`, both of which reach the owner's
-- payroll figure.
--
-- 1. It has no tenant. A gym cannot see the one-to-one sessions its own
--    trainers deliver on its floor — the same class of gap that made
--    `gym_classes` readable across gyms (see 30-classes-tenant-scope.sql),
--    except here the data is missing rather than over-shared.
--
-- 2. `status` describes the slot, not the outcome: available, booked, blocked.
--    There is nowhere to record that a booked session was actually delivered.
--    So "delivered" has been inferred as "was booked and the clock has since
--    passed" — which counts no-shows, un-cancelled slots and sessions the
--    trainer never turned up to. That inference feeds payroll, so a gym pays
--    for sessions that did not happen.
--
-- Additive only. `status` keeps its meaning; the new `outcome` column carries
-- the delivery result and is null until somebody records one. Null is the
-- honest state: not delivered, not cancelled — not yet known.

alter table public.sessions add column if not exists tenant_id uuid references public.tenants(id) on delete cascade;

alter table public.sessions add column if not exists outcome text
  check (outcome is null or outcome in ('completed','no_show','cancelled','late_cancelled'));

alter table public.sessions add column if not exists outcome_at timestamptz;
alter table public.sessions add column if not exists outcome_by uuid references auth.users(id) on delete set null;

-- The rate at the moment of delivery. Snapshotted so that changing a trainer's
-- fee next month does not silently rewrite what last month cost.
alter table public.sessions add column if not exists rate_cents integer
  check (rate_cents is null or rate_cents >= 0);

create index if not exists idx_sessions_tenant on public.sessions(tenant_id, starts_at desc);
create index if not exists idx_sessions_unmarked on public.sessions(tenant_id, starts_at)
  where outcome is null;

-- ── backfill the tenant from the trainer who owns the slot ──────────────────
update public.sessions s
   set tenant_id = t.tenant_id
  from public.trainers t
 where t.id = s.trainer_id
   and s.tenant_id is null;

-- New rows inherit it, so no caller has to supply it and none can supply the
-- wrong one.
create or replace function public.sessions_fill_tenant() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.tenant_id is null then
    select t.tenant_id into new.tenant_id from public.trainers t where t.id = new.trainer_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_sessions_fill_tenant on public.sessions;
create trigger trg_sessions_fill_tenant
  before insert on public.sessions
  for each row execute function public.sessions_fill_tenant();

-- Stamp who recorded the outcome and when, so a disputed payroll line has an
-- author. Only on transition into an outcome, so an edit does not lose the
-- original time.
create or replace function public.sessions_stamp_outcome() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.outcome is distinct from old.outcome and new.outcome is not null then
    new.outcome_at := coalesce(new.outcome_at, now());
    new.outcome_by := coalesce(new.outcome_by, (select auth.uid()));
  end if;
  if new.outcome is null then
    new.outcome_at := null;
    new.outcome_by := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_sessions_stamp_outcome on public.sessions;
create trigger trg_sessions_stamp_outcome
  before update on public.sessions
  for each row execute function public.sessions_stamp_outcome();

-- ── row-level security ──────────────────────────────────────────────────────
-- Existing policies (09-sessions-access.sql) already cover the trainer who owns
-- the slot and the client who booked it. This adds the gym: an owner may read
-- the sessions delivered on their floor, because that is what they are paying
-- for, and may correct an outcome.
--
-- The helpers are SECURITY DEFINER, so a policy calling them does not re-enter
-- the table it is protecting — the recursion that once made `profiles`
-- unreadable for everyone (see 28-fix-profiles-recursion.sql).

drop policy if exists sessions_gym_owner_r on public.sessions;
create policy sessions_gym_owner_r on public.sessions
  for select using (tenant_id is not null and is_owner_of(tenant_id));

drop policy if exists sessions_gym_owner_u on public.sessions;
create policy sessions_gym_owner_u on public.sessions
  for update using (tenant_id is not null and is_owner_of(tenant_id))
  with check (tenant_id is not null and is_owner_of(tenant_id));
