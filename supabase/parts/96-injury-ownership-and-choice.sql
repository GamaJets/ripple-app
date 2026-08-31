-- ── An injury belongs to the person who has it ─────────────────────────────
--
-- `clients_trainer_update` lets a coach update their own client's row, which is
-- right for the things a coach records about somebody — delivery mode, the goal
-- they agreed. Row-level security cannot restrict WHICH COLUMNS an update
-- touches, so the same policy also let a coach rewrite, or empty, the injuries
-- their client had disclosed. Nothing in the app ever offered it, but the grant
-- was there, and a disclosure a client cannot rely on keeping is not a
-- disclosure.
--
-- It also made the acknowledgement gate defeatable by the person it constrains:
-- delete the injury, and there is nothing left to acknowledge.
--
-- A trigger is the only place this can be said. auth.uid() IS NULL is the
-- service role and migrations, which are server-side and trusted; every request
-- through PostgREST carries a uid, so a coach is always caught.
create or replace function public.clients_injuries_are_the_clients()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if new.injuries is distinct from old.injuries
     and auth.uid() is not null
     and auth.uid() <> old.id then
    raise exception 'Only the client may add, change or remove their own injuries'
      using errcode = '42501';
  end if;
  return new;
end $fn$;

drop trigger if exists clients_injuries_guard on public.clients;
create trigger clients_injuries_guard
  before update on public.clients
  for each row execute function public.clients_injuries_are_the_clients();


-- ── And a record when the coach loads one on purpose ───────────────────────
--
-- A coach may put a movement that loads a disclosed injury into a programme
-- deliberately — training around a knee is their judgement and their client,
-- and a squat is sometimes exactly the rehabilitation. What they may not do is
-- do it without saying so.
--
-- This is the counterpart to the client's own release. The client signs that
-- they take part at their own risk; this records that the coach knew which
-- movements loaded which disclosure on the day they assigned them. Immutable
-- for the same reason the waiver is — no UPDATE or DELETE policy — so neither
-- party can revise it afterwards.
--
-- The CLIENT can read it. Somebody who disclosed a knee is entitled to see that
-- their coach included leg press knowing about it; that is the whole basis on
-- which they would agree to do it.
create table if not exists public.program_injury_acknowledgements (
  id uuid primary key default uuid_generate_v4(),
  trainer_id uuid not null references public.profiles(id) on delete cascade,
  client_id uuid not null references public.profiles(id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  -- [{ exercise, area, severity }] — what was included, and what it loads.
  movements jsonb not null,
  constraint program_inj_ack_movements_is_array
    check (jsonb_typeof(movements) = 'array' and jsonb_array_length(movements) > 0)
);

create index if not exists program_inj_ack_client_idx
  on public.program_injury_acknowledgements (client_id, acknowledged_at desc);

alter table public.program_injury_acknowledgements enable row level security;

drop policy if exists program_inj_ack_trainer_i on public.program_injury_acknowledgements;
create policy program_inj_ack_trainer_i on public.program_injury_acknowledgements
  for insert with check (trainer_id = (select auth.uid()));

drop policy if exists program_inj_ack_trainer_r on public.program_injury_acknowledgements;
create policy program_inj_ack_trainer_r on public.program_injury_acknowledgements
  for select using (trainer_id = (select auth.uid()));

drop policy if exists program_inj_ack_client_r on public.program_injury_acknowledgements;
create policy program_inj_ack_client_r on public.program_injury_acknowledgements
  for select using (client_id = (select auth.uid()));

grant select, insert on public.program_injury_acknowledgements to authenticated;


-- ── A report is usually a PDF, not a photograph of one ─────────────────────
--
-- Part 91 excluded PDFs for a good reason at the time: ocr-scan forced a
-- `data:image/jpeg` prefix and read only ParsedResults[0], so a PDF would have
-- uploaded happily, read as a corrupt image, or — worse — read page one and
-- silently dropped the rest, which on a report is where the diagnosis usually
-- is NOT. Both are fixed in the function: the caller says what it sent, PDFs
-- get filetype=PDF, and every page is joined.
update storage.buckets
   set allowed_mime_types = array['image/jpeg', 'image/png', 'application/pdf']
 where id = 'injury-docs';
