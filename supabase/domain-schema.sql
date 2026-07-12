-- Repple domain addendum — reconciled with the existing FitForge schema.sql.
-- Adds ONLY new tables (no name collisions with tenants/profiles/clients/scans/
-- sessions/exercise_videos/workout_logs/messages/etc). Idempotent; re-runnable.
-- Coach access uses the existing clients.trainer_id relationship.

create or replace function is_my_client(c uuid) returns boolean language sql stable as $$
  select exists (select 1 from clients cl where cl.id = c and cl.trainer_id = auth.uid());
$$;
create or replace function is_owner_of(t uuid) returns boolean language sql stable as $$
  select exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'owner' and p.tenant_id = t);
$$;

-- ── workouts (free-text exercise log; wired to the app now) ──────────────────
create table if not exists workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  performed_at timestamptz not null default now(),
  exercise text not null, sets jsonb, cardio jsonb, kcal int,
  created_at timestamptz not null default now()
);
create index if not exists idx_workouts_user on workouts(user_id, performed_at desc);

create table if not exists measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  taken_at date not null, kind text not null, value numeric not null
);
create index if not exists idx_meas_user on measurements(user_id, taken_at);

create table if not exists check_ins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  at timestamptz not null default now(),
  weight_kg numeric, energy int, sleep int, mood int, adherence int, note text
);
create index if not exists idx_checkins_user on check_ins(user_id, at desc);

create table if not exists habit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  habit text not null, done_on date not null, unique(user_id, habit, done_on)
);

-- ── coach → client (feedback, nutrition nudge, assigned program) ─────────────
create table if not exists coach_feedback (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references profiles(id) on delete cascade,
  client_id uuid not null references profiles(id) on delete cascade,
  body text not null, created_at timestamptz not null default now()
);
create table if not exists coach_nutrition (
  client_id uuid primary key references profiles(id) on delete cascade,
  coach_id uuid references profiles(id) on delete set null,
  kcal_delta int default 0, protein_delta int default 0, note text,
  updated_at timestamptz not null default now()
);
create table if not exists assigned_programs (
  client_id uuid primary key references profiles(id) on delete cascade,
  coach_id uuid references profiles(id) on delete set null,
  program jsonb not null, updated_at timestamptz not null default now()
);

-- ── platform (billing, promos, announcements) ───────────────────────────────
create table if not exists trainer_billing (
  trainer_id uuid primary key references profiles(id) on delete cascade,
  tenant_id uuid references tenants(id) on delete cascade,
  plan text not null default 'Pro', mrr numeric not null default 0,
  status text not null default 'active' check (status in ('trial','active','suspended')),
  updated_at timestamptz not null default now()
);
create table if not exists promos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  code text not null, discount int not null, active boolean default true,
  redemptions int default 0, created_at timestamptz not null default now()
);
create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references profiles(id) on delete set null,
  audience text not null check (audience in ('clients','trainers')),
  tenant_id uuid references tenants(id) on delete cascade,
  body text not null, created_at timestamptz not null default now()
);

-- ── RLS ─────────────────────────────────────────────────────────────────────
do $$ declare tbl text; begin
  foreach tbl in array array['workouts','measurements','check_ins','habit_logs',
    'coach_feedback','coach_nutrition','assigned_programs','trainer_billing','promos','announcements']
  loop execute format('alter table %I enable row level security;', tbl); end loop;
end $$;

-- client-owned: own all; their trainer can read.
do $$ declare t text; begin
  foreach t in array array['workouts','measurements','check_ins','habit_logs'] loop
    execute format('drop policy if exists %1$s_own on %1$s;', t);
    execute format('create policy %1$s_own on %1$s for all using (user_id = auth.uid()) with check (user_id = auth.uid());', t);
    execute format('drop policy if exists %1$s_coach_read on %1$s;', t);
    execute format('create policy %1$s_coach_read on %1$s for select using (is_my_client(user_id));', t);
  end loop;
end $$;

drop policy if exists feedback_rw on coach_feedback;
create policy feedback_rw on coach_feedback for all
  using (coach_id = auth.uid() or client_id = auth.uid()) with check (coach_id = auth.uid());
drop policy if exists nutri_rw on coach_nutrition;
create policy nutri_rw on coach_nutrition for all
  using (coach_id = auth.uid() or client_id = auth.uid()) with check (coach_id = auth.uid());
drop policy if exists prog_rw on assigned_programs;
create policy prog_rw on assigned_programs for all
  using (coach_id = auth.uid() or client_id = auth.uid()) with check (coach_id = auth.uid());

drop policy if exists billing_owner on trainer_billing;
create policy billing_owner on trainer_billing for all
  using (is_owner_of(tenant_id) or trainer_id = auth.uid()) with check (is_owner_of(tenant_id));
drop policy if exists promos_owner on promos;
create policy promos_owner on promos for all using (is_owner_of(tenant_id)) with check (is_owner_of(tenant_id));
drop policy if exists ann_read on announcements;
create policy ann_read on announcements for select using (true);
drop policy if exists ann_write on announcements;
create policy ann_write on announcements for insert with check (author_id = auth.uid());
