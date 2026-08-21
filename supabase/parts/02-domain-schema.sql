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
