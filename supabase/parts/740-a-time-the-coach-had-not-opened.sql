-- ═══════════════════════════════════════════════════════════════════════════
-- A member can ask for a time the coach never opened.
--
-- ── The hole, stated exactly ─────────────────────────────────────────────
--
-- Reported by the product owner testing the client app: "i can't see my coach
-- Dayne's availability and am not able to book a session or send a request for
-- a booking."
--
-- Three separate things are behind that sentence and only the third is here.
--
--   1. A client is never shown a coach's WEEKLY AVAILABILITY, on purpose.
--      `trainer_availability` is touched by four files and all four are
--      coach-side. What a client sees is generated open slots — real `sessions`
--      rows with `status = 'available'` — and books one through `book_session`.
--   2. Those slots stopped being generated for most existing coaches, because
--      `run_open_slot_extension` (part 650) skips every availability row with
--      `tz is null` and nothing ever backfilled the column. Part 731 fixes it.
--   3. THERE IS NO WAY TO ASK FOR AN HOUR THE COACH HAS NOT ALREADY OPENED.
--      Every spelling of it was grepped for and none exists. A member who wants
--      Tuesday at seven, and whose coach has not published Tuesday at seven,
--      has nothing to tap. This part is that.
--
-- ── A request is not a booking, and the schema says so ───────────────────
--
-- The single most dangerous thing this feature could do is let somebody arrange
-- their evening around an hour nobody agreed to. So a request lives in its OWN
-- table and never in `sessions`:
--
--   · A `sessions` row is a commitment. It occupies the coach's diary, it is
--     counted by payroll (src/lib/gymSessions.ts), it appears on the gym's
--     timetable (part 44), it holds the exclusion constraint that stops a coach
--     being in two places at once, and it draws money at delivery (part 370).
--     None of that is true of a question somebody asked.
--   · A row in `sessions` with some new `status = 'requested'` would have been
--     the cheap version and it is the wrong one twice over. It widens a CHECK
--     constraint every one of those readers depends on — `status in
--     ('available','booked','blocked')` is load-bearing in the client read
--     policy, in `book_session`, in `block_time`, in the exclusion constraint's
--     WHERE clause and in the payroll reads — and every one of them would have
--     had to be re-read and re-decided to find out what a fourth value means to
--     it. And a row that is in the table means the coach's calendar has a thing
--     in it, which is the exact false impression the feature must not create.
--
-- So: `session_requests` names two people, an hour and a question. It confers
-- nothing. ACCEPTANCE IS THE ONLY THING IN THIS FILE THAT CREATES A SESSION.
--
-- ── Acceptance is atomic, and what that means here ───────────────────────
--
-- Two coaches cannot both answer one request (a request names one coach), but
-- ONE coach with two handsets, or one coach double-tapping, absolutely can —
-- and a second `sessions` row from one question is a member charged twice and a
-- diary with a phantom hour in it. `answer_session_request` therefore:
--
--   1. takes `select … for update` on the request row. The second caller blocks
--      until the first commits, then reads `state <> 'asked'` and is told
--      'already-answered'. It is not a race that is usually won; it is a race
--      that cannot be entered.
--   2. writes the session and the answer in ONE transaction. A function is one
--      transaction, so there is no state in which the request says accepted and
--      no session exists, or a session exists and the request still reads as
--      unanswered.
--   3. records `session_id` on the request. That is what makes step 1's refusal
--      safe to state plainly — the second caller is told which session the
--      first one made, rather than being left to guess.
--
-- ── The existing overlap rules apply, and are named in the refusal ───────
--
-- `src/lib/gymPtSchedule.ts` and the `classClashes` / `addSession` path in the
-- trainer calendar are the precedent: a coach may not be put in two places at
-- once, and the reason is said out loud rather than the write quietly failing.
-- Accepting onto an occupied hour is refused with the reason, never dropped:
--
--   'clash-booked'   another one-to-one is already booked in that span.
--   'clash-blocked'  the coach marked that time as unavailable (part 89).
--   'clash-class'    the coach is down to teach a class then (`gym_classes`,
--                    cancelled ones excluded exactly as `classClashes` does).
--
-- The first two are ALSO enforced by `sessions_no_double_booking`, the
-- exclusion constraint parts 86 and 89 built, which covers `status in
-- ('booked','blocked')`. The explicit checks exist to NAME the clash; the
-- constraint exists to be true under concurrency. Both are here, and the
-- constraint violation is caught and reported as 'clash' — the honest answer
-- when the row that caused it landed between the check and the insert.
--
-- A clash with an OPEN slot is deliberately not a refusal. Part 86 already
-- settled that: "Two OPEN slots may overlap on purpose … but only one of them
-- can ever be taken, because the moment one is booked the other cannot be."
-- An accepted request makes exactly that booking, and any open slot left across
-- it becomes unbookable the way every other overlapped slot already is —
-- `book_session` raises `exclusion_violation`, catches it, and returns false,
-- which the client screen already prints as "someone may have taken it first".
-- Nothing new is required and nothing is silently deleted out of a coach's
-- calendar behind their back.
--
-- ── Credits and money: this file moves neither ───────────────────────────
--
-- There is no price on a request, no credit drawn by one, and no charge raised
-- by one. A question costs nothing.
--
-- An ACCEPTED request produces a session, and that session is paid for by the
-- route that already exists for it. Which route is decided by one field and it
-- is decided by NOT setting it: `sessions.booking_drew_credit_at` is stamped by
-- `book_session` to mean "the client booked this on their own phone and their
-- phone drew the coach-pack credit in the next breath" (part 370). An accepted
-- request was not booked on the client's phone — the coach accepted it, on
-- theirs — so the column is left null, and `sessions_pack_draw()` treats the
-- session exactly as it treats the one a coach books into their own diary or a
-- front desk puts on the timetable: the credit is drawn AT DELIVERY, off
-- whichever entitlement part 370 says pays, in part 370's order, with part
-- 370's shortfall marker when the client held one and it was empty.
--
-- That is the whole of the money design and it is deliberately a subtraction.
-- The alternative — having the member's app call `redeem_pack_session` when it
-- notices the acceptance — would have been a SECOND draw path for a one-off,
-- reachable only if the member opened the app, and it would double-draw against
-- part 370's delivery trigger the moment they did. There is one path. It is the
-- one already in the file.
--
-- ── What happens to a request nobody answers ─────────────────────────────
--
-- IT EXPIRES WHEN THE HOUR IT ASKS FOR ARRIVES, and not before.
--
-- One rule, chosen over a fixed timer for a reason worth stating: a request is
-- a question about a specific hour, so the hour answers it. A 48-hour deadline
-- would kill a request made three weeks out while it was still perfectly live,
-- and would leave one made for tomorrow morning standing after the morning had
-- gone. There is nothing to tune and nothing to explain to a member beyond one
-- sentence, which `src/lib/sessionRequests.ts` writes and the member's screen
-- prints BEFORE they rely on it rather than after.
--
-- Expiry is DERIVED, never stored. `state` has four values and 'expired' is not
-- one of them: a lapsed request is one still marked 'asked' whose `starts_at`
-- has passed. That is a deliberate refusal to depend on a job. A stored expiry
-- needs something to run, and a nightly job that stops running is exactly how
-- part 731's defect happened — a count quietly excluding people, with no error
-- anywhere. Derived, the rule is true at every instant with nothing scheduled,
-- on a database nobody has swept, and it reads the same to the member's screen,
-- to the coach's screen and to the RPC that refuses to accept one.
--
-- ── Who can see one ──────────────────────────────────────────────────────
--
-- The member reads and writes their own. The coach reads and answers the ones
-- addressed to them. Nobody else — no other coach, no gym owner, no front desk.
--
-- The owner exclusion is the one that needed deciding rather than assuming, and
-- part 138 is the precedent: a coach's own ledger is not readable by the gym
-- because "a self-employed trainer's own billing is not gym money". The same
-- shape applies here for a different reason. A request is a CONVERSATION
-- between two named people about an hour that may never happen, and most of
-- them will never become anything the gym has a stake in. What the gym has a
-- stake in is the SESSION, and the moment one exists the gym's existing reads
-- pick it up: `sessions_gym_owner_r` (part 44) shows it on the timetable and
-- payroll counts it. So the gym sees every arrangement that was made and none
-- of the asking, which is the correct line and is narrower than the one that
-- would have been drawn by reflex.
--
-- The policies are built from `is_my_client` and `auth.uid()` — the idioms
-- already in this schema — and add no helper of their own. `my_tenant()` and
-- `my_role()` appear nowhere below on purpose: neither the tenant nor the role
-- decides anything here, and a policy that consulted them would be widening the
-- read to a third party by accident of habit.
--
-- Every write goes through a SECURITY DEFINER function, exactly as part 09
-- reasoned for booking and cancelling — "so no broad client UPDATE grant is
-- needed". There is no UPDATE policy and no DELETE policy on this table for
-- anybody. A member cannot mark their own request accepted, a coach cannot move
-- the hour it asks for, and neither can rewrite what was asked after the fact.
--
-- auth.uid() throughout, never current_user: under PostgREST every signed-in
-- request runs as the shared `authenticated` role.
--
-- Additive and idempotent; safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
begin
  if to_regclass('public.sessions') is null then
    raise exception 'public.sessions is missing — part 01 must be applied before part 740.';
  end if;
  if to_regclass('public.clients') is null then
    raise exception 'public.clients is missing — part 01 must be applied before part 740.';
  end if;
  -- Named rather than assumed. Without the exclusion constraint parts 86 and 89
  -- built, acceptance below would still refuse a clash it can SEE and would
  -- have nothing underneath it when two accepts land in the same instant.
  if not exists (
    select 1 from pg_constraint where conname = 'sessions_no_double_booking'
  ) then
    raise exception 'sessions_no_double_booking is missing — parts 86 and 89 must be applied before part 740.';
  end if;
end $$;


-- ── 1 · the question ───────────────────────────────────────────────────────

create table if not exists public.session_requests (
  id            uuid primary key default gen_random_uuid(),
  -- Both sides are named on the row rather than one of them being looked up
  -- through `clients.trainer_id` when it is needed. Coaching relationships end
  -- (part 68) and clients move between coaches; a request answered last month
  -- was answered by the coach it was addressed to, and re-deriving that from
  -- today's link would rewrite history every time somebody changed coach.
  client_id     uuid not null references public.clients(id) on delete cascade,
  trainer_id    uuid not null references public.trainers(id) on delete cascade,
  -- The hour being asked for. An instant, like `sessions.starts_at` — the
  -- member's phone knows what "Tuesday at seven" means on its own clock and
  -- sends the instant, so nothing here has to guess a zone. There is no
  -- timezone column and no default zone anywhere in this file; part 731 is the
  -- write-up of what a guessed zone costs.
  starts_at     timestamptz not null,
  duration_min  int not null default 60 check (duration_min > 0 and duration_min <= 480),
  -- The member's own words. Optional, capped, and never required — "can we do
  -- Tuesday at seven" is a complete request without a covering letter.
  note          text check (note is null or char_length(note) <= 400),
  -- Four values, and 'expired' is deliberately not one of them. See the header:
  -- a lapsed request is one still 'asked' whose hour has gone, computed rather
  -- than swept, so the rule needs nothing to be running to be true.
  state         text not null default 'asked'
                check (state in ('asked', 'accepted', 'declined', 'withdrawn')),
  -- What the session became, once one exists. This is the join that makes the
  -- second answerer's refusal safe to state: they are told which session the
  -- first one made rather than being left to work it out. ON DELETE SET NULL
  -- rather than CASCADE — a session that was later deleted does not unmake the
  -- fact that this request was accepted.
  session_id    uuid references public.sessions(id) on delete set null,
  -- The coach's reason for saying no, in their own words. Optional: a coach who
  -- declines without explaining has still given an answer, and a screen that
  -- demanded a reason would produce a full stop typed to get past it.
  decline_note  text check (decline_note is null or char_length(decline_note) <= 400),
  answered_at   timestamptz,
  answered_by   uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

-- One live question per hour, per pair. A double tap, a retried offline intent
-- and an impatient second ask are all the same question, and the second one
-- lands as 23505 rather than as a second row for the coach to answer twice.
-- Partial on 'asked' deliberately: a request that was DECLINED for Tuesday at
-- seven must not stop the member asking again next week for the same hour, and
-- an accepted one must not stop them asking again after they cancel.
create unique index if not exists uq_session_requests_live
  on public.session_requests (client_id, trainer_id, starts_at)
  where state = 'asked';

-- The coach's queue: "what have I been asked, soonest first". The one read the
-- coach's screen makes and the one `answer_session_request` does not need.
create index if not exists session_requests_coach_idx
  on public.session_requests (trainer_id, starts_at)
  where state = 'asked';

-- The member's own list, newest first, whatever became of each one.
create index if not exists session_requests_client_idx
  on public.session_requests (client_id, created_at desc);

comment on table public.session_requests is
  'A member asking their coach for an hour the coach has not opened. It is NOT a booking and confers nothing: no slot is held, no credit is drawn, no money moves. Accepting one creates the `sessions` row — see answer_session_request(), which is the only thing in this schema that turns one of these into a commitment.';
comment on column public.session_requests.state is
  'asked | accepted | declined | withdrawn. ''expired'' is NOT a state: a request still marked ''asked'' whose starts_at has passed has lapsed, and that is computed rather than swept so it needs no job to be true. See src/lib/sessionRequests.ts, which is the one place the rule is written for the apps.';
comment on column public.session_requests.session_id is
  'The session acceptance created. Null for every other state — and null on an accepted one only if that session was later deleted, which does not unmake the acceptance.';
comment on column public.session_requests.starts_at is
  'The instant asked for. No timezone column and no default zone: the member''s phone resolved their own clock before sending. Part 731 is what a guessed zone costs.';


-- ── 2 · who may see one ────────────────────────────────────────────────────
--
-- Two SELECT policies, no UPDATE policy, no DELETE policy, no INSERT policy.
-- Every write is an RPC below, for the reason part 09 gives about booking.

alter table public.session_requests enable row level security;

drop policy if exists session_requests_client_r on public.session_requests;
create policy session_requests_client_r on public.session_requests
  for select using (client_id = auth.uid());

-- `is_my_client` rather than a hand-rolled EXISTS on `clients`, for the reason
-- part 02 established when it introduced the helper and part 109 restates: one
-- definition of "this person is mine" that every coach-side policy in this
-- schema shares. It is also not quite enough on its own — a coach who has since
-- taken this member on must not inherit the requests addressed to their
-- previous coach — so the row's own `trainer_id` is checked too, and it is the
-- half that actually decides.
drop policy if exists session_requests_coach_r on public.session_requests;
create policy session_requests_coach_r on public.session_requests
  for select using (trainer_id = auth.uid() and is_my_client(client_id));

grant select on public.session_requests to authenticated;


-- ── 3 · asking ─────────────────────────────────────────────────────────────
--
-- The coach is NOT a parameter. It is read from `clients.trainer_id` for the
-- caller, so a member can only ever ask their own coach and there is no id on
-- the wire for anybody to substitute. A member with no coach gets 'no-coach',
-- which is a true thing their screen can say rather than an empty list.

-- How many unanswered questions one member may have outstanding with one coach.
-- Not a rate limit on asking — it is a limit on how much unanswered work one
-- person can put in front of a coach at once, which is the thing that makes a
-- queue useless to the coach and therefore useless to everybody asking.
create or replace function public.session_request_live_cap()
returns int language sql immutable set search_path to 'public'
as $fn$ select 10 $fn$;

create or replace function public.request_session(
  p_starts_at timestamptz,
  p_duration_min int default 60,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid uuid := auth.uid();
  v_trainer uuid;
  v_live int;
  v_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not-signed-in');
  end if;
  if p_starts_at is null then
    return jsonb_build_object('ok', false, 'reason', 'bad-time');
  end if;
  -- The hour must still be ahead. Asking for a time that has gone is not a
  -- request, and the same sentence part 731's neighbour `canPlan` uses applies:
  -- it would be a claim about the past arriving through the front door.
  if p_starts_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'in-the-past');
  end if;
  if p_duration_min is null or p_duration_min <= 0 or p_duration_min > 480 then
    return jsonb_build_object('ok', false, 'reason', 'bad-duration');
  end if;

  select c.trainer_id into v_trainer from clients c where c.id = v_uid;
  if v_trainer is null then
    return jsonb_build_object('ok', false, 'reason', 'no-coach');
  end if;

  select count(*) into v_live
    from session_requests r
   where r.client_id = v_uid
     and r.trainer_id = v_trainer
     and r.state = 'asked'
     and r.starts_at > now();
  if v_live >= session_request_live_cap() then
    return jsonb_build_object('ok', false, 'reason', 'too-many', 'cap', session_request_live_cap());
  end if;

  begin
    insert into session_requests (client_id, trainer_id, starts_at, duration_min, note)
    values (v_uid, v_trainer, p_starts_at, p_duration_min, nullif(btrim(coalesce(p_note, '')), ''))
    returning id into v_id;
  exception
    -- The partial unique index. The member has already asked for this hour and
    -- it is still unanswered, which is not a failure — it is the state they
    -- wanted to be in. Reported as its own reason so the screen says "you have
    -- already asked for that" rather than "something went wrong".
    when unique_violation then
      return jsonb_build_object('ok', false, 'reason', 'already-asked');
  end;

  return jsonb_build_object('ok', true, 'reason', 'asked', 'id', v_id, 'trainer', v_trainer);
end $fn$;

revoke all on function public.request_session(timestamptz, int, text) from public, anon;
grant execute on function public.request_session(timestamptz, int, text) to authenticated;

comment on function public.request_session is
  'Ask this member''s own coach for an hour. The coach is read from clients.trainer_id and is not a parameter, so nobody can address a request to a coach who is not theirs. Creates NOTHING but the question: no slot is held and no credit moves. Returns {ok, reason, id, trainer}.';


-- ── 4 · withdrawing ────────────────────────────────────────────────────────
--
-- A member changing their mind. Only from 'asked', and only their own: an
-- accepted request has become a session, and the way out of a session is
-- `cancel_my_session`, which prices the coach's policy and hands the slot on.
-- Withdrawing an accepted request here would take the arrangement off this
-- table and leave the session standing with nothing pointing at it.

create or replace function public.withdraw_session_request(p_request uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid uuid := auth.uid();
  v_rows int;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not-signed-in');
  end if;
  update session_requests
     set state = 'withdrawn', answered_at = now(), answered_by = v_uid
   where id = p_request and client_id = v_uid and state = 'asked';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    -- One answer for "not yours" and for "already answered", because from the
    -- member's side both mean the same thing: this is not a live question any
    -- more, and their screen should re-read rather than assert anything.
    return jsonb_build_object('ok', false, 'reason', 'gone');
  end if;
  return jsonb_build_object('ok', true, 'reason', 'withdrawn');
end $fn$;

revoke all on function public.withdraw_session_request(uuid) from public, anon;
grant execute on function public.withdraw_session_request(uuid) to authenticated;

comment on function public.withdraw_session_request is
  'The member taking back an unanswered request. Only from ''asked'' and only their own. An ACCEPTED request is a session and is cancelled with cancel_my_session, which prices the coach''s policy — withdrawing one here would orphan it.';


-- ── 5 · answering, which is the only thing here that creates a session ─────

create or replace function public.answer_session_request(
  p_request uuid,
  p_accept boolean,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid uuid := auth.uid();
  v_req session_requests%rowtype;
  v_session uuid;
  v_clash_id uuid;
  v_clash_status text;
  v_class_title text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not-signed-in');
  end if;
  if p_accept is null then
    return jsonb_build_object('ok', false, 'reason', 'no-answer');
  end if;

  -- THE LOCK. Everything the rest of this function decides is decided against a
  -- row nobody else can be reading for update at the same time, so a coach with
  -- two handsets — or one handset that sent twice — cannot produce two sessions
  -- from one question. The second caller waits here, then falls through to the
  -- 'already-answered' branch below with the first caller's session named.
  select * into v_req from session_requests
   where id = p_request and trainer_id = v_uid
   for update;

  if not found then
    -- Not this coach's request, or no such request. One answer for both: a
    -- coach must not be able to tell a request they may not see from one that
    -- does not exist.
    return jsonb_build_object('ok', false, 'reason', 'not-yours');
  end if;

  if v_req.state <> 'asked' then
    return jsonb_build_object(
      'ok', false, 'reason', 'already-answered',
      'state', v_req.state, 'session', v_req.session_id
    );
  end if;

  -- Lapsed. The hour it asks for has arrived, so there is nothing left to say
  -- yes to. Refused rather than silently accepted into the past, and the state
  -- is deliberately left as 'asked' — see the header on why expiry is derived.
  if v_req.starts_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  -- ── declining ──────────────────────────────────────────────────────────
  if not p_accept then
    update session_requests
       set state = 'declined',
           decline_note = nullif(btrim(coalesce(p_note, '')), ''),
           answered_at = now(), answered_by = v_uid
     where id = v_req.id;
    return jsonb_build_object('ok', true, 'reason', 'declined');
  end if;

  -- ── accepting ──────────────────────────────────────────────────────────
  --
  -- The clash checks NAME the obstacle. They are not what makes acceptance
  -- safe — `sessions_no_double_booking` is, and it is caught below — they are
  -- what lets the coach be told "you are teaching Bootcamp then" instead of
  -- "that didn't work". Same three rules the trainer calendar applies before
  -- `addSession`, in the same order.

  select s.id, s.status into v_clash_id, v_clash_status
    from sessions s
   where s.trainer_id = v_uid
     and s.status in ('booked', 'blocked')
     and session_span(s.starts_at, s.duration_min)
         && session_span(v_req.starts_at, v_req.duration_min)
   limit 1;
  if v_clash_id is not null then
    return jsonb_build_object(
      'ok', false,
      'reason', case when v_clash_status = 'blocked' then 'clash-blocked' else 'clash-booked' end
    );
  end if;

  -- A class the coach is DOWN TO TEACH. `classClashes` in src/lib/booking.ts is
  -- the precedent and this is its server half, with the same two exclusions: a
  -- cancelled class is not a commitment, and a class attributed to nobody is
  -- not attributed to this coach. The unattributed ones are exactly what that
  -- function refuses to rule in or out, and a server that guessed here would be
  -- refusing a coach their own hour over somebody else's untitled row.
  if to_regclass('public.gym_classes') is not null then
    select g.title into v_class_title
      from gym_classes g
     where g.trainer_id = v_uid
       and coalesce(g.status, 'scheduled') <> 'cancelled'
       and session_span(g.starts_at, g.duration_min)
           && session_span(v_req.starts_at, v_req.duration_min)
     limit 1;
    if v_class_title is not null then
      return jsonb_build_object('ok', false, 'reason', 'clash-class', 'class', v_class_title);
    end if;
  end if;

  begin
    insert into sessions (trainer_id, client_id, starts_at, duration_min, status, released)
    values (v_req.trainer_id, v_req.client_id, v_req.starts_at, v_req.duration_min, 'booked', false)
    returning id into v_session;
  exception
    -- The constraint caught what the checks above could not: a booking or a
    -- block that landed in the microseconds between them and this insert.
    -- Reported as a plain 'clash' rather than being attributed to one of the
    -- two, because this branch genuinely does not know which it was and a
    -- guessed reason on a refusal is worse than an unspecific true one.
    when exclusion_violation then
      return jsonb_build_object('ok', false, 'reason', 'clash');
  end;

  -- `booking_drew_credit_at` is NOT set, and that is the whole money decision.
  -- See the header: leaving it null routes this session through part 370's
  -- delivery draw, which is the same path a coach-booked or desk-booked one-off
  -- already takes. Stamping it would tell part 370 that a client's phone had
  -- drawn a credit that nothing drew.

  update session_requests
     set state = 'accepted', session_id = v_session,
         answered_at = now(), answered_by = v_uid
   where id = v_req.id;

  return jsonb_build_object('ok', true, 'reason', 'accepted', 'session', v_session);
end $fn$;

revoke all on function public.answer_session_request(uuid, boolean, text) from public, anon;
grant execute on function public.answer_session_request(uuid, boolean, text) to authenticated;

revoke all on function public.session_request_live_cap() from public, anon;
grant execute on function public.session_request_live_cap() to authenticated;

comment on function public.answer_session_request is
  'The coach''s yes or no. The ONLY thing in this schema that turns a request into a session. Locks the request row FOR UPDATE first, so one question cannot produce two sessions however many handsets answer it. Refuses an occupied hour with the reason named — clash-booked, clash-blocked, clash-class — and falls back to a plain ''clash'' when sessions_no_double_booking catches one that landed mid-flight. Leaves sessions.booking_drew_credit_at null on purpose: the credit is drawn at delivery by part 370, on the route a coach-booked one-off already uses.';
comment on function public.session_request_live_cap is
  'How many unanswered requests one member may have outstanding with one coach. Not a rate limit on asking — a limit on how much unanswered work can be stacked in front of one coach, past which the queue is useless to them and therefore to everyone in it.';
