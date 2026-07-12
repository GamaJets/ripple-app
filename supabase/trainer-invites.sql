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
