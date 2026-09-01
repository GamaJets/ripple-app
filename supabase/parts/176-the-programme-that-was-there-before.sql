-- ═══════════════════════════════════════════════════════════════════════════
-- Reassigning a programme destroyed the one before it, and nothing anywhere
-- remembered.
--
-- `assigned_programs` has ONE row per client — `client_id` is the primary key —
-- and `assignProgramTo` in src/ui/assignedPrograms.tsx writes it with
-- `upsert(..., { onConflict: 'client_id' })`. So the spring block is not
-- archived when the summer block lands. It is overwritten, in place, and the
-- only copy of it that existed is gone.
--
-- Grepped `supabase/parts/` before writing this: there is no history table, no
-- version column, no audit trigger and no soft delete on that table. There
-- never was one.
--
-- ── Four things this costs, none of them hypothetical ─────────────────────
--
--   · A coach cannot answer "what did we do in the spring block". Their client
--     asks that question every time they plateau, and the answer is in nobody's
--     hands — the coach's own memory, or a screenshot.
--
--   · The client report (src/lib/coachClientReport.ts) can show what somebody
--     LOGGED against a plan nobody can produce any more. The training record
--     survives — `workouts` is keyed by user and exercise and carries no
--     reference to a plan, which src/ui/assignedPrograms.tsx documents at
--     length — so the evidence outlives the prescription it was evidence
--     against.
--
--   · Every progression decision wants the last block as its input, and the
--     app throws it away at the exact moment the coach opens the builder to
--     make one.
--
--   · An accidental overwrite is unrecoverable. `guardOverwrite` withholds the
--     Assign control until the current programme has been READ, which stops the
--     coach writing over something they never saw — it cannot undo the write
--     they did see and meant differently.
--
-- ── Why a trigger, and not a write from the app ───────────────────────────
--
-- Because the app is not the only writer and must not be the only one that
-- remembers. `assigned_programs` is written from the builder, from the template
-- library's bulk assign, from the group fan-out, from the roster's quick
-- actions and by hand in the SQL editor when something has gone wrong. A
-- history that depended on five call sites each remembering to snapshot first
-- is a history with holes in it exactly where somebody was in a hurry — and a
-- history with holes is worse than none, because a screen reading it says "no
-- earlier programme" about a client who had six.
--
-- A BEFORE trigger on UPDATE and DELETE catches every one of them, including
-- the SQL editor, and cannot be forgotten by a screen written next year.
--
-- ── Why it is SECURITY DEFINER and the table takes no INSERT grant ────────
--
-- The history is the record of what was replaced. If the coach's role could
-- INSERT into it, the record would be something a screen could write — and a
-- screen that can write a history can write a history that did not happen.
-- Nothing needs that: the only legitimate writer is the replacement itself. So
-- `authenticated` gets SELECT and nothing else, `anon` gets nothing at all, and
-- the trigger function runs as its owner.
--
-- The definer burden is taken seriously here because part 105 opened a real
-- hole with it: `set search_path = public` is pinned on the function, and the
-- EXECUTE privilege is revoked from public, anon AND authenticated — a trigger
-- function is invoked by the trigger, not by a caller, so nobody needs to be
-- able to call it and everybody being able to is how one gets called with
-- forged arguments.
--
-- ── Why the snapshot is conditional ───────────────────────────────────────
--
-- Only when the PROGRAMME or the START DATE actually changed. Every assign
-- writes the whole row, and a bulk re-assign of an unchanged template would
-- otherwise write a history row per client per tap — a timeline full of
-- identical entries an hour apart, which a coach reading it would take as their
-- client having been moved between six programmes.
--
-- `is distinct from` rather than `<>`: a jsonb `<>` null is null, which is not
-- true, so a programme going from NULL to something would not be recorded. That
-- cannot happen today (`program` is NOT NULL) and the operator is written for
-- when it can.
--
-- ── And the stale updated_at, fixed here because it is the same bug ───────
--
-- `updated_at` is `default now()` and the upsert never sends it, so a DEFAULT
-- only applies on INSERT: every overwrite left the timestamp at the moment the
-- client's FIRST programme was assigned. Every screen that has printed "updated
-- 3 March" over an assignment rewritten in August was reading that. The history
-- rows below are stamped from it, so a lie there would become a lie in the
-- timeline; a trigger sets it, which is where a server-side truth belongs
-- rather than in a timestamp the client sends and could get wrong.
--
-- auth.uid(), never current_user.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.assigned_program_history (
  id          uuid        primary key default gen_random_uuid(),
  -- The person whose programme this WAS. Cascades with them: a deleted profile
  -- takes their own training history with it, exactly as `assigned_programs`
  -- and `workouts` already do.
  client_id   uuid        not null references public.profiles(id) on delete cascade,
  -- The coach whose row it was. `set null` rather than cascade, matching
  -- `assigned_programs.coach_id`: a coach leaving the platform must not delete
  -- the record of what their former clients were training.
  coach_id    uuid        references public.profiles(id) on delete set null,
  -- The programme, in full, exactly as it was. Not a diff and not a summary —
  -- the whole point is that a coach can look at what they actually wrote, and a
  -- diff is only readable against a version that itself has to exist.
  program     jsonb       not null,
  -- Part 175's column, carried across so a past block keeps the date the coach
  -- gave it. Null for every row snapshotted from an assignment made before that
  -- column existed, which is what null there has always meant.
  starts_on   date,
  -- When the row being replaced was last written. Taken from the OLD row, so it
  -- is when this programme was ASSIGNED rather than when it was replaced.
  assigned_at timestamptz,
  -- When it stopped being what they were on.
  replaced_at timestamptz not null default now(),
  -- Who performed the replacement. auth.uid(), which may be null for a write
  -- made from the SQL editor or a service key — recorded as null rather than
  -- attributed to the coach on the row, because "your coach changed this" about
  -- an admin's repair is a false statement about a person.
  replaced_by uuid,
  -- 'replaced' or 'removed'. A DELETE is a coach taking somebody OFF a
  -- programme (builder's Revert, the roster's unassign) and it is a different
  -- event from swapping one block for another — a timeline that could not tell
  -- them apart would show a gap as a programme change.
  reason      text        not null check (reason in ('replaced', 'removed'))
);

-- The only read there is: one client's blocks, newest first.
create index if not exists assigned_program_history_client_idx
  on public.assigned_program_history (client_id, replaced_at desc);

comment on table public.assigned_program_history is
  'What a client was training before the row on assigned_programs was overwritten or deleted. Append-only, written by a trigger, never by a screen.';

alter table public.assigned_program_history enable row level security;

-- ── Who may read it ───────────────────────────────────────────────────────
--
-- The coach whose client it is, and the client themselves. The same pair part
-- 69 gives `assigned_programs`, and the same reasoning: this is not the coach's
-- private filing (that is what `program_groups` is, and part 134 explains why
-- THAT has no client policy) — it is a record of what a specific person was
-- told to train, and they were entitled to read it while it was current.
--
-- `is_my_client(client_id)` on the coach side rather than `coach_id =
-- auth.uid()`. A client who has changed coach carries their old coach's id on
-- every historical row, and a policy keyed on it would show the NEW coach
-- nothing about what their client has been doing — which is the single most
-- useful thing in this table for the person now responsible for them. The old
-- coach loses access when the client leaves their book, which is the behaviour
-- part 69 already established for the live assignment.
drop policy if exists assigned_program_history_coach_read on public.assigned_program_history;
create policy assigned_program_history_coach_read on public.assigned_program_history
  for select
  to authenticated
  using (public.is_my_client(client_id));

drop policy if exists assigned_program_history_client_read on public.assigned_program_history;
create policy assigned_program_history_client_read on public.assigned_program_history
  for select
  to authenticated
  using (client_id = (select auth.uid()));

-- RLS narrows a GRANT; it does not confer one, and a GRANT nobody wrote is not
-- an absence of one. Supabase's stock default privileges hand `anon` the full
-- DML set on every table created in this schema (part 119), so this arrived
-- reachable by the publishable key. SELECT only, to `authenticated` only:
-- INSERT, UPDATE and DELETE are not granted to anybody, which is what makes
-- "append-only, written by a trigger" a property of the database rather than a
-- convention screens are trusted to follow.
revoke all on public.assigned_program_history from anon, authenticated;
grant select on public.assigned_program_history to authenticated;

-- ── The trigger ───────────────────────────────────────────────────────────
--
-- Dropped before it is recreated with a body that could differ. `create or
-- replace function` keeps the same signature so the trigger itself survives,
-- but the trigger is dropped and recreated too, so re-running this file is a
-- no-op rather than a second trigger firing twice on every assign — which
-- would write two history rows per overwrite and make every timeline read as
-- double the programmes.
create or replace function public.snapshot_assigned_program()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    -- Unchanged content writes no history. See the header: a bulk re-assign of
    -- the same template would otherwise fill a client's timeline with identical
    -- entries minutes apart.
    if new.program is not distinct from old.program
       and new.starts_on is not distinct from old.starts_on then
      -- The timestamp is still refreshed. This branch is reached by a write
      -- that touched something else on the row, and "when was this last
      -- written" is a true answer to give even when nothing meaningful moved.
      new.updated_at := now();
      return new;
    end if;
  end if;

  insert into public.assigned_program_history
    (client_id, coach_id, program, starts_on, assigned_at, replaced_by, reason)
  values
    (old.client_id, old.coach_id, old.program, old.starts_on, old.updated_at,
     auth.uid(),
     case when tg_op = 'DELETE' then 'removed' else 'replaced' end);

  if tg_op = 'DELETE' then
    return old;
  end if;

  -- The stale-timestamp fix, stated in the header. `default now()` fires on
  -- INSERT only, and no writer in this app sends the column, so before this
  -- line every overwritten assignment still carried the date of the client's
  -- FIRST programme.
  new.updated_at := now();
  return new;
end $$;

revoke all on function public.snapshot_assigned_program() from public, anon, authenticated;

drop trigger if exists snapshot_assigned_program_trg on public.assigned_programs;
create trigger snapshot_assigned_program_trg
  before update or delete on public.assigned_programs
  for each row execute function public.snapshot_assigned_program();

-- ── What is deliberately NOT here ─────────────────────────────────────────
--
-- No "restore this block" function. Putting an old programme back is an ASSIGN
-- — it writes over what somebody is training this evening — and every refusal
-- that guards an assign belongs in front of it: the overwrite guard, the
-- per-client injury gate (a client's shoulder in September is not the shoulder
-- they had in March, and a programme written before a disclosure must not go
-- back out without it being read), and the acknowledgement record. All three
-- are coach-facing decisions made against what the coach has read, so restoring
-- goes through the same `assignProgramTo` path as any other assign, from a
-- screen, with the programme loaded into the builder first. A `restore(id)` RPC
-- would be a way around all of them and it would look like the convenient
-- option.
--
-- No retention limit and no pruning. A programme is a few kilobytes of jsonb
-- and a coach with a five-year client accumulates a few dozen rows; a cap would
-- delete the oldest block, which is the one somebody is asking about when they
-- ask what they did two years ago.
