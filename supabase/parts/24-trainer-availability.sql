-- Trainer weekly availability template — the recurring day-of-week + hour slots a
-- coach offers, which "generate" turns into concrete open sessions.
-- Reconstructed from src/ui/availability.ts, which reads and writes this table
-- and falls back to a per-device AsyncStorage copy when it is absent. That
-- fallback is why the loss was invisible: a schedule survived on the device that
-- created it and existed nowhere else.

create table if not exists trainer_availability (
  id         uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references profiles(id) on delete cascade,
  dow        smallint not null check (dow between 0 and 6),   -- 0 = Sunday
  hour       smallint not null check (hour between 0 and 23),
  dur        smallint not null default 60 check (dur > 0),    -- minutes
  created_at timestamptz not null default now(),
  unique (trainer_id, dow, hour)
);

-- availability.ts already refuses a duplicate (dow, hour) client-side; the
-- constraint makes that hold across devices, where the client check cannot see
-- what another device already wrote.

create index if not exists idx_trainer_availability_trainer
  on trainer_availability(trainer_id, dow, hour);

alter table trainer_availability enable row level security;

drop policy if exists trainer_availability_own on trainer_availability;
create policy trainer_availability_own on trainer_availability
  for all using (trainer_id = (select auth.uid()))
  with check (trainer_id = (select auth.uid()));

grant select, insert, update, delete on trainer_availability to authenticated;
