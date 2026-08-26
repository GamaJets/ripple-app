-- ═══════════════════════════════════════════════════════════════════════════
-- Repple — ONE-SHOT Supabase setup. Paste this whole file into the Supabase
-- SQL editor (Dashboard ▸ SQL Editor ▸ New query) and Run.
-- Every part below is idempotent; order is dependency-correct and safe to re-run.
-- GENERATED from supabase/parts/*.sql by scripts/build-supabase-setup.mjs.
-- Do not hand-edit — edit the part and rebuild.
-- ═══════════════════════════════════════════════════════════════════════════

-- ▶ schema.sql

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
-- Seconds spent in each heart-rate zone, written when a session had a live HR
-- source. Live already had this column; the repo did not describe it.
alter table workouts add column if not exists zones jsonb;

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

-- ── Gym classes (multi-location group-class booking) ────────────────────────
create table if not exists gym_classes (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid references trainers(id) on delete set null,
  title text not null,
  kind text,
  instructor text,
  branch text,
  room text,
  starts_at timestamptz not null,
  duration_min int not null default 45,
  capacity int not null default 12,
  created_at timestamptz not null default now()
);
create index if not exists idx_gym_classes_start on gym_classes(starts_at);
create index if not exists idx_gym_classes_branch on gym_classes(branch);

create table if not exists class_bookings (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references gym_classes(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  status text not null default 'booked' check (status in ('booked','waitlist')),
  created_at timestamptz not null default now(),
  unique (class_id, user_id)
);
create index if not exists idx_class_bookings_class on class_bookings(class_id);

alter table gym_classes    enable row level security;
alter table class_bookings enable row level security;
drop policy if exists gym_classes_read on gym_classes;
create policy gym_classes_read on gym_classes for select using (auth.role() = 'authenticated');
drop policy if exists gym_classes_write on gym_classes;
create policy gym_classes_write on gym_classes for all using (trainer_id = auth.uid()) with check (trainer_id = auth.uid());
drop policy if exists class_bookings_self on class_bookings;
create policy class_bookings_self on class_bookings for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Book a class; returns 'booked' or 'waitlist'. Capacity-safe via row lock.
create or replace function book_class(p_class uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_cap int; v_count int; v_status text;
begin
  perform 1 from gym_classes where id = p_class for update;
  select capacity into v_cap from gym_classes where id = p_class;
  if v_cap is null then return 'notfound'; end if;
  select count(*) into v_count from class_bookings where class_id = p_class and status = 'booked';
  v_status := case when v_count < v_cap then 'booked' else 'waitlist' end;
  insert into class_bookings (class_id, user_id, status) values (p_class, auth.uid(), v_status)
    on conflict (class_id, user_id) do update set status = excluded.status;
  return v_status;
end; $$;

-- Cancel my booking; promote the earliest waitlister if a seat opens.
create or replace function cancel_class(p_class uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from class_bookings where class_id = p_class and user_id = auth.uid();
  update class_bookings set status = 'booked'
   where id = (
     select cb.id from class_bookings cb join gym_classes gc on gc.id = cb.class_id
     where cb.class_id = p_class and cb.status = 'waitlist'
       and (select count(*) from class_bookings b where b.class_id = p_class and b.status = 'booked') < gc.capacity
     order by cb.created_at asc limit 1
   );
end; $$;

-- Confirmed counts per class (for spots-left display across all members).
create or replace function class_counts()
returns table(class_id uuid, booked int) language sql security definer set search_path = public as $$
  select class_id, count(*)::int from class_bookings where status = 'booked' group by class_id;
$$;
grant execute on function book_class(uuid)   to authenticated;
grant execute on function cancel_class(uuid) to authenticated;
grant execute on function class_counts()     to authenticated;

-- ── GDPR: right to erasure (deletion request flag) ──────────────────────────
alter table profiles add column if not exists deletion_requested_at timestamptz;
create or replace function request_account_deletion()
returns void language plpgsql security definer set search_path = public as $$
begin
  update profiles set deletion_requested_at = now() where id = auth.uid();
end; $$;
grant execute on function request_account_deletion() to authenticated;

-- Re-offer a freed PT slot to the trainer other clients (member cancelled).
-- Guarded: only a client of that trainer can trigger it. Ids only, no names.
create or replace function reoffer_client_ids(p_session uuid)
returns table(client_id uuid) language sql security definer set search_path = public as $$
  select c.id from clients c
  where c.trainer_id = (select trainer_id from sessions where id = p_session)
    and c.id <> auth.uid()
    and exists (
      select 1 from clients me
      where me.id = auth.uid()
        and me.trainer_id = (select trainer_id from sessions where id = p_session)
    );
$$;
grant execute on function reoffer_client_ids(uuid) to authenticated;

-- All member ids for an owner-wide promotion push (owner role only). Ids only.
create or replace function all_member_ids()
returns table(user_id uuid) language sql security definer set search_path = public as $$
  select c.id from clients c
  where exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'owner');
$$;

-- Owner-only by role, and not reachable at all without signing in.
revoke all on function all_member_ids() from public;
revoke execute on function all_member_ids() from public, anon;
grant execute on function all_member_ids() to authenticated;
grant execute on function all_member_ids() to authenticated;

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

-- ▶ billing.sql

-- Repple billing (Stripe). The platform owner charges TRAINERS a subscription
-- (the white-label fee). These tables are written ONLY by the stripe-webhook
-- edge function via the service role; the app reads its own rows. Idempotent.
-- Depends on schema.sql (profiles with a `role` column). Client payments to
-- trainers (Stripe Connect) are a separate later phase — not in this file.

create table if not exists billing_customers (
  trainer_id uuid primary key references profiles(id) on delete cascade,
  stripe_customer_id text not null unique,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists subscriptions (
  trainer_id uuid primary key references profiles(id) on delete cascade,
  stripe_subscription_id text unique,
  plan text,
  status text,                     -- active | trialing | past_due | canceled | unpaid | incomplete
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists invoices (
  id text primary key,             -- stripe invoice id
  trainer_id uuid references profiles(id) on delete set null,
  amount_due integer,              -- cents
  currency text,
  status text,                     -- paid | open | uncollectible | void
  attempt_count integer,
  hosted_invoice_url text,
  created_at timestamptz not null default now()
);
create index if not exists idx_invoices_trainer on invoices (trainer_id, created_at desc);

alter table billing_customers enable row level security;
alter table subscriptions enable row level security;
alter table invoices enable row level security;

-- A trainer sees their own billing; the owner sees everyone's (for dunning).
drop policy if exists cust_read on billing_customers;
create policy cust_read on billing_customers for select using (
  trainer_id = auth.uid() or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'owner'));
drop policy if exists sub_read on subscriptions;
create policy sub_read on subscriptions for select using (
  trainer_id = auth.uid() or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'owner'));
drop policy if exists inv_read on invoices;
create policy inv_read on invoices for select using (
  trainer_id = auth.uid() or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'owner'));

-- ▶ connect.sql

-- Stripe Connect — trainers get paid by THEIR clients (marketplace layer on top
-- of the platform subscription billing in billing.sql). Each trainer is a Stripe
-- Express connected account; clients pay via Checkout with the platform taking an
-- application fee. Connect tables are written by the connect-* edge functions via
-- the service role; trainers manage their own packages directly (RLS). Idempotent.

create table if not exists connect_accounts (
  trainer_id uuid primary key references profiles(id) on delete cascade,
  stripe_account_id text unique,
  charges_enabled boolean not null default false,
  details_submitted boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists trainer_packages (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  price_cents integer not null,        -- price in cents
  currency text not null default 'usd',
  sessions integer,                    -- null = membership/one-off; N = a session pack
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_packages_trainer on trainer_packages (trainer_id) where active;

create table if not exists client_purchases (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references profiles(id) on delete set null,
  trainer_id uuid references profiles(id) on delete set null,
  package_id uuid references trainer_packages(id) on delete set null,
  stripe_session_id text unique,
  amount_cents integer,
  sessions_total integer,
  sessions_used integer not null default 0,
  status text not null default 'paid',
  created_at timestamptz not null default now()
);
create index if not exists idx_purchases_client on client_purchases (client_id, created_at desc);
create index if not exists idx_purchases_trainer on client_purchases (trainer_id, created_at desc);

alter table connect_accounts enable row level security;
alter table trainer_packages enable row level security;
alter table client_purchases enable row level security;

-- Connect account: the trainer reads their own; the owner reads all.
drop policy if exists conn_read on connect_accounts;
create policy conn_read on connect_accounts for select using (
  trainer_id = auth.uid() or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'owner'));

-- Packages: any signed-in user reads ACTIVE packages (clients browse); a trainer
-- fully manages their own (create/edit/deactivate) straight from the app.
drop policy if exists pkg_read on trainer_packages;
create policy pkg_read on trainer_packages for select using (active or trainer_id = auth.uid());
drop policy if exists pkg_write on trainer_packages;
create policy pkg_write on trainer_packages for all using (trainer_id = auth.uid()) with check (trainer_id = auth.uid());

-- Purchases: the client sees their own, the trainer sees theirs, the owner all.
drop policy if exists purch_read on client_purchases;
create policy purch_read on client_purchases for select using (
  client_id = auth.uid() or trainer_id = auth.uid()
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'owner'));

-- ▶ session-approvals.sql

-- Client approval of a delivered PT session, with the optional comment the
-- pt-sessions screen has always collected and never sent anywhere.
--
-- The approval lives in its own table rather than as columns on `sessions`
-- because `sessions_client_read` lets a client read sessions belonging to their
-- trainer. A note column on `sessions` would therefore be readable by every
-- other client of that trainer. Row-level security cannot restrict individual
-- columns, so the note gets its own table with its own policy: the client who
-- wrote it, and the trainer who delivered the session.

create table if not exists public.session_approvals (
  session_id  uuid primary key references public.sessions(id) on delete cascade,
  client_id   uuid not null references auth.users(id) on delete cascade,
  approved_at timestamptz not null default now(),
  note        text
);

alter table public.session_approvals enable row level security;

drop policy if exists session_approvals_read on public.session_approvals;
create policy session_approvals_read on public.session_approvals
  for select using (
    client_id = (select auth.uid())
    or exists (
      select 1 from public.sessions s
       where s.id = session_approvals.session_id
         and s.trainer_id = (select auth.uid())
    )
  );

-- Deliberately no insert/update/delete policies. Every write goes through
-- approve_session() so a client cannot approve on someone else's behalf, and
-- cannot reach status or trainer_id while doing it.
grant select on public.session_approvals to authenticated;

create or replace function public.approve_session(p_session uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not exists (
    select 1 from sessions s
     where s.id = p_session
       and s.client_id = auth.uid()
       and s.status = 'booked'
       and s.starts_at <= now()
  ) then
    -- Covers all three refusals: not yours, not booked, or not yet delivered.
    raise exception 'That session cannot be approved.';
  end if;

  insert into session_approvals (session_id, client_id, note)
  values (p_session, auth.uid(), v_note)
  on conflict (session_id) do update
     set note = excluded.note, approved_at = now();
end
$function$;

revoke all on function public.approve_session(uuid, text) from public;
revoke execute on function public.approve_session(uuid, text) from public, anon;
grant execute on function public.approve_session(uuid, text) to authenticated;

-- Unrelated to approvals, found while reading the policy: clients could read
-- every session of their trainer, including which client was booked into each
-- slot. Every client screen already filters to `available` or `mine`, so
-- narrowing this changes no UI -- it just stops other clients' rows leaving the
-- database.
drop policy if exists sessions_client_read on public.sessions;
create policy sessions_client_read on public.sessions
  for select using (
    client_id = (select auth.uid())
    or (
      status = 'available'
      and exists (
        select 1 from public.clients c
         where c.id = (select auth.uid())
           and c.trainer_id = sessions.trainer_id
      )
    )
  );

-- ▶ trainer-directory.sql

-- Trainer directory → coaching request → roster.
--
-- DUMPED FROM THE LIVE DATABASE (project phgfwzpkkwdysftlgkoq), not authored
-- here. These objects were applied by hand in an earlier session and had never
-- been written down; an earlier reconstruction of them from the app's call sites
-- got several details wrong, so this file is the database's own definition.
-- Re-running it against live is a no-op.

-- ── Public-facing trainer profile ───────────────────────────────────────────
-- Nullable with no defaults, matching live. (A reconstruction had these NOT NULL
-- with defaults, which `add column if not exists` would have silently skipped.)
alter table trainers add column if not exists tagline     text;
alter table trainers add column if not exists offers      text[];
alter table trainers add column if not exists specialties text[];
alter table trainers add column if not exists session_fee numeric;
alter table trainers add column if not exists listed      boolean not null default false;

create index if not exists trainers_listed_idx on trainers(listed) where listed;

alter table trainers enable row level security;

-- Five policies, all SELECT except the trainer's own row. `trainers` is readable
-- far more narrowly than the repo previously suggested.
drop policy if exists trainers_self_rw on trainers;
create policy trainers_self_rw on trainers
  for all using ((select auth.uid()) = id);

drop policy if exists trainers_public_directory_r on trainers;
create policy trainers_public_directory_r on trainers
  for select to authenticated using (listed = true);

drop policy if exists trainers_owner_r on trainers;
create policy trainers_owner_r on trainers
  for select using (is_owner_of(tenant_id));

drop policy if exists trainers_peer_r on trainers;
create policy trainers_peer_r on trainers
  for select using (exists (
    select 1 from trainers t1
     where t1.id = (select auth.uid()) and t1.tenant_id = trainers.tenant_id));

drop policy if exists trainers_assigned_client_r on trainers;
create policy trainers_assigned_client_r on trainers
  for select using (exists (
    select 1 from coach_clients
     where coach_clients.trainer_id = trainers.id
       and coach_clients.id = (select auth.uid())));

-- ── Coaching requests ───────────────────────────────────────────────────────
create table if not exists coach_requests (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references profiles(id) on delete cascade,
  trainer_id   uuid not null references profiles(id) on delete cascade,
  mode         text not null default 'online'  check (mode in ('online','inperson')),
  status       text not null default 'pending' check (status in ('pending','accepted','declined','withdrawn')),
  note         text,
  created_at   timestamptz not null default now(),
  responded_at timestamptz
);

-- Partial unique: one PENDING request per pair, but a declined request can be
-- sent again later. A plain unique (client_id, trainer_id) would have blocked
-- that forever; this is what makes trainers.tsx's duplicate handling correct.
create unique index if not exists coach_requests_one_pending
  on coach_requests(client_id, trainer_id) where status = 'pending';
create index if not exists coach_requests_client_idx  on coach_requests(client_id, status);
create index if not exists coach_requests_trainer_idx on coach_requests(trainer_id, status);

alter table coach_requests enable row level security;

drop policy if exists coach_requests_client_rw on coach_requests;
create policy coach_requests_client_rw on coach_requests
  for all to authenticated
  using (client_id = (select auth.uid()))
  with check (client_id = (select auth.uid()));

drop policy if exists coach_requests_trainer_r on coach_requests;
create policy coach_requests_trainer_r on coach_requests
  for select to authenticated using (trainer_id = (select auth.uid()));

drop policy if exists coach_requests_trainer_u on coach_requests;
create policy coach_requests_trainer_u on coach_requests
  for update to authenticated
  using (trainer_id = (select auth.uid()))
  with check (trainer_id = (select auth.uid()));

-- ── Coach-created roster entries ────────────────────────────────────────────
-- `id` is not a foreign key: a coach adds clients by hand who have no auth
-- account. `trainer_id` references auth.users directly, not profiles.
create table if not exists coach_clients (
  id         uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  goal       text,
  mode       text not null default 'online' check (mode in ('online','inperson')),
  created_at timestamptz not null default now()
);

create index if not exists coach_clients_trainer_idx on coach_clients(trainer_id, created_at);

alter table coach_clients enable row level security;

-- cc_own and coach_clients_trainer_rw are redundant with each other; both exist
-- live and both are reproduced so this file matches the database exactly.
drop policy if exists cc_own on coach_clients;
create policy cc_own on coach_clients
  for all using (trainer_id = (select auth.uid()))
  with check (trainer_id = (select auth.uid()));

drop policy if exists coach_clients_trainer_rw on coach_clients;
create policy coach_clients_trainer_rw on coach_clients
  for all using ((select auth.uid()) = trainer_id);

drop policy if exists coach_clients_client_r on coach_clients;
create policy coach_clients_client_r on coach_clients
  for select using ((select auth.uid()) = id);

drop policy if exists coach_clients_owner_r on coach_clients;
create policy coach_clients_owner_r on coach_clients
  for select using (exists (
    select 1 from profiles
     where profiles.id = (select auth.uid()) and profiles.role = 'owner'));

-- ▶ trainer-availability.sql

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

-- ▶ class-attendance.sql

-- Group-class attendance: the trainer checks members into a class, the owner
-- reads fill rates for payroll and analytics.
--
-- DUMPED FROM THE LIVE DATABASE. The important detail, and the one a
-- reconstruction got wrong: attendance is recorded as `class_bookings.attended_at
-- is not null`. There is no `attended` boolean column. Adding one and switching
-- the functions to it would have orphaned every attendance already recorded.

alter table class_bookings add column if not exists attended_at timestamptz;

create index if not exists idx_class_bookings_user_id on class_bookings(user_id);

-- The owner of the tenant that owns the class can read its bookings.
drop policy if exists class_bookings_owner_r on class_bookings;
create policy class_bookings_owner_r on class_bookings
  for select using (exists (
    select 1 from gym_classes gc
      join trainers t on t.id = gc.trainer_id
     where gc.id = class_bookings.class_id and is_owner_of(t.tenant_id)));

-- ── The check-in roster for one class ───────────────────────────────────────
-- Readable by the class's trainer OR an owner.
create or replace function public.class_roster(p_class uuid)
returns table(user_id uuid, name text, status text, attended boolean)
language sql
security definer
set search_path to 'public'
as $function$
  select cb.user_id,
         coalesce(p.full_name, 'Member') as name,
         cb.status,
         (cb.attended_at is not null) as attended
  from class_bookings cb
  left join profiles p on p.id = cb.user_id
  where cb.class_id = p_class
    and ( exists (select 1 from gym_classes gc where gc.id = p_class and gc.trainer_id = auth.uid())
          or exists (select 1 from profiles o where o.id = auth.uid() and o.role = 'owner') )
  order by name;
$function$;

-- ── Mark one member present or absent ───────────────────────────────────────
create or replace function public.set_class_attendance(p_class uuid, p_user uuid, p_present boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not exists (select 1 from gym_classes gc where gc.id = p_class and gc.trainer_id = auth.uid()) then
    raise exception 'not your class';
  end if;
  update class_bookings
     set attended_at = case when p_present then now() else null end
   where class_id = p_class and user_id = p_user;
end; $function$;

-- ── Attendance over a date range ────────────────────────────────────────────
-- Visible to the class's own trainer OR an owner, and the range is half-open
-- (>= p_from, < p_to). Parameter names are load-bearing: PostgREST binds by
-- name, so they must match src/lib/classAttendance.ts exactly.
--
-- Note for anything calling this server-side: the guard is on auth.uid(), which
-- is NULL under the service role, so a service-role call returns zero rows.
create or replace function public.class_attendance_summary(p_from timestamptz, p_to timestamptz)
returns table(class_id uuid, title text, kind text, branch text, trainer_id uuid,
              trainer_name text, starts_at timestamptz, booked integer, attended integer)
language sql
security definer
set search_path to 'public'
as $function$
  select gc.id, gc.title, gc.kind, gc.branch, gc.trainer_id,
         coalesce(tp.full_name, 'Trainer') as trainer_name, gc.starts_at,
         count(cb.id) filter (where cb.status = 'booked')::int as booked,
         count(cb.attended_at)::int as attended
  from gym_classes gc
  left join class_bookings cb on cb.class_id = gc.id
  left join profiles tp on tp.id = gc.trainer_id
  where gc.starts_at >= p_from and gc.starts_at < p_to
    and ( gc.trainer_id = auth.uid()
          or exists (select 1 from profiles o where o.id = auth.uid() and o.role = 'owner') )
  group by gc.id, tp.full_name
  order by gc.starts_at desc;
$function$;

-- ▶ message-notifications.sql

-- Push + in-app notification on a new message.
--
-- An AFTER INSERT trigger on `messages` posts to the `notify-message` edge
-- function via pg_net; that function resolves the recipient, writes the
-- notifications row and sends the Expo push.
--
-- `notify-message` runs with verify_jwt:false, so it is publicly reachable and
-- this shared secret is its ONLY authentication. The secret is read from Vault
-- at call time and is deliberately not a literal here: the original version of
-- this function carried it in plaintext in its body, where anything able to read
-- pg_proc could read it. That value has been rotated.
--
-- Rotating again needs no change to this file — set a new value in BOTH:
--   • Vault secret `hook_secret`  (Dashboard ▸ Project Settings ▸ Vault)
--   • edge function secret `HOOK_SECRET`
-- Between saving the second one and the first, pushes are skipped; messages
-- themselves are unaffected.

create or replace function public.notify_on_message()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'hook_secret'
   limit 1;

  -- No secret configured: skip rather than post an unauthenticated request.
  if v_secret is null or v_secret = '' then
    return NEW;
  end if;

  perform net.http_post(
    url     := 'https://phgfwzpkkwdysftlgkoq.supabase.co/functions/v1/notify-message',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := jsonb_build_object(
      'secret',    v_secret,
      'client_id', NEW.client_id,
      'sender',    NEW.sender,
      'body',      NEW.body
    )
  );
  return NEW;
-- A failed notification must never block the message itself from being written.
exception when others then
  return NEW;
end;
$function$;

drop trigger if exists on_message_insert on public.messages;
create trigger on_message_insert
  after insert on public.messages
  for each row execute function notify_on_message();

-- ▶ owner-portal-access.sql

-- Owner portal reads.
--
-- `profiles.role = 'owner'` means a GYM owner, scoped to their tenant — the
-- meaning the rest of the policies already assumed via is_owner_of(tenant_id).
-- Reading the live policies, an owner can already see their tenant's profiles,
-- clients, trainers and the tenant row itself. One table was missing.
--
-- Without this an owner cannot read sessions at all, so "sessions delivered"
-- and any payroll figure derived from it have nothing behind them. The portal
-- would show zero and the zero would be a permissions artefact rather than a
-- fact about the gym — which is the exact failure this codebase keeps removing.

drop policy if exists sessions_owner_r on sessions;
create policy sessions_owner_r on sessions
  for select using (
    exists (
      select 1 from trainers t
       where t.id = sessions.trainer_id
         and is_owner_of(t.tenant_id)
    )
  );

-- ▶ fix-profiles-recursion.sql

-- Every authenticated read of `profiles` was failing:
--
--   infinite recursion detected in policy for relation "profiles"
--
-- The visible damage was small and constant. The client dashboard greeted
-- people with "Good afternoon" and no name, the Me screen showed no name, and
-- the avatar fell back to a hardcoded letter. The app swallowed the error and
-- rendered defaults, so it looked like cosmetic polish rather than a table that
-- could not be read at all.
--
-- Three separate cycles, all the same shape — a policy asking a question whose
-- answer lives in a table that is itself policed:
--
--   1. `profiles_trainer_r_peers` / `_r_clients` asked "what is my role?" with a
--      sub-select on `profiles`, from inside a policy ON `profiles`.
--   2. Nine policies across eight other tables asked "am I an owner?" the same
--      way. Reachable from `profiles` via trainers → coach_clients, so they
--      closed the loop from outside.
--   3. `trainers_peer_r` asked "am I a trainer in this tenant?" with a
--      sub-select on `trainers`, from inside a policy ON `trainers`.
--
-- The fix is one idea applied everywhere: ask those questions through a
-- SECURITY DEFINER function, which runs as the table owner and does not
-- re-enter RLS.
--
-- `is_owner_of` looked like it already did this and did not — it was declared
-- STABLE but SECURITY INVOKER, so it recursed like the rest. It is corrected
-- here too.

create or replace function public.my_role()
returns text language sql stable security definer set search_path to 'public'
as $function$ select role from profiles where id = auth.uid() $function$;

create or replace function public.my_tenant()
returns uuid language sql stable security definer set search_path to 'public'
as $function$ select tenant_id from profiles where id = auth.uid() $function$;

revoke all on function public.my_role() from public;
revoke all on function public.my_tenant() from public;
grant execute on function public.my_role() to authenticated;
grant execute on function public.my_tenant() to authenticated;

-- Was SECURITY INVOKER; that is what made it recurse.
create or replace function public.is_owner_of(t uuid)
returns boolean language sql stable security definer set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1 from profiles p
     where p.id = auth.uid() and p.role = 'owner' and p.tenant_id = t
  );
$function$;

-- ── 1. profiles policing profiles ───────────────────────────────────────────
drop policy if exists profiles_trainer_r_peers on profiles;
create policy profiles_trainer_r_peers on profiles
  for select using (my_role() = 'trainer' and role = 'trainer' and tenant_id = my_tenant());

drop policy if exists profiles_trainer_r_clients on profiles;
create policy profiles_trainer_r_clients on profiles
  for select using (
    my_role() = 'trainer'
    and exists (select 1 from coach_clients
                 where coach_clients.trainer_id = auth.uid()
                   and coach_clients.id = profiles.id));

-- ── 2. the "am I an owner?" question, asked from eight other tables ─────────
drop policy if exists app_errors_owner on app_errors;
create policy app_errors_owner on app_errors for select using (my_role() = 'owner');

drop policy if exists purch_read on client_purchases;
create policy purch_read on client_purchases for select using (
  client_id = (select auth.uid()) or trainer_id = (select auth.uid()) or my_role() = 'owner');

drop policy if exists coach_clients_owner_r on coach_clients;
create policy coach_clients_owner_r on coach_clients for select using (my_role() = 'owner');

drop policy if exists conn_read on connect_accounts;
create policy conn_read on connect_accounts for select using (
  trainer_id = (select auth.uid()) or my_role() = 'owner');

drop policy if exists exvid_read on exercise_videos;
create policy exvid_read on exercise_videos for select using (
  trainer_id = (select auth.uid())
  or exists (select 1 from clients c
              where c.id = (select auth.uid()) and c.trainer_id = exercise_videos.trainer_id)
  or my_role() = 'owner');

drop policy if exists fb_owner on feedback;
create policy fb_owner on feedback for select using (
  is_owner_of(tenant_id) or my_role() = 'owner');

drop policy if exists inv_read on invoices;
create policy inv_read on invoices for select using (
  trainer_id = (select auth.uid()) or my_role() = 'owner');

drop policy if exists sub_owner on subscriptions;
create policy sub_owner on subscriptions for select using (my_role() = 'owner');

drop policy if exists tenants_owner_rw on tenants;
create policy tenants_owner_rw on tenants for all
  using (is_owner_of(tenants.id)) with check (is_owner_of(tenants.id));

-- ── 3. trainers policing trainers ───────────────────────────────────────────
drop policy if exists trainers_peer_r on trainers;
create policy trainers_peer_r on trainers
  for select using (my_role() = 'trainer' and tenant_id = my_tenant());

-- ▶ gym-operating-record.sql

-- ── The gym's operating record ──────────────────────────────────────────────
--
-- Phase 1 of the web roadmap. None of this existed, which is why every
-- financial figure in the owner portal read zero: `invoices` and `subscriptions`
-- are keyed on trainer_id and are Repple billing trainers for the product, and
-- `trainer_packages` is a trainer's own PT packages. A gym had nowhere to record
-- a membership or a payment at all.
--
-- Additive only. Nothing here alters an existing table.

-- what the gym sells
create table if not exists membership_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'AED',
  -- `once` covers a day pass or a joining fee; it is not a recurring plan.
  interval text not null default 'month' check (interval in ('month','year','once')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_membership_plans_tenant on membership_plans(tenant_id, active);

-- who holds one
create table if not exists memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  member_id uuid not null references profiles(id) on delete cascade,
  -- A plan may be retired while a membership sold on it is still running, so
  -- this goes null rather than taking the membership with it.
  plan_id uuid references membership_plans(id) on delete set null,
  started_on date not null default current_date,
  -- null means open-ended, which is not the same as expired.
  ends_on date,
  status text not null default 'active'
    check (status in ('active', 'frozen', 'cancelled', 'expired')),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_memberships_tenant on memberships(tenant_id, status);
create index if not exists idx_memberships_member on memberships(member_id);

-- money the gym actually received. Recorded, never inferred: a row here means
-- somebody took money, and there is no other way for one to appear.
create table if not exists gym_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  member_id uuid references profiles(id) on delete set null,
  membership_id uuid references memberships(id) on delete set null,
  amount_cents integer not null,
  currency text not null default 'AED',
  method text not null default 'card'
    check (method in ('card', 'cash', 'transfer', 'direct_debit', 'other')),
  taken_at timestamptz not null default now(),
  note text,
  recorded_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_gym_payments_tenant on gym_payments(tenant_id, taken_at desc);
create index if not exists idx_gym_payments_member on gym_payments(member_id);

-- what the gym billed
create table if not exists gym_invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  member_id uuid not null references profiles(id) on delete cascade,
  membership_id uuid references memberships(id) on delete set null,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'AED',
  issued_on date not null default current_date,
  due_on date,
  status text not null default 'open'
    check (status in ('draft', 'open', 'paid', 'overdue', 'void', 'written_off')),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_gym_invoices_tenant on gym_invoices(tenant_id, status, due_on);
create index if not exists idx_gym_invoices_member on gym_invoices(member_id);

-- ── row-level security ──────────────────────────────────────────────────────
-- The helpers are SECURITY DEFINER, so a policy calling them does not re-enter
-- the table it is protecting — the recursion that once made `profiles`
-- unreadable for everyone (see 28-fix-profiles-recursion.sql).
alter table membership_plans enable row level security;
alter table memberships     enable row level security;
alter table gym_payments    enable row level security;
alter table gym_invoices    enable row level security;

drop policy if exists membership_plans_owner on membership_plans;
create policy membership_plans_owner on membership_plans
  for all using (is_owner_of(tenant_id)) with check (is_owner_of(tenant_id));

drop policy if exists memberships_owner on memberships;
create policy memberships_owner on memberships
  for all using (is_owner_of(tenant_id)) with check (is_owner_of(tenant_id));

drop policy if exists gym_payments_owner on gym_payments;
create policy gym_payments_owner on gym_payments
  for all using (is_owner_of(tenant_id)) with check (is_owner_of(tenant_id));

drop policy if exists gym_invoices_owner on gym_invoices;
create policy gym_invoices_owner on gym_invoices
  for all using (is_owner_of(tenant_id)) with check (is_owner_of(tenant_id));

-- Anyone in the gym may see what is on sale — a price book is not private, and
-- the member-facing booking pages will need it.
drop policy if exists membership_plans_tenant_r on membership_plans;
create policy membership_plans_tenant_r on membership_plans
  for select using (tenant_id = my_tenant() and active);

-- A member reads their own membership, invoices and payments, and nobody else's.
drop policy if exists memberships_own_r on memberships;
create policy memberships_own_r on memberships
  for select using (member_id = (select auth.uid()));

drop policy if exists gym_payments_own_r on gym_payments;
create policy gym_payments_own_r on gym_payments
  for select using (member_id = (select auth.uid()));

drop policy if exists gym_invoices_own_r on gym_invoices;
create policy gym_invoices_own_r on gym_invoices
  for select using (member_id = (select auth.uid()));

-- ▶ classes-tenant-scope.sql

-- ── Classes belong to a gym, not only to a trainer ──────────────────────────
--
-- Two problems.
--
-- First, `gym_classes` reached its tenant only through trainer_id ->
-- trainers.tenant_id, so a class with no trainer assigned was invisible to the
-- owner of the gym running it — and a gym cannot put a class on the timetable
-- before it knows who is teaching it.
--
-- Second, and worse: `gym_classes_read` was `auth.role() = 'authenticated'`,
-- which let any signed-in person read every class in every gym on the platform.
-- A member of one gym could enumerate a competitor's whole timetable. It was
-- corrected while the table was still empty, so no behaviour changed for
-- existing rows.

alter table gym_classes add column if not exists tenant_id uuid references tenants(id) on delete cascade;
create index if not exists idx_gym_classes_tenant on gym_classes(tenant_id, starts_at);

-- Older code paths (the trainer app) insert a class without naming the gym.
-- Rather than break them, derive it from the trainer so scoping stays direct.
create or replace function public.gym_classes_fill_tenant()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.tenant_id is null and new.trainer_id is not null then
    select t.tenant_id into new.tenant_id from trainers t where t.id = new.trainer_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_gym_classes_fill_tenant on gym_classes;
create trigger trg_gym_classes_fill_tenant
  before insert or update on gym_classes
  for each row execute function public.gym_classes_fill_tenant();

-- ── policies ────────────────────────────────────────────────────────────────
-- A row whose tenant_id is null is invisible to a tenant read rather than
-- visible to everyone: unscoped fails closed.
drop policy if exists gym_classes_read on gym_classes;
create policy gym_classes_read on gym_classes
  for select using (tenant_id = my_tenant());

drop policy if exists gym_classes_owner_rw on gym_classes;
create policy gym_classes_owner_rw on gym_classes
  for all using (is_owner_of(tenant_id)) with check (is_owner_of(tenant_id));

-- A trainer keeps managing their own classes.
drop policy if exists gym_classes_write on gym_classes;
create policy gym_classes_write on gym_classes
  for all using (trainer_id = (select auth.uid())) with check (trainer_id = (select auth.uid()));

-- The owner's view of who booked keys off the class's own tenant rather than a
-- second hop through trainers.
drop policy if exists class_bookings_owner_r on class_bookings;
create policy class_bookings_owner_r on class_bookings
  for select using (exists (
    select 1 from gym_classes gc
    where gc.id = class_bookings.class_id and is_owner_of(gc.tenant_id)
  ));

-- An owner marking attendance at the front desk is the whole point of the
-- roster, and previously only the class's own trainer could.
drop policy if exists class_bookings_owner_w on class_bookings;
create policy class_bookings_owner_w on class_bookings
  for update using (exists (
    select 1 from gym_classes gc
    where gc.id = class_bookings.class_id and is_owner_of(gc.tenant_id)
  )) with check (exists (
    select 1 from gym_classes gc
    where gc.id = class_bookings.class_id and is_owner_of(gc.tenant_id)
  ));

-- ▶ drop-ins-and-passes.sql

-- ── Drop-ins, guest passes and class packs ──────────────────────────────────
--
-- Phase 1, F16. A gym takes money from people who are not members: the walk-in
-- who pays for one session, the friend a member brings, the ten-class pack sold
-- at the desk. None of that fits `memberships`, which assumes a profile and a
-- recurring plan, so it was going unrecorded — and every attendance and revenue
-- figure was short by however much of it happens.
--
-- Additive only. Nothing here alters an existing table.

-- ── what the gym sells at the desk ──────────────────────────────────────────
create table if not exists gym_pass_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  -- drop_in: one visit, bought by anyone.
  -- guest:   one visit, bought by (or gifted to) a member for someone else.
  -- pack:    a block of visits used over time.
  kind text not null default 'drop_in' check (kind in ('drop_in','guest','pack')),
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'AED',
  -- How many visits one purchase is worth. A drop-in is 1; a pack is n.
  uses integer not null default 1 check (uses >= 1),
  -- Days from issue until it expires. Null means it does not expire, which is
  -- a deliberate choice a gym makes, not a missing value.
  valid_days integer check (valid_days is null or valid_days > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_gym_pass_types_tenant on gym_pass_types(tenant_id, active);

-- ── an issued pass ──────────────────────────────────────────────────────────
create table if not exists gym_passes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  -- A type may be retired while passes sold on it are still valid, so this
  -- goes null rather than taking the pass with it.
  pass_type_id uuid references gym_pass_types(id) on delete set null,
  -- The holder is either a profile (a member, or a walk-in who made an account)
  -- or just a name written at the desk. Requiring an account to sell someone a
  -- day pass would mean the sale went unrecorded, which is how we got here.
  holder_id uuid references profiles(id) on delete set null,
  holder_name text,
  -- Who brought them, when this is a guest pass. Useful on its own: guests of
  -- members convert differently from cold walk-ins.
  host_member_id uuid references profiles(id) on delete set null,
  issued_on date not null default current_date,
  expires_on date,
  uses_total integer not null check (uses_total >= 1),
  uses_spent integer not null default 0 check (uses_spent >= 0),
  -- What was actually taken for it. Null means nobody recorded a price — not
  -- that it was free. `gymPasses.passRevenueCents` returns null for that rather
  -- than quietly counting it as zero.
  paid_cents integer check (paid_cents is null or paid_cents >= 0),
  currency text not null default 'AED',
  note text,
  created_at timestamptz not null default now(),
  -- A pass with no holder at all cannot be checked in against anyone.
  constraint gym_passes_holder_present
    check (holder_id is not null or nullif(btrim(holder_name), '') is not null),
  -- The database refuses to let a pass be spent past its own limit; the app
  -- checks too, but the app is not the last line.
  constraint gym_passes_not_overspent check (uses_spent <= uses_total)
);
create index if not exists idx_gym_passes_tenant on gym_passes(tenant_id, issued_on desc);
create index if not exists idx_gym_passes_holder on gym_passes(holder_id) where holder_id is not null;

-- ── each redemption, kept rather than just decremented ──────────────────────
-- A counter tells you a pass was used; a row tells you when, by whom, and
-- against which class. Only the second can be disputed and resolved.
create table if not exists gym_pass_redemptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  pass_id uuid not null references gym_passes(id) on delete cascade,
  class_id uuid references gym_classes(id) on delete set null,
  redeemed_at timestamptz not null default now(),
  -- The staff member who took it, not the person using it.
  redeemed_by uuid references profiles(id) on delete set null
);
create index if not exists idx_gym_pass_redemptions_pass on gym_pass_redemptions(pass_id, redeemed_at desc);
create index if not exists idx_gym_pass_redemptions_tenant on gym_pass_redemptions(tenant_id, redeemed_at desc);

-- ── keep the counter and the rows honest ────────────────────────────────────
-- uses_spent is a cache of count(redemptions). Letting the app maintain both
-- independently guarantees they drift, so the trigger owns it.
create or replace function gym_passes_sync_uses() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update gym_passes p
     set uses_spent = (select count(*) from gym_pass_redemptions r where r.pass_id = p.id)
   where p.id = coalesce(new.pass_id, old.pass_id);
  return coalesce(new, old);
end $$;

drop trigger if exists trg_gym_pass_redemptions_sync on gym_pass_redemptions;
create trigger trg_gym_pass_redemptions_sync
  after insert or delete on gym_pass_redemptions
  for each row execute function gym_passes_sync_uses();

-- A redemption inherits the pass's tenant, so the desk never has to supply it
-- and can never supply the wrong one.
create or replace function gym_pass_redemptions_fill_tenant() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.tenant_id is null then
    select p.tenant_id into new.tenant_id from gym_passes p where p.id = new.pass_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_gym_pass_redemptions_tenant on gym_pass_redemptions;
create trigger trg_gym_pass_redemptions_tenant
  before insert on gym_pass_redemptions
  for each row execute function gym_pass_redemptions_fill_tenant();

-- ── row-level security ──────────────────────────────────────────────────────
-- The helpers are SECURITY DEFINER, so a policy calling them does not re-enter
-- the table it is protecting — the recursion that once made `profiles`
-- unreadable for everyone (see 28-fix-profiles-recursion.sql).
alter table gym_pass_types       enable row level security;
alter table gym_passes           enable row level security;
alter table gym_pass_redemptions enable row level security;

drop policy if exists gym_pass_types_owner on gym_pass_types;
create policy gym_pass_types_owner on gym_pass_types
  for all using (is_owner_of(tenant_id)) with check (is_owner_of(tenant_id));

drop policy if exists gym_passes_owner on gym_passes;
create policy gym_passes_owner on gym_passes
  for all using (is_owner_of(tenant_id)) with check (is_owner_of(tenant_id));

drop policy if exists gym_pass_redemptions_owner on gym_pass_redemptions;
create policy gym_pass_redemptions_owner on gym_pass_redemptions
  for all using (is_owner_of(tenant_id)) with check (is_owner_of(tenant_id));

-- What is on sale at the desk is not private, and the booking screens need it.
drop policy if exists gym_pass_types_tenant_r on gym_pass_types;
create policy gym_pass_types_tenant_r on gym_pass_types
  for select using (tenant_id = my_tenant() and active);

-- A holder reads their own passes and nobody else's. Note this is scoped to
-- holder_id, so a desk-written walk-in (holder_name only) is visible to the
-- gym alone — there is no account for it to leak to.
drop policy if exists gym_passes_own_r on gym_passes;
create policy gym_passes_own_r on gym_passes
  for select using (holder_id = (select auth.uid()));

drop policy if exists gym_pass_redemptions_own_r on gym_pass_redemptions;
create policy gym_pass_redemptions_own_r on gym_pass_redemptions
  for select using (
    exists (select 1 from gym_passes p
             where p.id = gym_pass_redemptions.pass_id
               and p.holder_id = (select auth.uid()))
  );

-- Staff need to take a pass at the desk without being an owner. A trainer in
-- the gym may record a redemption, but may not issue or price a pass.
drop policy if exists gym_pass_redemptions_staff_w on gym_pass_redemptions;
create policy gym_pass_redemptions_staff_w on gym_pass_redemptions
  for insert with check (tenant_id = my_tenant() and my_role() in ('trainer','owner'));

drop policy if exists gym_passes_staff_r on gym_passes;
create policy gym_passes_staff_r on gym_passes
  for select using (tenant_id = my_tenant() and my_role() in ('trainer','owner'));

-- ▶ door-log.sql

-- ── The door log ────────────────────────────────────────────────────────────
--
-- Phase 1. Attendance is currently only counted where a class was booked and
-- ticked off. Every member who walks in, trains on the floor and leaves is
-- invisible — which in most gyms is the majority of visits.
--
-- That under-count matters beyond the headline: retention is inferred from
-- attendance pattern breaks, so a member who switched from classes to the
-- floor currently looks like a member who stopped coming.
--
-- Additive only. Nothing here alters an existing table.

create table if not exists gym_visits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  -- Null for an anonymous head-count: a turnstile that counts bodies without
  -- identifying them still tells the gym about capacity, even though it says
  -- nothing about retention.
  member_id uuid references profiles(id) on delete set null,
  -- Set when the visit was paid for with a drop-in or guest pass, so the two
  -- records reconcile instead of double counting the same person.
  pass_id uuid references gym_passes(id) on delete set null,
  -- Set when the visit was attendance at a booked class, so class attendance
  -- and floor attendance can be told apart in the same table.
  class_id uuid references gym_classes(id) on delete set null,
  entered_at timestamptz not null default now(),
  -- Null means either still inside or nobody recorded an exit. The two are
  -- indistinguishable here on purpose — see gymVisits.averageDwellMinutes,
  -- which refuses to average over visits with no exit rather than guessing.
  exited_at timestamptz,
  source text not null default 'desk'
    check (source in ('desk','qr','door','app','manual')),
  note text,
  created_at timestamptz not null default now(),
  -- A visit cannot end before it began. Clock skew on a door terminal is real,
  -- and a negative dwell time poisons every average built on it.
  constraint gym_visits_exit_after_entry
    check (exited_at is null or exited_at >= entered_at)
);

create index if not exists idx_gym_visits_tenant on gym_visits(tenant_id, entered_at desc);
create index if not exists idx_gym_visits_member on gym_visits(member_id, entered_at desc)
  where member_id is not null;
create index if not exists idx_gym_visits_open on gym_visits(tenant_id)
  where exited_at is null;

-- A visit paid for by a pass inherits that pass's tenant, so a terminal never
-- has to supply it and can never supply the wrong one.
create or replace function gym_visits_fill_tenant() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.tenant_id is null and new.pass_id is not null then
    select p.tenant_id into new.tenant_id from gym_passes p where p.id = new.pass_id;
  end if;
  if new.tenant_id is null and new.class_id is not null then
    select c.tenant_id into new.tenant_id from gym_classes c where c.id = new.class_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_gym_visits_tenant on gym_visits;
create trigger trg_gym_visits_tenant
  before insert on gym_visits
  for each row execute function gym_visits_fill_tenant();

-- ── row-level security ──────────────────────────────────────────────────────
-- The helpers are SECURITY DEFINER, so a policy calling them does not re-enter
-- the table it is protecting — the recursion that once made `profiles`
-- unreadable for everyone (see 28-fix-profiles-recursion.sql).
alter table gym_visits enable row level security;

drop policy if exists gym_visits_owner on gym_visits;
create policy gym_visits_owner on gym_visits
  for all using (is_owner_of(tenant_id)) with check (is_owner_of(tenant_id));

-- Staff work the door; they may record visits without being an owner.
drop policy if exists gym_visits_staff_rw on gym_visits;
create policy gym_visits_staff_rw on gym_visits
  for select using (tenant_id = my_tenant() and my_role() in ('trainer','owner'));

drop policy if exists gym_visits_staff_w on gym_visits;
create policy gym_visits_staff_w on gym_visits
  for insert with check (tenant_id = my_tenant() and my_role() in ('trainer','owner'));

drop policy if exists gym_visits_staff_u on gym_visits;
create policy gym_visits_staff_u on gym_visits
  for update using (tenant_id = my_tenant() and my_role() in ('trainer','owner'))
  with check (tenant_id = my_tenant() and my_role() in ('trainer','owner'));

-- A member sees their own visit history and nobody else's. This is deliberately
-- readable to them: "when did I actually come in" is their record too, and it
-- is the evidence behind any retention conversation the gym starts.
drop policy if exists gym_visits_own_r on gym_visits;
create policy gym_visits_own_r on gym_visits
  for select using (member_id = (select auth.uid()));

-- ▶ session-outcomes.sql

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

-- ▶ equipment-register.sql

-- ── The equipment register ──────────────────────────────────────────────────
--
-- Phase 1. What the gym owns, what is out of action, and what is due a service.
--
-- The reason this is not just an inventory list: capacity. A class capacity of
-- 14 is a claim about the room, and it stops being true the moment six of the
-- rowers are broken. Studio already reports fill rate against stated capacity,
-- so without this the gym is measuring itself against a number that quietly
-- became fiction.
--
-- Additive only. Nothing here alters an existing table.

create table if not exists gym_equipment (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  -- Loose on purpose. A gym's own words for its kit beat a taxonomy we impose,
  -- and the capacity check matches on this string.
  category text,
  -- Asset tag, serial, or whatever is written on the sticker.
  identifier text,
  quantity integer not null default 1 check (quantity >= 0),
  status text not null default 'in_service'
    check (status in ('in_service', 'out_of_service', 'retired')),
  purchased_on date,
  -- Null means no service schedule — a decision the gym made, not a gap.
  service_interval_days integer check (service_interval_days is null or service_interval_days > 0),
  -- Null with an interval set means the schedule exists but nobody has recorded
  -- a service. That is NOT the same as "serviced today", and
  -- gymEquipment.serviceState reports it as its own state rather than
  -- computing a due date from a date it does not have.
  last_serviced_on date,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_gym_equipment_tenant on gym_equipment(tenant_id, status);
create index if not exists idx_gym_equipment_category on gym_equipment(tenant_id, category)
  where status = 'in_service';
create index if not exists idx_gym_equipment_service on gym_equipment(tenant_id, last_serviced_on)
  where service_interval_days is not null;

-- ── row-level security ──────────────────────────────────────────────────────
-- The helpers are SECURITY DEFINER, so a policy calling them does not re-enter
-- the table it is protecting — the recursion that once made `profiles`
-- unreadable for everyone (see 28-fix-profiles-recursion.sql).
alter table gym_equipment enable row level security;

drop policy if exists gym_equipment_owner on gym_equipment;
create policy gym_equipment_owner on gym_equipment
  for all using (is_owner_of(tenant_id)) with check (is_owner_of(tenant_id));

-- Trainers read the register and may take a machine out of action — they are
-- the ones standing next to it when it breaks. They cannot add, price or
-- retire kit, which is the owner's call.
drop policy if exists gym_equipment_staff_r on gym_equipment;
create policy gym_equipment_staff_r on gym_equipment
  for select using (tenant_id = my_tenant() and my_role() in ('trainer', 'owner'));

drop policy if exists gym_equipment_staff_u on gym_equipment;
create policy gym_equipment_staff_u on gym_equipment
  for update using (tenant_id = my_tenant() and my_role() in ('trainer', 'owner'))
  with check (tenant_id = my_tenant() and my_role() in ('trainer', 'owner'));

-- ▶ class-capacity-and-scope.sql

-- ─────────────────────────────────────────────────────────────────────────
-- class_attendance_summary: add capacity, and scope it to the caller's gym.
--
-- TWO changes, one function.
--
-- 1. CAPACITY. The summary returned booked and attended but not capacity, so
--    the owner's class screen could only ever compute attended/booked. It
--    printed that under the label "fill", while gymSchedule.ts reserves fill
--    for booked/capacity — the same class read 71% on the timetable and 80%
--    on the analytics screen. gym_classes.capacity has been there all along;
--    the summary simply never selected it. With it present the screen can
--    show both rates and mean each honestly.
--
-- 2. TENANT SCOPE — a cross-tenant read. The function is SECURITY DEFINER, so
--    it runs as its owner and RLS on gym_classes does not apply to it. Its own
--    guard was:
--
--      gc.trainer_id = auth.uid()
--      or exists (select 1 from profiles o
--                  where o.id = auth.uid() and o.role = 'owner')
--
--    The second arm asks "is this caller AN owner", never "is this caller the
--    owner of THIS gym". Any owner of any tenant could therefore read every
--    other gym's class titles, trainer names, booking and attendance counts.
--    Every RLS policy added in 30-classes-tenant-scope.sql already uses
--    is_owner_of(tenant_id); this brings the function into line with them.
--
-- The return type changes, so the function has to be dropped rather than
-- replaced. Both signatures are dropped because an older build may have left
-- either behind.
-- ─────────────────────────────────────────────────────────────────────────

drop function if exists public.class_attendance_summary(timestamptz, timestamptz);

create function public.class_attendance_summary(p_from timestamptz, p_to timestamptz)
returns table(class_id uuid, title text, kind text, branch text, trainer_id uuid,
              trainer_name text, starts_at timestamptz,
              capacity integer, booked integer, attended integer)
language sql
security definer
set search_path to 'public'
as $function$
  select gc.id, gc.title, gc.kind, gc.branch, gc.trainer_id,
         coalesce(tp.full_name, 'Trainer') as trainer_name, gc.starts_at,
         coalesce(gc.capacity, 0)::int as capacity,
         count(cb.id) filter (where cb.status = 'booked')::int as booked,
         count(cb.attended_at)::int as attended
  from gym_classes gc
  left join class_bookings cb on cb.class_id = gc.id
  left join profiles tp on tp.id = gc.trainer_id
  where gc.starts_at >= p_from and gc.starts_at < p_to
    and ( gc.trainer_id = auth.uid()
          -- the caller must own THIS class's gym, not merely be an owner
          or is_owner_of(gc.tenant_id) )
  group by gc.id, tp.full_name
  order by gc.starts_at desc;
$function$;

grant execute on function public.class_attendance_summary(timestamptz, timestamptz) to authenticated;

-- ▶ payroll-settlements.sql

-- ─────────────────────────────────────────────────────────────────────────
-- Recording that payroll was actually paid.
--
-- gymSessions.ts already computes what a gym owes and refuses to answer while
-- any session is unmarked. What nothing recorded was that the money went out.
-- Without it a gym can only ask "what do we owe for this period", never "have
-- we paid it" — and the second question is the one that gets asked twice on a
-- Friday afternoon by two different people.
--
-- THE DESIGN PROBLEM this solves is double payment.
--
-- A settlement cannot simply store a date range and an amount, because a
-- session can be marked AFTER its period is settled — a trainer catching up on
-- last week's outcomes. If settlement were range-based, that late session would
-- either be silently unpaid forever (it falls inside a settled range) or paid
-- twice (the range is settled again). Both are real money going wrong quietly.
--
-- So settlement is per SESSION, not per period. Each settled session carries
-- the id of the run that paid it:
--
--   · a session with settlement_id has been paid, and is excluded from what is
--     owed, permanently
--   · a session marked late has no settlement_id, so it simply appears in the
--     next run — late, but paid exactly once
--
-- The amount is snapshotted on the settlement row as well, so a later change to
-- the gym's session fee cannot rewrite what was actually handed over. That is
-- the same reasoning as rate_cents on the session itself: history is what
-- happened, not what today's prices imply.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.payroll_settlements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  trainer_id uuid not null references public.profiles(id) on delete cascade,

  -- The window the run covered, for reporting. NOT the definition of what was
  -- paid — that is the set of sessions pointing at this row.
  period_from date not null,
  period_to date not null,

  -- What was handed over, snapshotted. Never recomputed.
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'AED',
  sessions_count integer not null check (sessions_count >= 0),

  method text not null default 'transfer'
    check (method in ('transfer', 'cash', 'payroll', 'other')),
  note text,

  settled_at timestamptz not null default now(),
  settled_by uuid references auth.users(id) on delete set null,

  created_at timestamptz not null default now()
);

create index if not exists idx_settlements_tenant
  on public.payroll_settlements(tenant_id, settled_at desc);
create index if not exists idx_settlements_trainer
  on public.payroll_settlements(trainer_id, settled_at desc);

-- The link that makes double payment impossible.
alter table public.sessions
  add column if not exists settlement_id uuid
  references public.payroll_settlements(id) on delete set null;

-- Partial index: the query that matters is "what is still unpaid", and the
-- settled rows grow without bound while the unsettled set stays small.
create index if not exists idx_sessions_unsettled
  on public.sessions(tenant_id, trainer_id)
  where settlement_id is null;

-- ── access ─────────────────────────────────────────────────────────────────
alter table public.payroll_settlements enable row level security;

-- The owner of the gym runs payroll and sees all of it.
drop policy if exists settlements_owner on public.payroll_settlements;
create policy settlements_owner on public.payroll_settlements for all
  using (is_owner_of(tenant_id))
  with check (is_owner_of(tenant_id));

-- A trainer may read their own settlements — what they were paid, and when.
-- Read only: being paid is not something you record about yourself.
drop policy if exists settlements_trainer_read on public.payroll_settlements;
create policy settlements_trainer_read on public.payroll_settlements for select
  using (trainer_id = auth.uid());

-- ▶ member-invites.sql

-- ─────────────────────────────────────────────────────────────────────────
-- Gym → member invites. The hole this fills is a hard one:
--
--   memberships.member_id is `uuid not null references profiles(id)`
--
-- so a membership cannot exist before the person does. A gym owner opening the
-- Studio member screen — or feeding last year's spreadsheet through the CSV
-- importer — hits that wall on the very first row, because their members have
-- names and email addresses, not Repple accounts. There has been no path from
-- "person the gym knows about" to "profiles row". This is that path.
--
-- The shape is deliberately the same as 11-coach-invites.sql and
-- 12-trainer-invites.sql: a pending row addressed to an email, readable by the
-- person it names, redeemed by a security-definer function that does the
-- cross-account writes RLS would otherwise forbid. A gym that has already
-- learned one invite flow should not have to learn a second.
--
-- WHY AN INVITE ROW AND NOT A PLACEHOLDER PROFILE. The tempting shortcut is to
-- relax the foreign key and insert a stub profile per member. That trades one
-- missing feature for a permanent data-quality problem: stub rows that never
-- get claimed are indistinguishable from real accounts, they accumulate, and
-- every count of "members" in the product silently starts including ghosts. An
-- invite is honestly a different kind of thing from a membership, and it is
-- modelled as one.
--
-- Depends on 01-schema.sql (tenants/profiles/clients), 02-domain-schema.sql
-- (is_owner_of) and 29-gym-operating-record.sql (membership_plans/memberships).
-- Idempotent; safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.member_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- Stored as typed, matched case-insensitively everywhere. Keeping the
  -- original casing means the gym's own record of the address is intact if
  -- they have to read it back to someone over the phone.
  email text not null,

  -- What the gym calls them. Nullable because a gym importing a mailing list
  -- may genuinely only have the address, and a blank name is not a reason to
  -- refuse the import — it is a reason to show the address in the UI.
  full_name text,

  -- The plan the membership opens on. Nullable on purpose: "join the gym, we
  -- will sort the package out at the desk" is a real thing gyms do, and a
  -- forced plan choice would push owners into inventing one.
  plan_id uuid references public.membership_plans(id) on delete set null,

  invited_by uuid references public.profiles(id) on delete set null,

  -- The share link's secret. A uuid rather than encode(gen_random_bytes(...)):
  -- gen_random_bytes needs pgcrypto, which nothing else in this schema assumes
  -- is installed, and 122 random bits is already far beyond guessable for a
  -- value that also has to survive an email-address check to be worth anything.
  token uuid not null unique default gen_random_uuid(),

  -- Only ever the three states somebody DECIDED. 'expired' is deliberately not
  -- in this list — see the note on expires_at below.
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked')),

  created_at timestamptz not null default now(),

  -- An invite that stays open forever is a permanent unauthenticated way into
  -- a gym's tenant, so every invite carries an expiry. It is a stored column
  -- rather than a derived one so the owner can extend a specific invite for
  -- somebody who was on holiday, without loosening the rule for everyone.
  --
  -- NOTE what does NOT happen here: nothing flips status to 'expired' when the
  -- clock passes. That would need a cron job, and until it ran the row would
  -- lie. Instead expiry is derived at read time — in SQL by accept_member_
  -- invite below, and in TypeScript by inviteState() in src/lib/memberInvites.ts
  -- — so the two never disagree and the table only ever stores facts.
  expires_at timestamptz not null default now() + interval '30 days',

  accepted_at timestamptz,
  accepted_by uuid references public.profiles(id) on delete set null
);

-- One open invite per address per gym. Partial, and only over the pending ones,
-- because a member who joined, left and is being invited back a year later must
-- not be blocked by their own accepted invite from last time. coach_invites
-- uses a plain unique (coach_id, email) and has exactly that problem.
create unique index if not exists uq_member_invites_open
  on public.member_invites (tenant_id, lower(email))
  where status = 'pending';

-- The owner's list view: their gym's invites, newest first.
create index if not exists idx_member_invites_tenant
  on public.member_invites (tenant_id, status, created_at desc);

-- The invitee's lookup, which comes in by address and has no tenant to narrow
-- it. Must be on lower(email) to match the RLS policy, or the policy scans.
create index if not exists idx_member_invites_email
  on public.member_invites (lower(email));

-- ── access ─────────────────────────────────────────────────────────────────
-- A blank email would match an anon caller's empty claim, so it must not
-- be storable. Belt and braces with the nullif in mi_invitee_read below.
alter table public.member_invites
  add constraint member_invites_email_not_blank check (btrim(email) <> '');

alter table public.member_invites enable row level security;

-- The owner of THIS gym manages its invites: create, list, extend, revoke.
-- is_owner_of(tenant_id) asks whether the caller owns this particular tenant,
-- not merely whether they own something.
drop policy if exists mi_owner on public.member_invites;
create policy mi_owner on public.member_invites for all
  using (is_owner_of(tenant_id))
  with check (is_owner_of(tenant_id));

-- The invited person, matched on the email they signed in with, can read the
-- invite addressed to them — that read is what lets the app show "Fit Republic
-- has invited you to join" the first time they open it.
--
-- SELECT only. Accepting is not an UPDATE they are allowed to make; it goes
-- through accept_member_invite, which validates before it writes.
drop policy if exists mi_invitee_read on public.member_invites;
create policy mi_invitee_read on public.member_invites for select
  -- nullif, NOT coalesce(..., ''): an unauthenticated caller has no email
  -- claim, so coalescing to '' would make an invite stored with a blank email
  -- readable by anon. nullif makes that comparison null, which matches nothing.
  using (lower(email) = lower(nullif(auth.jwt() ->> 'email', '')));

-- ── redeeming ──────────────────────────────────────────────────────────────
-- Accept the invite addressed to me: attach my profile to the gym's tenant and
-- open the membership. SECURITY DEFINER because the writes span rows the
-- invitee has no rights over — memberships belongs to the owner under RLS.
--
-- TENANT SCOPING, which is the whole risk in a definer function. Every write
-- below targets inv.tenant_id — the tenant on the invite row the caller proved
-- they are addressed by — and never the caller's current tenant, never "a"
-- tenant, never a tenant read from an argument. The bug this is written
-- against is the one fixed in 35-class-capacity-and-scope.sql, where a definer
-- function guarded on "is this caller AN owner" instead of "does this caller
-- own THIS gym" and leaked every tenant's data to every other tenant's owner.
-- The equivalent mistake here would be trusting a tenant id passed in as a
-- parameter: anyone could then post themselves into any gym. The function
-- therefore takes only the invite id, and derives everything else from the row.
create or replace function public.accept_member_invite(p_invite uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  inv public.member_invites;
  my_email text;
  -- Named caller_* deliberately. my_role() and my_tenant() are existing SQL
  -- helpers in this schema (28-fix-profiles-recursion.sql), and a plpgsql
  -- variable sharing their name is a shadowing accident waiting to happen.
  caller_role text;
  caller_tenant uuid;
  mem uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  select email into my_email from auth.users where id = auth.uid();
  select role, tenant_id into caller_role, caller_tenant from profiles where id = auth.uid();

  select * into inv from member_invites where id = p_invite;
  if inv.id is null then
    raise exception 'invite not found';
  end if;

  -- Identity, first and hardest. The invite id alone proves nothing.
  if lower(inv.email) <> lower(coalesce(my_email, '')) then
    raise exception 'invite not addressed to you';
  end if;

  -- Already settled one way or the other. Distinguished from expiry so the app
  -- can say something true: "you have already joined" is not "this has lapsed".
  if inv.status = 'accepted' then
    raise exception 'invite already accepted';
  elsif inv.status = 'revoked' then
    raise exception 'invite was withdrawn';
  end if;

  if inv.expires_at <= now() then
    raise exception 'invite has expired';
  end if;

  -- WHO MAY BE MOVED. Accepting rewrites profiles.tenant_id, which is the spine
  -- of every RLS policy in the schema, so it must not be able to strip somebody
  -- of a role they hold elsewhere.
  --
  --  · an owner would be moved out of the gym they own, taking is_owner_of with
  --    them and locking them out of their own business
  --  · a trainer would be detached from the roster they coach
  --
  -- Both refuse rather than half-succeed. A trainer holding a membership where
  -- they work is legitimate and is allowed — they are already in that tenant,
  -- so nothing moves and only the membership opens.
  if caller_role = 'owner' then
    raise exception 'an owner cannot join a gym as a member from this account';
  elsif caller_role = 'trainer' and caller_tenant is distinct from inv.tenant_id then
    raise exception 'a trainer cannot be moved to another gym by a member invite';
  end if;

  if caller_role = 'client' then
    update profiles
       set tenant_id = inv.tenant_id,
           -- Only fills a gap. The name the member typed about themselves beats
           -- the one the gym typed about them.
           full_name  = coalesce(nullif(trim(full_name), ''), nullif(trim(inv.full_name), ''))
     where id = auth.uid();

    -- provision_profile() gave them a clients row against their personal tenant
    -- at signup. Left behind it would point at the wrong gym, and the roster
    -- policies read clients.tenant_id — so it moves with the profile. Same
    -- upsert shape as accept_trainer_invite uses for trainers.
    insert into clients (id, tenant_id) values (auth.uid(), inv.tenant_id)
      on conflict (id) do update set tenant_id = excluded.tenant_id;
  end if;

  -- Open the membership — unless one is already running. There is no unique
  -- constraint on (tenant_id, member_id) and there should not be: a member who
  -- cancelled and rejoined has two real, separate membership rows and the gym's
  -- history depends on both surviving. So the guard is on live memberships
  -- only, and it is here rather than in an index.
  select id into mem
    from memberships
   where tenant_id = inv.tenant_id
     and member_id = auth.uid()
     and status in ('active', 'frozen')
   order by started_on desc
   limit 1;

  if mem is null then
    insert into memberships (tenant_id, member_id, plan_id, started_on, status)
    values (inv.tenant_id, auth.uid(), inv.plan_id, current_date, 'active')
    returning id into mem;
  end if;

  update member_invites
     set status = 'accepted', accepted_at = now(), accepted_by = auth.uid()
   where id = p_invite;

  -- The membership, so the app can go straight to it instead of refetching and
  -- guessing which row it just caused.
  return mem;
end $$;

-- The grant to authenticated is not enough on its own. Postgres grants EXECUTE
-- to PUBLIC on every newly created function, and Supabase's default privileges
-- on the public schema add an explicit `anon` grant on top of that — so a bare
-- `grant ... to authenticated` leaves the function callable by a signed-out
-- caller. Verified on the live database: immediately after this file first
-- applied, has_function_privilege('anon', ..., 'EXECUTE') was TRUE and the acl
-- read {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/...}.
-- Both grants have to come off before the grant back means anything. This is
-- the same convention as 22-session-approvals.sql, 38-tenant-isolation.sql and
-- the sweep in 40-function-grants.sql; its absence here was an omission.
--
-- accept_member_invite raises 'not signed in' when auth.uid() is null, so an
-- anon caller could not have completed a redemption — but it would still have
-- reached the body and the auth.users/profiles reads inside a SECURITY DEFINER
-- context, which is not a surface to leave open.
revoke execute on function public.accept_member_invite(uuid) from public, anon;
grant  execute on function public.accept_member_invite(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────

-- ▶ tenant-isolation.sql

-- ─────────────────────────────────────────────────────────────────────────
-- Tenant isolation: the three holes that made every other policy decorative.
--
-- A security review of all 37 parts found eleven cross-tenant problems. Eight
-- are the "is this caller AN owner rather than THIS gym's owner" mistake, and
-- they are fixed in 39-owner-policy-scope.sql. The three here are different in
-- kind: while any of them stands, fixing the other eight changes nothing,
-- because an attacker does not need to defeat a policy — they can simply
-- become someone the policy already trusts.
-- ─────────────────────────────────────────────────────────────────────────


-- ── 1 · Anyone could make themselves the owner of any gym ──────────────────
--
-- profiles_self is:
--
--   create policy profiles_self on profiles
--     for all using (id = auth.uid()) with check (id = auth.uid());
--
-- FOR ALL includes UPDATE, and RLS cannot restrict which COLUMNS an update
-- touches. So any signed-in user could run
--
--   update profiles set role = 'owner', tenant_id = '<any gym>' where id = auth.uid();
--
-- and is_owner_of(t) — which is exactly `role = 'owner' and tenant_id = t` —
-- would then return true for a gym they have nothing to do with. Every
-- correctly written policy in parts 29 to 37 was reachable this way.
--
-- RLS is the wrong tool for a column-level rule, so this is a trigger.
--
-- WHY THE current_user TEST: a SECURITY DEFINER function runs as its owner
-- (postgres), while an ordinary request from the app runs as `authenticated`
-- or `anon`. The legitimate ways a person changes tenant — accepting a trainer
-- or member invite — all go through definer functions, so they pass. A direct
-- UPDATE from a client does not. This keeps the invite flows working without
-- needing a flag that a caller could learn to set.
--
-- Note what is NOT blocked: signing up as an owner. That is harmless, because
-- provision_profile() gives every new profile its own fresh tenant — you become
-- the owner of your own empty gym, which is the intended way to start. The
-- danger was never the role; it was moving an existing profile into somebody
-- else's tenant.

create or replace function public.guard_profile_identity()
returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.role is distinct from old.role then
      raise exception 'A profile cannot change its own role. Ask the gym owner to change it for you.'
        using errcode = '42501';
    end if;
    if new.tenant_id is distinct from old.tenant_id then
      raise exception 'A profile cannot move itself between gyms. Joining a gym happens by invitation.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists guard_profile_identity_t on public.profiles;
create trigger guard_profile_identity_t
  before update on public.profiles
  for each row execute function public.guard_profile_identity();


-- NOTE ON REVOKE, learned the hard way against the live database: `revoke
-- execute ... from anon` accomplishes nothing on its own. Postgres grants
-- EXECUTE to PUBLIC on every new function, and that is the grant anon actually
-- resolves through — has_function_privilege('anon', ...) stayed true after
-- revoking from anon alone. Every revoke here therefore names PUBLIC, and the
-- roles that should still call the function are granted back explicitly.


-- ── 2 · link_coaching() had no authorization at all ────────────────────────
--
-- It is SECURITY DEFINER, never references auth.uid(), and nothing revoked it
-- from PUBLIC — so it was callable as an RPC by anyone holding the anon key,
-- which ships inside the mobile bundle. It re-points any client at any trainer:
--
--   update clients set trainer_id = p_coach where id = p_client;
--
-- and is_my_client() then opens that member's workouts, measurements, check-ins,
-- habit logs, scans, food logs and their private coach conversation. Pointing a
-- stranger's client record at yourself was a complete read of their health
-- history.
--
-- Other definer functions in this schema (all_member_ids, approve_session) do
-- revoke from anon, so this was an omission rather than a convention.
--
-- The rule: you may create a coaching link only if you are one of the two
-- people in it, or you own the gym they belong to. Anything else raises.

create or replace function public.link_coaching(
  p_coach uuid, p_client uuid, p_mode text default 'online'
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare client_tenant uuid;
begin
  select tenant_id into client_tenant from profiles where id = p_client;

  if not (
    auth.uid() = p_coach
    or auth.uid() = p_client
    or (client_tenant is not null and is_owner_of(client_tenant))
  ) then
    raise exception 'You can only link a coach and a client you are part of.'
      using errcode = '42501';
  end if;

  insert into coaching_relationships (coach_id, client_id, mode, status)
  values (p_coach, p_client, coalesce(p_mode, 'online'), 'active')
  on conflict (coach_id, client_id) do update set mode = excluded.mode, status = 'active';

  update clients set trainer_id = p_coach where id = p_client;
end $$;

revoke execute on function public.link_coaching(uuid, uuid, text) from public, anon;
grant execute on function public.link_coaching(uuid, uuid, text) to authenticated;


-- ── 3 · Four tables never had row-level security switched on ───────────────
--
-- tenants, exercise_videos, availability_templates and session_waitlist all
-- hold tenant data and none of them had `enable row level security`.
--
-- The trap is that 28-fix-profiles-recursion.sql creates policies for tenants
-- and exercise_videos, so reading the migrations they look protected. A policy
-- on a table without RLS enabled is inert: Postgres never consults it, and
-- Supabase's default grants to anon and authenticated apply in full. The anon
-- key is compiled into the shipped app, so every gym's name, brand colour, plan
-- and session_fee was world-readable AND world-writable — including the
-- tenants.id values needed to exploit the profiles hole above.

alter table public.tenants enable row level security;
alter table public.exercise_videos enable row level security;
alter table public.availability_templates enable row level security;
alter table public.session_waitlist enable row level security;

-- Your own gym: everybody inside it can read it (the app shows its name and
-- brand everywhere); only its owner can change it.
drop policy if exists tenants_read on public.tenants;
create policy tenants_read on public.tenants for select
  using (id = my_tenant());

drop policy if exists tenants_owner_rw on public.tenants;
create policy tenants_owner_rw on public.tenants for all
  using (is_owner_of(id)) with check (is_owner_of(id));

-- Exercise demos are content, not customer data, and the whole point is that a
-- client can watch one. Readable by any signed-in user; writable only by the
-- owner of the gym that added it.
drop policy if exists exvid_read on public.exercise_videos;
create policy exvid_read on public.exercise_videos for select
  to authenticated using (true);

-- exercise_videos has no tenant_id — it is keyed on trainer_id, and a NULL
-- trainer means a platform-wide "Academy" video belonging to nobody. So the
-- write rule reaches the tenant through the trainer, and platform videos are
-- deliberately not writable by any gym.
drop policy if exists exvid_trainer_rw on public.exercise_videos;
create policy exvid_trainer_rw on public.exercise_videos for all
  using (trainer_id = auth.uid()) with check (trainer_id = auth.uid());

drop policy if exists exvid_owner_rw on public.exercise_videos;
create policy exvid_owner_rw on public.exercise_videos for all
  using (exists (
    select 1 from trainers tr
    where tr.id = exercise_videos.trainer_id and is_owner_of(tr.tenant_id)))
  with check (exists (
    select 1 from trainers tr
    where tr.id = exercise_videos.trainer_id and is_owner_of(tr.tenant_id)));

-- A trainer's working pattern. Theirs to set; their gym's owner may see it.
drop policy if exists avail_self on public.availability_templates;
create policy avail_self on public.availability_templates for all
  using (trainer_id = auth.uid()) with check (trainer_id = auth.uid());

drop policy if exists avail_owner_r on public.availability_templates;
create policy avail_owner_r on public.availability_templates for select
  using (exists (
    select 1 from trainers tr
    where tr.id = availability_templates.trainer_id and is_owner_of(tr.tenant_id)));

-- session_waitlist is (session_id, client_id) against `sessions`, not classes —
-- it is the PT waitlist, not the class one. A queue entry belongs to the client
-- on it; the trainer whose session it is, and that gym's owner, may see it.
drop policy if exists waitlist_self on public.session_waitlist;
create policy waitlist_self on public.session_waitlist for all
  using (client_id = auth.uid()) with check (client_id = auth.uid());

drop policy if exists waitlist_gym_r on public.session_waitlist;
create policy waitlist_gym_r on public.session_waitlist for select
  using (exists (
    select 1 from sessions s
    where s.id = session_waitlist.session_id
      and (s.trainer_id = auth.uid() or is_owner_of(s.tenant_id))));


-- ── 4 · class_roster() — the leak that 35 missed ───────────────────────────
--
-- 35-class-capacity-and-scope.sql fixed class_attendance_summary and left its
-- neighbour in the same file carrying a byte-identical guard. This one is
-- worse: the summary gave counts, this gives member NAMES.

drop function if exists public.class_roster(uuid);

create function public.class_roster(p_class uuid)
returns table(user_id uuid, name text, status text, attended boolean)
language sql
security definer
set search_path to 'public'
as $function$
  select cb.user_id,
         coalesce(p.full_name, 'Member') as name,
         cb.status,
         (cb.attended_at is not null) as attended
  from class_bookings cb
  join gym_classes gc on gc.id = cb.class_id
  left join profiles p on p.id = cb.user_id
  where cb.class_id = p_class
    and ( gc.trainer_id = auth.uid()
          -- the caller must own THIS class's gym, not merely be an owner
          or is_owner_of(gc.tenant_id) );
$function$;

revoke execute on function public.class_roster(uuid) from public, anon;
grant execute on function public.class_roster(uuid) to authenticated;


-- ── 5 · Three more unguarded definer functions ─────────────────────────────

-- all_member_ids() tested only that the caller was AN owner, and its select had
-- no join to the caller's tenant — so it returned every member id on the
-- platform. Ids alone are low value, but they are the join key that made the
-- other leaks usable.
create or replace function public.all_member_ids()
returns setof uuid
language sql
security definer
set search_path = public
as $$
  select c.id from clients c where is_owner_of(c.tenant_id);
$$;

-- class_counts() had no guard whatsoever, so any signed-in user could read
-- booking counts for every class in every gym.
create or replace function public.class_counts()
returns table(class_id uuid, booked bigint)
language sql
security definer
set search_path = public
as $$
  select cb.class_id, count(*)::bigint
  from class_bookings cb
  join gym_classes gc on gc.id = cb.class_id
  where gc.tenant_id = my_tenant()
  group by cb.class_id;
$$;

revoke execute on function public.class_counts() from public, anon;
grant execute on function public.class_counts() to authenticated;


-- ── 6 · announcements were world-readable and anyone could plant one ───────
--
--   create policy ann_read on announcements for select using (true);
--   create policy ann_write on announcements for insert with check (author_id = auth.uid());
--
-- ann_read had no `to authenticated`, so it covered anon — and the anon key is
-- in the app bundle. ann_write constrained only the author, never the
-- tenant_id, so any user could post an announcement into a competitor's gym
-- and have it appear to their members as if the gym had written it.

drop policy if exists ann_read on public.announcements;
create policy ann_read on public.announcements for select
  using (tenant_id = my_tenant());

drop policy if exists ann_write on public.announcements;
create policy ann_write on public.announcements for insert
  with check (author_id = auth.uid() and is_owner_of(tenant_id));

drop policy if exists ann_owner_rw on public.announcements;
create policy ann_owner_rw on public.announcements for all
  using (is_owner_of(tenant_id)) with check (is_owner_of(tenant_id));


-- ── 7 · book_class() could take a seat in another gym's class ──────────────
--
-- Both functions are SECURITY DEFINER and their only filter is `where id =
-- p_class`, so a member of gym A could book — and hold — seats in gym B's
-- classes. The return value ('booked' / 'waitlist' / 'notfound') also confirmed
-- cross-tenant whether a class existed and whether it was full, which is a
-- capacity denial-of-service with a built-in progress indicator.
--
-- The guard is the same question the rest of this file asks: is this class in
-- the caller's gym? Returning 'notfound' rather than raising is deliberate — a
-- distinct error would still confirm the class exists to someone who should not
-- know that.

create or replace function public.book_class(p_class uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_cap int; v_count int; v_status text; v_tenant uuid;
begin
  perform 1 from gym_classes where id = p_class for update;
  select capacity, tenant_id into v_cap, v_tenant from gym_classes where id = p_class;
  if v_cap is null then return 'notfound'; end if;
  -- A class outside your gym is indistinguishable from one that is not there.
  if v_tenant is distinct from my_tenant() then return 'notfound'; end if;

  select count(*) into v_count from class_bookings where class_id = p_class and status = 'booked';
  v_status := case when v_count < v_cap then 'booked' else 'waitlist' end;
  insert into class_bookings (class_id, user_id, status) values (p_class, auth.uid(), v_status)
    on conflict (class_id, user_id) do update set status = excluded.status;
  return v_status;
end; $$;

create or replace function public.cancel_class(p_class uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Cancelling only ever touches the caller's own booking, so the tenant check
  -- guards the promotion below rather than the delete.
  delete from class_bookings where class_id = p_class and user_id = auth.uid();

  if not exists (select 1 from gym_classes gc
                 where gc.id = p_class and gc.tenant_id = my_tenant()) then
    return;
  end if;

  update class_bookings set status = 'booked'
   where id = (
     select cb.id from class_bookings cb join gym_classes gc on gc.id = cb.class_id
     where cb.class_id = p_class and cb.status = 'waitlist'
       and (select count(*) from class_bookings b where b.class_id = p_class and b.status = 'booked') < gc.capacity
     order by cb.created_at asc limit 1
   );
end; $$;

revoke execute on function public.book_class(uuid) from public, anon;
revoke execute on function public.cancel_class(uuid) from public, anon;
grant execute on function public.book_class(uuid) to authenticated;
grant execute on function public.cancel_class(uuid) to authenticated;


-- ── 8 · An owner could not read their own members' profiles ────────────────
--
-- Not a leak — the opposite, and found while fixing the leaks. There is no
-- owner-scoped SELECT policy on `profiles` anywhere in the schema: only
-- profiles_self and three trainer-scoped ones. So a gym owner could read their
-- own row and nobody else's.
--
-- 27-owner-portal-access.sql opens by asserting "an owner can already see their
-- tenant's profiles". That is not true of the checked-in policies, and several
-- things were quietly built on the assumption — the member search on the Studio
-- members screen queries profiles by tenant and would have returned an empty
-- list for every owner, which reads as "nobody matches" rather than "you are
-- not allowed to ask".
--
-- WHY my_role()/my_tenant() AND NOT is_owner_of(): this policy is ON profiles,
-- and is_owner_of() is a plain `stable` function that selects from profiles —
-- so it would re-enter this policy and Postgres would raise infinite recursion.
-- my_role() and my_tenant() are SECURITY DEFINER precisely so they can be used
-- here; that is what 28-fix-profiles-recursion.sql exists for.

drop policy if exists profiles_owner_r on public.profiles;
create policy profiles_owner_r on public.profiles for select
  using (my_role() = 'owner' and tenant_id = my_tenant());

-- ▶ owner-policy-scope.sql

-- ── "AN owner" is not "the owner of THIS row" ───────────────────────────────
--
-- `profiles.role = 'owner'` used to mean the PLATFORM owner — one person, who
-- was genuinely allowed to read everything. 27-owner-portal-access.sql redefined
-- it to mean a GYM owner, scoped to their own tenant, and every policy written
-- from that point on asks the scoped question through is_owner_of(tenant_id).
--
-- The policies written BEFORE that redefinition were never revisited. Nine of
-- them still ask the unscoped question, in one of two spellings:
--
--     exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'owner')
--     my_role() = 'owner'
--
-- Both mean "is this caller an owner of some gym, anywhere on the platform".
-- Neither mentions the row being read. So the owner of gym A could read gym B's
-- Stripe customer ids, subscription status and invoice amounts, gym B's clients'
-- purchase history, gym B's Connect payout accounts, gym B's coach rosters,
-- gym B's crash logs and gym B's members' written feedback. Every gym owner on
-- the platform is a signed-in user, so this is not a theoretical hole: it is
-- readable today from the app's own Supabase client with no special tooling.
-- 35-class-capacity-and-scope.sql fixed the same mistake inside
-- class_attendance_summary; this file finishes the job for the RLS policies.
--
-- WHY THIS IS NOT A ONE-WORD SWAP. The billing tables (billing_customers,
-- subscriptions, invoices, connect_accounts, client_purchases) have no
-- tenant_id column at all — they are keyed on trainer_id, because they were
-- built when billing was platform→trainer and a gym was not part of the model.
-- Their tenant has to be reached by joining trainers, which is exactly the hop
-- 27-owner-portal-access.sql already makes for sessions:
--
--     exists (select 1 from trainers tr
--              where tr.id = <table>.trainer_id and is_owner_of(tr.tenant_id))
--
-- That join is safe to write inline because `trainers` has trainers_owner_r
-- (is_owner_of(tenant_id)), so an owner can read the rows the join needs.
--
-- DUPLICATES. Several of these tables carry TWO stale policies — the original
-- in 20/21, and a rewrite in 28-fix-profiles-recursion.sql that swapped the
-- profiles sub-select for my_role() without noticing it was preserving an
-- unscoped test. Same policy name in both files for most of them, but
-- `subscriptions` has sub_read (20) AND sub_owner (28) under different names.
-- Permissive policies OR together, so dropping one and leaving the other fixes
-- nothing. Every stale name is dropped below.
--
-- SELF-ACCESS IS PRESERVED. A trainer still reads their own billing, Connect
-- and invoice rows; a client still reads their own purchases; a member still
-- reads their own feedback (fb_own, untouched). Only the owner arm narrows.

-- ── a tenant lookup that does not re-enter RLS ──────────────────────────────
-- Two of the nine tables cannot use the inline trainers join.
--
--   * `coach_clients` would deadlock on it. trainers has
--     trainers_assigned_client_r, whose USING clause reads coach_clients — so a
--     coach_clients policy that reads trainers closes a cycle and Postgres
--     raises "infinite recursion detected in policy for relation". That is the
--     precise failure 28-fix-profiles-recursion.sql existed to remove, and the
--     remedy there applies here: ask through SECURITY DEFINER.
--
--   * `app_errors` reaches its tenant only through profiles, and there is no
--     owner-scoped SELECT policy on profiles — an inline sub-select would
--     return no rows for the very caller it is meant to authorise, silently
--     emptying the owner's crash inbox.
--
-- profiles.tenant_id is the spine (37-member-invites.sql rewrites it, and
-- clients.tenant_id, when a member moves gyms), so it is the right source. The
-- trainers row wins when both exist because trainers.tenant_id is NOT NULL and
-- is what the billing joins above key on; this keeps the two paths agreeing.
create or replace function public.tenant_of_user(u uuid)
returns uuid language sql stable security definer set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(
    (select t.tenant_id from trainers t where t.id = u),
    (select p.tenant_id from profiles p where p.id = u)
  );
$function$;

revoke all on function public.tenant_of_user(uuid) from public;
grant execute on function public.tenant_of_user(uuid) to authenticated;

-- ── billing: trainer_id → trainers.tenant_id ────────────────────────────────
-- Stripe customer ids and the email they were opened with. Leaked the identity
-- of every other gym's trainers as Stripe billing contacts.
drop policy if exists cust_read on billing_customers;
create policy cust_read on billing_customers for select using (
  trainer_id = (select auth.uid())
  or exists (select 1 from trainers tr
              where tr.id = billing_customers.trainer_id and is_owner_of(tr.tenant_id)));

-- Both stale policies dropped: sub_read (20-billing.sql) had the self arm,
-- sub_owner (28) was owner-only. They OR'd, so the pair behaved as one policy
-- and is replaced by one — plan, status and renewal date for a competitor's
-- trainers is commercial intelligence, not gym data.
drop policy if exists sub_read on subscriptions;
drop policy if exists sub_owner on subscriptions;
create policy sub_read on subscriptions for select using (
  trainer_id = (select auth.uid())
  or exists (select 1 from trainers tr
              where tr.id = subscriptions.trainer_id and is_owner_of(tr.tenant_id)));

-- Invoice amounts and the hosted Stripe URL. The URL is the sharper end of it:
-- it renders a payable invoice document, not just a number.
drop policy if exists inv_read on invoices;
create policy inv_read on invoices for select using (
  trainer_id = (select auth.uid())
  or exists (select 1 from trainers tr
              where tr.id = invoices.trainer_id and is_owner_of(tr.tenant_id)));

-- Connect payout accounts — which of a rival's trainers can actually take money
-- and which are still stuck in onboarding.
drop policy if exists conn_read on connect_accounts;
create policy conn_read on connect_accounts for select using (
  trainer_id = (select auth.uid())
  or exists (select 1 from trainers tr
              where tr.id = connect_accounts.trainer_id and is_owner_of(tr.tenant_id)));

-- Client purchases: who bought what, for how much, and how much of the pack is
-- used. The client and the selling trainer keep their own rows; the owner arm
-- now only covers trainers who belong to the owner's gym.
drop policy if exists purch_read on client_purchases;
create policy purch_read on client_purchases for select using (
  client_id = (select auth.uid())
  or trainer_id = (select auth.uid())
  or exists (select 1 from trainers tr
              where tr.id = client_purchases.trainer_id and is_owner_of(tr.tenant_id)));

-- ── tables that already carry their tenant, or reach it through a person ────
-- feedback.tenant_id was already being checked — and then undone on the very
-- next line. `is_owner_of(tenant_id) or my_role() = 'owner'` is two permissive
-- arms in one policy: the second is strictly wider than the first, so the
-- scoped test never decided anything. Dropping it is the whole fix. Rows with
-- a null tenant_id are now invisible to owners rather than visible to all of
-- them; their author still reads them via fb_own.
drop policy if exists fb_owner on feedback;
create policy fb_owner on feedback for select using (is_owner_of(tenant_id));

-- Crash logs carry a stack trace and whatever the message happened to contain,
-- attributed to a named user. Scoped through the reporting user's tenant.
-- app_errors_insert allows a null user_id (an error caught before sign-in);
-- those rows have no tenant to belong to and are now readable by nobody
-- through RLS, which is the fail-closed side of the choice.
drop policy if exists app_errors_owner on app_errors;
create policy app_errors_owner on app_errors for select using (
  is_owner_of(tenant_of_user(user_id)));

-- Coach rosters — client names and goals, typed in by hand for people who have
-- no account. coach_clients.trainer_id references auth.users directly and the
-- table has no tenant_id, so the coach's own tenant is the row's tenant. Via
-- tenant_of_user rather than a trainers join: see the note on the function.
drop policy if exists coach_clients_owner_r on coach_clients;
create policy coach_clients_owner_r on coach_clients for select using (
  is_owner_of(tenant_of_user(trainer_id)));

-- ── exercise_videos: deliberately NOT touched here ──────────────────────────
-- The ninth stale policy was exvid_read, whose `or my_role() = 'owner'` arm let
-- any owner read any gym's coaching videos. 38-tenant-isolation.sql — which
-- sorts immediately before this file and therefore runs immediately before it —
-- has already replaced that policy, and answered the underlying question
-- differently: it treats exercise demos as content rather than customer data,
-- opens SELECT to every authenticated user, and scopes WRITES to the gym via
-- `exists (select 1 from trainers tr where tr.id = exercise_videos.trainer_id
-- and is_owner_of(tr.tenant_id))`. Either answer closes the owner leak — 38's
-- version has no owner-specific read arm left to escalate through.
--
-- Re-creating exvid_read here would win purely on filename order and revert a
-- deliberate product decision without either author noticing. So it is left
-- alone on purpose. If the demos-are-private reading is the one you want, the
-- change belongs in 38 next to its own reasoning, not silently after it.

-- ▶ function-grants.sql

-- ─────────────────────────────────────────────────────────────────────────
-- No function in this schema is callable without signing in.
--
-- Postgres grants EXECUTE to PUBLIC on every function it creates. That default
-- is what `anon` resolves through, and `anon` is the key compiled into the
-- shipped mobile app — so every RPC was reachable by anyone who extracted it.
-- Thirty-two SECURITY DEFINER functions had no revoke at all, and the three
-- that did named `anon` rather than PUBLIC, which does nothing.
--
-- Two ways this kept coming back:
--
--   · A new function silently inherits the PUBLIC grant. Nobody has to make a
--     mistake for the hole to exist; it is there unless someone removes it.
--   · `drop function` takes the ACL with it, so recreating a function to fix
--     something else quietly restores the default. That happened today: the
--     class-attendance fix dropped and recreated its function, and the
--     recreated one was anon-callable again until the revoke was re-applied.
--
-- So this is written as a loop over the catalogue rather than a list of names.
-- A list would go stale the first time somebody adds a function, which is
-- exactly how the schema arrived here.
--
-- Trigger functions are skipped: they return `trigger`, PostgREST does not
-- expose them as RPCs, and they are invoked by the trigger rather than called.
--
-- Every function gets `authenticated`, which is strictly narrower than the
-- PUBLIC grant it replaces. This is not the authorization — each function
-- still carries its own tenant check, and that is what stops one gym reading
-- another. This only ensures a caller has proved who they are first.
--
-- Nothing in the product needs anon RPC access. Every call site was checked:
-- record_referral, the one that looks like a pre-auth candidate, records the
-- SIGNED-IN user and runs after sign-up returns a session.
--
-- RE-RUN THIS after adding or recreating any function. It is idempotent.
-- ─────────────────────────────────────────────────────────────────────────

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and pg_get_function_result(p.oid) <> 'trigger'
  loop
    execute format('revoke execute on function %s from public', r.sig);
    execute format('revoke execute on function %s from anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

-- ▶ account-deletion.sql

-- ─────────────────────────────────────────────────────────────────────────
-- Make "delete my account" actually delete the account.
--
-- request_account_deletion() has existed since 02-domain-schema.sql and does
-- one thing:
--
--   update profiles set deletion_requested_at = now() where id = auth.uid();
--
-- Nothing anywhere reads that column. Grepped the whole repo: written in one
-- place, read in zero. So a member tapped the button, got a success response,
-- and their data stayed indefinitely with nobody even notified. That is worse
-- than not offering deletion at all — it is a promise the software does not
-- keep, and Google Play is about to require a public page describing it.
--
-- WHY A TRUE DELETE IS POSSIBLE HERE. profiles.id references auth.users(id) on
-- delete cascade, and 26 tables cascade directly from profiles — 39 once the
-- cascade is followed all the way down. Removing the auth user therefore
-- removes the person's data by construction rather than by a hand-maintained
-- list of DELETE statements that would drift the first time somebody adds a
-- table. Seventeen further columns across 13 tables are `on delete set null`:
-- those rows survive with the person detached, which is right for payments,
-- door-log visits and guest passes a gym must keep for tax and legal reasons.
--
-- INVOICES AND MEMBERSHIPS ARE NOT IN THAT SURVIVING SET. An earlier version
-- of this comment said they were, and it was wrong: gym_invoices.member_id and
-- memberships.member_id are both `not null references profiles(id) on delete
-- cascade`, so deleting a member takes their invoices and memberships with
-- them. Counted from the live catalogue, not from memory:
--
--   select confdeltype, count(*) from pg_constraint
--   where contype='f' and confrelid='public.profiles'::regclass
--   group by confdeltype;   -- c: 29 cols / 26 tables, n: 17 cols / 13 tables
--
-- That matters beyond tidiness. The public deletion page and the owner's
-- confirmation dialog both tell people what survives, and a gym with a tax
-- obligation to retain invoices needs to know this deletes them.
--
-- The cascade is the design. This file adds who may pull the trigger, a record
-- that it happened, and a way for a gym to see what is waiting.
-- ─────────────────────────────────────────────────────────────────────────


-- ── the queue ──────────────────────────────────────────────────────────────
--
-- deletion_requested_at already exists. This adds the other half: when it was
-- actioned, and by whom, so a gym can show its own compliance record after the
-- profile itself is gone.

create table if not exists public.deletion_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete set null,
  -- Deliberately NOT a foreign key to profiles. The whole point is that the
  -- profile no longer exists once this row is written; a reference would either
  -- block the delete or null itself and destroy the audit trail.
  subject_id uuid not null,
  subject_label text,
  requested_at timestamptz,
  actioned_at timestamptz not null default now(),
  actioned_by uuid references auth.users(id) on delete set null,
  note text
);

create index if not exists idx_deletion_log_tenant
  on public.deletion_log(tenant_id, actioned_at desc);

alter table public.deletion_log enable row level security;

drop policy if exists deletion_log_owner on public.deletion_log;
create policy deletion_log_owner on public.deletion_log for select
  using (is_owner_of(tenant_id));


-- ── what a gym can see ─────────────────────────────────────────────────────
--
-- Pending requests for this gym only. A view rather than a policy on profiles,
-- because the owner needs the request date and a name to act on, and nothing
-- more — this is not a general window onto member records.

create or replace view public.pending_deletions
with (security_invoker = true) as
  select p.id            as subject_id,
         p.tenant_id,
         p.full_name,
         p.role,
         p.deletion_requested_at,
         -- How long the gym has left. The public page promises 30 days.
         greatest(0, 30 - extract(day from (now() - p.deletion_requested_at))::int) as days_remaining
  from public.profiles p
  where p.deletion_requested_at is not null;

grant select on public.pending_deletions to authenticated;


-- ── withdrawing ────────────────────────────────────────────────────────────
--
-- The public page promises a grace period during which a request can be taken
-- back. Without this the promise is unkeepable: nothing could clear the flag.

create or replace function public.withdraw_account_deletion()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  update profiles set deletion_requested_at = null where id = auth.uid();
end $$;

revoke execute on function public.withdraw_account_deletion() from public, anon;
grant execute on function public.withdraw_account_deletion() to authenticated;


-- ── actioning it ───────────────────────────────────────────────────────────
--
-- Deletes the auth user, which cascades. Restricted to the owner of the gym
-- the person belongs to, and only for someone who actually asked — a gym
-- cannot use this to remove a member who has not requested it, which would be
-- a deletion tool wearing a compliance label.
--
-- The log row is written BEFORE the delete. Afterwards the profile is gone and
-- there is nothing left to read a name or a tenant from.

create or replace function public.action_account_deletion(p_subject uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  subj_tenant uuid;
  subj_name text;
  subj_requested timestamptz;
begin
  select tenant_id, full_name, deletion_requested_at
    into subj_tenant, subj_name, subj_requested
  from profiles where id = p_subject;

  if not found then
    raise exception 'No such account.' using errcode = 'P0002';
  end if;

  if subj_requested is null then
    raise exception 'That member has not asked to be deleted.' using errcode = '42501';
  end if;

  if not is_owner_of(subj_tenant) then
    raise exception 'Only the owner of that gym can action this.' using errcode = '42501';
  end if;

  insert into deletion_log (tenant_id, subject_id, subject_label, requested_at, actioned_by)
  values (subj_tenant, p_subject, subj_name, subj_requested, auth.uid());

  -- Cascades: 26 tables directly, 39 following the chain down.
  -- Seventeen columns are `on delete set null`, so payments, visits and
  -- passes survive with the person detached. Invoices and memberships do
  -- NOT — they cascade. See the header.
  delete from auth.users where id = p_subject;
end $$;

revoke execute on function public.action_account_deletion(uuid) from public, anon;
grant execute on function public.action_account_deletion(uuid) to authenticated;

-- ▶ deletion-request-idempotent.sql

-- ─────────────────────────────────────────────────────────────────────────
-- Asking twice must not push the deadline away from you.
--
-- request_account_deletion() has been unconditional since 02-domain-schema.sql:
--
--   update profiles set deletion_requested_at = now() where id = auth.uid();
--
-- So a second call overwrites the first timestamp with a later one. The clock
-- the public page promises — actioned within 30 days of asking — restarts, and
-- pending_deletions.days_remaining jumps back up to 30. The person waited
-- longer by asking again, which is the opposite of what pressing the button
-- twice means.
--
-- This is not hypothetical. The client settings screen offers the request
-- again whenever it cannot READ the current state (a failed read must not
-- block anyone's right to erasure), so the double-call path is one dropped
-- connection away, and it is reachable by exactly the person least likely to
-- notice their deadline moved.
--
-- The fix is a where-clause, not a raise. Asking to be deleted when you have
-- already asked is not an error to be shouted at — the state you wanted is the
-- state you are in. It returns quietly, the original timestamp stands, and the
-- call stays idempotent for a client that retries.
--
-- Withdrawing still clears the flag, so withdraw-then-ask-again correctly
-- starts a fresh clock. That is a different act from asking twice.
--
-- `create or replace` keeps the function's existing ACL — only `drop function`
-- discards it — so the authenticated-only grant from 40-function-grants.sql
-- survives this. Verified with has_function_privilege after applying rather
-- than assumed, because that exact assumption was wrong earlier in this
-- schema's history.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.request_account_deletion()
returns void language plpgsql security definer set search_path = public as $$
begin
  update profiles
     set deletion_requested_at = now()
   where id = auth.uid()
     and deletion_requested_at is null;   -- the first ask is the one that counts
end $$;

-- ▶ exercise-video-library.sql

-- ── Exercise videos: a library that survives the phone it was recorded on ───
--
-- The trainer video library has never once written a row. `exercise_videos`
-- declares `exercise_id text not null references exercises(id)` and `title text
-- not null`; the app inserts `{trainer_id, name, muscle_group, url}` and
-- supplies neither. Postgres refused every insert with 23502, supabase-js
-- returned that as `{ data: null, error }` rather than throwing, and the catch
-- in src/ui/exerciseVideos.ts fell through to an AsyncStorage-only entry. So a
-- trainer recorded a clip, watched it appear in their library, and lost it on
-- the next device — while the screen said "Added". The live table today holds
-- zero rows and the bucket holds zero files, which is the proof: the remote
-- path has never worked, and nothing here can lose data that was never stored.
--
-- Three things had to be true before this could be fixed rather than patched.
--
-- 1 · An exercise had to become a thing, not a spelling. `exercises` has been
--     in the schema since 01 and has never held a single row; the app names an
--     exercise with a free-text display string and joins video to exercise with
--     a bidirectional substring match at render time, so "Squat" matches
--     whichever of Back, Front or Goblet Squat happens to sort first. This
--     seeds the catalogue from the three vocabularies the app already ships
--     (the builder's picker, focus.ts, machines.ts), deduped on a slug, and
--     lets a trainer's custom movement mint its own slug on demand. The
--     NOT NULLs are then satisfiable rather than in the way, so they stay.
--
-- 2 · The bucket had to stop being public. `exercise-videos` was created by
--     hand in the dashboard, written down nowhere, and marked public — so a
--     clip of a named trainer demonstrating an exercise was readable by anyone
--     who ever saw the URL, whatever the table's policies said. It is declared
--     here and flipped to private; `video_path` (the column 01 defined and
--     nothing ever wrote) becomes the durable handle, and the app signs a
--     short-lived URL when someone is actually allowed to watch. `url` stays
--     for the other case: a link to a video hosted somewhere else entirely.
--
-- 3 · Visibility had to be the trainer's decision. 38-tenant-isolation.sql
--     opened SELECT to every authenticated user on the reasoning that "exercise
--     demos are content, not customer data", and 39-owner-policy-scope.sql then
--     declined to narrow it from a later file, saying the change "belongs in 38
--     next to its own reasoning". This file argues with that paragraph directly,
--     so here is the argument: it is true of a stock demo of a barbell row and
--     false of a clip with a named coach in it, and the table cannot tell them
--     apart because nobody ever asked. Now it asks. `visibility` carries the
--     answer per clip — private, this trainer's clients, the whole gym, or
--     genuinely public — plus an explicit grant list for "this person, this
--     clip". A platform clip with no trainer behind it is public by default,
--     which preserves 38's intent for exactly the content 38 was describing.
-- ───────────────────────────────────────────────────────────────────────────

-- ── 1 · The exercise catalogue ─────────────────────────────────────────────
-- Slug rule, mirrored exactly by exerciseSlug() in src/lib/exerciseId.ts:
-- lowercase, every run of non-alphanumerics becomes a single hyphen, trimmed.
-- 'Back Squat' → 'back-squat', 'Push-up' → 'push-up'. It is what collapses
-- 'Bent-over Row' and 'Bent-Over Row' into one row rather than two movements.

insert into public.exercises (id, name, muscle_group, is_cardio) values
  ('ab-crunch', 'Ab Crunch', 'Core', false),
  ('air-bike', 'Air Bike', 'Full body', true),
  ('assisted-pull-up', 'Assisted Pull-up', 'Back', false),
  ('back-extension', 'Back Extension', 'Lower back', false),
  ('back-squat', 'Back Squat', 'Legs', false),
  ('barbell-curl', 'Barbell Curl', 'Arms', false),
  ('bench-press', 'Bench Press', 'Chest', false),
  ('bent-over-row', 'Bent-over Row', 'Back', false),
  ('bicep-curl', 'Bicep Curl', 'Arms', false),
  ('bulgarian-split-squat', 'Bulgarian Split Squat', 'Legs', false),
  ('cable-crossover', 'Cable Crossover', 'Chest', false),
  ('cable-crunch', 'Cable Crunch', 'Core', false),
  ('cable-kickback', 'Cable Kickback', 'Glutes', false),
  ('cable-machine', 'Cable Machine', 'Full body', false),
  ('calf-raise', 'Calf Raise', 'Calves', false),
  ('chest-press', 'Chest Press', 'Chest', false),
  ('deadlift', 'Deadlift', 'Back', false),
  ('elliptical', 'Elliptical', 'Full body', true),
  ('face-pull', 'Face Pull', 'Shoulders', false),
  ('front-squat', 'Front Squat', 'Legs', false),
  ('glute-bridge', 'Glute Bridge', 'Glutes', false),
  ('good-morning', 'Good Morning', 'Hamstrings', false),
  ('hack-squat', 'Hack Squat', 'Legs', false),
  ('hammer-curl', 'Hammer Curl', 'Arms', false),
  ('hanging-leg-raise', 'Hanging Leg Raise', 'Core', false),
  ('hip-abduction', 'Hip Abduction', 'Glutes', false),
  ('hip-thrust', 'Hip Thrust', 'Glutes', false),
  ('incline-dumbbell-press', 'Incline Dumbbell Press', 'Chest', false),
  ('lat-pulldown', 'Lat Pulldown', 'Back', false),
  ('lateral-raise', 'Lateral Raise', 'Shoulders', false),
  ('leg-curl', 'Leg Curl', 'Hamstrings', false),
  ('leg-extension', 'Leg Extension', 'Legs', false),
  ('leg-press', 'Leg Press', 'Legs', false),
  ('nordic-curl', 'Nordic Curl', 'Hamstrings', false),
  ('overhead-press', 'Overhead Press', 'Shoulders', false),
  ('overhead-tricep-extension', 'Overhead Tricep Extension', 'Arms', false),
  ('pec-deck', 'Pec Deck', 'Chest', false),
  ('plank', 'Plank', 'Core', false),
  ('pull-up', 'Pull-up', 'Back', false),
  ('push-up', 'Push-up', 'Chest', false),
  ('rear-delt-fly', 'Rear Delt Fly', 'Shoulders', false),
  ('romanian-deadlift', 'Romanian Deadlift', 'Hamstrings', false),
  ('rowing-machine', 'Rowing Machine', 'Full body', true),
  ('russian-twist', 'Russian Twist', 'Core', false),
  ('seated-calf-raise', 'Seated Calf Raise', 'Calves', false),
  ('seated-row', 'Seated Row', 'Back', false),
  ('shoulder-press', 'Shoulder Press', 'Shoulders', false),
  ('ski-erg', 'Ski Erg', 'Full body', true),
  ('smith-machine', 'Smith Machine', 'Full body', false),
  ('stair-climber', 'Stair Climber', 'Legs', true),
  ('standing-calf-raise', 'Standing Calf Raise', 'Calves', false),
  ('treadmill', 'Treadmill', 'Legs', true),
  ('tricep-pushdown', 'Tricep Pushdown', 'Arms', false),
  ('triceps-pushdown', 'Triceps Pushdown', 'Arms', false),
  ('upright-bike', 'Upright Bike', 'Legs', true),
  ('walking-lunge', 'Walking Lunge', 'Legs', false)
on conflict (id) do nothing;

-- The catalogue had no row-level security at all, which — per 38's own third
-- section — means the policies it never had were not the problem: the anon key
-- is compiled into the shipped app, so the table was world-writable. Reading is
-- open to anyone signed in, because a catalogue is only useful if everyone
-- resolves the same slug to the same movement. Writing is how a trainer's
-- custom exercise gets a durable id, so it is open to staff and closed to
-- clients. Nothing here can be deleted through the API.
alter table public.exercises enable row level security;

drop policy if exists exercises_read on public.exercises;
create policy exercises_read on public.exercises for select
  to authenticated using (true);

drop policy if exists exercises_staff_w on public.exercises;
create policy exercises_staff_w on public.exercises for insert
  to authenticated with check (my_role() in ('trainer', 'owner'));

-- ── 2 · Reconciling exercise_videos with what the app actually writes ──────
-- name, muscle_group and url exist in the live database and in no SQL file in
-- this repo — added by hand at some point and never written down. Declaring
-- them here is what stops the next person reading 01-schema.sql and believing
-- the table is something it is not. `title` and `exercise_id` keep their NOT
-- NULL: section 1 is what makes them answerable.
alter table public.exercise_videos add column if not exists name         text;
alter table public.exercise_videos add column if not exists muscle_group text;
alter table public.exercise_videos add column if not exists url          text;

-- Who may watch this clip. Default 'clients': a coach who records a demo means
-- it for the people they coach, and a default that silently published it to the
-- platform would be the wrong way round to be wrong.
alter table public.exercise_videos add column if not exists visibility text not null default 'clients';

alter table public.exercise_videos drop constraint if exists exercise_videos_visibility_chk;
alter table public.exercise_videos add constraint exercise_videos_visibility_chk
  check (visibility in ('private', 'clients', 'gym', 'public'));

create index if not exists idx_exercise_videos_exercise on public.exercise_videos(exercise_id);
create index if not exists idx_exercise_videos_trainer  on public.exercise_videos(trainer_id);

-- ── 3 · "Whoever the trainer gives permissions to" ─────────────────────────
-- The four visibility levels answer the common cases; this answers the precise
-- one. A row here is a named person the trainer handed one clip to, and it is
-- additive only — it can widen who sees a private clip and can never narrow a
-- public one.
create table if not exists public.exercise_video_grants (
  video_id   uuid not null references public.exercise_videos(id) on delete cascade,
  client_id  uuid not null references public.profiles(id) on delete cascade,
  granted_at timestamptz not null default now(),
  primary key (video_id, client_id)
);
create index if not exists idx_exvid_grants_client on public.exercise_video_grants(client_id);

alter table public.exercise_video_grants enable row level security;

-- The trainer who owns the clip manages its grants. The join to exercise_videos
-- is safe to write inline for the same reason 39 gives for its trainers join:
-- exvid_trainer_rw already lets that trainer read the row this asks about.
drop policy if exists exvid_grants_trainer_rw on public.exercise_video_grants;
create policy exvid_grants_trainer_rw on public.exercise_video_grants for all
  using (exists (select 1 from public.exercise_videos v
                  where v.id = exercise_video_grants.video_id and v.trainer_id = (select auth.uid())))
  with check (exists (select 1 from public.exercise_videos v
                  where v.id = exercise_video_grants.video_id and v.trainer_id = (select auth.uid())));

-- A person may see that they were given something.
drop policy if exists exvid_grants_client_r on public.exercise_video_grants;
create policy exvid_grants_client_r on public.exercise_video_grants for select
  using (client_id = (select auth.uid()));

-- ── 4 · The read rule ──────────────────────────────────────────────────────
-- Replaces 38's `using (true)`. Each arm is one sentence of the product rule,
-- in the order a person would say them.
drop policy if exists exvid_read on public.exercise_videos;
create policy exvid_read on public.exercise_videos for select to authenticated using (
  -- the trainer's own clip, whatever it is set to
  trainer_id = (select auth.uid())
  -- a platform clip belonging to no trainer, which is what 38 meant by content
  or (trainer_id is null and visibility in ('public', 'clients', 'gym'))
  -- anything a trainer deliberately published
  or visibility = 'public'
  -- their own coach's clip, the ordinary case
  or (visibility = 'clients' and exists (
        select 1 from public.clients c
         where c.id = (select auth.uid()) and c.trainer_id = exercise_videos.trainer_id))
  -- shared with the whole gym: any member or staff of the tenant that trainer is in
  or (visibility = 'gym' and exists (
        select 1 from public.trainers tr
         where tr.id = exercise_videos.trainer_id and tr.tenant_id = my_tenant()))
  -- handed to this person by name, which can reach even a private clip
  or exists (select 1 from public.exercise_video_grants g
              where g.video_id = exercise_videos.id and g.client_id = (select auth.uid()))
  -- the owner of the gym the trainer belongs to
  or exists (select 1 from public.trainers tr
              where tr.id = exercise_videos.trainer_id and is_owner_of(tr.tenant_id))
);

-- ── 5 · The bucket, and the file behind the row ────────────────────────────
-- Declared here because it was not declared anywhere. Private: a signed URL is
-- what carries permission to the player, so the table's rule above is the only
-- way in rather than a suggestion sitting in front of a public URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exercise-videos', 'exercise-videos', false, 524288000,
        array['video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Whether the caller may watch the file at this storage path.
--
-- Deliberately SECURITY INVOKER — the opposite of the usual advice in this
-- schema, and for a reason worth stating. Running as the caller means the
-- select inside it is filtered by exvid_read above, so the storage rule cannot
-- drift away from the table rule: there is exactly one definition of who may
-- watch a clip, and this asks it rather than restating it. There is no
-- recursion hazard because exercise_videos' policy never reads storage.
create or replace function public.can_watch_exercise_video(p_path text)
returns boolean language sql stable security invoker set search_path to 'public'
as $function$
  select exists (select 1 from public.exercise_videos v where v.video_path = p_path);
$function$;

revoke execute on function public.can_watch_exercise_video(text) from public, anon;
grant execute on function public.can_watch_exercise_video(text) to authenticated;

-- A trainer owns the folder named after them; nobody writes into anyone else's.
-- This is the convention the upload code already follows: `${uid}/${epoch}.mp4`.
drop policy if exists exvid_object_w on storage.objects;
create policy exvid_object_w on storage.objects for insert to authenticated
  with check (bucket_id = 'exercise-videos'
              and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists exvid_object_u on storage.objects;
create policy exvid_object_u on storage.objects for update to authenticated
  using (bucket_id = 'exercise-videos'
         and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists exvid_object_d on storage.objects;
create policy exvid_object_d on storage.objects for delete to authenticated
  using (bucket_id = 'exercise-videos'
         and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Reading is whatever the table said.
drop policy if exists exvid_object_r on storage.objects;
create policy exvid_object_r on storage.objects for select to authenticated
  using (bucket_id = 'exercise-videos' and public.can_watch_exercise_video(name));
