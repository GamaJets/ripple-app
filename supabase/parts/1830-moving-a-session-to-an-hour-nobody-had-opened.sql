-- ═════════════════════════════════════════════════════════════════════════
-- A coach moves a session to a time they had not already opened.
--
-- ── the dead end ─────────────────────────────────────────────────────────
--
-- Part 461 gave the coach an atomic move and its argument still stands in
-- full. It takes TWO SESSION IDS, so it can only land a client in a slot that
-- already exists, and app/(trainer)/calendar.tsx says so in the sheet:
-- "Nothing here creates an hour: a move goes into a slot that already exists."
-- The consequence is that a coach whose client asks to shift Tuesday 7am to
-- 8am is told to go and open 8am first — publish it to the whole roster, come
-- back, and hope nobody took it in the meantime.
--
-- Moving an hour is the single most common thing that happens to a diary, and
-- the fallback when this refuses is Cancel, whose costs part 461 already
-- lists: the client's hour goes to a waitlist before the client has been put
-- anywhere, the client is told they were cancelled when they were not, and
-- re-booking them draws a SECOND pack credit for one hour of training.
--
-- ── why this is a function and not two calls from the app ────────────────
--
-- The obvious client-side version is "create the open slot, then call
-- reschedule_client_session". It was written and thrown away, and the reason
-- is not tidiness. The slot that first write creates is BOOKABLE — a
-- `sessions` row with status 'available' is published to every client the
-- coach has and `book_session` will hand it to the first one who taps. So the
-- failure mode of the second write is not "nothing happened". It is "somebody
-- else took the hour you were making for Ana, and Ana is still at seven". A
-- function is one transaction, so no such hour is ever observable.
--
-- ── what is part 461's, unchanged, and why ───────────────────────────────
--
-- The lock, the free-then-book ORDER inside a subtransaction, the five credit
-- markers travelling in the SAME statement that gives the destination its
-- occupant (which is what tells `sessions_release_clears_draw`, part 370, that
-- this is a carry rather than a release), the gym-pass redemption following by
-- id, and the freed hour going to the head of its own waitlist inside this
-- same transaction so it is never observable as bookable while somebody is
-- waiting for it. NOTHING IS CHARGED and no credit is drawn or returned: the
-- member paid for one session, they are having one session, and it is the same
-- one at a different hour.
--
-- ── the three differences, each with its reason ──────────────────────────
--
-- 1 · THE DESTINATION IS AN INSTANT, NOT A ROW. There is therefore no 'taken'
--     refusal — nothing can take a time — and in its place are the three
--     obstacles `answer_session_request` (part 740) already names, in the same
--     order and with the same exclusions: a booked one-to-one, time the coach
--     blocked out (part 89), and a class they are down to teach with a
--     cancelled class not counting and an unattributed one not attributed.
--     The exclusion constraint from part 86 is what makes it SAFE; these
--     checks are what let the coach be told which of the three it was.
--
-- 2 · AN EXACT OPEN SLOT IS CONSUMED RATHER THAN DUPLICATED. If the coach
--     happens to have an open slot at precisely this instant and length, the
--     move takes THAT row instead of inserting a new one. Otherwise the diary
--     would carry a booked hour and an open hour on top of each other, and
--     part 86 is explicit that the open one is then unbookable — a row a
--     client can see, tap and be refused. Only an exact match is consumed. A
--     partly-overlapping open slot is LEFT ALONE, deliberately: part 740
--     settled that too ("nothing is silently deleted out of a coach's calendar
--     behind their back"), and it becomes unbookable in exactly the way every
--     other overlapped open slot in this schema already is.
--
-- 3 · THE HOUR BEING MOVED IS NOT AN OBSTACLE TO ITSELF. The clash checks
--     exclude p_from, and the update that frees it runs before the one that
--     books the destination. Moving a 7:00–8:00 to 7:30 is an ordinary move
--     and a function that refused it as a clash with itself would refuse the
--     commonest small change there is.
--
-- The client is told BY THE APP and not by this, exactly as in part 461: the
-- id comes back in the report so exactly one person is notified, and only
-- about their own hour.
-- ═════════════════════════════════════════════════════════════════════════

create or replace function public.reschedule_client_session_at(
  p_from uuid,
  p_starts_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_uid         uuid := auth.uid();
  v_from        record;
  v_to          uuid;
  v_clash_id    uuid;
  v_clash_state text;
  v_class_title text;
  v_promoted    uuid;
  v_waiting     int := 0;
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  if p_starts_at is null then
    return jsonb_build_object('moved', false, 'reason', 'bad-time');
  end if;

  -- Locked before anything is decided, in a fixed order by id, so a coach with
  -- two handsets cannot produce two moves from one session. Part 461's rule,
  -- with only one row to take here.
  perform 1 from sessions s where s.id = p_from for update;

  select s.id, s.trainer_id, s.client_id, s.starts_at, s.duration_min,
         s.pack_drawn_at, s.pack_drawn_purchase_id, s.pack_drawn_kind,
         s.pack_drawn_pass_id, s.booking_drew_credit_at
    into v_from
    from sessions s
   where s.id = p_from and s.trainer_id = v_uid and s.status = 'booked'
     and s.client_id is not null;
  if not found then
    -- Not this coach's, not booked, or nobody in it. A refusal and not a fault:
    -- the screen may have been open for an hour and the session may already
    -- have been cancelled from the client's phone.
    return jsonb_build_object('moved', false, 'reason', 'not-yours');
  end if;

  -- A session that has already begun is not something to move. It is either
  -- delivered or it is not, and both of those are outcomes rather than times.
  if v_from.starts_at <= now() then
    return jsonb_build_object('moved', false, 'reason', 'already-started');
  end if;

  if p_starts_at <= now() then
    return jsonb_build_object('moved', false, 'reason', 'past');
  end if;

  if p_starts_at = v_from.starts_at then
    -- Not an error and not a move. Reported as done, with nothing written,
    -- because the world already looks the way the caller asked for.
    return jsonb_build_object(
      'moved', false, 'reason', 'same-time',
      'client', v_from.client_id, 'from_at', v_from.starts_at, 'to_at', v_from.starts_at);
  end if;

  -- ── the three obstacles, named ───────────────────────────────────────
  select s.id, s.status into v_clash_id, v_clash_state
    from sessions s
   where s.trainer_id = v_uid
     and s.id <> p_from
     and s.status in ('booked', 'blocked')
     and session_span(s.starts_at, s.duration_min)
         && session_span(p_starts_at, v_from.duration_min)
   limit 1;
  if v_clash_id is not null then
    return jsonb_build_object(
      'moved', false,
      'reason', case when v_clash_state = 'blocked' then 'clash-blocked' else 'clash-booked' end);
  end if;

  if to_regclass('public.gym_classes') is not null then
    select g.title into v_class_title
      from gym_classes g
     where g.trainer_id = v_uid
       and coalesce(g.status, 'scheduled') <> 'cancelled'
       and session_span(g.starts_at, g.duration_min)
           && session_span(p_starts_at, v_from.duration_min)
     limit 1;
    if v_class_title is not null then
      return jsonb_build_object('moved', false, 'reason', 'clash-class', 'class', v_class_title);
    end if;
  end if;

  -- An open hour of this coach's at exactly this instant and length. Consumed
  -- rather than left underneath the booking — see difference 2 in the header.
  --
  -- Read WITHOUT a lock, and then claimed by an UPDATE that repeats
  -- `status = 'available'` in its own WHERE clause. That is the whole
  -- concurrency argument for this branch: a `select … for update` taken after
  -- an unlocked read would lock a row whose status had already changed, and the
  -- update that followed would overwrite somebody else's booking with this
  -- client. Under READ COMMITTED the guarded UPDATE waits for the concurrent
  -- writer, re-evaluates its WHERE against the committed row, and touches
  -- nothing when the slot was taken. `not found` is then the honest answer and
  -- the move falls through to the insert, which meets that same booking at the
  -- exclusion constraint and is reported as 'clash'.
  select s.id into v_to
    from sessions s
   where s.trainer_id = v_uid and s.status = 'available'
     and s.starts_at = p_starts_at and s.duration_min = v_from.duration_min
     and s.id <> p_from
   order by s.id
   limit 1;

  -- Free first, then book. If booking the new hour violates the no-double-
  -- booking exclusion constraint the whole subtransaction rolls back and the
  -- client still has the hour they started with.
  begin
    update sessions
       set client_id = null, status = 'available', released = true
     where id = p_from;

    if v_to is not null then
      -- The markers travel in the SAME statement that gives the slot its new
      -- occupant, which is what part 370's trigger reads as a carry rather than
      -- a release. Splitting them into two updates draws a second credit.
      update sessions
         set client_id = v_from.client_id, status = 'booked', released = false,
             pack_drawn_at = v_from.pack_drawn_at,
             pack_drawn_purchase_id = v_from.pack_drawn_purchase_id,
             pack_drawn_kind = v_from.pack_drawn_kind,
             pack_drawn_pass_id = v_from.pack_drawn_pass_id,
             booking_drew_credit_at = v_from.booking_drew_credit_at
       where id = v_to and status = 'available';
      if not found then v_to := null; end if;
    end if;

    if v_to is null then
      insert into sessions (
        trainer_id, client_id, starts_at, duration_min, status, released,
        pack_drawn_at, pack_drawn_purchase_id, pack_drawn_kind,
        pack_drawn_pass_id, booking_drew_credit_at)
      values (
        v_from.trainer_id, v_from.client_id, p_starts_at, v_from.duration_min, 'booked', false,
        v_from.pack_drawn_at, v_from.pack_drawn_purchase_id, v_from.pack_drawn_kind,
        v_from.pack_drawn_pass_id, v_from.booking_drew_credit_at)
      returning id into v_to;
    end if;

    update gym_pass_redemptions set session_id = v_to where session_id = p_from;
  exception when exclusion_violation then
    -- Something landed across the new hour between the checks above and this
    -- write. Reported as a plain 'clash' rather than attributed to one of the
    -- three, because this branch genuinely does not know which it was and a
    -- guessed reason on a refusal is worse than an unspecific true one.
    return jsonb_build_object('moved', false, 'reason', 'clash');
  end;

  -- The hour the client gave up is genuinely free, so it goes to whoever is
  -- first in line for it, in this same transaction — and only now, with the
  -- client already in their new hour.
  v_promoted := public._promote_session_waitlist(p_from);
  select count(*) into v_waiting from session_waitlist where session_id = p_from;

  return jsonb_build_object(
    'moved', true,
    'reason', null,
    -- So the app can tell exactly one person, and only about their own hour.
    'client', v_from.client_id,
    'session', v_to,
    'from_at', v_from.starts_at,
    'to_at', p_starts_at,
    -- Stated rather than implied, for part 461's reason: a caller that had to
    -- infer this from silence would be one edit away from telling somebody
    -- otherwise.
    'charged', false,
    'credit_drawn', false,
    'promoted', v_promoted,
    'waiting', v_waiting);
end;
$fn$;

revoke all on function public.reschedule_client_session_at(uuid, timestamptz) from public, anon;
grant execute on function public.reschedule_client_session_at(uuid, timestamptz) to authenticated;

comment on function public.reschedule_client_session_at(uuid, timestamptz) is
  'A coach moves one of their booked sessions to an instant they had not already opened, atomically. Part 461 is the same act into an existing open slot and holds the shared argument; this one takes a time instead of a destination row, names the obstacle when the hour is occupied (clash-booked, clash-blocked, clash-class), consumes an exactly-matching open slot rather than leaving an unbookable one underneath the booking, and never charges, draws or returns a credit.';
