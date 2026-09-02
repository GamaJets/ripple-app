-- ═════════════════════════════════════════════════════════════════════════
-- A coach can move a booked session. Until now they could only cancel it.
--
-- Part 243 gave the MEMBER an atomic reschedule and stated the argument in
-- full: "Not cancel-then-book. Those are two acts with a gap in the middle."
-- `reschedule_my_session` scopes on `s.client_id = auth.uid()`, so a coach
-- calling it is refused as `not_yours` — and the coach's calendar never called
-- it. Their only route is `releaseSession`, then `promote_from_waitlist`, then
-- a "Session cancelled" push, then booking the client back in by hand.
--
-- What that does to a coach moving Ana from 7am to 8am:
--
--   · Ana's 7am is freed and handed to whoever was first on its waitlist,
--     inside the transaction that frees it. Correct behaviour for a
--     cancellation; catastrophic for a move, because Ana has not been put
--     anywhere yet.
--   · Ana is sent a cancellation. She has not cancelled and is not cancelled.
--   · The 8am may be taken in the gap by anybody, including the person who
--     just took the 7am.
--   · The pack credit markers on the booking are cleared by
--     `sessions_release_clears_draw` (part 370) — rightly, because a released
--     slot must never read as paid — and re-booking Ana draws a SECOND credit
--     for one hour of training.
--
-- Moving a session is the single most common thing that happens to a diary.
--
-- ── This is part 243's function with three deliberate differences ─────────
--
-- 1 · WHO. Both rows are scoped by `trainer_id = auth.uid()` rather than by
--     `client_id`, and the moved booking keeps ITS OWN client. A coach moves
--     their client's hour; they do not take it.
--
-- 2 · NO NOTICE GATE, AND STILL NO CHARGE. Part 243 refuses a member's move
--     inside the coach's notice window, because moving freely inside it would
--     be the button that makes late cancellation cost nothing. Neither half of
--     that argument applies here. The notice period is the COACH's own rule and
--     exists to protect the coach; there is nobody to charge for a coach's
--     change of plan, and a coach who cannot move a session two hours out will
--     cancel it instead — which is strictly worse for the client, for the
--     record, and for the credit attached to it. Nothing is written to
--     `charges` on any path through this function.
--
-- 3 · THE CLIENT IS TOLD BY THE APP, NOT BY THIS. The id of the client whose
--     session moved comes back in the report so the caller can push to exactly
--     that person, and to nobody else. A move nobody is told about is a
--     no-show the client is blamed for.
--
-- Everything else is part 243's, deliberately unchanged and for its own stated
-- reasons: the lock order, the free-then-book order inside a subtransaction so
-- an exclusion violation rolls the whole move back, the five credit markers
-- travelling in the SAME statement that gives the slot its occupant (which is
-- what tells `sessions_release_clears_draw` this is a carry rather than a
-- release), the gym-pass redemption following by id, and the freed slot going
-- to the head of its waitlist inside this same transaction so it is never
-- observable as bookable while somebody is waiting for it.
--
-- NO CREDIT IS DRAWN and none returned. The credit follows the member: they
-- paid for one session, they are having one session, and it is the same one at
-- a different hour.
-- ═════════════════════════════════════════════════════════════════════════

create or replace function public.reschedule_client_session(p_from uuid, p_to uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_uid      uuid := auth.uid();
  v_from     record;
  v_to       record;
  v_promoted uuid;
  v_waiting  int := 0;
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  if p_from = p_to then
    return jsonb_build_object('moved', false, 'reason', 'same_slot');
  end if;

  -- Both rows locked, in a fixed order by id, so two coaches moving into each
  -- other's slots at the same moment cannot deadlock. Part 243's, kept exactly.
  perform 1 from sessions s
   where s.id in (p_from, p_to)
   order by s.id
     for update;

  -- The booking being moved, plus the five markers that have to travel with it.
  -- Read under the lock above, because the update that frees p_from clears them.
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
    return jsonb_build_object('moved', false, 'reason', 'not_yours');
  end if;

  -- A session that has already begun is not something to move. It is either
  -- delivered or it is not, and both of those are outcomes rather than times.
  if v_from.starts_at <= now() then
    return jsonb_build_object('moved', false, 'reason', 'already_started');
  end if;

  -- The destination: this coach's own open hour. Scoped by trainer_id here as
  -- well, so a coach cannot move their client into a colleague's diary — that
  -- is not a move, it is a different booking with a different relationship
  -- behind it.
  select s.id, s.trainer_id, s.starts_at, s.duration_min
    into v_to
    from sessions s
   where s.id = p_to and s.trainer_id = v_uid and s.status = 'available';
  if not found then
    return jsonb_build_object('moved', false, 'reason', 'taken');
  end if;

  if v_to.starts_at <= now() then
    return jsonb_build_object('moved', false, 'reason', 'already_started');
  end if;

  -- Free first, then book. If booking the new slot violates the no-double-
  -- booking exclusion constraint the whole subtransaction rolls back and the
  -- client still has the hour they started with.
  begin
    update sessions
       set client_id = null, status = 'available', released = true
     where id = p_from;

    -- The markers travel, in the SAME statement that gives the slot its new
    -- occupant. `sessions_release_clears_draw` (part 370) reads that as a carry
    -- rather than a release, which is what stops a moved session drawing a
    -- second credit for one hour of training.
    update sessions
       set client_id = v_from.client_id, status = 'booked', released = false,
           pack_drawn_at = v_from.pack_drawn_at,
           pack_drawn_purchase_id = v_from.pack_drawn_purchase_id,
           pack_drawn_kind = v_from.pack_drawn_kind,
           pack_drawn_pass_id = v_from.pack_drawn_pass_id,
           booking_drew_credit_at = v_from.booking_drew_credit_at
     where id = p_to;

    update gym_pass_redemptions set session_id = p_to where session_id = p_from;
  exception when exclusion_violation then
    -- The client already has something with this coach across the new hour.
    return jsonb_build_object('moved', false, 'reason', 'clash');
  end;

  -- The hour the client gave up is genuinely free, so it goes to whoever is
  -- first in line for it, in this same transaction. Unlike the cancel-then-book
  -- route this replaces, the client being moved is already in their new slot
  -- before anybody else is offered the old one.
  v_promoted := public._promote_session_waitlist(p_from);
  select count(*) into v_waiting from session_waitlist where session_id = p_from;

  return jsonb_build_object(
    'moved', true,
    'reason', null,
    -- So the app can tell exactly one person, and only about their own hour.
    'client', v_from.client_id,
    'from_at', v_from.starts_at,
    'to_at', v_to.starts_at,
    -- Stated rather than implied. Nothing on this path writes to `charges` and
    -- nothing draws or returns a credit, and a caller that had to infer that
    -- from silence would be one edit away from telling somebody otherwise.
    'charged', false,
    'credit_drawn', false,
    'promoted', v_promoted,
    'waiting', v_waiting);
end;
$fn$;

revoke all on function public.reschedule_client_session(uuid, uuid) from public, anon;
grant execute on function public.reschedule_client_session(uuid, uuid) to authenticated;

comment on function public.reschedule_client_session(uuid, uuid) is
  'A coach moves one of their booked sessions into another of their own open slots, atomically. Never charges, never draws or returns a credit, and carries the pack markers so the move does not read as a second booking. The freed hour goes to the head of its waitlist in the same transaction. Part 243 is the member-side counterpart and holds the shared argument.';
