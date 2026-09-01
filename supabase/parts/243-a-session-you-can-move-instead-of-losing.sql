-- ═════════════════════════════════════════════════════════════════════════
-- There is no reschedule, anywhere.
--
-- A repo-wide grep for `reschedul` hits one test fixture. Moving a session
-- means CANCELLING it and booking again, and those are two separate acts with
-- a gap in the middle:
--
--   · the gap is real. The slot is `available` between the two taps and the
--     waitlist promotion in part 126 is deliberately instantaneous, so a member
--     freeing 07:00 to take 18:00 can lose the 07:00 to somebody waiting and
--     then find 18:00 taken as well. They now have no session at all, having
--     asked to move one.
--   · the cancellation may cost a late fee, and the re-booking draws a second
--     pack credit for a session they had already paid for. So a move can cost
--     money twice for one hour of training.
--
-- This is the move as ONE transaction: the old slot is freed and the new one
-- booked together, or neither happens.
--
-- ── THE DECISION THAT SHAPES THE WHOLE FUNCTION: it never charges ────────
--
-- A move inside the coach's notice window is REFUSED, with the notice period
-- and the fee in the refusal, and the member is sent to cancel instead. It is
-- not priced and it never writes to `charges`.
--
-- Three alternatives were considered and all three are worse:
--
--   MOVE FREELY INSIDE THE WINDOW. This deletes the coach's policy. A member
--   an hour before their session moves it to a slot three weeks out, then
--   cancels that one — which is outside anybody's notice window and therefore
--   free. "Reschedule" becomes the button that makes late cancellation cost
--   nothing, and no coach in the product is told their policy has a hole in it.
--
--   CHARGE FOR IT, AS A CANCELLATION. The record would then say a session was
--   cancelled when it was moved. Both people can read that record.
--
--   CHARGE FOR IT UNDER A NEW REASON. `charges.reason` is free text, so
--   'late_reschedule' would insert happily — and then be INVISIBLE. Both
--   screens that read this table filter on the literal string:
--   src/ui/sessions.tsx (`useLateCancelCharges`, the member's own list of what
--   they owe) and src/ui/coachStatement.ts (what the coach is owed). A fee
--   neither party can see is worse than no fee, and widening two reads in two
--   files to keep one new string in step is exactly the drift this codebase
--   has been bitten by before.
--
-- So the notice window is a GATE here rather than a price. Nothing about the
-- coach's policy changes, no new money appears anywhere, and the honest path
-- for a late change is the one that already exists and is already priced:
-- cancel, which prices it, and book again.
--
-- Outside the window — which is the overwhelming majority of moves, and the
-- whole of the complaint this part answers — the move is free, atomic, and
-- costs no credit.
--
-- ── What it does with the money it does not move ────────────────────────
--
-- NO CREDIT IS DRAWN for the new slot and none is returned for the old one.
-- The credit follows the MEMBER, not the slot: they paid for one session when
-- they booked, they are having one session, and it is the same one at a
-- different hour. Drawing another would charge twice for it; returning the old
-- one and drawing a new one would be the same thing with two extra failure
-- modes, since `redeemSession` can decline and this function cannot un-decline
-- it halfway through.
--
-- ── What it does with the slot it frees ─────────────────────────────────
--
-- Exactly what a cancellation does: the slot goes back on the coach's calendar
-- and is handed to the head of its waitlist inside the same transaction, so it
-- is never observable as bookable while somebody is waiting for it (part 126's
-- argument, and its `_promote_session_waitlist` does the work).
--
-- A freed occurrence of a standing appointment keeps its `series_id` and
-- `occurrence_on`, unchanged, for the same reason `cancel_my_session` leaves
-- them: those two columns are how the materialiser knows this week's Tuesday
-- has already been written out, and clearing them would have it write a second
-- one the next morning. The NEW slot does not take them. The arrangement is
-- still Tuesday at seven; one occurrence of it moved.
-- ═════════════════════════════════════════════════════════════════════════

create or replace function public.reschedule_my_session(p_from uuid, p_to uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_uid      uuid := auth.uid();
  v_from     record;
  v_to       record;
  v_applies  boolean := false;
  v_notice   int := 24;
  v_fee      numeric;
  v_currency text;
  v_promoted uuid;
  v_waiting  int := 0;
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  if p_from = p_to then
    return jsonb_build_object('moved', false, 'reason', 'same_slot');
  end if;

  -- Both rows locked, and in a fixed order by id so two members moving into
  -- each other's slots at the same moment cannot deadlock.
  perform 1 from sessions s
   where s.id in (p_from, p_to)
   order by s.id
     for update;

  select s.id, s.trainer_id, s.starts_at, s.duration_min
    into v_from
    from sessions s
   where s.id = p_from and s.client_id = v_uid and s.status = 'booked';
  if not found then
    -- Not yours, or not booked. Reported rather than raised, because it is a
    -- refusal and not a fault: somebody may have opened this screen an hour
    -- ago and the session may already have moved.
    return jsonb_build_object('moved', false, 'reason', 'not_yours');
  end if;

  select s.id, s.trainer_id, s.starts_at, s.duration_min
    into v_to
    from sessions s
   where s.id = p_to and s.status = 'available';
  if not found then
    return jsonb_build_object('moved', false, 'reason', 'taken');
  end if;

  -- The same coach. A move to another coach's slot is not a move, it is a
  -- different booking with a different relationship and possibly a different
  -- pack behind it.
  if v_to.trainer_id <> v_from.trainer_id then
    return jsonb_build_object('moved', false, 'reason', 'other_coach');
  end if;

  -- Never into the past, and never into a slot that has already begun.
  if v_to.starts_at <= now() then
    return jsonb_build_object('moved', false, 'reason', 'already_started');
  end if;

  select coalesce(t.late_cancel_applies, false),
         coalesce(t.late_cancel_notice_hours, 24),
         t.late_cancel_fee,
         tn.currency
    into v_applies, v_notice, v_fee, v_currency
    from trainers t
    left join tenants tn on tn.id = t.tenant_id
   where t.id = v_from.trainer_id;

  -- The gate. Measured on the session being MOVED OUT OF, on exactly the rule
  -- `cancel_my_session` uses — `starts_at - now() < notice`, with no lower
  -- bound, so a session already in progress is inside the window.
  --
  -- Only when the coach actually HAS a policy. A coach who has not set one has
  -- not agreed to charge anybody and has no window to be inside, so their
  -- clients may move a session at any notice. That is the same default part
  -- 126 chose for the fee itself, and choosing differently here would invent a
  -- restriction out of a policy nobody stated.
  if v_applies and (v_from.starts_at - now()) < make_interval(hours => v_notice) then
    return jsonb_build_object(
      'moved', false,
      'reason', 'inside_notice',
      'notice_hours', v_notice,
      'fee', v_fee,
      'currency', v_currency);
  end if;

  -- Free first, then book. If booking the new slot violates the no-double-
  -- booking exclusion constraint — the member is already booked with this coach
  -- across that hour — the whole subtransaction rolls back and the old session
  -- is still theirs. A member who asked to move must never end up with neither.
  begin
    update sessions
       set client_id = null, status = 'available', released = true
     where id = p_from;

    update sessions
       set client_id = v_uid, status = 'booked', released = false
     where id = p_to;
  exception when exclusion_violation then
    return jsonb_build_object('moved', false, 'reason', 'clash');
  end;

  -- The freed slot goes to whoever is first in line, in this same transaction,
  -- so it is never observable as bookable while somebody is waiting.
  v_promoted := public._promote_session_waitlist(p_from);
  select count(*) into v_waiting from session_waitlist where session_id = p_from;

  return jsonb_build_object(
    'moved', true,
    'reason', null,
    'from_at', v_from.starts_at,
    'to_at', v_to.starts_at,
    'notice_hours', v_notice,
    'policy_applies', v_applies,
    -- Said explicitly rather than left to be inferred from its absence. A
    -- screen reading this report tells somebody what just happened to their
    -- money, and "nothing" is a thing to say out loud.
    'charged', false,
    'credit_drawn', false,
    'promoted', v_promoted,
    'waiting', v_waiting);
end $fn$;

revoke all on function public.reschedule_my_session(uuid, uuid) from public, anon;
grant execute on function public.reschedule_my_session(uuid, uuid) to authenticated;

comment on function public.reschedule_my_session(uuid, uuid) is
  'Move one booked session to another open slot of the SAME coach, atomically. '
  'Never charges and never draws or returns a pack credit; refuses a move made '
  'inside the coach''s notice window rather than pricing one. See supabase/parts/243.';
