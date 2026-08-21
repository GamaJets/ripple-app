-- ─────────────────────────────────────────────────────────────────────────
-- ═══════════════════════════════════════════════════════════════════════════
-- FitForge — Postgres schema for Supabase
-- Multi-tenant white-label fitness platform (owner ▸ trainers ▸ clients)
-- Run in the Supabase SQL editor, or `supabase db push` with the CLI.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists "uuid-ossp";

-- ── Tenancy: one row per trainer's white-label brand ────────────────────────
create table if not exists tenants (
  id            uuid primary key default uuid_generate_v4(),
  name          text not null,
  logo          text,
  brand_color   text default '#2dd4bf',
  plan          text not null default 'starter' check (plan in ('starter','pro','studio')),
  session_fee   numeric(8,2) not null default 75,
  created_at    timestamptz not null default now()
);

-- ── Profiles: extends Supabase auth.users, carries the role ─────────────────
create table if not exists profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  role       text not null check (role in ('owner','trainer','client')),
  tenant_id  uuid references tenants(id) on delete set null,
  full_name  text,
  avatar     text,
  created_at timestamptz not null default now()
);

-- ── Trainers ────────────────────────────────────────────────────────────────
create table if not exists trainers (
  id         uuid primary key references profiles(id) on delete cascade,
  tenant_id  uuid not null references tenants(id) on delete cascade,
  bio        text
);

-- ── Clients ─────────────────────────────────────────────────────────────────
create table if not exists clients (
  id            uuid primary key references profiles(id) on delete cascade,
  trainer_id    uuid references trainers(id) on delete set null,
  tenant_id     uuid not null references tenants(id) on delete cascade,
  sex           text check (sex in ('f','m')),
  dob           date,                         -- age is derived, never stored
  height_cm     numeric(5,1),
  goal          text check (goal in ('fatloss','tone','muscle')),
  diet          text check (diet in ('meat','vegetarian','vegan','paleo','keto')),
  activity      numeric(3,2) default 1.45,
  meals_per_day int default 4,
  theme_mode    text default 'dark',
  theme_color   text
);

-- ── InBody scans (source of the body-stat time series) ──────────────────────
create table if not exists scans (
  id                 uuid primary key default uuid_generate_v4(),
  client_id          uuid not null references clients(id) on delete cascade,
  taken_at           date not null,
  weight_kg          numeric(5,1) not null,
  body_fat_pct       numeric(4,1) not null,
  skeletal_muscle_kg numeric(5,1),
  source             text default 'InBody (OCR)',
  image_path         text,                    -- storage key of the uploaded sheet
  created_at         timestamptz not null default now()
);
create index if not exists on scans (client_id, taken_at);

-- ── Progress photos ─────────────────────────────────────────────────────────
create table if not exists progress_photos (
  id         uuid primary key default uuid_generate_v4(),
  client_id  uuid not null references clients(id) on delete cascade,
  taken_at   timestamptz not null default now(),
  image_path text not null,
  weight_kg  numeric(5,1),
  body_fat_pct numeric(4,1)
);

-- ── Exercise library + trainer videos ───────────────────────────────────────
create table if not exists exercises (
  id       text primary key,                  -- 'squat', 'bench', 'tread' ...
  name     text not null,
  muscle_group text,
  is_cardio boolean not null default false
);
create table if not exists exercise_videos (
  id           uuid primary key default uuid_generate_v4(),
  exercise_id  text not null references exercises(id),
  trainer_id   uuid references trainers(id) on delete cascade,  -- null = platform "Academy"
  title        text not null,
  video_path   text,
  created_at   timestamptz not null default now()
);

-- ── Programs & workout logs ─────────────────────────────────────────────────
create table if not exists programs (
  id         uuid primary key default uuid_generate_v4(),
  client_id  uuid not null references clients(id) on delete cascade,
  day        text not null,                   -- 'Mon' ...
  focus      text,
  exercises  jsonb not null default '[]'      -- [{exercise_id, sets, reps, kg}]
);
create table if not exists workout_logs (
  id          uuid primary key default uuid_generate_v4(),
  client_id   uuid not null references clients(id) on delete cascade,
  logged_at   timestamptz not null default now(),
  exercise_id text not null references exercises(id),
  sets        jsonb,                           -- [[reps, kg], ...] for strength
  cardio      jsonb,                           -- {mins, dist, unit} for cardio
  kcal        int,
  avg_hr      int,
  source      text default 'manual'            -- 'manual' | 'watch'
);
create index if not exists on workout_logs (client_id, logged_at);

-- ── Meal plans (generated, cached; regenerated on stat change) ──────────────
create table if not exists meal_plans (
  id          uuid primary key default uuid_generate_v4(),
  client_id   uuid not null references clients(id) on delete cascade,
  generated_at timestamptz not null default now(),
  targets     jsonb not null,                  -- {kcal, protein, carbs, fat}
  meals       jsonb not null                   -- [{name, slot, servings, K,P,C,F}]
);

-- ── Calendar: in-person sessions, availability & blocks ─────────────────────
create table if not exists sessions (
  id           uuid primary key default uuid_generate_v4(),
  trainer_id   uuid not null references trainers(id) on delete cascade,
  client_id    uuid references clients(id) on delete set null,
  starts_at    timestamptz not null,
  duration_min int not null default 60,
  status       text not null check (status in ('available','booked','blocked')),
  released     boolean not null default false, -- re-offered after a cancellation
  created_at   timestamptz not null default now()
);
create index if not exists on sessions (trainer_id, starts_at);

-- recurring availability templates (generate concrete sessions ahead of time)
create table if not exists availability_templates (
  id          uuid primary key default uuid_generate_v4(),
  trainer_id  uuid not null references trainers(id) on delete cascade,
  weekday     int not null check (weekday between 0 and 6),  -- 0 = Monday
  start_hour  int not null check (start_hour between 0 and 23),
  duration_min int not null default 60,
  active      boolean not null default true
);

-- waitlist for a released/opened slot (FIFO auto-assign)
create table if not exists session_waitlist (
  session_id uuid not null references sessions(id) on delete cascade,
  client_id  uuid not null references clients(id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (session_id, client_id)
);

-- ── Charges (late-cancellation fees etc.) ───────────────────────────────────
create table if not exists charges (
  id         uuid primary key default uuid_generate_v4(),
  client_id  uuid not null references clients(id) on delete cascade,
  amount     numeric(8,2) not null,
  reason     text not null,
  stripe_payment_intent text,
  created_at timestamptz not null default now()
);

-- ── Messages (coach ↔ client threads) ───────────────────────────────────────
create table if not exists messages (
  id         uuid primary key default uuid_generate_v4(),
  client_id  uuid not null references clients(id) on delete cascade,  -- the thread
  sender     text not null check (sender in ('client','coach')),
  body       text not null,
  created_at timestamptz not null default now()
);
create index if not exists on messages (client_id, created_at);

-- ── Food log (search / barcode / photo entries against a daily macro target) ─
create table if not exists food_logs (
  id         uuid primary key default uuid_generate_v4(),
  client_id  uuid not null references clients(id) on delete cascade,
  logged_at  timestamptz not null default now(),
  name       text not null,
  kcal       int not null default 0,
  protein    numeric(6,1) not null default 0,
  carbs      numeric(6,1) not null default 0,
  fat        numeric(6,1) not null default 0,
  via        text not null default 'search' check (via in ('search','barcode','photo','manual'))
);
create index if not exists on food_logs (client_id, logged_at);

-- ── Notifications (backs the in-app bell; pushed via APNs/FCM edge fn) ───────
create table if not exists notifications (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references profiles(id) on delete cascade,
  icon       text,
  body       text not null,
  session_id uuid references sessions(id) on delete set null,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists on notifications (user_id, read);

-- ═══════════════════════════════════════════════════════════════════════════
-- Row Level Security — the heart of multi-tenant isolation.
-- Enable RLS on every table; policies below are the starting set. Clients see
-- only their own rows; trainers see their clients' rows within their tenant.
-- ═══════════════════════════════════════════════════════════════════════════
alter table profiles              enable row level security;
alter table clients               enable row level security;
alter table scans                 enable row level security;
alter table progress_photos       enable row level security;
alter table workout_logs          enable row level security;
alter table meal_plans            enable row level security;
alter table programs              enable row level security;
alter table sessions              enable row level security;
alter table charges               enable row level security;
alter table messages              enable row level security;
alter table food_logs             enable row level security;
alter table notifications         enable row level security;

-- a client reads/writes only their own data
create policy client_self on clients
  for all using (id = auth.uid());

create policy scans_owner on scans
  for all using (client_id = auth.uid());

-- a trainer reads their clients' scans (same trainer_id)
create policy scans_trainer_read on scans
  for select using (
    exists (select 1 from clients c
            where c.id = scans.client_id and c.trainer_id = auth.uid())
  );

-- a user sees only their own notifications
create policy notif_self on notifications
  for all using (user_id = auth.uid());

-- a client reads/writes their own food log; trainer can read their clients'
create policy food_owner on food_logs
  for all using (client_id = auth.uid());
create policy food_trainer_read on food_logs
  for select using (
    exists (select 1 from clients c
            where c.id = food_logs.client_id and c.trainer_id = auth.uid())
  );

-- messages: the client on the thread, or that client's trainer, may read/write
create policy msg_participants on messages
  for all using (
    client_id = auth.uid()
    or exists (select 1 from clients c
               where c.id = messages.client_id and c.trainer_id = auth.uid())
  );

-- NOTE: extend these per table before storing real user data. A security review
-- of the full policy set is a Phase-2 checklist item in the build plan.

-- ═══════════════════════════════════════════════════════════════════════════
-- Phase-1 auth wiring (added when the live backend was connected).
-- 1) Let a signed-in user read/write ONLY their own profile row.
-- 2) Auto-create that profile row the moment they sign up, pulling role +
--    full_name from the signUp metadata. Runs as SECURITY DEFINER so the
--    insert bypasses RLS (there is no session yet at insert time).
-- ═══════════════════════════════════════════════════════════════════════════
create policy profiles_self on profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'role', 'client'),
    coalesce(new.raw_user_meta_data->>'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ─────────────────────────────────────────────────────────────────────────
