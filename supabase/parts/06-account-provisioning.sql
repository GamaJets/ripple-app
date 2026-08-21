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
