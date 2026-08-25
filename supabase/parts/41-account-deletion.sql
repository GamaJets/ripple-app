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
