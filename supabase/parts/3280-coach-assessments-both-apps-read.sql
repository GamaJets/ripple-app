-- COACH ASSESSMENTS, ONE RECORD THAT BOTH APPS READ
--
-- A coach runs one of four standard tests with a client: a movement screen
-- (seven patterns scored 0-3, out of 21), a strength test (a lift, a load and
-- reps, kept as an estimated 1RM in kg), a mobility check (five joint checks
-- graded pass/partial/fail, out of 10), or a test of their own naming with a
-- value, a unit and whether higher or lower is better.
--
-- The client must have the same record, to look back at and to compare the
-- next test against. So there is ONE table and no copy: the coach writes the
-- row, and the client's app selects that same row. The two apps agree because
-- there is only one thing for them to read. The catalogue and the arithmetic
-- live in src/lib/assessments.ts; the constraints below hold the ranges that
-- arithmetic produces, so a row the app would never write cannot be stored.
--
-- Who may do what:
--   · the client's current coach reads every assessment on their client
--     (including one a previous coach recorded, because the history is the
--     client's), and writes, edits and deletes only rows they recorded;
--   · the client reads their own rows and writes nothing;
--   · the gym's owner reads their gym's rows.
-- A coach who stops coaching somebody loses the rows with the relationship,
-- the same rule part 69 gives programs and nutrition plans.

create table if not exists public.assessments (
  id          uuid        primary key default gen_random_uuid(),
  client_id   uuid        not null references public.clients(id) on delete cascade,
  -- Defaulted to the caller and stamped again by the trigger below: a caller
  -- able to name the coach is a caller able to write as somebody else.
  coach_id    uuid        not null default auth.uid() references public.profiles(id) on delete cascade,
  -- The CLIENT's gym, stamped from clients.tenant_id by the trigger, never sent.
  tenant_id   uuid        not null references public.tenants(id) on delete cascade,
  kind        text        not null check (kind in ('movement', 'strength', 'mobility', 'custom')),
  -- Which series this row belongs to: 'fms', 'standard', a lift key, or the
  -- slug of a custom test's name.
  test_key    text        not null check (test_key ~ '^[a-z0-9_]{1,60}$'),
  recorded_at timestamptz not null default now(),
  results     jsonb       not null default '{}'::jsonb check (jsonb_typeof(results) = 'object'),
  -- Nullable so that an unknown is never written as 0. The app always sends one.
  total       numeric     check (total is null or total <> 'NaN'::numeric),
  unit        text        not null default '' check (length(unit) <= 20),
  notes       text        check (notes is null or length(notes) <= 2000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint assessments_total_range check (
    total is null
    or (kind = 'movement' and total between 0 and 21 and total = trunc(total))
    or (kind = 'mobility' and total between 0 and 10 and total = trunc(total))
    or (kind = 'strength' and total > 0 and total <= 1000)
    or kind = 'custom'
  ),
  constraint assessments_custom_shape check (
    kind <> 'custom'
    or (btrim(coalesce(results->>'name', '')) <> ''
        and length(results->>'name') <= 60
        and results->>'direction' in ('higher', 'lower'))
  ),
  constraint assessments_strength_shape check (
    kind <> 'strength'
    or (jsonb_typeof(results->'weightKg') = 'number' and jsonb_typeof(results->'reps') = 'number')
  )
);

comment on table public.assessments is
  'Tests a coach recorded with a client: movement screen, strength test, mobility check or a custom test. One row per test taken. The client reads the same rows in their own app, so the two apps cannot disagree. Catalogue and totals: src/lib/assessments.ts. See part 3280.';
comment on column public.assessments.total is
  'The test''s headline figure: movement out of 21, mobility out of 10, strength an estimated 1RM in kg, custom in `unit`. Null means unknown and is never a stand-in for zero.';

create index if not exists assessments_client_idx on public.assessments (client_id, recorded_at desc);
create index if not exists assessments_coach_idx on public.assessments (coach_id);
create index if not exists assessments_tenant_idx on public.assessments (tenant_id);

-- Stamps what the caller must not choose, and keeps it from moving on update.
-- Definer so it can read clients.tenant_id whoever is writing; it reads one
-- column of one row the RLS policies below have already tied to the caller.
create or replace function public.assessments_stamp()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.coach_id := auth.uid();
    end if;
    select c.tenant_id into new.tenant_id from public.clients c where c.id = new.client_id;
    new.created_at := now();
  else
    new.client_id := old.client_id;
    new.coach_id := old.coach_id;
    new.tenant_id := old.tenant_id;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists assessments_stamp on public.assessments;
create trigger assessments_stamp
  before insert or update on public.assessments
  for each row execute function public.assessments_stamp();

revoke execute on function public.assessments_stamp() from public, anon, authenticated;

alter table public.assessments enable row level security;

drop policy if exists assessments_coach_read on public.assessments;
create policy assessments_coach_read on public.assessments
  for select to authenticated
  using (public.is_my_client(client_id));

drop policy if exists assessments_coach_insert on public.assessments;
create policy assessments_coach_insert on public.assessments
  for insert to authenticated
  with check (coach_id = (select auth.uid()) and public.is_my_client(client_id));

drop policy if exists assessments_coach_update on public.assessments;
create policy assessments_coach_update on public.assessments
  for update to authenticated
  using      (coach_id = (select auth.uid()) and public.is_my_client(client_id))
  with check (coach_id = (select auth.uid()) and public.is_my_client(client_id));

drop policy if exists assessments_coach_delete on public.assessments;
create policy assessments_coach_delete on public.assessments
  for delete to authenticated
  using (coach_id = (select auth.uid()) and public.is_my_client(client_id));

drop policy if exists assessments_client_read on public.assessments;
create policy assessments_client_read on public.assessments
  for select to authenticated
  using (client_id = (select auth.uid()));

drop policy if exists assessments_owner_read on public.assessments;
create policy assessments_owner_read on public.assessments
  for select to authenticated
  using (public.is_owner_of(tenant_id));

revoke all on public.assessments from anon, authenticated, public;
grant select, insert, update, delete on public.assessments to authenticated;
grant all on public.assessments to service_role;
