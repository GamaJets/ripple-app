-- Trainer directory → coaching request → roster.
--
-- DUMPED FROM THE LIVE DATABASE (project phgfwzpkkwdysftlgkoq), not authored
-- here. These objects were applied by hand in an earlier session and had never
-- been written down; an earlier reconstruction of them from the app's call sites
-- got several details wrong, so this file is the database's own definition.
-- Re-running it against live is a no-op.

-- ── Public-facing trainer profile ───────────────────────────────────────────
-- Nullable with no defaults, matching live. (A reconstruction had these NOT NULL
-- with defaults, which `add column if not exists` would have silently skipped.)
alter table trainers add column if not exists tagline     text;
alter table trainers add column if not exists offers      text[];
alter table trainers add column if not exists specialties text[];
alter table trainers add column if not exists session_fee numeric;
alter table trainers add column if not exists listed      boolean not null default false;

create index if not exists trainers_listed_idx on trainers(listed) where listed;

alter table trainers enable row level security;

-- Five policies, all SELECT except the trainer's own row. `trainers` is readable
-- far more narrowly than the repo previously suggested.
drop policy if exists trainers_self_rw on trainers;
create policy trainers_self_rw on trainers
  for all using ((select auth.uid()) = id);

drop policy if exists trainers_public_directory_r on trainers;
create policy trainers_public_directory_r on trainers
  for select to authenticated using (listed = true);

drop policy if exists trainers_owner_r on trainers;
create policy trainers_owner_r on trainers
  for select using (is_owner_of(tenant_id));

drop policy if exists trainers_peer_r on trainers;
create policy trainers_peer_r on trainers
  for select using (exists (
    select 1 from trainers t1
     where t1.id = (select auth.uid()) and t1.tenant_id = trainers.tenant_id));

drop policy if exists trainers_assigned_client_r on trainers;
create policy trainers_assigned_client_r on trainers
  for select using (exists (
    select 1 from coach_clients
     where coach_clients.trainer_id = trainers.id
       and coach_clients.id = (select auth.uid())));

-- ── Coaching requests ───────────────────────────────────────────────────────
create table if not exists coach_requests (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references profiles(id) on delete cascade,
  trainer_id   uuid not null references profiles(id) on delete cascade,
  mode         text not null default 'online'  check (mode in ('online','inperson')),
  status       text not null default 'pending' check (status in ('pending','accepted','declined','withdrawn')),
  note         text,
  created_at   timestamptz not null default now(),
  responded_at timestamptz
);

-- Partial unique: one PENDING request per pair, but a declined request can be
-- sent again later. A plain unique (client_id, trainer_id) would have blocked
-- that forever; this is what makes trainers.tsx's duplicate handling correct.
create unique index if not exists coach_requests_one_pending
  on coach_requests(client_id, trainer_id) where status = 'pending';
create index if not exists coach_requests_client_idx  on coach_requests(client_id, status);
create index if not exists coach_requests_trainer_idx on coach_requests(trainer_id, status);

alter table coach_requests enable row level security;

drop policy if exists coach_requests_client_rw on coach_requests;
create policy coach_requests_client_rw on coach_requests
  for all to authenticated
  using (client_id = (select auth.uid()))
  with check (client_id = (select auth.uid()));

drop policy if exists coach_requests_trainer_r on coach_requests;
create policy coach_requests_trainer_r on coach_requests
  for select to authenticated using (trainer_id = (select auth.uid()));

drop policy if exists coach_requests_trainer_u on coach_requests;
create policy coach_requests_trainer_u on coach_requests
  for update to authenticated
  using (trainer_id = (select auth.uid()))
  with check (trainer_id = (select auth.uid()));

-- ── Coach-created roster entries ────────────────────────────────────────────
-- `id` is not a foreign key: a coach adds clients by hand who have no auth
-- account. `trainer_id` references auth.users directly, not profiles.
create table if not exists coach_clients (
  id         uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  goal       text,
  mode       text not null default 'online' check (mode in ('online','inperson')),
  created_at timestamptz not null default now()
);

create index if not exists coach_clients_trainer_idx on coach_clients(trainer_id, created_at);

alter table coach_clients enable row level security;

-- cc_own and coach_clients_trainer_rw are redundant with each other; both exist
-- live and both are reproduced so this file matches the database exactly.
drop policy if exists cc_own on coach_clients;
create policy cc_own on coach_clients
  for all using (trainer_id = (select auth.uid()))
  with check (trainer_id = (select auth.uid()));

drop policy if exists coach_clients_trainer_rw on coach_clients;
create policy coach_clients_trainer_rw on coach_clients
  for all using ((select auth.uid()) = trainer_id);

drop policy if exists coach_clients_client_r on coach_clients;
create policy coach_clients_client_r on coach_clients
  for select using ((select auth.uid()) = id);

drop policy if exists coach_clients_owner_r on coach_clients;
create policy coach_clients_owner_r on coach_clients
  for select using (exists (
    select 1 from profiles
     where profiles.id = (select auth.uid()) and profiles.role = 'owner'));
