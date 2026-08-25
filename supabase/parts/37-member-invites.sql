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
