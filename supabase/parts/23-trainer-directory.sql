-- Trainer directory → coaching request → roster. The three pieces of that chain
-- were live in the app but had never been written down as SQL: the app queried
-- `trainers.listed`, inserted into `coach_requests` and upserted `coach_clients`,
-- none of which existed here. Reconstructed from the call sites:
--   app/(client)/trainers.tsx, src/ui/CoachRequests.tsx, src/ui/roster.tsx,
--   src/ui/coachProfile.tsx
--
-- Idempotent in both directions: `if not exists` for a fresh project, and
-- `add column if not exists` so it also converges on a database where these were
-- created by hand.

-- ── Public-facing trainer profile ───────────────────────────────────────────
-- `trainers` had only (id, tenant_id, bio); coachProfile.tsx reads and writes
-- five more, and the client directory filters on `listed`. Without these the
-- directory query fails outright and no coach is ever discoverable.
alter table trainers add column if not exists tagline     text;
alter table trainers add column if not exists offers      text[] not null default '{}';
alter table trainers add column if not exists specialties text[] not null default '{}';
alter table trainers add column if not exists session_fee numeric(8,2) not null default 75;
alter table trainers add column if not exists listed      boolean not null default false;

comment on column trainers.listed is
  'Opt-in. The trainer sets this themselves; only listed trainers appear in the client directory.';

create index if not exists idx_trainers_listed on trainers(listed) where listed;

-- ── Coaching requests ───────────────────────────────────────────────────────
-- A client asks a listed trainer to coach them. The trainer sees pending rows on
-- their dashboard and accepts or declines. The client's "Request pending" state
-- is this row, so it must be readable by both sides.
create table if not exists coach_requests (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references profiles(id) on delete cascade,
  trainer_id   uuid not null references profiles(id) on delete cascade,
  mode         text not null default 'online' check (mode in ('online','inperson')),
  status       text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  unique (client_id, trainer_id)
);

-- trainers.tsx treats a unique violation as "already sent" rather than an error,
-- which is why the constraint above is load-bearing and not just hygiene.
create index if not exists idx_coach_requests_trainer on coach_requests(trainer_id, status);

alter table coach_requests enable row level security;

drop policy if exists coach_requests_client_read on coach_requests;
create policy coach_requests_client_read on coach_requests
  for select using (client_id = (select auth.uid()));

drop policy if exists coach_requests_client_insert on coach_requests;
create policy coach_requests_client_insert on coach_requests
  for insert with check (client_id = (select auth.uid()));

drop policy if exists coach_requests_trainer_read on coach_requests;
create policy coach_requests_trainer_read on coach_requests
  for select using (trainer_id = (select auth.uid()));

-- Only the trainer answers a request. A client cannot accept on their own behalf.
drop policy if exists coach_requests_trainer_update on coach_requests;
create policy coach_requests_trainer_update on coach_requests
  for update using (trainer_id = (select auth.uid()))
  with check (trainer_id = (select auth.uid()));

grant select, insert, update on coach_requests to authenticated;

-- ── Coach-created roster entries ────────────────────────────────────────────
-- Two kinds of row land here: a client accepted from the directory (id = that
-- client's auth id, upserted on conflict) and a client the coach typed in by
-- hand, who has no auth account at all. `id` therefore defaults to a fresh uuid
-- and is deliberately NOT a foreign key to profiles — dashboard.tsx already
-- documents that a hand-added client has no user account behind it.
create table if not exists coach_clients (
  id         uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references profiles(id) on delete cascade,
  name       text not null,
  goal       text,
  mode       text not null default 'online' check (mode in ('online','inperson')),
  created_at timestamptz not null default now()
);

create index if not exists idx_coach_clients_trainer on coach_clients(trainer_id, created_at);

alter table coach_clients enable row level security;

drop policy if exists coach_clients_own on coach_clients;
create policy coach_clients_own on coach_clients
  for all using (trainer_id = (select auth.uid()))
  with check (trainer_id = (select auth.uid()));

grant select, insert, update, delete on coach_clients to authenticated;
