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

revoke execute on function public.link_coaching(uuid, uuid, text) from anon;
revoke execute on function public.link_coaching(uuid, uuid, text) from public;
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

revoke execute on function public.class_roster(uuid) from anon;
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

revoke execute on function public.class_counts() from anon;
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

revoke execute on function public.book_class(uuid) from anon;
revoke execute on function public.cancel_class(uuid) from anon;
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
