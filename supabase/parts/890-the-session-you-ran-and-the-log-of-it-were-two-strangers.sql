-- ═══════════════════════════════════════════════════════════════════════════
-- The hour that was booked and the hour that was written up had nothing
-- joining them.
--
-- "You can start a session but you can't finish a session and have it marked
-- completed and save the information that was logged during the session."
-- That report is exactly right, and the reason is one missing column.
--
-- Two halves of one act, recorded in two tables that had never heard of each
-- other:
--
--   `sessions`   what was booked, who with, and — since part 33 — an `outcome`
--                somebody marks afterwards on app/(trainer)/sessions.tsx.
--   `workouts`   the exercises, sets and loads, written by
--                app/(trainer)/log-session.tsx with `logged_by` set to the
--                coach (part 53).
--
-- Nothing pointed either way. The only `session_id` referencing `sessions(id)`
-- anywhere in this schema, outside `class_bookings`, is on `notifications`. So:
--
--   · a coach who logged the session could not close it, and a coach who closed
--     it could not see what was done in it;
--   · "what did we actually do on the 4th" was answerable only by eye, by
--     matching a workout's `performed_at` against a session's `starts_at` and
--     hoping the coach wrote it up on the right day — which src/lib/sessionWhen.ts
--     exists precisely because they often do not;
--   · and a client whose coach logged an hour had no way to see that hour
--     joined to the session they were charged a credit for.
--
-- ── NULLABLE, and `on delete set null` ───────────────────────────────────────
--
-- Nullable because most rows in `workouts` have no session and never will. A
-- client logging their own training on their own phone is the ordinary case; a
-- coach logging THEIR OWN training (they self-track through the same screens)
-- is another; a coach typing up an hour they ran before this column existed is
-- a third. None of those is a defect and none of them has a session to name.
--
-- `on delete set null` and never cascade. Deleting a session must not delete
-- the record of the training that happened inside it. The workout belongs to
-- the CLIENT — part 53 is explicit that `workouts` is their personal data, that
-- they may edit and erase it, and that `sessions` is a separate record feeding
-- payroll. A cascade would let a coach or a gym owner tidying a calendar reach
-- into somebody else's training history and remove an hour of it, silently, in
-- a table they have no business writing. The session link is a fact about
-- provenance; losing the provenance is survivable, losing the training is not.
--
-- ── WHICH SESSION MAY BE NAMED ───────────────────────────────────────────────
--
-- A column that anybody may set to anything is not a link, it is a suggestion.
-- `workouts_coach_insert` requires `is_my_client(user_id) and logged_by =
-- auth.uid()`, and `workouts_own` gives a person full control of their own
-- rows — so without a guard, either party could point a workout at ANY session
-- row in the database, including one belonging to two other people. What is
-- then shown "against the session" on a coach's screen would be somebody else's
-- training.
--
-- The trigger below states the two conditions that make the link mean what it
-- says:
--
--   1. the session is FOR the person whose workout this is
--      (`sessions.client_id = workouts.user_id`), and
--   2. whoever is writing was in the room — the session's trainer, or the
--      client themselves.
--
-- SECURITY DEFINER so the check can see the session row at all. A coach reading
-- `sessions` under RLS sees their own; the client sees theirs; the check needs
-- to compare both ends and must not silently pass because the reader could not
-- see the row it was meant to reject. It reads one row by primary key, compares
-- three ids and returns — it grants nothing and returns no data.
--
-- Clearing the link is always allowed. `on delete set null` fires as the table
-- owner and must not be refused, and a person removing a wrong link from their
-- own record is correcting it.
--
-- Idempotent; safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.workouts
  add column if not exists session_id uuid
  references public.sessions(id) on delete set null;

comment on column public.workouts.session_id is
  'The PT session this training was done in, when it was done in one. Null is the ordinary case: a client''s own logged workout, a coach''s own training, or an hour written up before this column existed. Never cascades — deleting a session must not delete the record of the training that happened in it.';

-- The read this exists for: "what was logged in this session".
--
-- Partial, because the overwhelming majority of `workouts` rows carry no
-- session and an index over a column that is null nine times in ten is mostly
-- an index of nulls. `performed_at` is inside it so the entries come back in
-- the order a coach reads them without a sort.
create index if not exists workouts_session_idx
  on public.workouts (session_id, performed_at)
  where session_id is not null;

create or replace function public.guard_workout_session()
returns trigger language plpgsql security definer
set search_path = public
as $$
declare
  v_client  uuid;
  v_trainer uuid;
  v_found   boolean;
begin
  -- Clearing it, or never setting it, is always fine. This is also the path
  -- `on delete set null` takes.
  if new.session_id is null then
    return new;
  end if;

  -- Unchanged on an update: an edit to the sets must not be refused because of
  -- a link that was already accepted, and re-checking it would make a client's
  -- own correction fail on a session they can no longer see.
  if tg_op = 'UPDATE' and new.session_id is not distinct from old.session_id then
    return new;
  end if;

  select s.client_id, s.trainer_id, true
    into v_client, v_trainer, v_found
    from public.sessions s
   where s.id = new.session_id;

  if not coalesce(v_found, false) then
    raise exception 'That session does not exist, so this training cannot be filed under it.'
      using errcode = '42501';
  end if;

  if v_client is distinct from new.user_id then
    raise exception 'That session is not this person''s, so their training cannot be filed under it.'
      using errcode = '42501';
  end if;

  if (select auth.uid()) is distinct from v_trainer
     and (select auth.uid()) is distinct from new.user_id then
    raise exception 'Only the coach who delivered that session, or the client it was for, can file training under it.'
      using errcode = '42501';
  end if;

  return new;
end $$;

drop trigger if exists guard_workout_session_t on public.workouts;
create trigger guard_workout_session_t
  before insert or update of session_id on public.workouts
  for each row execute function public.guard_workout_session();

-- Trigger functions are reachable by nobody; see 51-advisor-tidy.sql. This one
-- is SECURITY DEFINER, so the revoke is not tidiness — an executable definer
-- function is a standing grant to run as its owner.
revoke execute on function public.guard_workout_session() from public, anon, authenticated;
