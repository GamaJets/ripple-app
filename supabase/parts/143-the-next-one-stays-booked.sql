-- ─────────────────────────────────────────────────────────────────────────
-- The next one stays booked — and the arrangements list says when it is short.
--
-- Two corrections to part 135, both to functions it defined and neither
-- changing a table. `create or replace` only, so this part is safe to re-run
-- and safe to paste over a database that already has 135.
--
-- ── 1 · `end_session_series(p_series)` deleted the session it promised to keep
--
-- Part 135 states the promise in its own header, and every screen repeats it in
-- as many words: ending a standing appointment removes the occurrences AFTER
-- the next one and leaves the next one booked. "We'll stop after next Tuesday"
-- is what ending a standing appointment means to the two people in it.
--
-- The function did not do that when it was called the obvious way. `p_effective`
-- defaulted to TODAY and the delete is `occurrence_on > v_cut`, so
-- `end_session_series(id)` removed every occurrence after today — next Tuesday
-- among them. The one session the screen had just guaranteed would survive was
-- the first thing deleted.
--
-- The coach's calendar worked around it from the app: it computed the next
-- occurrence's local date in the SERIES' zone and passed it as `p_effective`.
-- That is correct and it is fragile, for three reasons that are the reason this
-- fix is in SQL rather than in the hook that calls it:
--
--   · the workaround protects exactly one caller. The client app is a second
--     one, `my_session_series()` is read by both, and either party may end an
--     arrangement — so the next screen written against this function inherits
--     the bug by doing the obvious thing.
--   · a date computed on a phone is computed by an `Intl` that may not know the
--     zone the series was agreed in, and falls back to the reader's own date.
--     A coach abroad by one calendar day either deletes the session that was
--     promised to survive or leaves one extra standing.
--   · the promise is stated in THIS function's own comment. A function that
--     documents a guarantee and relies on its callers to supply it is not
--     keeping the guarantee, it is describing one.
--
-- So the DEFAULT is now the next occurrence's own `occurrence_on` rather than
-- today. An explicit `p_effective` still wins — a caller naming a date is
-- naming it deliberately — and because the argument is a DATE rather than an
-- offset, a caller that already computes the same date (the coach's calendar
-- does) passes the value this function would have chosen anyway. There is
-- nothing to double-apply.
--
-- `greatest(…, today)` is the floor. A cut date in the past would widen the
-- delete backwards over sessions that have already happened, which is the one
-- thing part 135's first bullet promises never to do.
--
-- Everything else is byte-for-byte part 135: the same auth checks, the same
-- narrow delete, the same detach of anything that now belongs to somebody else,
-- and the same `'charged', false` stated as a fact. ENDING A SERIES STILL
-- CHARGES NOTHING, EVER, and this function still does not go near
-- `cancel_my_session`.
create or replace function public.end_session_series(p_series uuid, p_effective date default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_uid     uuid := auth.uid();
  v_s       record;
  v_today   date;
  v_next    date;
  v_cut     date;
  v_removed int := 0;
  v_kept    int := 0;
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  select ss.* into v_s from session_series ss where ss.id = p_series for update;
  if not found then
    raise exception 'That standing appointment no longer exists.' using errcode = '42501';
  end if;
  if v_s.trainer_id <> v_uid and v_s.client_id <> v_uid then
    raise exception 'That standing appointment is not yours.' using errcode = '42501';
  end if;

  -- Today in the SERIES' zone, because `occurrence_on` is a local date written
  -- in that zone. Comparing it against the server's date, or the caller's,
  -- moves the boundary by a day for anybody who agreed the arrangement
  -- somewhere else.
  v_today := (now() at time zone v_s.tz)::date;

  if p_effective is not null then
    v_cut := p_effective;
  else
    -- The next occurrence, matched exactly as the delete below matches: still
    -- ours, still booked, never delivered. A future occurrence that now belongs
    -- to somebody else is not the session anybody was promised would survive.
    select min(s.occurrence_on) into v_next
      from sessions s
     where s.series_id = p_series
       and s.status = 'booked'
       and s.client_id = v_s.client_id
       and s.outcome is null
       and s.starts_at > now();
    -- No next occurrence is a real answer — an arrangement whose horizon has
    -- not been written yet, or one whose every date was cancelled singly. Today
    -- is then the cut, which is what part 135 always did, and nothing that has
    -- already happened is touched either way.
    v_cut := greatest(coalesce(v_next, v_today), v_today);
  end if;

  -- Removed: still ours, still booked, never delivered. Nothing else.
  delete from sessions s
   where s.series_id = p_series
     and s.occurrence_on > v_cut
     and s.status = 'booked'
     and s.client_id = v_s.client_id
     and s.outcome is null;
  get diagnostics v_removed = row_count;

  -- Everything else in the future keeps its place on the calendar and simply
  -- stops belonging to an arrangement that has ended.
  update sessions s
     set series_id = null, occurrence_on = null
   where s.series_id = p_series
     and s.occurrence_on > v_cut;
  get diagnostics v_kept = row_count;

  update session_series
     set status = 'ended', ends_on = v_cut, ended_at = now(), ended_by = v_uid
   where id = p_series;

  return jsonb_build_object(
    'ended', true,
    'effective_on', v_cut,
    'removed', v_removed,
    'left_standing', v_kept,
    -- Stated rather than implied. Every screen that reports this reads it from
    -- here, so no app can invent a fee this function did not raise.
    'charged', false);
end $fn$;

revoke all on function public.end_session_series(uuid, date) from public, anon;
grant execute on function public.end_session_series(uuid, date) to authenticated;


-- ── 2 · `my_session_series()` could truncate and say nothing about it ───────
--
-- It was `limit 500`. Five hundred rows and five hundred rows out of six
-- hundred came back identically, and the app has no way to tell them apart —
-- which is precisely the silent failure src/lib/rowCap.ts exists for: a read
-- that succeeds, quietly, with part of the set, and a screen that renders it as
-- fact because nothing anywhere had cause to doubt it.
--
-- The fix is that file's own rule: ASK FOR ONE ROW MORE THAN YOU ARE WILLING TO
-- ACCEPT. At 501 a full page and a truncated one stop looking the same, the
-- caller drops the probe row and says 'partial', and the screens that gate
-- their figures on 'ready' render a dash instead of a subtotal.
--
-- Nobody has 500 standing appointments today. That is a fact about this month's
-- data, not a property of the schema, and it is the assumption every truncation
-- bug in this codebase was built on.
--
-- The body is otherwise unchanged from part 135.
create or replace function public.my_session_series()
returns table (
  id           uuid,
  trainer_id   uuid,
  client_id    uuid,
  client_name  text,
  dow          smallint,
  hour         smallint,
  minute       smallint,
  duration_min int,
  tz           text,
  starts_on    date,
  ends_on      date,
  status       text,
  upcoming     int,
  next_at      timestamptz
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
  select ss.id, ss.trainer_id, ss.client_id,
         -- The coach sees who it is with. The client is looking at their own
         -- arrangement and does not need to be told their own name.
         case when ss.trainer_id = auth.uid() then p.full_name else null end as client_name,
         ss.dow, ss.hour, ss.minute, ss.duration_min, ss.tz,
         ss.starts_on, ss.ends_on, ss.status,
         (select count(*)::int from sessions s
           where s.series_id = ss.id and s.starts_at > now() and s.status = 'booked') as upcoming,
         (select min(s.starts_at) from sessions s
           where s.series_id = ss.id and s.starts_at > now() and s.status = 'booked') as next_at
    from session_series ss
    left join profiles p on p.id = ss.client_id
   where ss.trainer_id = auth.uid() or ss.client_id = auth.uid()
   order by ss.status, ss.dow, ss.hour, ss.minute
   -- 500 is the cap the caller will show. The 501st is a probe: it is never
   -- rendered, it exists only so that "this is all of them" and "this is as
   -- many as you asked for" stop being the same answer.
   limit 501;
$fn$;

revoke all on function public.my_session_series() from public, anon;
grant execute on function public.my_session_series() to authenticated;
