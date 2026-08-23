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
