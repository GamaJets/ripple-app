-- ── Blood glucose, read out of Health ──────────────────────────────────────
--
-- A CGM — Dexcom, or a Libre through its companion app — writes its readings
-- into Apple Health and Health Connect. Repple reads them from there. That is
-- deliberately the whole integration: no vendor contract, no per-brand API key,
-- no separate review, and any monitor that reaches Health reaches Repple.
--
-- Readings hang off `profiles`, not `clients`, for the reason part 95 was
-- written: a coach has no `clients` row, and every coach-side meal and scan was
-- being refused by a foreign key nobody had noticed. A coach tracking their own
-- sugars is exactly the same feature as a client doing it.
create table if not exists public.glucose_readings (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references public.profiles(id) on delete cascade,
  taken_at timestamptz not null,
  -- Stored in mmol/L always. mg/dL is a DISPLAY unit and is converted at the
  -- edge (see src/lib/glucose.ts) — two units in one column is how a 5.5 and a
  -- 99 end up on the same axis.
  --
  -- The bounds are survivability, not clinical judgement: below 0.5 or above
  -- 40 mmol/L is a broken import rather than a person, and a garbage row on a
  -- chart of somebody's sugars is worse than a missing one.
  mmol_l numeric(4,1) not null check (mmol_l >= 0.5 and mmol_l <= 40),
  source text not null check (source in ('health', 'manual')),
  -- HealthKit's own sample UUID. Health is re-read on every open, so without
  -- this the same reading lands again every time — and a CGM writes one every
  -- five minutes.
  external_id text,
  created_at timestamptz not null default now()
);

-- Partial, so hand-typed readings (external_id null) can repeat freely while an
-- imported one can only ever land once.
create unique index if not exists glucose_external_once
  on public.glucose_readings (client_id, external_id)
  where external_id is not null;

create index if not exists glucose_client_time_idx
  on public.glucose_readings (client_id, taken_at desc);

alter table public.glucose_readings enable row level security;


-- ── Whether the coach may see them at all ──────────────────────────────────
--
-- Off by default, and off is the honest default: somebody wearing a CGM is
-- usually wearing it because of a diagnosis, and a coach learning about a
-- diagnosis should be the client's decision made on purpose, not a consequence
-- of connecting a watch.
--
-- On `clients` rather than `profiles` because sharing only means anything when
-- there is somebody to share with.
alter table public.clients
  add column if not exists glucose_shared boolean not null default false;

-- Same reasoning as part 96, and the same mechanism, because RLS still cannot
-- restrict which COLUMNS an update touches: `clients_trainer_update` lets a
-- coach write their client's row, so without this a coach could grant
-- themselves the access this column exists to withhold.
create or replace function public.clients_glucose_consent_is_the_clients()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if new.glucose_shared is distinct from old.glucose_shared
     and auth.uid() is not null
     and auth.uid() <> old.id then
    raise exception 'Only the client may choose to share their glucose readings'
      using errcode = '42501';
  end if;
  return new;
end $fn$;

drop trigger if exists clients_glucose_consent_guard on public.clients;
create trigger clients_glucose_consent_guard
  before update on public.clients
  for each row execute function public.clients_glucose_consent_is_the_clients();


-- ── Policies ───────────────────────────────────────────────────────────────
--
-- The owner does everything with their own readings, including deleting them.
drop policy if exists glucose_owner on public.glucose_readings;
create policy glucose_owner on public.glucose_readings
  for all using (client_id = (select auth.uid()))
  with check (client_id = (select auth.uid()));

-- The coach reads, and only while the client says so. Revoking consent hides
-- the history as well as the next reading — a share that cannot be taken back
-- is not a share.
drop policy if exists glucose_trainer_read on public.glucose_readings;
create policy glucose_trainer_read on public.glucose_readings
  for select using (
    exists (
      select 1 from public.clients c
       where c.id = glucose_readings.client_id
         and c.trainer_id = (select auth.uid())
         and c.glucose_shared
    )
  );

-- RLS narrows what a GRANT permits; it does not confer access. Without this the
-- policies above are inert.
grant select, insert, update, delete on public.glucose_readings to authenticated;
