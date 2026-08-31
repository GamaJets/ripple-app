-- ── "That did not save" was said about time that WAS blocked ───────────────
--
-- `block_time` guards the one clash it was written for — a BOOKED session
-- inside the period — by counting it first and returning `(false, 0, 'booked')`.
-- It never guarded the other one. `sessions_no_double_booking` covers 'blocked'
-- as well as 'booked' (part 89 widened it deliberately, so the database and not
-- the app is what stops a client booking across a coach's holiday), so an
-- INSERT of a block that overlaps a block the coach already has raises
-- exclusion_violation — and nothing caught it.
--
-- Reproduced against the live database: block 09:30–11:00, then block 10:00–
-- 11:00, and the second call comes back
--
--   ERROR 23P01 conflicting key value violates exclusion constraint
--   "sessions_no_double_booking" ... CONTEXT: PL/pgSQL function block_time
--
-- An exception out of the RPC is an `error` on the wire, and the sheet in
-- app/(trainer)/calendar.tsx has exactly one sentence for that: "That did not
-- save, so the time is not blocked and clients can still book it. Try again."
-- Both halves of that are false. The time IS blocked, by the earlier block, and
-- no client can book across it — the constraint that produced the error is the
-- very thing enforcing that. So the coach is told their holiday is open to
-- booking while it is not, and invited to keep tapping a button that cannot
-- ever succeed.
--
-- The coach extending a block is not an edge case: block the morning, then
-- decide to take the whole day. That is the second tap, and it is the one that
-- failed.
--
-- A refusal, like every other refusal in this function, is a row and not an
-- exception. 'already-blocked' is its own reason rather than being folded into
-- 'booked', because the two need opposite sentences: 'booked' asks the coach to
-- cancel a session and tell somebody, and this one has nobody to tell and
-- nothing to undo.
--
-- Two things are deliberately NOT changed here.
--
--  · The delete of the overlapping open slots still runs before the insert. It
--    is rolled back with everything else when the insert then raises, because
--    the whole RPC is one statement and therefore one transaction — proved by
--    the probe above, where the failing call left all three open slots exactly
--    where they were. Moving the delete after the insert would read as safer
--    and change nothing.
--  · `withdrawn` is reported as 0 on this path. Nothing was withdrawn: the
--    rollback put back whatever the delete had taken.
create or replace function public.block_time(p_starts_at timestamptz, p_duration_min int)
returns table (ok boolean, withdrawn int, reason text)
language plpgsql security definer set search_path to 'public'
as $fn$
declare
  v_uid uuid := auth.uid();
  v_withdrawn int := 0;
  v_clash int := 0;
begin
  if v_uid is null then
    return query select false, 0, 'not-signed-in'::text; return;
  end if;
  if p_duration_min is null or p_duration_min <= 0 then
    return query select false, 0, 'bad-duration'::text; return;
  end if;

  select count(*) into v_clash
    from sessions s
   where s.trainer_id = v_uid
     and s.status = 'booked'
     and session_span(s.starts_at, s.duration_min) && session_span(p_starts_at, p_duration_min);
  if v_clash > 0 then
    return query select false, 0, 'booked'::text; return;
  end if;

  delete from sessions s
   where s.trainer_id = v_uid
     and s.status = 'available'
     and session_span(s.starts_at, s.duration_min) && session_span(p_starts_at, p_duration_min);
  get diagnostics v_withdrawn = row_count;

  insert into sessions (trainer_id, client_id, starts_at, duration_min, status, released)
  values (v_uid, null, p_starts_at, p_duration_min, 'blocked', false);

  return query select true, v_withdrawn, null::text;
exception
  -- Only reachable from the insert: the period overlaps time this coach has
  -- already blocked. Reported the way every other refusal here is, so the app
  -- can say the true thing instead of its sentence for an unreachable server.
  when exclusion_violation then
    return query select false, 0, 'already-blocked'::text; return;
end $fn$;

grant execute on function public.block_time(timestamptz, int) to authenticated;
