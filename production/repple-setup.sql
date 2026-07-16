-- ═══════════════════════════════════════════════════════════════════════════
-- Repple — ONE-SHOT Supabase setup. Paste this whole file into the Supabase
-- SQL editor (Dashboard ▸ SQL Editor ▸ New query) and Run.
-- Every file below is idempotent; order is dependency-correct. Regenerate from
-- supabase/*.sql — do not hand-edit.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- ▶ schema.sql
-- ─────────────────────────────────────────────────────────────────────────
-- ═══════════════════════════════════════════════════════════════════════════
-- FitForge — Postgres schema for Supabase
-- Multi-tenant white-label fitness platform (owner ▸ trainers ▸ clients)
-- Run in the Supabase SQL editor, or `supabase db push` with the CLI.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists "uuid-ossp";

-- ── Tenancy: one row per trainer's white-label brand ────────────────────────
create table tenants (
  id            uuid primary key default uuid_generate_v4(),
  name          text not null,
  logo          text,
  brand_color   text default '#2dd4bf',
  plan          text not null default 'starter' check (plan in ('starter','pro','studio')),
  session_fee   numeric(8,2) not null default 75,
  created_at    timestamptz not null default now()
);

-- ── Profiles: extends Supabase auth.users, carries the role ─────────────────
create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  role       text not null check (role in ('owner','trainer','client')),
  tenant_id  uuid references tenants(id) on delete set null,
  full_name  text,
  avatar     text,
  created_at timestamptz not null default now()
);

-- ── Trainers ────────────────────────────────────────────────────────────────
create table trainers (
  id         uuid primary key references profiles(id) on delete cascade,
  tenant_id  uuid not null references tenants(id) on delete cascade,
  bio        text
);

-- ── Clients ─────────────────────────────────────────────────────────────────
create table clients (
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
create table scans (
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
create index on scans (client_id, taken_at);

-- ── Progress photos ─────────────────────────────────────────────────────────
create table progress_photos (
  id         uuid primary key default uuid_generate_v4(),
  client_id  uuid not null references clients(id) on delete cascade,
  taken_at   timestamptz not null default now(),
  image_path text not null,
  weight_kg  numeric(5,1),
  body_fat_pct numeric(4,1)
);

-- ── Exercise library + trainer videos ───────────────────────────────────────
create table exercises (
  id       text primary key,                  -- 'squat', 'bench', 'tread' ...
  name     text not null,
  muscle_group text,
  is_cardio boolean not null default false
);
create table exercise_videos (
  id           uuid primary key default uuid_generate_v4(),
  exercise_id  text not null references exercises(id),
  trainer_id   uuid references trainers(id) on delete cascade,  -- null = platform "Academy"
  title        text not null,
  video_path   text,
  created_at   timestamptz not null default now()
);

-- ── Programs & workout logs ─────────────────────────────────────────────────
create table programs (
  id         uuid primary key default uuid_generate_v4(),
  client_id  uuid not null references clients(id) on delete cascade,
  day        text not null,                   -- 'Mon' ...
  focus      text,
  exercises  jsonb not null default '[]'      -- [{exercise_id, sets, reps, kg}]
);
create table workout_logs (
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
create index on workout_logs (client_id, logged_at);

-- ── Meal plans (generated, cached; regenerated on stat change) ──────────────
create table meal_plans (
  id          uuid primary key default uuid_generate_v4(),
  client_id   uuid not null references clients(id) on delete cascade,
  generated_at timestamptz not null default now(),
  targets     jsonb not null,                  -- {kcal, protein, carbs, fat}
  meals       jsonb not null                   -- [{name, slot, servings, K,P,C,F}]
);

-- ── Calendar: in-person sessions, availability & blocks ─────────────────────
create table sessions (
  id           uuid primary key default uuid_generate_v4(),
  trainer_id   uuid not null references trainers(id) on delete cascade,
  client_id    uuid references clients(id) on delete set null,
  starts_at    timestamptz not null,
  duration_min int not null default 60,
  status       text not null check (status in ('available','booked','blocked')),
  released     boolean not null default false, -- re-offered after a cancellation
  created_at   timestamptz not null default now()
);
create index on sessions (trainer_id, starts_at);

-- recurring availability templates (generate concrete sessions ahead of time)
create table availability_templates (
  id          uuid primary key default uuid_generate_v4(),
  trainer_id  uuid not null references trainers(id) on delete cascade,
  weekday     int not null check (weekday between 0 and 6),  -- 0 = Monday
  start_hour  int not null check (start_hour between 0 and 23),
  duration_min int not null default 60,
  active      boolean not null default true
);

-- waitlist for a released/opened slot (FIFO auto-assign)
create table session_waitlist (
  session_id uuid not null references sessions(id) on delete cascade,
  client_id  uuid not null references clients(id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (session_id, client_id)
);

-- ── Charges (late-cancellation fees etc.) ───────────────────────────────────
create table charges (
  id         uuid primary key default uuid_generate_v4(),
  client_id  uuid not null references clients(id) on delete cascade,
  amount     numeric(8,2) not null,
  reason     text not null,
  stripe_payment_intent text,
  created_at timestamptz not null default now()
);

-- ── Messages (coach ↔ client threads) ───────────────────────────────────────
create table messages (
  id         uuid primary key default uuid_generate_v4(),
  client_id  uuid not null references clients(id) on delete cascade,  -- the thread
  sender     text not null check (sender in ('client','coach')),
  body       text not null,
  created_at timestamptz not null default now()
);
create index on messages (client_id, created_at);

-- ── Food log (search / barcode / photo entries against a daily macro target) ─
create table food_logs (
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
create index on food_logs (client_id, logged_at);

-- ── Notifications (backs the in-app bell; pushed via APNs/FCM edge fn) ───────
create table notifications (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references profiles(id) on delete cascade,
  icon       text,
  body       text not null,
  session_id uuid references sessions(id) on delete set null,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index on notifications (user_id, read);

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
-- ▶ domain-schema.sql
-- ─────────────────────────────────────────────────────────────────────────
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
alter table workouts add column if not exists feel jsonb;

-- ── Referrals (attribution when a new user signs up with a code) ─────────────
create table if not exists referrals (
  id uuid primary key default gen_random_uuid(),
  referred_user_id uuid not null references profiles(id) on delete cascade,
  code text not null,
  created_at timestamptz not null default now(),
  unique (referred_user_id)
);
create index if not exists idx_referrals_code on referrals(upper(code));
alter table referrals enable row level security;
drop policy if exists referrals_self on referrals;
create policy referrals_self on referrals for select using (referred_user_id = auth.uid());

create or replace function record_referral(p_code text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_code is null or length(trim(p_code)) = 0 then return; end if;
  insert into referrals (referred_user_id, code)
  values (auth.uid(), upper(trim(p_code)))
  on conflict (referred_user_id) do nothing;
end; $$;

create or replace function referral_count(p_code text)
returns int language sql security definer set search_path = public as $$
  select count(*)::int from referrals where upper(code) = upper(trim(p_code));
$$;
grant execute on function record_referral(text) to authenticated;
grant execute on function referral_count(text) to authenticated;

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


-- ─────────────────────────────────────────────────────────────────────────
-- ▶ scan-metrics.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Repple — optional richer InBody metrics on scans (visceral fat, InBody score,
-- BMR, fat/lean mass, body water/protein/minerals, segmental lean). Stored as a
-- single JSONB blob so new fields never need another migration. The app already
-- keeps these device-locally; run this + wire the write to make them sync across
-- devices and show up for the client's trainer. Idempotent; safe to re-run.
alter table scans add column if not exists metrics jsonb;


-- ─────────────────────────────────────────────────────────────────────────
-- ▶ coach-macros.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Repple — full-macro coach editor: carb & fat deltas on coach_nutrition so a
-- trainer can shape all four macros (not just calories + protein). The client's
-- targets already layer these via applyCoachAdjust. Idempotent; safe to re-run.
alter table coach_nutrition add column if not exists carb_delta int default 0;
alter table coach_nutrition add column if not exists fat_delta int default 0;


-- ─────────────────────────────────────────────────────────────────────────
-- ▶ coach-meal-plan.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Repple — coach meal-plan picker: the coach can set specific meals per slot for
-- a client. Needs the client's diet + meals/day (so the coach picks from the right
-- catalog) and a per-meal override map on coach_nutrition. Idempotent.
alter table clients add column if not exists diet text;
alter table clients add column if not exists meals_per_day int;
alter table clients add column if not exists avoid text[];
alter table coach_nutrition add column if not exists meal_override jsonb;


-- ─────────────────────────────────────────────────────────────────────────
-- ▶ account-provisioning.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Repple account provisioning. Makes every profile a real domain record:
--  • a personal tenant (if none)
--  • a clients row (role=client) or trainers row (role=trainer)
-- so client-keyed tables (scans, food_logs, messages, sessions) work per user,
-- and trainers have real client records to link to. Idempotent; safe to re-run.

-- ── Backfill existing profiles that have no clients/trainers record ──────────
do $$
declare p record; tid uuid;
begin
  for p in select id, coalesce(role,'client') as role, full_name, tenant_id from profiles loop
    tid := p.tenant_id;
    if tid is null then
      insert into tenants (name) values (coalesce(p.full_name,'My') || '''s space') returning id into tid;
      update profiles set tenant_id = tid where id = p.id;
    end if;
    if p.role = 'client' then
      insert into clients (id, tenant_id) values (p.id, tid) on conflict (id) do nothing;
    elsif p.role = 'trainer' then
      insert into trainers (id, tenant_id) values (p.id, tid) on conflict (id) do nothing;
    end if;
  end loop;
end $$;

-- ── Trigger: provision future signups automatically ─────────────────────────
create or replace function provision_profile()
returns trigger language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := new.tenant_id;
  if tid is null then
    insert into tenants (name) values (coalesce(new.full_name,'My') || '''s space') returning id into tid;
    update profiles set tenant_id = tid where id = new.id;
  end if;
  if coalesce(new.role,'client') = 'client' then
    insert into clients (id, tenant_id) values (new.id, tid) on conflict (id) do nothing;
  elsif new.role = 'trainer' then
    insert into trainers (id, tenant_id) values (new.id, tid) on conflict (id) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists on_profile_created on profiles;
create trigger on_profile_created after insert on profiles
  for each row execute procedure provision_profile();

-- ── Coaching relationships (a coach ↔ client link) ──────────────────────────
-- Not created by domain-schema.sql (that path uses clients.trainer_id for RLS).
-- This table records the full relationship + mode + status for the app.
create table if not exists coaching_relationships (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references profiles(id) on delete cascade,
  client_id uuid not null references profiles(id) on delete cascade,
  mode text not null default 'online' check (mode in ('online','inperson')),
  status text not null default 'active' check (status in ('pending','active','ended')),
  created_at timestamptz not null default now(),
  unique (coach_id, client_id)
);
alter table coaching_relationships enable row level security;
drop policy if exists cr_self on coaching_relationships;
create policy cr_self on coaching_relationships for all
  using (coach_id = auth.uid() or client_id = auth.uid())
  with check (coach_id = auth.uid() or client_id = auth.uid());

-- ── Coaching link helper: a client requests / a trainer adds a client ───────
-- Call from the app after Find-a-Trainer request or trainer "add client".
create or replace function link_coaching(p_coach uuid, p_client uuid, p_mode text default 'online')
returns void language sql security definer set search_path = public as $$
  insert into coaching_relationships (coach_id, client_id, mode, status)
  values (p_coach, p_client, coalesce(p_mode,'online'), 'active')
  on conflict (coach_id, client_id) do update set mode = excluded.mode, status = 'active';
  update clients set trainer_id = p_coach where id = p_client;
$$;


-- ─────────────────────────────────────────────────────────────────────────
-- ▶ auth-setup.sql
-- ─────────────────────────────────────────────────────────────────────────
-- ═══════════════════════════════════════════════════════════════════════════
-- Repple — Phase 1 auth wiring ONLY.
-- Safe to run on a database that already has the tables (idempotent):
-- every statement either uses "if not exists" or drops-then-recreates.
-- Run this instead of the full schema.sql when the tables already exist.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists "uuid-ossp";

-- Profiles table (no-op if it already exists) ────────────────────────────────
create table if not exists profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  role       text not null check (role in ('owner','trainer','client')),
  tenant_id  uuid references tenants(id) on delete set null,
  full_name  text,
  avatar     text,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

-- A user can read/write ONLY their own profile row ───────────────────────────
drop policy if exists profiles_self on profiles;
drop policy if exists profile_self  on profiles;
create policy profiles_self on profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

-- Auto-create the profile row the instant a user signs up ────────────────────
-- Runs as SECURITY DEFINER so the insert bypasses RLS (no session yet).
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
-- ▶ roster-access.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Repple roster access — lets a trainer read their own clients (and those
-- clients' names) so linked accounts appear in the coach's roster with real IDs.
-- Depends on schema.sql (clients, profiles). Idempotent; safe to re-run.

drop policy if exists clients_trainer_read on clients;
create policy clients_trainer_read on clients for select
  using (trainer_id = auth.uid());

drop policy if exists profiles_trainer_read on profiles;
create policy profiles_trainer_read on profiles for select
  using (exists (select 1 from clients c where c.id = profiles.id and c.trainer_id = auth.uid()));


-- ─────────────────────────────────────────────────────────────────────────
-- ▶ sessions-access.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Repple sessions/bookings access. A trainer manages their own slots; a client
-- reads their coach's slots + their own bookings, and books/cancels via RPCs
-- (SECURITY DEFINER, so no broad client UPDATE grant is needed).
-- Depends on schema.sql (sessions, clients). Idempotent; safe to re-run.

alter table sessions enable row level security;

drop policy if exists sessions_trainer on sessions;
create policy sessions_trainer on sessions for all
  using (trainer_id = auth.uid()) with check (trainer_id = auth.uid());

drop policy if exists sessions_client_read on sessions;
create policy sessions_client_read on sessions for select
  using (
    client_id = auth.uid()
    or exists (select 1 from clients c where c.id = auth.uid() and c.trainer_id = sessions.trainer_id)
  );

create or replace function book_session(p_session uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update sessions set client_id = auth.uid(), status = 'booked', released = false
   where id = p_session and status = 'available'
     and exists (select 1 from clients c where c.id = auth.uid() and c.trainer_id = sessions.trainer_id);
end $$;

create or replace function cancel_session(p_session uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update sessions set client_id = null, status = 'available', released = true
   where id = p_session and client_id = auth.uid();
end $$;


-- ─────────────────────────────────────────────────────────────────────────
-- ▶ messages-setup.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Repple messaging — RLS + realtime for the coach↔client chat thread.
-- The thread is keyed by the client's id (messages.client_id = the client).
-- Depends on schema.sql (messages, clients) + domain-schema.sql (is_my_client).
-- Idempotent; safe to re-run.

alter table messages enable row level security;

drop policy if exists msg_client on messages;
create policy msg_client on messages for all
  using (client_id = auth.uid())
  with check (client_id = auth.uid() and sender = 'client');

drop policy if exists msg_coach on messages;
create policy msg_coach on messages for all
  using (is_my_client(client_id))
  with check (is_my_client(client_id) and sender = 'coach');

do $$
begin
  begin
    alter publication supabase_realtime add table messages;
  exception
    when duplicate_object then null;
    when others then null;
  end;
end $$;


-- ─────────────────────────────────────────────────────────────────────────
-- ▶ coach-invites.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Repple coach invites — a trainer invites a client by email; the client accepts
-- to link the two accounts. Depends on link_coaching() from
-- account-provisioning.sql (run that first). Idempotent; safe to re-run.

create table if not exists coach_invites (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references profiles(id) on delete cascade,
  coach_name text,
  email text not null,
  mode text not null default 'online' check (mode in ('online','inperson')),
  status text not null default 'pending' check (status in ('pending','accepted','revoked')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid references profiles(id) on delete set null,
  unique (coach_id, email)
);
create index if not exists idx_coach_invites_email on coach_invites (lower(email));

alter table coach_invites enable row level security;

-- The coach manages their own invites (create / list / revoke).
drop policy if exists ci_coach on coach_invites;
create policy ci_coach on coach_invites for all
  using (coach_id = auth.uid()) with check (coach_id = auth.uid());

-- The invited person (matched by the email on their login) can read invites
-- addressed to them so the app can show the pending invitation.
drop policy if exists ci_invitee_read on coach_invites;
create policy ci_invitee_read on coach_invites for select
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- Accept an invite addressed to me: links coach↔client (via link_coaching) and
-- marks the invite accepted. SECURITY DEFINER so it can write across the link.
create or replace function accept_invite(p_invite uuid)
returns void language plpgsql security definer set search_path = public as $$
declare inv coach_invites; my_email text;
begin
  select email into my_email from auth.users where id = auth.uid();
  select * into inv from coach_invites where id = p_invite;
  if inv.id is null then raise exception 'invite not found'; end if;
  if lower(inv.email) <> lower(coalesce(my_email, '')) then
    raise exception 'invite not addressed to you';
  end if;
  perform link_coaching(inv.coach_id, auth.uid(), inv.mode);
  update coach_invites
     set status = 'accepted', accepted_at = now(), accepted_by = auth.uid()
   where id = p_invite;
end $$;


-- ─────────────────────────────────────────────────────────────────────────
-- ▶ trainer-invites.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Repple owner → trainer invites. The platform owner invites a trainer by email;
-- the trainer signs in with that email, accepts, and is attached to the owner's
-- tenant as a trainer with a trial billing record — then completes their profile.
-- Depends on schema.sql (tenants/profiles/trainers) + domain-schema.sql
-- (trainer_billing). Idempotent; safe to re-run.

create table if not exists trainer_invites (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  owner_name text,
  tenant_id uuid references tenants(id) on delete set null,
  email text not null,
  status text not null default 'pending' check (status in ('pending','accepted','revoked')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid references profiles(id) on delete set null,
  unique (owner_id, email)
);
create index if not exists idx_trainer_invites_email on trainer_invites (lower(email));

alter table trainer_invites enable row level security;

drop policy if exists ti_owner on trainer_invites;
create policy ti_owner on trainer_invites for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists ti_invitee_read on trainer_invites;
create policy ti_invitee_read on trainer_invites for select
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

create or replace function accept_trainer_invite(p_invite uuid)
returns void language plpgsql security definer set search_path = public as $$
declare inv trainer_invites; my_email text; ten uuid;
begin
  select email into my_email from auth.users where id = auth.uid();
  select * into inv from trainer_invites where id = p_invite;
  if inv.id is null then raise exception 'invite not found'; end if;
  if lower(inv.email) <> lower(coalesce(my_email, '')) then
    raise exception 'invite not addressed to you';
  end if;
  ten := coalesce(inv.tenant_id, (select tenant_id from profiles where id = inv.owner_id));
  update profiles set role = 'trainer', tenant_id = coalesce(ten, tenant_id) where id = auth.uid();
  if ten is not null then
    insert into trainers (id, tenant_id) values (auth.uid(), ten)
      on conflict (id) do update set tenant_id = excluded.tenant_id;
    insert into trainer_billing (trainer_id, tenant_id, plan, mrr, status)
      values (auth.uid(), ten, 'Pro', 0, 'trial')
      on conflict (trainer_id) do nothing;
  end if;
  update trainer_invites
     set status = 'accepted', accepted_at = now(), accepted_by = auth.uid()
   where id = p_invite;
end $$;


-- ─────────────────────────────────────────────────────────────────────────
-- ▶ program-templates.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Repple program templates — a coach's reusable weekly programs ("build once,
-- assign to many"). Each row is one saved template owned by the coach; the
-- `program` JSONB is the same shape assigned to clients. Idempotent.

create table if not exists program_templates (
  id         text primary key,
  coach_id   uuid not null references profiles(id) on delete cascade,
  name       text not null,
  program    jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_program_templates_coach on program_templates(coach_id);

alter table program_templates enable row level security;

-- A coach reads/writes only their own templates.
drop policy if exists program_templates_self on program_templates;
create policy program_templates_self on program_templates for all
  using (coach_id = auth.uid()) with check (coach_id = auth.uid());


-- ─────────────────────────────────────────────────────────────────────────
-- ▶ client-tags.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Repple client tags — coach-owned labels on clients ("comp prep", "new",
-- "paused", "high-touch"…) that drive roster segments/filters. Each row is one
-- (coach, client, tag). A coach manages only their own tags. Idempotent.

create table if not exists client_tags (
  coach_id  uuid not null references profiles(id) on delete cascade,
  client_id uuid not null,
  tag       text not null,
  created_at timestamptz not null default now(),
  primary key (coach_id, client_id, tag)
);
create index if not exists idx_client_tags_coach on client_tags(coach_id);

alter table client_tags enable row level security;

-- A coach reads/writes only the tags they created.
drop policy if exists client_tags_self on client_tags;
create policy client_tags_self on client_tags for all
  using (coach_id = auth.uid()) with check (coach_id = auth.uid());


-- ─────────────────────────────────────────────────────────────────────────
-- ▶ push-tokens.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Repple push tokens — each user's Expo push token(s) for remote notifications.
-- The app upserts here on login; the send-push edge function reads them (via the
-- service role) to deliver notifications. Idempotent; safe to re-run.

create table if not exists push_tokens (
  token text primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  platform text default 'expo',
  updated_at timestamptz not null default now()
);
create index if not exists idx_push_tokens_user on push_tokens(user_id);

alter table push_tokens enable row level security;

drop policy if exists pt_self on push_tokens;
create policy pt_self on push_tokens for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());


-- ─────────────────────────────────────────────────────────────────────────
-- ▶ wearable-tokens.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Repple wearable OAuth tokens — one row per (user, cloud provider). Written ONLY
-- by the wearable-oauth / wearable-day edge functions via the service role, so
-- access/refresh tokens are never exposed to the app. Users may delete their own
-- row to disconnect. Idempotent; safe to re-run.

create table if not exists wearable_tokens (
  user_id       uuid not null references profiles(id) on delete cascade,
  provider      text not null,
  access_token  text not null,
  refresh_token text,
  expires_at    timestamptz,
  updated_at    timestamptz not null default now(),
  primary key (user_id, provider)
);

alter table wearable_tokens enable row level security;

drop policy if exists wearable_tokens_delete_own on wearable_tokens;
create policy wearable_tokens_delete_own on wearable_tokens for delete
  using (user_id = auth.uid());


-- ─────────────────────────────────────────────────────────────────────────
-- ▶ app-errors.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Repple crash/error log — the app's ErrorBoundary writes caught render errors
-- here (best-effort) so the platform owner can review them in the Owner ▸ Feedback
-- inbox without a heavyweight crash reporter. Any signed-in user logs their own
-- errors; the owner reads them all. Depends on schema.sql (profiles).
-- Idempotent; safe to re-run.

create table if not exists app_errors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete set null,
  message text not null,
  stack text,
  platform text,
  app_version text,
  created_at timestamptz not null default now()
);
create index if not exists idx_app_errors_created on app_errors (created_at desc);

alter table app_errors enable row level security;

-- A signed-in user can log an error attributed to themselves (or anonymously).
drop policy if exists app_errors_insert on app_errors;
create policy app_errors_insert on app_errors for insert
  with check (user_id = auth.uid() or user_id is null);

-- The platform owner reads every error.
drop policy if exists app_errors_owner on app_errors;
create policy app_errors_owner on app_errors for select using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'owner')
);


-- ─────────────────────────────────────────────────────────────────────────
-- ▶ feedback.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Repple in-app feedback. Any signed-in user (trainer tester, client) submits a
-- rating + note; the platform owner reads them all in the Owner portal.
-- Depends on schema.sql (profiles/tenants) + domain-schema.sql (is_owner_of).
-- Idempotent; safe to re-run.

create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete set null,
  role text,
  tenant_id uuid references tenants(id) on delete set null,
  rating int check (rating between 1 and 5),
  category text,
  body text not null,
  app_version text,
  created_at timestamptz not null default now()
);
create index if not exists idx_feedback_created on feedback (created_at desc);

alter table feedback enable row level security;

drop policy if exists fb_insert on feedback;
create policy fb_insert on feedback for insert with check (user_id = auth.uid());

drop policy if exists fb_own on feedback;
create policy fb_own on feedback for select using (user_id = auth.uid());

drop policy if exists fb_owner on feedback;
create policy fb_owner on feedback for select using (
  is_owner_of(tenant_id)
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'owner')
);


-- ─────────────────────────────────────────────────────────────────────────
-- ▶ trainer-read-access.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Repple trainer read access — lets a trainer SELECT their linked clients'
-- domain data so the coach roster & client detail show REAL progress (weight
-- change, last-active, self-reported adherence), not placeholders.
-- Mirrors scans_trainer_read / food_trainer_read. Depends on domain-schema.sql
-- (workouts/measurements/check_ins/habit_logs, user_id) + clients.trainer_id.
-- Idempotent; safe to re-run.

drop policy if exists workouts_trainer_read on workouts;
create policy workouts_trainer_read on workouts for select
  using (exists (select 1 from clients c where c.id = workouts.user_id and c.trainer_id = auth.uid()));

drop policy if exists meas_trainer_read on measurements;
create policy meas_trainer_read on measurements for select
  using (exists (select 1 from clients c where c.id = measurements.user_id and c.trainer_id = auth.uid()));

drop policy if exists checkins_trainer_read on check_ins;
create policy checkins_trainer_read on check_ins for select
  using (exists (select 1 from clients c where c.id = check_ins.user_id and c.trainer_id = auth.uid()));

drop policy if exists habits_trainer_read on habit_logs;
create policy habits_trainer_read on habit_logs for select
  using (exists (select 1 from clients c where c.id = habit_logs.user_id and c.trainer_id = auth.uid()));

