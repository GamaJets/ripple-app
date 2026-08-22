-- Trainer weekly availability template — recurring day-of-week + hour slots.
--
-- DUMPED FROM THE LIVE DATABASE. Note `integer` (not smallint) and the absence
-- of a unique constraint on (trainer_id, dow, hour): availability.ts dedups
-- client-side only, so two devices can still create the same slot twice. Left as
-- live has it rather than silently tightening a constraint on existing rows.

create table if not exists trainer_availability (
  id         uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references auth.users(id) on delete cascade,
  dow        integer not null check (dow >= 0 and dow <= 6),   -- 0 = Sunday
  hour       integer not null check (hour >= 0 and hour <= 23),
  dur        integer not null default 60,                      -- minutes
  created_at timestamptz not null default now()
);

create index if not exists trainer_availability_idx
  on trainer_availability(trainer_id, dow, hour);

alter table trainer_availability enable row level security;

drop policy if exists ta_own on trainer_availability;
create policy ta_own on trainer_availability
  for all using (trainer_id = (select auth.uid()))
  with check (trainer_id = (select auth.uid()));
