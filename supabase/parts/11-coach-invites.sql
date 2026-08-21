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
