-- ═══════════════════════════════════════════════════════════════════════════
-- Repple — ONE-SHOT Supabase setup. Paste this whole file into the Supabase
-- SQL editor (Dashboard ▸ SQL Editor ▸ New query) and Run.
-- Every part below is idempotent; order is dependency-correct and safe to re-run.
-- GENERATED from supabase/parts/*.sql by scripts/build-supabase-setup.mjs.
-- Do not hand-edit — edit the part and rebuild.
-- ═══════════════════════════════════════════════════════════════════════════

-- ▶ schema.sql



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
revoke execute on function all_member_ids() from anon;
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
revoke execute on function public.approve_session(uuid, text) from anon;
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
