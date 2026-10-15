-- ═══════════════════════════════════════════════════════════════════════════
-- A session the coach ran is ONE workout in the client's record, written once.
--
-- ── What was already true (and is not changed here) ───────────────────────
--
--   · part 53   a coach may insert into a client's `workouts`, only for their
--               own client and only as `logged_by = auth.uid()`;
--   · part 890  `workouts.session_id` joins the rows to the booked session;
--   · part 370  `sessions.outcome := 'completed'` draws one pack credit, once
--               (`pack_drawn_at`), and gives it back if the outcome is undone;
--   · part 900  any insert into `notifications` is pushed by the table trigger;
--   · part 2613 `workouts` is in `supabase_realtime`, so the client sees rows
--               land live.
--
-- ── What was missing ───────────────────────────────────────────────────────
--
-- 1. NO GROUPING. A "workout" is N per-exercise rows that happen to share a
--    `performed_at`. Nothing said "these rows are one session", so a history
--    card, a finish summary and an idempotent replay all had to guess.
-- 2. FINISHING WAS TWO WRITES with two answers (the rows, then the outcome),
--    sent through the floor queue as two acts. A lost acknowledgement on the
--    first could be replayed as a duplicate hour of training.
-- 3. NOTHING TOLD THE CLIENT. Their phone updated live if it was open, and
--    otherwise they found out next time they looked.
--
-- ── What this part adds ────────────────────────────────────────────────────
--
--   `workouts.workout_uid`   one id per workout. Set by the writer when it has
--                            one (the coach finish below; the coach's phone
--                            mints it at Save, so a replay carries the same
--                            id). When a writer does not send one — every
--                            client build in the field today — a BEFORE INSERT
--                            trigger derives it from (user_id, performed_at),
--                            which is exactly the grouping the client log
--                            already uses (src/ui/workoutLog.tsx matches a
--                            session's rows on `performed_at`). Existing rows
--                            are backfilled with the same derivation.
--   `workouts.workout_pos`   the row's place inside its workout. Only the RPC
--                            sets it; null elsewhere.
--   unique (workout_uid, workout_pos) where workout_pos is not null
--                            the idempotency key for the RPC's rows. Partial,
--                            because the backfilled history legitimately has
--                            the same exercise twice in one workout and no
--                            position to tell them apart.
--   `finish_coach_session()` the one write a coach's Finish makes. Atomic,
--                            idempotent on `p_workout_uid`, and it checks every
--                            fact the policies would have checked, because a
--                            SECURITY DEFINER body does not see the policies.
--
-- Idempotent; safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.workouts
  add column if not exists workout_uid uuid,
  add column if not exists workout_pos smallint;

comment on column public.workouts.workout_uid is
  'One id per workout (a session of logging). Writer-supplied when it has one; otherwise derived from (user_id, performed_at) by workouts_default_workout_uid. See part 3460.';
comment on column public.workouts.workout_pos is
  'Position of this row inside its workout, set only by finish_coach_session. With workout_uid it is the idempotency key for a coach''s Finish.';

-- The derivation, in one place. md5 of the two facts the client log already
-- groups by, read as a uuid. Deterministic, so the backfill and the trigger
-- agree, and a client re-sending a queued row lands in the same workout.
create or replace function public.derived_workout_uid(p_user uuid, p_at timestamptz)
returns uuid
language sql
immutable
set search_path to 'public', 'pg_temp'
as $fn$
  select md5(p_user::text || '|' || to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'))::uuid
$fn$;

create or replace function public.workouts_default_workout_uid()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $fn$
begin
  if new.workout_uid is null then
    new.workout_uid := public.derived_workout_uid(new.user_id, new.performed_at);
  end if;
  return new;
end;
$fn$;

drop trigger if exists workouts_default_workout_uid_t on public.workouts;
-- A trigger function: EXECUTE is checked when the trigger is created, not when
-- it fires (part 141 §2), so nobody needs it.
revoke all on function public.workouts_default_workout_uid() from public, anon, authenticated;

create trigger workouts_default_workout_uid_t
  before insert on public.workouts
  for each row execute function public.workouts_default_workout_uid();

-- Backfill. Batched by nothing because `workouts` is per-member and small; the
-- `where workout_uid is null` makes a re-run a no-op.
update public.workouts
   set workout_uid = public.derived_workout_uid(user_id, performed_at)
 where workout_uid is null;

create index if not exists workouts_workout_uid_idx
  on public.workouts (workout_uid);

create unique index if not exists workouts_workout_uid_pos_uq
  on public.workouts (workout_uid, workout_pos)
  where workout_pos is not null;

-- ── finish_coach_session ───────────────────────────────────────────────────
--
-- p_rows is a JSON array of rows shaped like `entryToRow` (src/lib/workoutRow.ts)
-- minus `user_id`: performed_at, exercise, sets, bw, timed, tempos, feel,
-- cardio, kcal, zones, session_mins. Anything else in an element is ignored —
-- in particular `user_id`, `logged_by`, `session_id`, `workout_uid` and
-- `workout_pos` are set HERE and never taken from the caller.
--
-- Answers with one row naming what happened, never success over nothing:
--   'finished'   rows written, outcome set (or already completed), client told
--   'already'    this workout_uid was finished before; nothing written again
create or replace function public.finish_coach_session(
  p_session     uuid,
  p_client      uuid,
  p_workout_uid uuid,
  p_rows        jsonb,
  p_rate_cents  integer default null,
  p_pr_count    integer default null
)
returns table (outcome text, rows_written integer, sessions_left integer, pack_total integer)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_coach   uuid := auth.uid();
  v_sess    public.sessions%rowtype;
  v_n       integer;
  v_written integer := 0;
  v_name    text;
  v_body    text;
  v_left    integer;
  v_total   integer;
begin
  if v_coach is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  if p_session is null or p_client is null or p_workout_uid is null then
    raise exception 'Session, client and workout id are all required.' using errcode = '22004';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Nothing to record.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 100 then
    raise exception 'Too many exercises for one session.' using errcode = '22023';
  end if;

  -- The caller is this person's coach. The same test `workouts_coach_insert`
  -- makes, made here because a definer body does not see that policy.
  if not exists (select 1 from public.clients c where c.id = p_client and c.trainer_id = v_coach) then
    raise exception 'That person is not one of your clients.' using errcode = '42501';
  end if;

  -- The session is this coach's, and it is FOR this client. Locked, so two
  -- Finishes for one session queue behind each other rather than racing.
  select * into v_sess from public.sessions s
   where s.id = p_session and s.trainer_id = v_coach
   for update;
  if not found then
    raise exception 'That session is not yours.' using errcode = '42501';
  end if;
  if v_sess.client_id is distinct from p_client then
    raise exception 'That session is booked for somebody else.' using errcode = '42501';
  end if;

  -- Idempotent on the workout id. The lock makes "is it there yet" a fact.
  perform pg_advisory_xact_lock(hashtextextended(p_workout_uid::text, 3460));
  select count(*) into v_n from public.workouts w where w.workout_uid = p_workout_uid;
  if v_n > 0 then
    -- Only if it is the same coach's same client: a uid that collides with
    -- somebody else's workout is refused, not reported as done.
    if exists (select 1 from public.workouts w where w.workout_uid = p_workout_uid
                and (w.user_id <> p_client or w.logged_by is distinct from v_coach)) then
      raise exception 'That workout id belongs to another record.' using errcode = '42501';
    end if;
    select cp.sessions_total - cp.sessions_used, cp.sessions_total into v_left, v_total
      from public.client_purchases cp where cp.id = v_sess.pack_drawn_purchase_id;
    return query select 'already'::text, v_n, v_left, v_total;
    return;
  end if;

  insert into public.workouts
    (user_id, logged_by, session_id, workout_uid, workout_pos,
     performed_at, exercise, sets, bw, timed, tempos, feel, cardio, kcal, zones, session_mins)
  select p_client, v_coach, p_session, p_workout_uid, (r.ord - 1)::smallint,
         -- One time for the whole workout: the client log groups on it.
         coalesce((r.e->>'performed_at')::timestamptz, (p_rows->0->>'performed_at')::timestamptz, now()),
         r.e->>'exercise',
         r.e->'sets', r.e->'bw', r.e->'timed', r.e->'tempos', r.e->'feel', r.e->'cardio',
         nullif(r.e->>'kcal', '')::int, r.e->'zones', nullif(r.e->>'session_mins', '')::int
    from jsonb_array_elements(p_rows) with ordinality as r(e, ord);
  get diagnostics v_written = row_count;
  if v_written <> jsonb_array_length(p_rows) then
    raise exception 'Only % of % rows were recorded.', v_written, jsonb_array_length(p_rows);
  end if;

  -- The outcome. Part 370's trigger draws the credit; not touched if it is
  -- already completed, so a session marked from the queue first is not
  -- re-written (and not re-charged — `pack_drawn_at` would stop that anyway).
  if v_sess.outcome is distinct from 'completed' then
    update public.sessions s
       set outcome = 'completed',
           outcome_at = now(),
           rate_cents = coalesce(p_rate_cents, s.rate_cents)
     where s.id = p_session;
  end if;

  -- Tell the client. The insert is the push: part 900's trigger dispatches
  -- every notifications row whose route `notification_channel` classifies,
  -- and '/(client)/workouts' is classified by §2 below ('clients').
  select nullif(btrim(p.full_name), '') into v_name from public.profiles p where p.id = v_coach;
  v_body := v_written || ' exercise' || case when v_written = 1 then '' else 's' end
         || case when coalesce(p_pr_count, 0) > 0
                 then ' · ' || p_pr_count || ' PR' || case when p_pr_count = 1 then '' else 's' end
                 else '' end;
  insert into public.notifications (user_id, title, body, icon, route, session_id)
  values (p_client,
          coalesce('Coach ' || split_part(v_name, ' ', 1), 'Your coach') || ' logged your session',
          left(v_body, 500), 'dumbbell', '/(client)/workouts', p_session);

  select cp.sessions_total - cp.sessions_used, cp.sessions_total into v_left, v_total
    from public.client_purchases cp
   where cp.id = (select s.pack_drawn_purchase_id from public.sessions s where s.id = p_session);

  return query select 'finished'::text, v_written, v_left, v_total;
end;
$fn$;

comment on function public.finish_coach_session(uuid, uuid, uuid, jsonb, integer, integer) is
  'A coach''s Finish: writes the session''s rows into the client''s record as logged_by = caller, marks the session completed (part 370 draws the credit), and notifies the client (part 900 pushes). Atomic and idempotent on p_workout_uid. Part 3460.';

revoke all on function public.finish_coach_session(uuid, uuid, uuid, jsonb, integer, integer) from public, anon;
grant execute on function public.finish_coach_session(uuid, uuid, uuid, jsonb, integer, integer) to authenticated;
revoke all on function public.derived_workout_uid(uuid, timestamptz) from public, anon;
grant execute on function public.derived_workout_uid(uuid, timestamptz) to authenticated;

-- notification_channel: not redefined. Live already classifies /(client)/workouts and
-- /(trainer)/checkins (migration fix_notification_channel_and_coach_board).
