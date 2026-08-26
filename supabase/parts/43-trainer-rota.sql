-- ── The trainer rota ────────────────────────────────────────────────────────
--
-- Phase 1. Who is on the gym floor when — and, the part that makes it worth
-- building, whether that lines up with what the floor is actually doing.
--
-- A rota that is only a calendar adds nothing over the spreadsheet it replaces.
-- The reason this table exists is that the gym already records demand: classes
-- sit in `gym_classes` with a start and a duration, one-to-ones sit in
-- `sessions`. Put the supply on the same timeline and two questions answer
-- themselves — which hours have work booked and nobody rostered, and which
-- hours have somebody rostered against nothing at all. Neither is answerable
-- from a rota alone, and neither is answerable from the timetable alone.
--
-- ── Why concrete timestamps and not a weekly pattern ────────────────────────
--
-- `trainer_availability` (part 24) already holds the recurring pattern: dow +
-- hour, the shape of a trainer's normal week. That is a different fact. A rota
-- is what is happening in THIS week — the cover for someone off sick, the
-- public holiday, the Saturday somebody swapped. Those are edits to a single
-- occurrence, and a recurrence rule cannot carry them without growing an
-- exceptions table that is these rows under another name. `gymSchedule
-- .weeklyOccurrences` made the same call for classes, for the same reason.
--
-- Storing timestamptz rather than (date, time) is what makes the comparison
-- sound: shifts, classes and sessions then live on one timeline and no part of
-- the app has to reconcile a wall clock against a timezone to ask whether an
-- hour was covered.
--
-- Additive only. Nothing here alters an existing table.

create table if not exists gym_shifts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  -- `trainers`, not `profiles`: a shift belongs to somebody who works here. A
  -- trainer leaving takes their future shifts with them, which is right — a
  -- rota row for a person who is gone is not history, it is a hole nobody has
  -- noticed yet.
  trainer_id uuid not null references trainers(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- A zero-length or reversed shift is always a typo, and it would silently
  -- cover no hours at all while looking like cover on the screen.
  constraint gym_shifts_span check (ends_at > starts_at),
  -- What they are on for. Loose enough to be useful, closed enough that the
  -- rota can be read at a glance. 'floor' is the default because that is what
  -- the roadmap item asks about — who is out there if a member needs someone.
  role text not null default 'floor'
    check (role in ('floor', 'classes', 'pt', 'desk', 'admin')),
  -- A pulled shift is kept rather than deleted. "Somebody was rostered and
  -- dropped out" and "nobody was ever rostered" produce the same hole in the
  -- cover, but they are different problems and the owner needs to tell them
  -- apart. gymRota counts neither as cover.
  status text not null default 'scheduled'
    check (status in ('scheduled', 'cancelled')),
  note text,
  created_at timestamptz not null default now()
);

-- The rota is always read as a week of one gym, and written as one trainer's
-- run of shifts. Both directions get an index.
create index if not exists idx_gym_shifts_tenant on gym_shifts(tenant_id, starts_at);
create index if not exists idx_gym_shifts_trainer on gym_shifts(trainer_id, starts_at);

-- NOT ENFORCED, deliberately: two overlapping shifts for one trainer. The
-- exclusion constraint that would catch it needs btree_gist, which this schema
-- does not install, and an overlap is a rota mistake rather than a corruption —
-- it is visible on the week view as the same name twice in one row.

-- ── row-level security ──────────────────────────────────────────────────────
-- Enabled before any policy is written. A policy on a table without RLS on is
-- inert — Postgres never consults it and Supabase's default grants to anon and
-- authenticated apply in full, which is exactly how four tables ended up
-- world-writable until 38-tenant-isolation.sql.
--
-- The helpers are SECURITY DEFINER, so a policy calling them does not re-enter
-- the table it is protecting (see 28-fix-profiles-recursion.sql).
alter table gym_shifts enable row level security;

-- The rota is the owner's instrument: they write it, and `is_owner_of` scopes
-- them to THIS gym rather than merely to being an owner somewhere.
drop policy if exists gym_shifts_owner on gym_shifts;
create policy gym_shifts_owner on gym_shifts
  for all using (is_owner_of(tenant_id)) with check (is_owner_of(tenant_id));

-- Trainers read it. A rota nobody rostered on it can see is a rota that gets
-- re-typed into WhatsApp, which is how it stops being true. Read only: when
-- their own shift changes it is because the gym moved it, and a trainer who
-- could edit the rota could quietly uncover the floor.
drop policy if exists gym_shifts_staff_r on gym_shifts;
create policy gym_shifts_staff_r on gym_shifts
  for select using (tenant_id = my_tenant() and my_role() in ('trainer', 'owner'));

-- No functions are added here, so nothing needs the revoke-from-PUBLIC
-- treatment that 40-function-grants.sql applies. If one is ever added to this
-- file, re-run that part: Postgres grants EXECUTE to PUBLIC by default and
-- `anon` resolves through it.
