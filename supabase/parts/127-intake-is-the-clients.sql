-- ── The form a coach takes before they train somebody ──────────────────────
--
-- There was no intake. `app/(client)/onboarding.tsx` asks a goal, a height, a
-- diet and a list of allergens and stops, which is enough to build a meal plan
-- and not enough to put a stranger under a barbell. No readiness questions, no
-- training history, no account of what they have already tried and abandoned,
-- no idea which days of the week they can actually be in a gym. Every coach in
-- the trade takes this on paper on day one; Repple asked a coach to start
-- without it and then gated their programme on injuries the client had thought
-- to volunteer.
--
-- It lands on `clients` rather than in a table of its own, and that is a
-- decision about who can see it as much as about shape. The row already carries
-- the rest of what a coach is entitled to know about the person they coach, and
-- it already has the reads that answer the question correctly: `client_self`
-- for the person it is about, `clients_trainer_read` for the one coach whose
-- `trainer_id` is on the row, and nobody else — a coach at the next gym cannot
-- read it, because there is no policy under which they could.
--
-- (`clients_owner_r` also reads the row, for the gym that owns the tenant. That
-- is pre-existing and it is the same access an owner already has to the
-- client's disclosed injuries. It is named here so that it is a fact somebody
-- decided rather than one they inherited: if intake is ever to be narrower than
-- injuries, that policy is where it would be said, and it is not this part's to
-- change.)
--
-- One column, not two. A completed-at timestamp in a column beside the document
-- is a second place to say the same thing and therefore a place for the two to
-- disagree; the document carries its own `updatedAt` and the app reads it from
-- there. `null` is "never opened it" and is different from `{}`, which is
-- somebody who started.
alter table public.clients
  add column if not exists intake jsonb;

-- Survivability, not validation. The shape belongs to src/lib/intake.ts, which
-- parses tolerantly because a document written by an older build of the app has
-- to keep opening. What the database will not accept is an array or a bare
-- string in a column every reader treats as an object.
alter table public.clients
  drop constraint if exists clients_intake_is_object;
alter table public.clients
  add constraint clients_intake_is_object
  check (intake is null or jsonb_typeof(intake) = 'object');


-- ── And it belongs to the person who answered it ───────────────────────────
--
-- The same rule as `clients.injuries` in part 96 and `clients.glucose_shared`
-- in part 102, for the same reason and by the same mechanism: row-level
-- security cannot restrict WHICH COLUMNS an update touches, and
-- `clients_trainer_update` lets a coach write their own client's row. Without a
-- trigger, the coach the intake is addressed to could rewrite it — or empty it
-- — and nothing in the record would say it had happened.
--
-- That matters more here than it does for a delivery mode. This document holds
-- what somebody said about their own heart, their medication, their dizziness
-- and their joints. It is health information about a person, disclosed by that
-- person, and its whole value to the coach reading it is that it is what the
-- client actually said. A field the reader can edit is not a disclosure; it is
-- a note the reader wrote.
--
-- It also has the shape of the injuries gate: a coach who could type an intake
-- in could type a "no" over every readiness answer and hand themselves a clean
-- sheet. The client can always change their own answers — that is the point of
-- them being theirs — and the coach sees what changed because they are reading
-- the same document.
--
-- auth.uid() IS NULL is the service role and migrations, which are server-side
-- and trusted; every request through PostgREST carries a uid, so a coach is
-- always caught.
create or replace function public.clients_intake_is_the_clients()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if new.intake is distinct from old.intake
     and auth.uid() is not null
     and auth.uid() <> old.id then
    raise exception 'Only the client may fill in or change their own intake'
      using errcode = '42501';
  end if;
  return new;
end $fn$;

-- A trigger fires on the table's own authority and never checks EXECUTE, so
-- nothing here needs to be callable by a request. Revoked from both roles
-- rather than left at the default so that a SECURITY DEFINER function is not
-- sitting on the API surface waiting for somebody to find a use for it.
revoke execute on function public.clients_intake_is_the_clients() from public;
revoke execute on function public.clients_intake_is_the_clients() from anon;

drop trigger if exists clients_intake_guard on public.clients;
create trigger clients_intake_guard
  before update on public.clients
  for each row execute function public.clients_intake_is_the_clients();
