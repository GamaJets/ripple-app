-- ── The cancellation policy, the late fee, and the waitlist ────────────────
--
-- Three roadmap items that are one feature, and all three of them were already
-- half-built in part 01 and then left.
--
--   · `charges` has existed since the first schema and is written by NOTHING.
--     A late cancellation was detected on the calendar, warned about in an
--     alert, recorded as an outcome — and never billed, anywhere, by anything.
--     The coach's own screen said "your late-cancel policy would apply", which
--     described a charge no code in this repo makes.
--   · `session_waitlist` has existed just as long and is referenced in ONE
--     COMMENT (src/lib/gymSessions.ts, explaining an ambiguous PostgREST
--     embed). When a slot freed, the app pushed every client of that coach
--     "first to book it gets it" and let them race for it — a race the app
--     creates and then loses, because the loser was told to hurry.
--   · the policy itself was `trainers.session_fee`: a bare number, with no
--     notice period, no way to say the fee does not apply, and no way to
--     forgive one after the fact.
--
-- Repple does not take the money. It never has and this part does not start:
-- there is no payment intent, no Stripe call, no balance. The coach settles the
-- fee with their client. What Repple owes them is the RECORD — a row that says
-- who, when, which session, how much and in what currency — and the record is
-- the product. Every sentence the apps print about it says exactly that.
--
-- ── Why the promotion happens INSIDE the cancellation ──────────────────────
--
-- The freed slot is never observable as 'available' when somebody is waiting
-- for it. `cancel_my_session` locks the session row, frees it, and hands it to
-- the head of the waitlist in one transaction, so there is no window for a
-- racing `book_session` to win — a racer either sees the row before the commit
-- (still booked by the canceller, so `status = 'available'` matches nothing) or
-- after it (booked by the head of the list, same). The waitlist is a queue
-- because the queue is resolved by the database, not by whoever taps first.


-- ── 1. A policy a coach can express ────────────────────────────────────────
--
-- `trainers`, not `tenants`: a late-cancellation policy is the coach's, not the
-- gym's. Two coaches in one gym can and do run different ones, and an
-- independent coach has no gym at all. The gym still owns the CURRENCY
-- (`tenants.currency`, part 99) because that is what the money is denominated
-- in, and a coach does not get to pick that per policy.
--
-- Three columns rather than one number, because all three are separate facts a
-- coach states and any of them alone is unusable:
--
--   applies       whether there is a policy at all. Default FALSE — a coach who
--                 has said nothing has not agreed to charge anybody, and the
--                 apps say "your coach has not set one" rather than assuming.
--   notice_hours  the notice period. 24 is the default because it is what the
--                 apps have always warned about, so an existing coach's policy
--                 is unchanged the moment they switch it on.
--   fee           the amount, in the gym's currency, in major units like every
--                 other money column a human types into (`trainers.session_fee`,
--                 `tenants.session_fee`). NULL means unstated.
alter table public.trainers
  add column if not exists late_cancel_applies boolean not null default false,
  add column if not exists late_cancel_notice_hours int not null default 24,
  add column if not exists late_cancel_fee numeric(8,2);

alter table public.trainers drop constraint if exists trainers_late_cancel_notice_range;
alter table public.trainers add constraint trainers_late_cancel_notice_range
  check (late_cancel_notice_hours between 1 and 168);

-- A policy that applies must name its amount. This is the constraint that stops
-- the old bug coming back in a new shape: "the fee applies" with no fee behind
-- it is what produced "a $0 late fee may apply" on a client's screen, and a
-- figure about somebody's money that nobody chose is worse than no figure.
-- Zero is excluded deliberately — a fee of nothing is a policy that does not
-- apply, and it has its own switch.
alter table public.trainers drop constraint if exists trainers_late_cancel_fee_stated;
alter table public.trainers add constraint trainers_late_cancel_fee_stated
  check (not late_cancel_applies or (late_cancel_fee is not null and late_cancel_fee > 0));

comment on column public.trainers.late_cancel_applies is
  'Whether this coach charges for a late cancellation at all. FALSE by default — never assume a policy nobody stated.';
comment on column public.trainers.late_cancel_notice_hours is
  'Hours of notice required to cancel free of charge. Inside this window the fee is recorded.';
comment on column public.trainers.late_cancel_fee is
  'The fee in MAJOR units of tenants.currency. NULL means unstated; a policy that applies may not have one.';


-- ── 2. A fee that is actually recorded ─────────────────────────────────────
--
-- `charges` gains what a record of a fee needs and did not have:
--
--   session_id  what the fee is FOR. Without it a client sees an amount and a
--               date and has to take it on trust, and the coach cannot answer
--               "which session was this?" either.
--   currency    snapshotted, not derived. `tenants.currency` is the gym's today
--               and a gym may change it; a fee raised last March was raised in
--               last March's money, and re-reading it through today's tenant
--               row would silently restate the amount.
--   waived_at   the forgiveness the policy never had. A coach who lets one off
--               needs to say so ON the record — deleting the row loses the fact
--               that it happened, and leaving it standing bills somebody the
--               coach already excused.
alter table public.charges
  add column if not exists session_id uuid references public.sessions(id) on delete set null,
  add column if not exists currency text,
  add column if not exists waived_at timestamptz,
  add column if not exists waived_by uuid references public.profiles(id) on delete set null;

alter table public.charges drop constraint if exists charges_currency_is_iso;
alter table public.charges add constraint charges_currency_is_iso
  check (currency is null or currency ~ '^[A-Z]{3}$');

-- Deliberately NOT unique. The same slot can be booked and late-cancelled twice
-- by the same client, and that is two fees, not one duplicate. A double tap on
-- Cancel cannot produce a second row because the second call finds the session
-- no longer booked to them and does nothing at all.
create index if not exists charges_session_idx on public.charges (session_id);
create index if not exists charges_client_created_idx on public.charges (client_id, created_at desc);

comment on column public.charges.session_id is
  'The session this fee is for. NULL for charges that are not about a session.';
comment on column public.charges.currency is
  'ISO 4217, snapshotted when the charge was raised. NULL means unknown — render a dash, never a symbol.';
comment on column public.charges.waived_at is
  'Set when the coach forgave this fee. The row stays: a waived charge is a fact about what happened, not an absence.';


-- ── 3. A waitlist that is a queue ──────────────────────────────────────────
--
-- `joined_at` defaults to now(), which is the TRANSACTION timestamp, so two
-- clients joining in the same microsecond would tie and the order of a queue
-- would depend on whatever the planner felt like. `seq` is a total order behind
-- it; the pair is what every ordering below sorts on, and what the app's
-- `nextWaitlistClaim` in src/lib/booking.ts mirrors so the rule is stated in
-- both places and tested in one.
alter table public.session_waitlist add column if not exists seq bigserial;

create index if not exists session_waitlist_order_idx
  on public.session_waitlist (session_id, joined_at, seq);

comment on column public.session_waitlist.seq is
  'Tiebreak behind joined_at so the queue has a total order. Never shown to anybody.';

-- The old policy was `for all using (auth.uid() = client_id)` with no WITH
-- CHECK, so its USING clause doubled as the insert check: a client could insert
-- a waitlist row for ANY session id in the database, including sessions
-- belonging to coaches they have never met. Nothing bad followed from it
-- because nothing read the table — which is exactly the state this part ends.
--
-- Joining now goes through `join_session_waitlist`, which checks the slot is
-- their own coach's, is actually taken, and has not already started. Reading
-- and leaving stay direct, because both are about the client's own row.
drop policy if exists session_waitlist_client_rw on public.session_waitlist;

create policy session_waitlist_client_r on public.session_waitlist
  for select using (client_id = (select auth.uid()));

create policy session_waitlist_client_d on public.session_waitlist
  for delete using (client_id = (select auth.uid()));


-- ── 4. The queue, resolved by the database ─────────────────────────────────

-- Internal. No authorisation of its own and therefore executable by NOBODY: it
-- is called only by the two SECURITY DEFINER functions below, which have
-- already established who may free this slot. Revoked from public, anon AND
-- authenticated — part 120 is the record of what happens when only `public` is
-- revoked and the two API roles are left holding their separate grants.
create or replace function public._promote_session_waitlist(p_session uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_sess record;
  v_cand record;
  v_pack uuid;
begin
  select s.id, s.trainer_id, s.starts_at, s.status
    into v_sess
    from sessions s
   where s.id = p_session
   for update;
  if not found or v_sess.status <> 'available' then
    return null;
  end if;

  -- A session that has already started is not promoted. Handing somebody a slot
  -- that began ten minutes ago books them into a session they cannot attend and
  -- draws a credit off their pack for it. The slot simply stays open.
  if v_sess.starts_at <= now() then
    return null;
  end if;

  for v_cand in
    select w.client_id
      from session_waitlist w
      join clients c on c.id = w.client_id
     where w.session_id = p_session
       and c.trainer_id = v_sess.trainer_id
     order by w.joined_at, w.seq
     for update of w
  loop
    begin
      update sessions
         set client_id = v_cand.client_id, status = 'booked', released = false
       where id = p_session;

      -- The credit. A client promoted off a waitlist is booked by the server
      -- while their phone is in their pocket, so the draw-down `redeemSession`
      -- does at the moment somebody taps Book has to happen here instead —
      -- otherwise the queue is the cheapest way to book, and the coach delivers
      -- a session nobody paid for. Oldest pack first, exactly as redeemSession
      -- orders them. No pack is the ordinary case for a client who pays per
      -- session, and it is not an error.
      select p.id into v_pack
        from client_purchases p
       where p.client_id = v_cand.client_id
         and p.trainer_id = v_sess.trainer_id
         and p.status = 'paid'
         and p.sessions_total is not null
         and p.sessions_total - p.sessions_used > 0
       order by p.created_at asc
       limit 1
         for update;
      if v_pack is not null then
        update client_purchases set sessions_used = sessions_used + 1 where id = v_pack;
      end if;

      delete from session_waitlist
       where session_id = p_session and client_id = v_cand.client_id;

      return v_cand.client_id;
    exception when exclusion_violation then
      -- They are already booked with this coach across that hour. Their place
      -- in the queue is kept and the next person is tried, rather than the slot
      -- silently failing to move.
      continue;
    end;
  end loop;

  return null;
end $fn$;

revoke all on function public._promote_session_waitlist(uuid) from public, anon, authenticated;

comment on function public._promote_session_waitlist(uuid) is
  'Internal. Hands a freed slot to the head of its waitlist. Callers must authorise first; this function does not.';


-- The client cancelling their own booked session: free it, record the fee if
-- the coach's policy says so, and hand the slot to whoever is first in line —
-- one transaction, one row lock, no window.
--
-- Returns a jsonb report rather than a boolean because every one of these facts
-- is something the member is then told, and a screen that has to re-read the
-- row to find out what happened is a screen that can be told a different story
-- than the one that was written.
--
-- `freed: false` is a refusal, not an error: it means the session is not this
-- caller's, or is not booked. The apps treat it as "nothing changed", which is
-- true, and say so.
create or replace function public.cancel_my_session(p_session uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_uid uuid := auth.uid();
  v_sess record;
  v_applies boolean := false;
  v_notice int := 24;
  v_fee numeric;
  v_currency text;
  v_late boolean := false;
  v_charge uuid;
  v_promoted uuid;
  v_waiting int := 0;
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  select s.id, s.trainer_id, s.starts_at, s.duration_min
    into v_sess
    from sessions s
   where s.id = p_session
     and s.client_id = v_uid
     and s.status = 'booked'
   for update;

  if not found then
    return jsonb_build_object(
      'freed', false, 'late', false, 'notice_hours', null, 'policy_applies', false,
      'fee', null, 'currency', null, 'charged', false, 'charge_id', null,
      'promoted', null, 'waiting', 0);
  end if;

  select coalesce(t.late_cancel_applies, false),
         coalesce(t.late_cancel_notice_hours, 24),
         t.late_cancel_fee,
         tn.currency
    into v_applies, v_notice, v_fee, v_currency
    from trainers t
    left join tenants tn on tn.id = t.tenant_id
   where t.id = v_sess.trainer_id;

  -- The rule is `starts_at - now() < notice`, with NO lower bound, and that is
  -- deliberate: a session that has already begun is inside the window. The app
  -- has always worked this way (see the note on `late` in cancelBookedSession,
  -- src/ui/sessions.tsx) and `isLateCancellation` in src/lib/booking.ts does
  -- NOT, because it requires the session to still be in the future — under that
  -- rule somebody cancelling a session already in progress comes back "not
  -- late", is charged nothing and is handed their credit back while their coach
  -- stands in an empty gym.
  v_late := (v_sess.starts_at - now()) < make_interval(hours => v_notice);

  update sessions
     set client_id = null, status = 'available', released = true
   where id = p_session;

  -- The whole of the billing. No payment intent, no capture, no balance: a row
  -- that says what is owed to whom for which session, which the coach settles
  -- themselves. `stripe_payment_intent` stays NULL and that is the point.
  if v_late and v_applies and v_fee is not null and v_fee > 0
     and exists (select 1 from clients c where c.id = v_uid) then
    insert into charges (client_id, amount, reason, session_id, currency)
    values (v_uid, v_fee, 'late_cancellation', p_session, v_currency)
    returning id into v_charge;
  end if;

  v_promoted := public._promote_session_waitlist(p_session);

  select count(*) into v_waiting from session_waitlist where session_id = p_session;

  return jsonb_build_object(
    'freed', true,
    'late', v_late,
    'notice_hours', v_notice,
    'policy_applies', v_applies,
    -- Null unless the policy is live. A fee a coach has typed but switched off
    -- is not a sum anybody owes, and a screen handed the number will print it.
    'fee', case when v_applies then v_fee else null end,
    'currency', v_currency,
    'charged', v_charge is not null,
    'charge_id', v_charge,
    'promoted', v_promoted,
    'waiting', v_waiting);
end $fn$;

revoke all on function public.cancel_my_session(uuid) from public, anon;
grant execute on function public.cancel_my_session(uuid) to authenticated;


-- The coach freeing a slot themselves. Their cancellation goes through RLS on
-- `sessions` (they own the row), so the promotion cannot ride along inside it —
-- this is the explicit second step their screen takes, and it is authorised on
-- the one fact that matters: the session is theirs.
create or replace function public.promote_session_waitlist(p_session uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  if not exists (select 1 from sessions s where s.id = p_session and s.trainer_id = v_uid) then
    raise exception 'That session is not yours.' using errcode = '42501';
  end if;
  return public._promote_session_waitlist(p_session);
end $fn$;

revoke all on function public.promote_session_waitlist(uuid) from public, anon;
grant execute on function public.promote_session_waitlist(uuid) to authenticated;


-- ── 5. Joining, leaving, and seeing the queue ──────────────────────────────

-- Joining is an RPC and not an insert because none of what makes a waitlist
-- entry legitimate is visible to the client: they cannot read the session row
-- of a slot somebody else has booked (sessions_client_read shows them their own
-- sessions and their coach's OPEN ones), so they cannot check whose it is, or
-- whether it is taken, or whether it has already run.
create or replace function public.join_session_waitlist(p_session uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_uid uuid := auth.uid();
  v_sess record;
  v_pos int;
  v_waiting int;
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  select s.id, s.trainer_id, s.starts_at, s.client_id, s.status
    into v_sess
    from sessions s where s.id = p_session;
  if not found then
    raise exception 'That session no longer exists.' using errcode = '42501';
  end if;
  if not exists (select 1 from clients c where c.id = v_uid and c.trainer_id = v_sess.trainer_id) then
    raise exception 'That slot belongs to another coach.' using errcode = '42501';
  end if;
  if v_sess.client_id = v_uid then
    raise exception 'That session is already yours.' using errcode = '22023';
  end if;
  if v_sess.status <> 'booked' then
    raise exception 'That slot is open — book it rather than waiting for it.' using errcode = '22023';
  end if;
  if v_sess.starts_at <= now() then
    raise exception 'That session has already started.' using errcode = '22023';
  end if;

  insert into session_waitlist (session_id, client_id)
  values (p_session, v_uid)
  on conflict (session_id, client_id) do nothing;

  select count(*) into v_pos
    from session_waitlist w
   where w.session_id = p_session
     and (w.joined_at, w.seq) <= (
       select w2.joined_at, w2.seq from session_waitlist w2
        where w2.session_id = p_session and w2.client_id = v_uid);
  select count(*) into v_waiting from session_waitlist w where w.session_id = p_session;

  return jsonb_build_object('joined', true, 'position', v_pos, 'waiting', v_waiting);
end $fn$;

revoke all on function public.join_session_waitlist(uuid) from public, anon;
grant execute on function public.join_session_waitlist(uuid) to authenticated;


-- Leaving is a plain delete under the client's own policy, wrapped so the
-- screen gets a straight answer: PostgREST reports a delete that matched no
-- rows as a success, and "you have left the waitlist" over a row that is still
-- there is the failure mode this repo keeps finding.
create or replace function public.leave_session_waitlist(p_session uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare v_uid uuid := auth.uid(); n int;
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  delete from session_waitlist where session_id = p_session and client_id = v_uid;
  get diagnostics n = row_count;
  return n > 0;
end $fn$;

revoke all on function public.leave_session_waitlist(uuid) from public, anon;
grant execute on function public.leave_session_waitlist(uuid) to authenticated;


-- What the signed-in client is waiting for, with their place in each queue.
-- Position cannot be computed client-side: `session_waitlist_client_r` shows a
-- client their own row and nobody else's, so from the app the queue is a set of
-- one and every position is 1.
create or replace function public.my_waitlist()
returns table (
  session_id uuid,
  starts_at timestamptz,
  duration_min int,
  trainer_id uuid,
  -- `position` is a reserved word in a function's OUT list; Postgres rejects
  -- `position int` outright. The queue is what it is.
  queue_position int,
  waiting int,
  still_taken boolean
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
  select w.session_id,
         s.starts_at,
         s.duration_min,
         s.trainer_id,
         (select count(*)::int from session_waitlist w2
           where w2.session_id = w.session_id
             and (w2.joined_at, w2.seq) <= (w.joined_at, w.seq)) as queue_position,
         (select count(*)::int from session_waitlist w3 where w3.session_id = w.session_id) as waiting,
         (s.status = 'booked') as still_taken
    from session_waitlist w
    join sessions s on s.id = w.session_id
   where w.client_id = auth.uid()
   order by s.starts_at asc
   limit 500;
$fn$;

revoke all on function public.my_waitlist() from public, anon;
grant execute on function public.my_waitlist() to authenticated;


-- The coach's taken slots, so a client has something to WAIT FOR. Their own
-- booked sessions are excluded — there is nothing to wait for in a slot you
-- hold — and no client identity is returned for any of them: a member learns
-- that an hour is taken, which is what any booking calendar shows, and not by
-- whom.
create or replace function public.waitlistable_slots(p_from timestamptz, p_to timestamptz)
returns table (
  session_id uuid,
  starts_at timestamptz,
  duration_min int,
  waiting int,
  my_position int
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
  select s.id,
         s.starts_at,
         s.duration_min,
         (select count(*)::int from session_waitlist w where w.session_id = s.id) as waiting,
         -- 0 when the caller is not on it: the row comparison against an empty
         -- subquery is NULL, which nothing counts. 1 is the head of the queue.
         (select count(*)::int from session_waitlist w2
           where w2.session_id = s.id
             and (w2.joined_at, w2.seq) <= (
               select w3.joined_at, w3.seq from session_waitlist w3
                where w3.session_id = s.id and w3.client_id = auth.uid())) as my_position
    from sessions s
    join clients c on c.id = auth.uid() and c.trainer_id = s.trainer_id
   where s.status = 'booked'
     and s.client_id is distinct from auth.uid()
     and s.starts_at > greatest(p_from, now())
     and s.starts_at <= p_to
   order by s.starts_at asc
   limit 500;
$fn$;

revoke all on function public.waitlistable_slots(timestamptz, timestamptz) from public, anon;
grant execute on function public.waitlistable_slots(timestamptz, timestamptz) to authenticated;


-- The coach's policy, as the CLIENT is entitled to read it: the notice period
-- they are held to, the fee they would be charged, and the money it is in.
-- Returns null when the caller has no coach — which is not a policy of "no
-- fee", and the app words it differently.
create or replace function public.my_cancellation_policy()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare v_uid uuid := auth.uid(); v_row record;
begin
  if v_uid is null then return null; end if;
  select t.id as trainer_id,
         coalesce(t.late_cancel_applies, false) as applies,
         coalesce(t.late_cancel_notice_hours, 24) as notice_hours,
         t.late_cancel_fee as fee,
         tn.currency as currency
    into v_row
    from clients c
    join trainers t on t.id = c.trainer_id
    left join tenants tn on tn.id = t.tenant_id
   where c.id = v_uid;
  if not found then return null; end if;
  return jsonb_build_object(
    'trainer_id', v_row.trainer_id,
    'applies', v_row.applies,
    'notice_hours', v_row.notice_hours,
    'fee', case when v_row.applies then v_row.fee else null end,
    'currency', v_row.currency);
end $fn$;

revoke all on function public.my_cancellation_policy() from public, anon;
grant execute on function public.my_cancellation_policy() to authenticated;
