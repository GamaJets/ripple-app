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
