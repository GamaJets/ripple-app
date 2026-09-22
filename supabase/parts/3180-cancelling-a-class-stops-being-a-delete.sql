-- ═══════════════════════════════════════════════════════════════════════════
-- Cancelling a class stops being a DELETE, and re-booking stops erasing it.
--
-- NOT YET APPLIED. Part 3060 put the columns in place on 13 Sep 2026 and
-- deliberately did not touch `cancel_class`, because changing a destructive RPC
-- is its own review. This file is that review, and it is the other half of 3060.
--
-- ── What 3060 left standing, verified against the live database ────────────
--
-- Read off project phgfwzpkkwdysftlgkoq on 13 Sep 2026 before a line of this
-- was written, because a part built on an assumed schema is a part that fails
-- on the first statement:
--
--   · class_bookings_status_check is
--     CHECK (status = ANY (ARRAY['booked','waitlist','cancelled','late_cancelled']))
--   · class_bookings has cancelled_at, cancelled_by, promoted_at
--   · trg_class_bookings_stamp_cancel is BEFORE UPDATE FOR EACH ROW
--   · gym_classes has register_taken_at / register_taken_by, and
--     can_register_class() / mark_register_taken() both exist
--   · tenants has class_cancel_hours (integer), class_cancel_fee (numeric),
--     currency (text) — part 2615's source, which is what decides the word
--   · class_bookings is UNIQUE (class_id, user_id). That constraint is the
--     reason for the whole middle section of this file; see "re-booking".
--
-- And the defect itself, still live, word for word as part 1830 left it:
--
--     delete from class_bookings
--      where class_id = p_class and user_id = auth.uid()
--     returning status into v_was;
--
-- ── 1 · THE OLD-STATUS TRAP, and how it is solved ──────────────────────────
--
-- `v_was` gates the waitlist promotion: only a cancelled BOOKED seat frees a
-- place, and a member leaving the QUEUE must promote nobody. Part 1830 got that
-- fact for free, because a DELETE's `returning` hands back the row that was
-- removed — the old row is the only row there is.
--
-- An UPDATE's `returning` hands back the NEW row. Written as a one-liner,
-- `update … set status = 'cancelled' … returning status into v_was` sets
-- `v_was` to 'cancelled' on EVERY call, `v_was is distinct from 'booked'` is
-- then always true, and NO cancellation ever promotes anybody. Spell the gate
-- the other way round and every cancellation promotes somebody, including the
-- waitlister who just left the queue — which is the exact bug part 1830 was
-- written to remove. Two ways to write it, both silent, both wrong.
--
-- The fix is to stop asking the UPDATE for the answer. Immediately before it:
--
--     select cb.status into v_was
--       from class_bookings cb
--      where cb.class_id = p_class and cb.user_id = auth.uid()
--        for update;
--
-- `for update` is not decoration and it is not a performance note. It takes the
-- row lock and HOLDS IT to the end of the transaction, so between reading the
-- old status and writing the new one nothing else can move that row — not a
-- second tap from the same member on a flaky connection, not the console's
-- promote button, not a concurrent `promoteFromWaitlist`. Without it the read
-- and the write straddle a window in which the row's status can change, and the
-- promotion would be decided on a status the row no longer has. `select … into`
-- with no matching row leaves `v_was` null and raises nothing, which is the
-- "caller had no booking here" case and is handled explicitly.
--
-- ── 2 · Which word gets stored, and the boundary it is decided on ──────────
--
-- The source is part 2615's — `tenants.class_cancel_hours`, read through the
-- class's own tenant. A gym that has stated no notice period has
-- `class_cancel_hours` null, and a null window makes every cancellation plain
-- 'cancelled'. It does NOT fall back to 24, or to any other number: inventing a
-- window to charge inside is the thing src/lib/classCancel.ts refuses to do in
-- prose, and the database must not do it in SQL.
--
-- THE BOUNDARY IS COPIED FROM THE CLIENT, NOT RE-DERIVED. `cancelStanding` in
-- src/lib/classCancel.ts is
--
--     h = Math.max(0, Math.floor((starts - now) / 3_600_000))
--     h < policy.notice ? 'late_cancelled' : 'cancelled'
--
-- and that same function is what `classChargeLine` uses to tell the member
-- "Cancelling now is inside your gym's 12-hour notice. Your gym charges GBP
-- 8.00 for one." So the sentence the member reads and the word this file stores
-- MUST come from the same comparison, or a member is shown the fee sentence and
-- has an ordinary cancellation filed, or is told it is free and is charged.
--
-- The obvious SQL — `now() >= starts_at - make_interval(hours => v_hours)` —
-- does NOT agree with it. The client floors to whole hours first. With a
-- 12-hour notice and a class starting in 12 hours 40 minutes, the interval form
-- says "not yet late" and so does the floor (12 < 12 is false); but at 11 hours
-- 20 minutes the interval form says late and the floor says late too. They part
-- company only at the top of the hour — and "only at the boundary" is precisely
-- where a member taps, because the app has just told them how long they have.
-- So this reproduces the client's arithmetic exactly:
--
--     greatest(0, floor(extract(epoch from (starts_at - now())) / 3600.0))
--
-- `greatest(0, …)` for the class that has already started, matching
-- `Math.max(0, …)`: a member cancelling after the start is 0 hours out, which
-- is inside every stated window, which is the correct answer and the one the
-- confirmation screen has already given them.
--
-- ── 3 · cancelled_at / cancelled_by are NOT set here ───────────────────────
--
-- Verified against the live body of `class_bookings_stamp_cancel()`: it is
-- BEFORE UPDATE, it fires on the status transition, and it `coalesce`s both
-- columns so a caller that supplies its own values keeps them. Setting them by
-- hand in `cancel_class` would bypass nothing and add nothing — it would just
-- be a second place that has to agree with the first. There is no code for them
-- below and that is deliberate.
--
-- ── 4 · The promotion statement is untouched ───────────────────────────────
--
-- Character for character as part 1830 left it, capacity test and FIFO order
-- included. `promoted_at` is stamped by the same BEFORE trigger, so the
-- 'waitlist' → 'booked' overwrite stops being an erasure without this file
-- touching the statement that performs it.
--
-- Checked, because it is now reachable by a path it was not before:
-- `class_promotion_notify()` is AFTER UPDATE OF status on the same table, and
-- its live body returns early unless `old.status = 'waitlist' and new.status =
-- 'booked'`. A cancellation ('booked' → 'cancelled') does not fire it, and
-- neither does a re-book ('cancelled' → 'booked'). Nobody is told a place has
-- opened because somebody cancelled their own.
--
-- ── 5 · RE-BOOKING. The decision, and why it needed a table ────────────────
--
-- The brief for this lane said `book_class`'s `on conflict … do update set
-- status = excluded.status` would silently overwrite a 'late_cancelled' back to
-- 'booked'. THAT IS NO LONGER TRUE, and the live body says so. A later part
-- (the one that also added `book_class_for`'s equivalent) put this in front of
-- the insert:
--
--     select status into v_existing from class_bookings
--      where class_id = p_class and user_id = auth.uid();
--     if v_existing is not null then return v_existing; end if;
--
-- so the conflict branch is already unreachable on the ordinary path. The
-- defect is real and it is the opposite one: the moment cancelling stops
-- deleting, that guard sees 'cancelled', returns it, and A MEMBER WHO CANCELS A
-- CLASS CAN NEVER BOOK IT AGAIN. `book_class` would answer 'cancelled', which
-- src/ui/classes.tsx correctly treats as a refusal, and the member would tap
-- Book and watch nothing happen, for ever. Both `book_class` and
-- `book_class_for` have that guard; the front desk would be locked out too.
--
-- So re-booking has to be allowed. Which puts the real question: a member who
-- late-cancelled on Monday and re-booked on Tuesday has done TWO things, and
-- both are facts. Part 3060's own header names the two ways out — "the
-- cancellation belongs in its own row per occurrence, or `book_class` must
-- refuse to overwrite a terminal status and write a fresh booking instead".
--
-- A fresh booking row is not available. `class_bookings` is UNIQUE (class_id,
-- user_id) — confirmed live — and that constraint is load-bearing in at least
-- six places: `book_class` and `book_class_for` both read the member's row with
-- a bare `select … into`, which raises the moment there are two;
-- `set_class_attendance` ticks "the" row; `class_cancel_policy` tests for one;
-- `class_roster` would list the same member twice on a register; the console's
-- promote and demote buttons write "the" row directly. Dropping a unique
-- constraint that six readers assume is not a change this review can make
-- safely, and doing it quietly would be a worse defect than the one being
-- fixed.
--
-- THE DECISION: the booking row keeps the CURRENT standing, and every
-- cancellation is appended to a table of its own. Re-booking is then an
-- ordinary transition on the booking row, the BEFORE trigger clears
-- `cancelled_at` / `cancelled_by` on it exactly as part 3060 wrote it to, and
-- the cancellation is not lost because it was never only on that row.
--
-- The log stores the gym's fee, currency and notice period AS THEY WERE AT THE
-- MOMENT, and this is the second reason it is a table and not a flag. A gym can
-- raise its late-cancellation fee next month. The fee owed is the fee that was
-- on the record when the member cancelled, and a row that merely says
-- 'late_cancelled' forces every later reader to re-derive an amount from
-- today's policy — which would bill the member a price nobody ever showed them.
-- White-label means per-tenant currency, so the currency is stored beside the
-- figure and never assumed.
--
-- ── 6 · class_counts() needs NO change, and here is the evidence ───────────
--
-- The brief was right to insist this be checked and right that a cancellation
-- which does not free the seat is worse than the erasure. It is already
-- correct. The live body is
--
--     count(*) filter (where cb.status = 'booked')::bigint   as booked,
--     count(*) filter (where cb.status = 'waitlist')::bigint as waiting
--
-- so a row whose status is 'cancelled' or 'late_cancelled' is counted in
-- NEITHER bucket, and the seat is handed straight back. It counted rows that no
-- longer existed and it now counts rows whose status says cancelled, and the
-- answer is the same number by construction rather than by coincidence — part
-- 210 rewrote it from a `where` to a `filter` for an unrelated reason (a class
-- of nothing but waitlisters was vanishing from the answer) and that rewrite is
-- what makes it correct here. Nothing in this file touches it.
--
-- ── 7 · The other readers, checked one at a time ───────────────────────────
--
-- Every function in the live database whose body names `class_bookings`, and
-- what a cancelled row does to it:
--
--   class_counts               correct already, see above. Untouched.
--   class_roster               returns `cb.status` verbatim, and
--                              src/lib/classRegister.ts already classifies all
--                              four words (its `isCancelled` and its
--                              `unknownStanding` diagnostic). A coach SHOULD
--                              see that Jane cancelled. Untouched, deliberately.
--   class_cancel_policy        `status` is not filtered, on purpose and with a
--                              comment saying so. Untouched.
--   my_class_history           a class you booked and cancelled is still a
--                              class you booked. Untouched.
--   book_class                 FIXED below — would refuse for ever.
--   book_class_for             FIXED below — same, from the front desk.
--   class_attendance_summary   FIXED below — `status <> 'booked'` becomes wrong
--                              the instant a third word exists. This is exactly
--                              the defect Lane 38 removed from
--                              src/lib/classRegister.ts, in SQL, unfixed.
--   class_cancelled_notify     FIXED below — would tell a member who had
--                              already cancelled that "your booking is kept on
--                              the record", about a booking they gave up.
--   set_class_attendance       FIXED below — would let a coach tick in a
--                              cancelled booking, and the part 3060 register
--                              trigger would then date the register off it.
--
-- ── 8 · What this part CANNOT fix, and must not be applied without ─────────
--
-- src/ui/classes.tsx is not this lane's file and is named here because applying
-- this part without the change below ships a member-facing regression.
--
-- Line 312 is
--
--     minePage.rows.forEach((b) => { ms[String(b.class_id)] = b.status; });
--
-- over a `.select('class_id, status').eq('user_id', id)` — every booking row
-- the member has, with no status filter, into `myStatus`, whose type is
-- `ClassBookingStatus = 'booked' | 'waitlist'` (src/lib/classesMock.ts:15).
-- Today a cancelled booking has no row, so the key disappears and the class
-- goes back to being bookable. After this part the row survives with status
-- 'cancelled', the key is present and truthy, and the class the member just
-- cancelled renders as one they still hold. It is a one-line fix — filter the
-- rows to `b.status === 'booked' || b.status === 'waitlist'` before building
-- `ms`, and the same at the cache read on line 219 — and it belongs to whoever
-- owns that file.
--
-- src/lib/classOff.ts has the same shape as `class_cancelled_notify` below: it
-- selects `id, user_id, class_id` with no status filter and messages everybody
-- who has a row when a class is called off. Same one-line fix, same argument,
-- also not this lane's file.
--
-- ── 9 · What is NOT recoverable ────────────────────────────────────────────
--
-- Part 3060 said it and it stays true: every class cancellation every member
-- has ever made was removed by an ordinary DELETE with no audit table behind
-- it, and nothing in this file reconstructs one. `class_booking_cancellations`
-- starts empty and its first row will be the first cancellation after this part
-- is applied. Any screen that counts cancellations must say what its window
-- starts at.
--
-- Idempotent throughout: `create table if not exists`, `add column if not
-- exists`, `create or replace`, `drop policy if exists` before each `create
-- policy`, `create index if not exists`. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1 · the cancellation, in a row of its own ──────────────────────────────

create table if not exists public.class_booking_cancellations (
  id            uuid primary key default gen_random_uuid(),
  class_id      uuid not null references public.gym_classes(id) on delete cascade,
  user_id       uuid not null references public.profiles(id)    on delete cascade,
  -- What they gave up. A seat and a place in a queue are not the same loss, and
  -- only the first of them freed anything.
  was_status    text not null check (was_status in ('booked', 'waitlist')),
  -- Spelled exactly as class_bookings.status and sessions.outcome spell them.
  status        text not null check (status in ('cancelled', 'late_cancelled')),
  cancelled_at  timestamptz not null default now(),
  cancelled_by  uuid references auth.users(id) on delete set null,
  -- The policy AS IT WAS. See §5 of the header: the fee owed is the fee that
  -- was on the gym's record at the moment, not the one it charges next month.
  notice_hours  integer,
  fee           numeric,
  currency      text
);

comment on table public.class_booking_cancellations is
  'Every class cancellation, appended, one row per occurrence. The booking row '
  'carries the CURRENT standing and this carries the history, because '
  'class_bookings is unique on (class_id, user_id) and a member who cancels and '
  're-books has done two things that both happened. Nothing updates or deletes '
  'a row here: it is written by trg_class_bookings_log_cancel and by nothing '
  'else. EMPTY BEFORE PART 3180 — cancel_class DELETEd from part 02 until then '
  'and those cancellations are gone, so any count taken from this table must '
  'state the date its window opens.';
comment on column public.class_booking_cancellations.was_status is
  'The standing that was given up: ''booked'' (a seat, which freed one) or '
  '''waitlist'' (a place in the queue, which freed nothing). This is the fact '
  'the waitlist promotion in cancel_class is decided on, recorded so a later '
  'reader does not have to guess why one cancellation promoted somebody and '
  'another did not.';
comment on column public.class_booking_cancellations.notice_hours is
  'The gym''s stated notice period at the moment of cancelling, from '
  'tenants.class_cancel_hours. NULL MEANS THE GYM HAD STATED NONE — not '
  'unknown, and not zero. A stated 0 is a gym saying nothing is ever late, '
  'which is a different sentence and a different number.';
comment on column public.class_booking_cancellations.fee is
  'The gym''s stated late-cancellation fee at the moment, from '
  'tenants.class_cancel_fee, whatever the status. NULL means unstated; 0 means '
  'stated as free. Meaningless without `currency`, and never to be rendered '
  'with a currency taken from anywhere else.';
comment on column public.class_booking_cancellations.currency is
  'The gym''s unit at the moment, from tenants.currency. NULL means the gym had '
  'no currency on record, in which case `fee` is a figure nothing may print — '
  'the same refusal src/lib/classCancel.ts makes in words. There is no default '
  'currency anywhere in this product.';

-- The foreign keys, indexed. An unindexed FK is what get_advisors reports and,
-- more to the point, `where user_id = …` is how a member reads their own
-- history and `where class_id = …` is how a gym reads a class's.
create index if not exists class_booking_cancellations_class_idx
  on public.class_booking_cancellations (class_id, cancelled_at desc);
create index if not exists class_booking_cancellations_user_idx
  on public.class_booking_cancellations (user_id, cancelled_at desc);
create index if not exists class_booking_cancellations_by_idx
  on public.class_booking_cancellations (cancelled_by);

alter table public.class_booking_cancellations enable row level security;

-- Two readers and no writer. The member, about themselves — this is the row
-- behind a fee they may be asked to pay, and part 2615 already took the
-- position that somebody who has cancelled is entitled to know what it cost.
drop policy if exists cbc_own_r on public.class_booking_cancellations;
create policy cbc_own_r on public.class_booking_cancellations
  for select using (user_id = (select auth.uid()));

-- And this class's gym staff, scoped the same way can_register_class() scopes
-- the register: tenant staff, or the coach named on the class. Written out
-- rather than calling that helper, because a policy whose function the querying
-- role may not execute fails the read outright — and because an RLS policy must
-- read as its own sentence.
drop policy if exists cbc_staff_r on public.class_booking_cancellations;
create policy cbc_staff_r on public.class_booking_cancellations
  for select using (
    exists (
      select 1 from public.gym_classes gc
       where gc.id = class_booking_cancellations.class_id
         and ( ( gc.tenant_id is not null
                 and gc.tenant_id = my_tenant()
                 and my_role() in ('trainer', 'owner') )
               or gc.trainer_id = (select auth.uid()) )
    )
  );

-- No INSERT, UPDATE or DELETE policy, deliberately. The only writer is the
-- SECURITY DEFINER trigger below, which runs as the table's owner and is
-- therefore not subject to these policies. A client that could insert here
-- could assert a cancellation that never happened and a fee nobody owes; a
-- client that could delete could take one back, which is the erasure this whole
-- part exists to stop, arriving through the front door.
-- Supabase ships ALTER DEFAULT PRIVILEGES granting ALL on a new table in schema
-- `public` to `anon` AND to `authenticated`, separately. So `authenticated` is
-- revoked too and then given back exactly SELECT: RLS would refuse the writes
-- anyway, having no policy that permits one, but a table whose only defence
-- against a client INSERT is the absence of a policy is one `create policy` away
-- from accepting forged cancellations. Two locks.
revoke all on public.class_booking_cancellations from public, anon, authenticated;
grant select on public.class_booking_cancellations to authenticated;

-- Table-wide SELECT, not column-level, so a column added to this table by a
-- later part is readable the moment it exists — the failure check:grants §2
-- exists for, declined here by construction rather than by an enumeration
-- somebody has to remember to extend.


-- ── 2 · the appender ───────────────────────────────────────────────────────
--
-- A trigger and not a line inside `cancel_class`, because `cancel_class` is not
-- the only thing that can move a booking into a cancelled status. The studio
-- console writes `class_bookings` directly under RLS (src/lib/gymSchedule.ts),
-- and anything that does so must be recorded by the same mechanism or the log
-- is a log of one caller's opinion.
--
-- AFTER, not BEFORE: this writes a second table, and a BEFORE trigger would be
-- doing so before the change that justifies it has been made. The same argument
-- part 3060 wrote out for gym_classes_stamp_register().
--
-- Only the transition INTO a cancelled status FROM a live one is recorded.
-- Re-saving a row that was already cancelled appends nothing — a second UPDATE
-- is not a second cancellation — and a transition from one cancelled word to
-- the other is an owner correcting the standing of a cancellation that is
-- already on the record, not a new one.
create or replace function public.class_bookings_log_cancel()
returns trigger
language plpgsql
security definer
-- Pinned for the reason check:definer states: an unpinned definer body resolves
-- every unqualified name against the CALLER's search_path.
set search_path to 'public', 'pg_temp'
as $$
declare
  v_tenant uuid;
  v_hours  integer;
  v_fee    numeric;
  v_ccy    text;
begin
  if not ( old.status in ('booked', 'waitlist')
           and new.status in ('cancelled', 'late_cancelled') ) then
    return null;
  end if;

  -- The gym's policy as it stands right now. Read through the class, because
  -- `class_bookings` has no tenant of its own — it takes the tenant of the
  -- class it is against, which is the note src/lib/live.ts makes about this
  -- table for a different reason.
  select gc.tenant_id into v_tenant
    from gym_classes gc where gc.id = new.class_id;

  if v_tenant is not null then
    select t.class_cancel_hours, t.class_cancel_fee, t.currency
      into v_hours, v_fee, v_ccy
      from tenants t where t.id = v_tenant;
  end if;

  insert into class_booking_cancellations
    (class_id, user_id, was_status, status, cancelled_at, cancelled_by,
     notice_hours, fee, currency)
  values
    (new.class_id, new.user_id, old.status, new.status,
     -- The BEFORE trigger has already stamped these on `new`. Taken from there
     -- rather than calling now() and auth.uid() again, so the row on the
     -- booking and the row in the log carry the SAME moment and the SAME
     -- author — two clocks a millisecond apart is how a dispute becomes
     -- unanswerable. `coalesce` only for the case a caller wrote the status
     -- past the trigger, which part 3060's own comment calls a defect.
     coalesce(new.cancelled_at, now()),
     new.cancelled_by,
     v_hours, v_fee, v_ccy);

  return null;
end $$;

drop trigger if exists trg_class_bookings_log_cancel on public.class_bookings;
create trigger trg_class_bookings_log_cancel
  after update of status on public.class_bookings
  for each row
  when (new.status is distinct from old.status)
  execute function public.class_bookings_log_cancel();

-- A trigger function is called by the executor and never by a role, so EXECUTE
-- on it is never checked when it fires — and the grant PostgreSQL hands PUBLIC
-- on a new function is pure surface, which in a Supabase project includes anon.
revoke all on function public.class_bookings_log_cancel() from public, anon;


-- ── 3 · cancel_class stops deleting ────────────────────────────────────────
--
-- The signature and return type are character-for-character the live ones. An
-- overload would leave PostgREST unable to resolve `cancel_class` at all.

create or replace function public.cancel_class(p_class uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_was    text;
  v_new    text;
  v_starts timestamptz;
  v_tenant uuid;
  v_hours  integer;
  v_left   integer;
begin
  -- THE OLD STATUS, READ AND LOCKED BEFORE ANYTHING CHANGES IT. See §1 of the
  -- header: `update … returning` hands back the NEW row, so the promotion gate
  -- below cannot be fed from it. `for update` holds the row to the end of the
  -- transaction, so the status this decision is made on is still the row's
  -- status when the decision is acted on.
  select cb.status into v_was
    from class_bookings cb
   where cb.class_id = p_class and cb.user_id = auth.uid()
     for update;

  -- No booking here at all, or one that has already been cancelled. Returns
  -- void without error and writes nothing, which is what the previous body did
  -- for the first case and is the honest answer to the second: cancelling a
  -- cancellation is not an event.
  if v_was is null or v_was not in ('booked', 'waitlist') then
    return;
  end if;

  -- Which word. The class's own gym, and part 2615's columns on it.
  select gc.starts_at, gc.tenant_id into v_starts, v_tenant
    from gym_classes gc where gc.id = p_class;

  if v_tenant is not null then
    select t.class_cancel_hours into v_hours
      from tenants t where t.id = v_tenant;
  end if;

  -- `cancelStanding` in src/lib/classCancel.ts, transcribed. Whole hours,
  -- floored, floored at zero, and `<` and not `<=` — so a gym that has stated a
  -- notice of 0 makes nothing late, which is the sentence that function already
  -- gives for it. See §2 of the header for why the obvious interval arithmetic
  -- is the wrong shape.
  v_new := 'cancelled';
  if v_hours is not null and v_starts is not null then
    v_left := greatest(0, floor(extract(epoch from (v_starts - now())) / 3600.0))::int;
    if v_left < v_hours then
      v_new := 'late_cancelled';
    end if;
  end if;
  -- A gym that has stated NO notice period keeps 'cancelled'. There is no
  -- default window here and there must never be one.

  -- `cancelled_at` and `cancelled_by` are absent on purpose: the BEFORE trigger
  -- part 3060 installed stamps both on this transition, and a second writer
  -- would only be a second thing to keep in agreement. The AFTER trigger above
  -- appends the log row off the same statement.
  --
  -- The status predicate is repeated on the UPDATE as well as tested above.
  -- Belt and braces under the lock, and it is what makes this statement safe to
  -- read on its own: it can only ever move a LIVE booking to a cancelled one.
  update class_bookings
     set status = v_new
   where class_id = p_class
     and user_id = auth.uid()
     and status in ('booked', 'waitlist');

  -- THE GATE. Unchanged in meaning from part 1830, and now fed from `v_was`
  -- above rather than from a `returning` that would have lied. A member leaving
  -- the QUEUE frees nothing and promotes nobody.
  if v_was is distinct from 'booked' then
    return;
  end if;

  -- Unchanged from here down, capacity test and FIFO order included. Part
  -- 3060's BEFORE trigger stamps `promoted_at` on the row this moves, so the
  -- overwrite stops being an erasure without this statement being touched.
  update class_bookings set status = 'booked'
   where id = (
     select cb.id from class_bookings cb join gym_classes gc on gc.id = cb.class_id
     where cb.class_id = p_class and cb.status = 'waitlist'
       and (select count(*) from class_bookings b where b.class_id = p_class and b.status = 'booked') < gc.capacity
     order by cb.created_at asc limit 1
   );
end; $function$;


-- ── 4 · book_class lets a cancelled seat be taken again ────────────────────
--
-- See §5 of the header. Without this change a member who cancels can never
-- book that class again, because `v_existing is not null` catches 'cancelled'
-- and hands it straight back as the answer.
--
-- Everything else is the live body, unchanged: the class row lock, the tenant
-- check that makes another gym's class indistinguishable from a missing one,
-- and the capacity count read under that lock.

create or replace function public.book_class(p_class uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_cap int; v_count int; v_status text; v_tenant uuid; v_existing text;
begin
  perform 1 from gym_classes where id = p_class for update;
  select capacity, tenant_id into v_cap, v_tenant from gym_classes where id = p_class;
  if v_cap is null then return 'notfound'; end if;
  -- A class outside your gym is indistinguishable from one that is not there.
  if v_tenant is distinct from my_tenant() then return 'notfound'; end if;

  select status into v_existing from class_bookings
   where class_id = p_class and user_id = auth.uid();

  -- A place already given is not taken back by a second tap. The list is now
  -- written out rather than `is not null`: a CANCELLED row is a row, and
  -- returning 'cancelled' here would answer every future tap with a refusal
  -- src/ui/classes.tsx correctly renders as "nothing happened".
  if v_existing in ('booked', 'waitlist') then return v_existing; end if;

  select count(*) into v_count from class_bookings where class_id = p_class and status = 'booked';
  v_status := case when v_count < v_cap then 'booked' else 'waitlist' end;

  -- `v_existing` is either null (never booked) or a cancelled word, and the
  -- conflict branch is the second of those. Re-booking overwrites the standing
  -- on this row and does NOT erase the cancellation, which was appended to
  -- class_booking_cancellations when it happened and is not on this row to
  -- lose. Part 3060's BEFORE trigger clears `cancelled_at` / `cancelled_by`
  -- here, which is correct and is the whole reason the log exists.
  insert into class_bookings (class_id, user_id, status) values (p_class, auth.uid(), v_status)
    on conflict (class_id, user_id) do update set status = excluded.status;
  return v_status;
end; $function$;


-- ── 5 · book_class_for, the same change at the front desk ──────────────────
--
-- Identical defect and it locks out the person who cannot work around it: a
-- member who cancelled by accident rings the gym, and the desk cannot put them
-- back on either. Its insert has no `on conflict` clause at all, so after this
-- part it would not merely refuse — it would raise a unique violation on the
-- surviving cancelled row.
--
-- Everything else is the live body: the class lock, the staff check that raises
-- rather than returning, and the membership check.

create or replace function public.book_class_for(p_class uuid, p_user uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid;
  v_cap int;
  v_count int;
  v_status text;
  v_existing text;
begin
  -- The lock comes first, exactly as it does in `book_class`: the count below
  -- is only capacity-safe if nothing else can book between reading it and
  -- writing.
  perform 1 from gym_classes where id = p_class for update;

  select gc.tenant_id, gc.capacity into v_tenant, v_cap
    from gym_classes gc where gc.id = p_class;
  if v_tenant is null then
    -- A class with no tenant is unscoped, and unscoped fails closed — the same
    -- position part 165 took on the staff read policy.
    return 'notfound';
  end if;

  if not (v_tenant = my_tenant() and my_role() in ('trainer', 'owner')) then
    raise exception 'Only this gym''s staff can book somebody onto its classes.'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from memberships m
     where m.tenant_id = v_tenant and m.member_id = p_user
  ) then
    raise exception 'That person is not on this gym''s roster, so they cannot be put on its register.'
      using errcode = 'foreign_key_violation';
  end if;

  select cb.status into v_existing
    from class_bookings cb
   where cb.class_id = p_class and cb.user_id = p_user;
  -- Already on it. Their place is not re-decided by a second click — but a
  -- CANCELLED row is not a place, and the desk must be able to give it back.
  if v_existing in ('booked', 'waitlist') then
    return v_existing;
  end if;

  select count(*) into v_count
    from class_bookings where class_id = p_class and status = 'booked';
  v_status := case when v_count < coalesce(v_cap, 0) then 'booked' else 'waitlist' end;

  -- `on conflict` is new and is not optional: the row this insert used to be
  -- sure did not exist can now exist, holding a cancelled status.
  insert into class_bookings (class_id, user_id, status)
  values (p_class, p_user, v_status)
  on conflict (class_id, user_id) do update set status = excluded.status;

  return v_status;
end $function$;


-- ── 6 · the readers that assumed the row was live ──────────────────────────
--
-- `class_attendance_summary`: `count(cb.attended_at) filter (where cb.status <>
-- 'booked')` was an exact synonym for "of the waitlist" while the column held
-- two words. It is not one now. A member who was ticked in at the door and
-- later had their booking cancelled by the desk keeps `attended_at`, and would
-- be counted as a walk-in the gym is paid for — a cancelled booking counted as
-- attendance. `= 'waitlist'` says what was always meant.
--
-- This is the same defect Lane 38 removed from src/lib/classRegister.ts, which
-- read `status !== 'booked'` as the waiting queue. One vocabulary, two
-- languages, the same wrong test in each.
--
-- Everything else is the live body, including the `<> 'cancelled'` on the
-- CLASS's own status, which is a different column on a different table and is
-- about a class that did not run.

create or replace function public.class_attendance_summary(p_from timestamp with time zone, p_to timestamp with time zone)
returns table(class_id uuid, title text, kind text, branch text, trainer_id uuid, trainer_name text, starts_at timestamp with time zone, capacity integer, booked integer, attended integer, waitlist_attended integer)
language sql
security definer
set search_path to 'public'
as $function$
  select gc.id, gc.title, gc.kind, gc.branch, gc.trainer_id,
         coalesce(tp.full_name, 'Trainer') as trainer_name, gc.starts_at,
         coalesce(gc.capacity, 0)::int as capacity,
         count(cb.id) filter (where cb.status = 'booked')::int as booked,
         -- Of THOSE BOOKED, how many were marked present. The filter is the
         -- whole fix: without it a waitlister ticked in at the door counted
         -- against a denominator they were never in.
         count(cb.attended_at) filter (where cb.status = 'booked')::int as attended,
         -- And the people who came off the waitlist and trained. Counted apart
         -- rather than dropped: they are real attendance the gym pays for, and
         -- they belong nowhere near the numerator of a show rate. `= 'waitlist'`
         -- and no longer `<> 'booked'` — see this section's note.
         count(cb.attended_at) filter (where cb.status = 'waitlist')::int as waitlist_attended
  from gym_classes gc
  left join class_bookings cb on cb.class_id = gc.id
  left join profiles tp on tp.id = gc.trainer_id
  where gc.starts_at >= p_from and gc.starts_at < p_to
    -- A class that was called off is not a class that ran.
    and coalesce(gc.status, '') <> 'cancelled'
    and ( gc.trainer_id = auth.uid()
          -- the caller must own THIS class's gym, not merely be an owner
          or is_owner_of(gc.tenant_id) )
  group by gc.id, tp.full_name
  order by gc.starts_at desc;
$function$;

-- `class_cancelled_notify`: when a GYM calls a class off it messages everybody
-- with a booking row on it. Everybody now includes the member who cancelled
-- their own seat last Tuesday, and the sentence they would get is "Your booking
-- is kept on the record and there is nothing for you to do" — about a booking
-- they gave up. Telling somebody a class they are not in is not running is not
-- news; it is the app revealing it has lost track of them.
--
-- Everything else is the live body.

create or replace function public.class_cancelled_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_when text;
  v_why  text;
begin
  if not (coalesce(old.status, 'scheduled') <> 'cancelled'
          and new.status = 'cancelled') then
    return new;
  end if;

  v_when := to_char(new.starts_at, 'FMDay FMDD FMMon at HH24:MI');
  v_why := nullif(btrim(coalesce(new.cancel_reason, '')), '');

  insert into public.notifications (user_id, title, body, icon, route, push_by)
  select
    cb.user_id,
    'A class you booked is not running',
    left(
      '“' || coalesce(nullif(btrim(new.title), ''), 'A class') || '” on ' || v_when
      || ' has been called off'
      || coalesce(': ' || v_why, '')
      || '. '
      || case when cb.status = 'waitlist'
              then 'You were on the waiting list for it, so there is nothing to cancel.'
              else 'Your booking is kept on the record and there is nothing for you to do.'
         end
      || ' Your Classes screen has the rest of the timetable.',
      500)
    ,
    'calendar',
    '/(client)/classes',
    'caller'
  from public.class_bookings cb
  where cb.class_id = new.id
    -- Only the people who still hold something. A member who cancelled their
    -- own booking is not waiting on this class and is not to be told about it.
    and cb.status in ('booked', 'waitlist')
    and cb.user_id is distinct from auth.uid();

  return new;
end;
$function$;

-- `set_class_attendance`: the register may only be taken against a live
-- booking. Without the predicate a coach could tick in a member who had
-- cancelled — and part 3060's AFTER trigger fires on `attended_at`, so that
-- tick would also stamp `register_taken_at` on the class and turn every other
-- un-ticked member on it into a recorded no-show, off a row that is not a
-- booking. The boolean it returns is `row_count > 0`, so a coach who tries it
-- gets an honest false rather than a silent success.
--
-- Part 3060 said it was leaving this function alone because rewriting a body
-- can revert whatever else is in flight against it. The body below is the LIVE
-- one, read from the database today, with one predicate added and its guard
-- left exactly as part 460 wrote it.

create or replace function public.set_class_attendance(p_class uuid, p_user uuid, p_present boolean)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_rows int;
begin
  if not exists (
    select 1 from gym_classes gc
    where gc.id = p_class
      and ( ( gc.tenant_id is not null
              and gc.tenant_id = my_tenant()
              and my_role() in ('trainer', 'owner') )
            or gc.trainer_id = auth.uid() )
  ) then
    raise exception 'this class is not yours to register';
  end if;

  update class_bookings
     set attended_at = case when p_present then now() else null end
   where class_id = p_class and user_id = p_user
     and status in ('booked', 'waitlist');

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end; $function$;


-- ── 7 · grants ─────────────────────────────────────────────────────────────
--
-- Every function above already existed, so its grants are as parts 02, 38, 195,
-- 460 and 492 left them. Restated in full because `create or replace` on a
-- function does not reset privileges — but getting that wrong in the other
-- direction is how part 1901 handed a definer function to `anon`, and a REVOKE
-- naming `anon` is the only statement that settles the question: Supabase ships
-- ALTER DEFAULT PRIVILEGES granting EXECUTE to `anon` and to `authenticated`
-- separately, so revoking from PUBLIC is not revoking from anon.

revoke all on function public.cancel_class(uuid) from public, anon;
revoke all on function public.book_class(uuid) from public, anon;
revoke all on function public.book_class_for(uuid, uuid) from public, anon;
revoke all on function public.class_attendance_summary(timestamptz, timestamptz) from public, anon;
revoke all on function public.set_class_attendance(uuid, uuid, boolean) from public, anon;
revoke all on function public.class_cancelled_notify() from public, anon;

grant execute on function public.cancel_class(uuid) to authenticated;
grant execute on function public.book_class(uuid) to authenticated;
grant execute on function public.book_class_for(uuid, uuid) to authenticated;
grant execute on function public.class_attendance_summary(timestamptz, timestamptz) to authenticated;
grant execute on function public.set_class_attendance(uuid, uuid, boolean) to authenticated;

comment on function public.cancel_class(uuid) is
  'Gives up the caller''s own place on a class. RECORDS the cancellation as '
  '''cancelled'' or ''late_cancelled'' — it DELETEd the row from part 02 until '
  'part 3180, which is why no cancellation before that date exists anywhere. '
  'The word is decided by tenants.class_cancel_hours against the class''s '
  'start, floored to whole hours exactly as cancelStanding in '
  'src/lib/classCancel.ts floors it, so the sentence the member is shown and '
  'the word that is stored can never disagree. A gym that has stated no notice '
  'period gets ''cancelled'': there is no default window. cancelled_at and '
  'cancelled_by are stamped by the part 3060 trigger, the log row is appended '
  'by the part 3180 trigger, and the waitlist promotion runs only when a BOOKED '
  'seat was given up — decided on the status read under a row lock BEFORE the '
  'update, because an UPDATE''s RETURNING hands back the new row.';
