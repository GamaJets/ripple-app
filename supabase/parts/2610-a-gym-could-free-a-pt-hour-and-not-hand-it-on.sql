-- ═══════════════════════════════════════════════════════════════════════════
-- A gym could free a PT hour and not hand it on
-- ═══════════════════════════════════════════════════════════════════════════
-- NOT APPLIED. Written to be applied by hand.
--
--
-- ── What a person suffers ─────────────────────────────────────────────────
--
-- Mara joined the waitlist for Tuesday 6:30pm three weeks ago. The app told her
-- she was first in line and she stopped thinking about it, which is the whole
-- purpose of a queue.
--
-- On Monday the member holding that hour rings the gym rather than opening the
-- app, and the front desk frees the slot from the owner console. The console
-- does exactly what it says it does: `updatePtSlot(supabase, slot.id,
-- { clientId: null })` in src/lib/gymPtSchedule.ts writes the same row an
-- unbooking writes, `sessions_gym_owner_u` permits it, one row changes, and the
-- hour is open.
--
-- Mara is not told, is not booked, and is not first in line for anything. The
-- hour sits on the board as spare capacity until somebody with the app open
-- happens to take it — which is the race the waitlist was built to replace,
-- except that this time nobody was even invited to it. She finds out by opening
-- the Classes screen weeks later and seeing the slot gone, or she never finds
-- out at all.
--
-- The coach's own path does not do this. `app/(trainer)/calendar.tsx` frees the
-- slot, calls `promote_session_waitlist`, and then sends "The slot you were
-- waiting for is yours". The member's own cancellation does not do it either —
-- `cancel_my_session` (part 126) promotes inside the transaction that frees the
-- hour. The gym is the one door with the queue behind it and no handle.
--
--
-- ── Gap, or a boundary somebody drew on purpose ───────────────────────────
--
-- Worth establishing before touching anything, because this repository has
-- deliberately narrow doors and a roadmap calling one of them a bug does not
-- make it one. Three files have an opinion.
--
--   1 · Part 126 itself, on the trainer function:
--
--         "The coach freeing a slot themselves. Their cancellation goes through
--          RLS on `sessions` (they own the row), so the promotion cannot ride
--          along inside it — this is the explicit second step their screen
--          takes, and it is authorised on the one fact that matters: the
--          session is theirs."
--
--       That is an argument for why the COACH's route is shaped as a second
--       call and what authorises it. It is not a sentence about a gym. Nothing
--       in part 126 mentions an owner, a tenant, or a console; the file was
--       written before any of them could free a PT hour.
--
--   2 · Part 144, which DID consider the gym and left it out — but about a
--       different verb. It kept `session_waitlist` unreadable to owners:
--
--         "waitlist_gym_r on session_waitlist — DELIBERATE, left alone. …
--          Re-adding the arm would widen who can see which named members are
--          queueing for a PT slot, on live data, to satisfy a comment in a
--          superseded file rather than a screen. A narrowing nobody is hitting
--          is left narrow."
--
--       That decision is about READING the queue — which named members are
--       waiting — and it is a privacy decision this part does not disturb. Its
--       stated ground is "nothing asks for it" and "no owner screen reads the
--       table", and both are still true of reading. Neither was ever a claim
--       that the gym may not RESOLVE a queue it cannot see.
--
--   3 · Part 142, recording the same narrowing without endorsing it:
--
--         "Recording is not agreeing — if either narrowing was accidental it is
--          now visible enough to argue about."
--
-- And the console says out loud that it is a gap, in
-- studio-web/app/timetable/page.tsx above `BookTo`:
--
--     "ONE THING IT DELIBERATELY DOES NOT DO … it does not promote the
--      waitlist. … Freeing an hour here therefore opens it for anyone rather
--      than handing it to whoever was first in the queue. Claiming otherwise
--      would be worse than saying it."
--
-- So: a gap. Part 33 settled the principle when it gave `sessions` a tenant at
-- all — "A gym cannot see the one-to-one sessions its own trainers deliver on
-- its floor … the data is missing rather than over-shared" — and gave the owner
-- `sessions_gym_owner_u`, an UPDATE on every session in their tenant. The gym
-- has held the power to free the hour since part 33 and has never held the
-- power to hand it on. That asymmetry is the defect, and it is one function.
--
--
-- ── The owner arm is the predicate the console already runs on ─────────────
--
-- `promote_session_waitlist` gains a second arm and loses nothing:
--
--     s.trainer_id = v_uid                                  ← part 126, intact
--     s.tenant_id is not null and public.is_owner_of(s.tenant_id)   ← new
--
-- The second is character for character the USING clause of `sessions_gym_owner_r`
-- and `sessions_gym_owner_u` (part 33). It is therefore not a new authority: it
-- is the same fact that already let this caller empty the slot, asked again by
-- the function that has to hand it on. An owner who cannot free the hour cannot
-- promote for it either, and an owner who can, can.
--
-- `is_owner_of` was read before it was used rather than assumed:
--
--     select exists (select 1 from profiles p
--                     where p.id = auth.uid() and p.role = 'owner'
--                       and p.tenant_id = t);
--
-- Three conjuncts, and all three matter here. `p.role = 'owner'` is why a
-- trainer cannot reach the new arm at all — a coach's profile row says
-- 'trainer' and the predicate is false for them on every tenant in the
-- database, including their own gym's. `p.tenant_id = t` is why the owner of
-- gym B cannot promote for gym A. And `p.id = auth.uid()` is why this is not a
-- role check in the abstract: it is a check on the caller of THIS request.
--
-- `tenant_id is not null` is kept even though `is_owner_of(null)` is already
-- false (`p.tenant_id = null` is never true), because the two policies that
-- decide the same question write it, and a reader comparing them should find
-- the same expression rather than a shorter one they have to reason about.
--
-- It is not an `or true` in disguise. The negative cases were enumerated and
-- every one of them still raises 42501: an authenticated member of the gym
-- (role 'client'), a coach on the gym's staff (role 'trainer'), the owner of a
-- different tenant, an owner over a session whose `tenant_id` is null, and
-- anon (which holds no execute grant on this function at all). The one caller
-- the arm admits is a profile whose role is 'owner' in the session's own
-- tenant.
--
-- `sessions.tenant_id` is safe to authorise on. It is not a label a caller can
-- choose: part 1062's `guard_session_tenant()` refuses an UPDATE of that column
-- from `authenticated` and `anon` precisely because it is "the left-hand side
-- of the owner policies", and names this exact shape — "a coach who points a
-- session's tenant_id at another gym hands that gym's owner the ability to
-- alter or delete it".
--
--
-- ── What this part does NOT do ────────────────────────────────────────────
--
-- No RLS policy is added or changed, on any table. `promote_session_waitlist`
-- and `_promote_session_waitlist` are both SECURITY DEFINER and neither reads
-- `session_waitlist` through a policy, so the gym gets the ANSWER — one member
-- was promoted, or nobody was — without ever being able to read the queue. Part
-- 144's narrowing stands exactly as it was written: an owner still cannot see
-- which named members are waiting for a PT slot, and a gap in promotion was
-- never a reason to widen that.
--
-- The absence of a policy is also the absence of this codebase's recurring
-- policy defect. A `for all` whose USING is looser than its WITH CHECK reads as
-- a read-widening and ships as a DELETE — `session_waitlist`'s own first policy
-- was that shape, `for all using (auth.uid() = client_id)` with no WITH CHECK,
-- and part 126 records what it allowed. There is no `for all` here to get wrong.
--
-- The trainer arm is not touched, not reworded and not re-ordered. It is
-- evaluated first, so the ordinary path costs one index lookup on `sessions`
-- and never calls `is_owner_of` at all.
--
--
-- ── Whoever is promoted has to be told, and by whom ───────────────────────
--
-- The promotion is worth nothing to Mara if nobody tells her, and this is the
-- one push in the product that reports a booking the recipient did not make
-- (src/lib/notifyInbox.ts says so, above `KNOWN_PUSHES`).
--
-- Today that sentence is sent by a HANDSET, from both paths that can free a PT
-- hour: `app/(trainer)/calendar.tsx` after `promoteWaitlist`, and
-- `src/ui/sessions.tsx` on the member's own cancellation. Part 159 names them —
-- "an app that sends 'The slot you were waiting for is yours' — twice, once
-- from each side that can free a slot".
--
-- The console is a third side and it is not a handset. So the row is written
-- here, in the same transaction as the promotion, and ONLY on the owner arm:
--
--   · not on the trainer arm, because `sendPushChecked` in the coach's calendar
--     already sends it and a second would arrive twice, in two wordings,
--     seconds apart — which is the exact defect `KNOWN_PUSHES` rule 1 and part
--     2392 were both written about.
--   · not as a trigger on `sessions`, for the same reason doubled: a trigger
--     would fire under the coach's cancellation AND the member's, and would
--     duplicate both existing senders. Part 159 put the class promotion on a
--     trigger because the class path had no sender at all. This one has two.
--
-- `push_by` is left at its column default of 'server', which is what makes this
-- reach a phone: `notifications_dispatch_push` (part 900) claims exactly the
-- rows a handset has not already pushed. `notify_users()` would have been the
-- wrong call — it stamps `push_by = 'caller'` on purpose, for callers that send
-- their own push, and the console does not.
--
-- Its authorisation would have permitted it — `notify_users` allows
-- `is_owner_of(c.tenant_id)` over a member of the caller's gym — and the direct
-- insert is deliberately no wider: the recipient is the client id
-- `_promote_session_waitlist` just booked into a session in the caller's own
-- tenant, which is a strictly narrower set than that arm allows.
--
-- Route `/(client)/calendar`, which `notification_channel` maps to 'bookings' —
-- the same switch that governs the handset push of the same sentence, so a
-- member who has muted booking notifications is not reached by the back door.
-- The title is the same title, because it is the same event and the gym freeing
-- the hour instead of the coach is not news to the person being told.
--
-- The join to `profiles` is not defensive noise. `notifications.user_id` is
-- `references profiles(id)`, and `notify_users` carries the same join with the
-- reason on it: a coach's roster merges real `clients` with hand-added
-- `coach_clients` whose ids have no profile behind them. A promotion must never
-- fail because the person promoted has no account — the booking is the
-- important half and it is already done.
--
-- The "when" is a DURATION and never a clock time. `sessions` has no zone on it
-- and the server has no idea what the member's phone reads, so part 159's bands
-- are reproduced here — the same bands `classStartsIn()` in src/lib/notifyCopy.ts
-- computes on the handset. Change one and change both. The already-started band
-- is unreachable today, because `_promote_session_waitlist` returns null for a
-- session whose `starts_at` has passed; it is kept so the copy is still true if
-- that guard ever moves.
--
--
-- ── A promotion that promoted nobody must not read as one that did ────────
--
-- The whole consequence here is a place in a gym: somebody gets Tuesday 6:30
-- and somebody else does not. The worst outcome is not a refusal — it is an
-- owner told "handed to the queue" over a call that handed it to nobody, who
-- then does not re-offer the hour.
--
-- The function keeps its three distinguishable answers and adds none:
--
--     a uuid    one named person was booked, and the row proving it was written
--               in the same transaction. Promoted implies told.
--     null      the server ran and promoted nobody — the queue was empty, or
--               the slot was no longer available, or it had already started.
--     42501     refused. NOTHING is known about the queue.
--
-- That is deliberately the same three `PromoteResult` in src/ui/sessions.tsx
-- already draws for the coach's screen, and its header holds the argument for
-- why the third must never collapse into the second: a caller that reads a
-- failed call as a proven-empty queue broadcasts the hour to the whole roster,
-- which is the race the waitlist exists to replace, run against somebody who
-- may already own the slot. src/lib/waitlistPromotion.ts is the pure half of
-- that reading for the console, which cannot import a React Native module.
--
-- Idempotent. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── The arm ───────────────────────────────────────────────────────────────
--
-- Re-emitted whole from part 126 rather than patched, because a function is
-- replaced whole or not at all. Every line except the authorisation block and
-- the notification is part 126's, unchanged.
create or replace function public.promote_session_waitlist(p_session uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_uid      uuid := auth.uid();
  v_mine     boolean;
  v_as_owner boolean;
  v_promoted uuid;
  v_starts   timestamptz;
  v_secs     numeric;
  v_hours    numeric;
  v_days     numeric;
  v_when     text;
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  -- The coach's own session. Part 126's check, character for character, and
  -- evaluated first so the ordinary path never asks the second question.
  select exists (
    select 1 from sessions s where s.id = p_session and s.trainer_id = v_uid
  ) into v_mine;

  -- The gym the session is delivered in. The USING clause of
  -- `sessions_gym_owner_u`, which is what let this caller empty the slot.
  if v_mine then
    v_as_owner := false;
  else
    select exists (
      select 1 from sessions s
       where s.id = p_session
         and s.tenant_id is not null
         and public.is_owner_of(s.tenant_id)
    ) into v_as_owner;
  end if;

  if not (v_mine or v_as_owner) then
    raise exception 'That session is not yours.' using errcode = '42501';
  end if;

  v_promoted := public._promote_session_waitlist(p_session);

  -- The sentence, on the owner arm ONLY.
  --
  -- The two handset paths send their own; see the header. Guarded on
  -- `v_as_owner` and not on "did the caller send one", because whether a push
  -- happened is not a fact the database can read.
  if v_as_owner and v_promoted is not null then
    select s.starts_at into v_starts from sessions s where s.id = p_session;

    -- classStartsIn(), band for band. src/lib/notifyCopy.ts and part 159.
    v_secs := extract(epoch from (v_starts - now()));
    if v_starts is null then
      v_when := '';
    elsif v_secs <= 0 then
      v_when := 'It has already started.';
    elsif v_secs < 3600 then
      v_when := 'It starts in under an hour.';
    else
      v_hours := round(v_secs / 3600.0);
      if v_hours = 1 then
        v_when := 'It starts in about an hour.';
      elsif v_hours < 24 then
        v_when := 'It starts in about ' || v_hours || ' hours.';
      else
        v_days := round(v_secs / 86400.0);
        if v_days <= 1 then
          v_when := 'It starts in about a day.';
        else
          v_when := 'It starts in about ' || v_days || ' days.';
        end if;
      end if;
    end if;

    -- One row, for one person, and only if that person has an account to read
    -- it with. `push_by` takes its default of 'server' so part 900 dispatches
    -- it; `channel` is derived from the route by `notifications_set_channel`.
    insert into public.notifications (user_id, title, body, icon, route, session_id)
    select v_promoted,
           'The slot you were waiting for is yours',
           -- `v_when` is empty only in the branch that cannot happen, and the
           -- case is here so that branch does not print two spaces if it does.
           left('The session you were on the waiting list for just freed up, and you were'
                || ' next on the list — it is booked for you. '
                || case when v_when = '' then '' else v_when || ' ' end
                || 'Your calendar has the time on your own clock, and is where to cancel if you'
                || ' can no longer make it.', 500),
           'calendar',
           '/(client)/calendar',
           p_session
     where exists (select 1 from profiles p where p.id = v_promoted);
  end if;

  return v_promoted;
end $fn$;

-- Part 126's grants, re-stated. `create or replace` keeps an existing function's
-- ACL, but on a database built from these parts in order this statement is the
-- CREATE — and a newly created function is executable by PUBLIC, which in a
-- Supabase project includes `anon`. The standing rule, and part 126's own two
-- lines.
revoke all on function public.promote_session_waitlist(uuid) from public, anon;
grant execute on function public.promote_session_waitlist(uuid) to authenticated;

comment on function public.promote_session_waitlist(uuid) is
  'Hands a freed one-to-one slot to the head of its waitlist. Authorised for the coach who owns the session (part 126) or the owner of the gym it is delivered in — is_owner_of(sessions.tenant_id), the same predicate as sessions_gym_owner_u, which is what lets a gym free the hour in the first place. Returns the promoted client id, or null when nobody was promoted; raises 42501 when the caller is neither. On the owner arm it also writes the promoted member their notification, because the console is not a handset and the two app paths send their own. See part 2610.';


-- ── verify, after applying ────────────────────────────────────────────────
--
-- 1. The arm exists and the trainer arm is intact:
--
--      select pg_get_functiondef('public.promote_session_waitlist(uuid)'::regprocedure);
--
--    Expect both `s.trainer_id = v_uid` and `public.is_owner_of(s.tenant_id)`.
--
-- 2. The grant did not widen. Expect `authenticated` true, `anon` false:
--
--      select has_function_privilege('authenticated',
--               'public.promote_session_waitlist(uuid)', 'EXECUTE') as auth_ok,
--             has_function_privilege('anon',
--               'public.promote_session_waitlist(uuid)', 'EXECUTE') as anon_ok;
--
-- 3. No policy moved. Expect the four `session_waitlist` policies part 142 and
--    145 left — _client_r, _client_d, _trainer_r, _service_rw — and no owner
--    arm among them:
--
--      select polname, polcmd from pg_policy p
--        join pg_class c on c.oid = p.polrelid
--       where c.relname = 'session_waitlist' order by 1;
--
-- 4. The refusal still refuses. As a signed-in TRAINER of the gym, against a
--    session belonging to a DIFFERENT coach in that same gym, expect 42501
--    'That session is not yours.':
--
--      select public.promote_session_waitlist('<a peer coach''s session uuid>');
--
-- 5. The arm admits the owner. As the gym's owner, over one of their own
--    trainers' freed slots with somebody waiting, expect the waiting member's
--    uuid back, `sessions.client_id` set to it, one `session_waitlist` row
--    gone, and exactly ONE new `notifications` row:
--
--      select public.promote_session_waitlist('<that session uuid>');
--      select user_id, title, channel, push_by, pushed_at
--        from notifications where session_id = '<that session uuid>';
--
--    Expect channel 'bookings' and push_by 'server'.
--
-- 6. `select public.get_advisors('security')` is clean, and the count of
--    anon-executable SECURITY DEFINER functions still holds at 2.
-- ═══════════════════════════════════════════════════════════════════════════
