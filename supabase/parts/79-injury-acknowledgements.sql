-- A coach has seen this client's injuries, and which ones.
--
-- This table exists in the live database and was never written down as a part,
-- which check-schema catches and is right to: being in the repo is not being
-- in the database, and being in the database is not being in the repo. The
-- next environment built from supabase/setup.sql would have come up without
-- it, and the acknowledgement gate would have failed open.
--
-- ── Why it stores the injuries and not just a timestamp ───────────────────
--
-- The point of the gate is that a coach cannot assign a program before reading
-- what the client cannot do. A bare acknowledged_at would be satisfied forever
-- by one tap: a client who later discloses a new shoulder problem would have it
-- silently covered by an acknowledgement made before it existed, which is the
-- exact failure the gate is there to prevent.
--
-- Storing WHAT was acknowledged makes the check a set comparison instead. The
-- acknowledgement stands while the current injuries are a subset of the ones
-- acknowledged, and a new disclosure invalidates it without anything having to
-- notice and clear a flag.
--
-- ── Access ────────────────────────────────────────────────────────────────
--
-- The coach owns the row and is the only one who can write it. The client may
-- read their own — they are entitled to see that what they disclosed was read,
-- and by when — and may not write it, because an acknowledgement the client
-- could create is not an acknowledgement.
--
-- auth.uid(), never current_user: under PostgREST every signed-in request runs
-- as the shared `authenticated` role, so current_user is the same string for
-- every person on the platform and a policy built on it grants everything to
-- everyone.

create table if not exists public.injury_acknowledgements (
  trainer_id             uuid        not null references public.trainers(id) on delete cascade,
  client_id              uuid        not null references public.clients(id)  on delete cascade,
  acknowledged_at        timestamptz not null default now(),
  -- The injuries as they read when the coach acknowledged them.
  acknowledged_injuries  text[]      not null default '{}'::text[],
  primary key (trainer_id, client_id)
);

alter table public.injury_acknowledgements enable row level security;

drop policy if exists injury_ack_trainer_rw on public.injury_acknowledgements;
create policy injury_ack_trainer_rw on public.injury_acknowledgements
  for all
  to authenticated
  using (trainer_id = (select auth.uid()))
  with check (trainer_id = (select auth.uid()));

drop policy if exists injury_ack_client_read on public.injury_acknowledgements;
create policy injury_ack_client_read on public.injury_acknowledgements
  for select
  to authenticated
  using (client_id = (select auth.uid()));
