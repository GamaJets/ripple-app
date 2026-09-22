-- ═══════════════════════════════════════════════════════════════════════════
-- A cancelled class booking was an erased one, and a no-show was a silence.
--
-- APPLIED to the live database on 13 Sep 2026 as part_3060_class_cancellation_record.
--
-- ── The defect ─────────────────────────────────────────────────────────────
--
-- `class_bookings` has carried the same two-value status since part 02:
--
--     status text not null default 'booked' check (status in ('booked','waitlist'))
--
-- and `cancel_class(p_class)` — part 02, re-scoped by part 38, gated by part
-- 1830 — still begins:
--
--     delete from class_bookings where class_id = p_class and user_id = auth.uid()
--
-- So of the three facts a gym's class register is actually read for, this
-- schema can record none of them:
--
--   · CANCELLED. The row is destroyed. Not marked, not moved, not archived —
--     DELETEd, by the ordinary member-facing path, with no trace anywhere that
--     a seat was ever held. The member who books every Tuesday and drops out of
--     nine of them looks identical to the member who has never booked.
--
--   · LATE CANCELLED. Same delete, and the gym has already been given a place
--     to state what one costs: part 2615 put `notice_hours`, `fee` and
--     `currency` on the gym and `class_cancel_policy()` hands them to the app,
--     which src/lib/classCancel.ts renders as "Cancelling now is inside your
--     gym's 12-hour notice. Your gym charges GBP 8.00 for one." That sentence
--     is true, the policy is real, and there has never been a row anywhere that
--     says the late cancellation HAPPENED. A gym cannot charge a fee it has no
--     record of, and this product tells the member it may be charged.
--
--   · NO SHOW. `set_class_attendance` (part 2330) writes
--     `attended_at = case when p_present then now() else null end`, and nothing
--     records that a register was taken at all. So `attended_at is null` means
--     BOTH "this member did not turn up" and "no coach ever opened the
--     register", and no read anywhere can separate them. That is the actual
--     bug in the attendance half: not a missing value, an OVERLOADED one.
--
-- The waitlist promotion is recorded, and it is recorded as an overwrite:
-- `update class_bookings set status = 'booked'` on the head of the queue. The
-- member who sat sixth in a queue and got in at the last minute, and the member
-- who booked the moment the class opened, are afterwards the same row.
--
-- This is the one house rule this schema contradicts outright. A correction is
-- a second recorded fact, never an erasure. `gym_costs` (part 700) is the
-- worked example on the money side; `gym_invoice_chases` (part 2820) is the
-- same argument about an event nobody could evidence. Here the database
-- enforces the opposite.
--
-- ── The vocabulary is BORROWED, not invented ───────────────────────────────
--
-- The one-to-one side already answers this exact question and has since part
-- 33. `sessions.outcome` is
--
--     check (outcome is null or outcome in ('completed','no_show','cancelled','late_cancelled'))
--
-- and `pastVerdict` in src/lib/sessionHistory.ts is the single reader, mapping
-- those onto `delivered | missed | cancelled | late_cancelled | unmarked`.
--
-- So the two words this part adds to `class_bookings.status` are 'cancelled'
-- and 'late_cancelled', SPELLED EXACTLY as `sessions.outcome` spells them. Not
-- 'canceled', not 'late-cancelled', not 'cancelled_late'. A second spelling of
-- the same fact is its own defect: it means every report that wants "how many
-- cancellations across this gym" has to know two vocabularies and a screen that
-- learns one of them is wrong half the time.
--
-- ── Why 'no_show' is NOT a status value ────────────────────────────────────
--
-- It is the obvious fourth word and it would be wrong, and getting this wrong
-- is exactly the failure the defect above already is: a column that means two
-- things.
--
-- `status` is the standing of the BOOKING — what claim this member has on a
-- seat. A no-show made no claim change. They booked, they did not cancel, they
-- held the seat, the seat went unused: `status` stayed 'booked' and that is the
-- true answer. A no-show is what the REGISTER says about a booking that stayed
-- 'booked', and it is derived, unambiguously, from two facts that are each
-- recorded once:
--
--     status = 'booked'  and  attended_at is null  and  the register WAS taken
--
-- Writing 'no_show' into `status` would also destroy the thing it claims to
-- record. `class_counts()` counts `filter (where cb.status = 'booked')`, so the
-- moment a coach marked a no-show the class would report a seat it never got
-- back, and the gym's fill rate would improve every time somebody failed to
-- turn up. The seat WAS taken. `status` must go on saying so.
--
-- ── The no-show marker: on the CLASS, not on the booking ───────────────────
--
-- Two candidates, and the choice matters more than it looks.
--
--   (a) a marker on the BOOKING — `no_show_at`, beside `attended_at`.
--   (b) a marker on the CLASS — `register_taken_at`, saying the register was
--       taken, which makes every un-ticked booking on it a no-show.
--
-- (b), for four reasons and the third is decisive:
--
--   1 · Taking a register is ONE event. One coach, one room, one moment. (a)
--       stores that single fact N times, once per member, and a set of N rows
--       that must agree is a set of N rows that can disagree.
--
--   2 · (a) admits a contradiction the database cannot refuse cheaply:
--       `attended_at` and `no_show_at` both set. (b) has no such state.
--
--   3 · COACHES TICK ATTENDEES. They do not tick absentees. Under (a) the
--       eight who came get `attended_at` and the four who did not get nothing —
--       `no_show_at` stays null on exactly the four rows it was added for, and
--       the ambiguity survives untouched under a new column name. That is the
--       "third ambiguous column" failure, and (a) walks straight into it. Under
--       (b) the coach's ordinary work — ticking the eight — is itself the
--       evidence the register was taken, and the four resolve for free.
--
--   4 · It answers the question the coach actually has, which is about the
--       class: "did anyone take this register?" A gym auditing last month wants
--       the classes nobody registered, not a per-member scan for absent rows.
--
-- The cost of (b) is stated rather than hidden: a class where the register was
-- taken and NOBODY attended produces no `attended_at` write, so the trigger
-- below never fires and the class reads 'not taken'. That is why
-- `mark_register_taken()` exists — an explicit "I took this register" a screen
-- can call. Until a screen calls it, that class stays UNMARKED, which is the
-- honest answer and not a guess in either direction.
--
-- ── Widening a CHECK on a table that has rows ──────────────────────────────
--
-- The column check from part 02 is unnamed in the source, so PostgreSQL named
-- it `class_bookings_status_check`. Widening means DROP then ADD, and ADD
-- re-validates every existing row.
--
-- RUN THIS FIRST, on the target database:
--
--     select status, count(*) from public.class_bookings group by status order by 2 desc;
--
-- Every row returned must have a status in
-- ('booked','waitlist','cancelled','late_cancelled'). Since the OLD constraint
-- was narrower than the new one, and was enforced, this should be exactly two
-- rows — 'booked' and 'waitlist'. If it is not, the constraint was dropped by
-- hand at some point and rows were written past it.
--
-- IF THE ADD FAILS it raises 23514 (check_violation) naming
-- `class_bookings_status_check`. The DROP and the ADD are inside one DO block,
-- which is one statement and therefore atomic: the failure rolls the DROP back
-- with it, and the table is left with the constraint it started with rather
-- than with none. Nothing is half-applied and nothing further in this file has
-- run. The operator then resolves the offending rows — they are a fact somebody
-- recorded and are not to be deleted — and re-runs this part.
--
-- Everything else here is `add column if not exists` / `create ... if not
-- exists` / `create or replace`. Idempotent; safe to re-run.
--
-- ── WHAT MUST CHANGE IN cancel_class, AND WHAT IS NOT RECOVERABLE ──────────
--
-- THIS PART DOES NOT CHANGE `cancel_class`. Changing a destructive RPC is its
-- own review. The change it needs is exactly this, and no more:
--
--   1 · `delete from class_bookings where class_id = p_class and user_id =
--       auth.uid() returning status into v_was`
--       becomes
--       `update class_bookings set status = case when <inside the gym's notice
--        window> then 'late_cancelled' else 'cancelled' end
--         where class_id = p_class and user_id = auth.uid()
--           and status in ('booked','waitlist')
--        returning status into v_was`
--       — and `v_was` must be captured from the OLD row, so the `returning`
--       has to read the pre-update value or the promotion gate below breaks.
--       `update ... returning` returns the NEW row, so the old status must be
--       read into `v_was` by a `select ... for update` immediately before it.
--       That single detail is why this is not a one-line change and why it is
--       not being made here.
--
--   2 · The notice window comes from `class_cancel_policy()`'s own source
--       (part 2615) joined to `gym_classes.starts_at`. A gym that has stated NO
--       notice period gets 'cancelled': inventing a window to charge inside is
--       the thing src/lib/classCancel.ts refuses to do in words, and the
--       database must not do it in SQL.
--
--   3 · `cancelled_at` / `cancelled_by` need no code in `cancel_class` at all.
--       `class_bookings_stamp_cancel()` below is a BEFORE UPDATE trigger and
--       stamps them on the transition, the same way
--       `sessions_stamp_outcome()` (part 33) stamps `outcome_at`.
--
--   4 · The waitlist promotion — `update class_bookings set status = 'booked'`
--       — keeps its capacity test and its FIFO order unchanged. It gains
--       nothing and loses nothing; `promoted_at` is stamped by the same
--       trigger, so the overwrite stops being an erasure without the promotion
--       statement being touched.
--
--   5 · `book_class` needs the matching change and it is NOT optional. Its
--       `on conflict (class_id, user_id) do update set status = excluded.status`
--       will, the moment cancelling stops deleting, silently overwrite a
--       'late_cancelled' back to 'booked' when the member re-books — which is
--       the identical erasure one level down. Re-booking after a cancellation
--       must leave the cancellation standing, which means the cancellation
--       belongs in its own row per occurrence, or `book_class` must refuse to
--       overwrite a terminal status and write a fresh booking instead.
--
-- ROWS ALREADY DELETED ARE GONE. There is no recovery, partial or otherwise.
-- `cancel_class` has been deleting since part 02; the rows were removed by an
-- ordinary DELETE with no audit table, no trigger and no soft-delete column
-- behind it, and `class_bookings` has never had one. Every class cancellation
-- every member has ever made is unrecoverable, and no backfill in this file or
-- any later one can reconstruct a single one of them. This part stops the
-- erasure from here forward and makes no claim about anything before it. Any
-- screen that counts cancellations must say what its window starts at.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · the status vocabulary ──────────────────────────────────────────────

do $$
begin
  -- Drop and add together. One statement, therefore atomic: if the ADD raises
  -- 23514 on a row the operator has not seen, the DROP goes back with it and
  -- the table keeps the constraint it had. Two bare statements would leave a
  -- window — and, on a failure, a table with NO check on its status at all.
  alter table public.class_bookings
    drop constraint if exists class_bookings_status_check;
  alter table public.class_bookings
    add constraint class_bookings_status_check
    check (status in ('booked', 'waitlist', 'cancelled', 'late_cancelled'));
end $$;

comment on column public.class_bookings.status is
  'booked | waitlist | cancelled | late_cancelled. The standing of the booking, '
  'and the LAST TWO ARE WHY THIS COLUMN IS NOT A BOOLEAN: cancelling must stop '
  'being the DELETE it has been since part 02, because a correction is a second '
  'recorded fact and never an erasure. Spelled exactly as sessions.outcome '
  'spells them (part 33) — a second spelling of the same fact is its own defect. '
  'There is deliberately no ''no_show'': a no-show held their seat and their '
  'status stays ''booked'', which is what keeps class_counts() from handing the '
  'seat back. A no-show is derived — status ''booked'', attended_at null, and '
  'gym_classes.register_taken_at not null.';

-- ── 2 · when it happened, and who said so ──────────────────────────────────
--
-- Named as part 33 names them on `sessions`: `<verb>_at` and `<verb>_by`, with
-- `by` pointing at auth.users and nulling on delete, so losing an account
-- leaves the fact and loses only the attribution.

alter table public.class_bookings
  add column if not exists cancelled_at timestamptz;
alter table public.class_bookings
  add column if not exists cancelled_by uuid references auth.users(id) on delete set null;
alter table public.class_bookings
  add column if not exists promoted_at timestamptz;

comment on column public.class_bookings.cancelled_at is
  'When this booking was cancelled. NULL means THIS BOOKING HAS NOT BEEN '
  'CANCELLED — it is not "unknown" and not "cancelled at an unrecorded time", '
  'because the trigger that sets it fires on the same statement that sets the '
  'status. A row with a cancelled status and a null cancelled_at is a row '
  'written past the trigger and must be treated as a defect, not read as today.';
comment on column public.class_bookings.cancelled_by is
  'Who cancelled it: the member themselves, or a staff member acting for them. '
  'NULL means either not cancelled, or cancelled by an account that has since '
  'been deleted — cancelled_at is the column that separates those two, and is '
  'the one to test. Never infer the canceller from user_id: that is who the '
  'booking is FOR.';
comment on column public.class_bookings.promoted_at is
  'When this booking came off the waitlist into a seat. NULL means it was NEVER '
  'ON THE WAITLIST — the seat was held from the moment it was booked. It does '
  'not mean "still waiting": that is status = ''waitlist''. Recorded because the '
  'promotion is an UPDATE over the top of ''waitlist'' and without this the fact '
  'that the member queued is erased by the good news.';

-- The stamper. Modelled on `sessions_stamp_outcome()` (part 33) and for the
-- same reason: a disputed late-cancellation fee needs an author and a time, and
-- neither can be left to whichever of the several callers remembers.
--
-- `coalesce` on both, so a caller that supplies its own values — a backfill, an
-- import, an owner correcting a date — keeps them. The trigger fills a blank;
-- it does not overrule a statement.
create or replace function public.class_bookings_stamp_cancel()
returns trigger
language plpgsql
security definer
-- Pinned for the reason check:definer states: an unpinned definer body resolves
-- every unqualified name against the CALLER's search_path.
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.status is distinct from old.status
     and new.status in ('cancelled', 'late_cancelled') then
    new.cancelled_at := coalesce(new.cancelled_at, now());
    new.cancelled_by := coalesce(new.cancelled_by, (select auth.uid()));
  end if;

  -- Un-cancelling clears both, so the pair can never outlive the fact. This is
  -- the one place the row is allowed to lose a value, and it loses it only
  -- because the status it described is no longer there to describe.
  if new.status not in ('cancelled', 'late_cancelled') then
    new.cancelled_at := null;
    new.cancelled_by := null;
  end if;

  -- The promotion. `old.status = 'waitlist'` and not merely "new is booked",
  -- because a booking that was always booked was never promoted and a stamp on
  -- it would be a fact nobody has.
  if old.status = 'waitlist' and new.status = 'booked' then
    new.promoted_at := coalesce(new.promoted_at, now());
  end if;

  return new;
end $$;

drop trigger if exists trg_class_bookings_stamp_cancel on public.class_bookings;
create trigger trg_class_bookings_stamp_cancel
  before update on public.class_bookings
  for each row execute function public.class_bookings_stamp_cancel();

-- A trigger function is called by the executor, not by a role, so EXECUTE on it
-- is never checked when it fires. The grant PostgreSQL hands PUBLIC on a new
-- function is therefore pure surface — and in a Supabase project PUBLIC
-- includes `anon`, which is what part 2180 was written to clean up after.
revoke all on function public.class_bookings_stamp_cancel() from public, anon;

-- ── 3 · the register was taken ─────────────────────────────────────────────

alter table public.gym_classes
  add column if not exists register_taken_at timestamptz;
alter table public.gym_classes
  add column if not exists register_taken_by uuid references auth.users(id) on delete set null;

comment on column public.gym_classes.register_taken_at is
  'When somebody took the register for this class. NULL MEANS NOBODY TOOK IT — '
  'it does not mean nobody attended. This is the column that stops '
  'class_bookings.attended_at from meaning two things: until part 3060, '
  '"attended_at is null" was both "did not turn up" and "no register was ever '
  'taken", and no read could separate them. With this set, an un-ticked booked '
  'member is a NO-SHOW; with it null, they are UNMARKED and a human has to '
  'look. Meaningless on a class whose own status is ''cancelled'' (part 195): a '
  'class that did not run has no register, and a stamp on one is a defect.';
comment on column public.gym_classes.register_taken_by is
  'Who took it. NULL means either it was not taken, or the account that took it '
  'has been deleted — register_taken_at is the column that separates those, and '
  'is the only one any read should test.';

-- Who may say a register was taken. One definition, called from both writers
-- below, because two spellings of an authorisation test is how the two drift.
--
-- Deliberately the same shape as the guard inside `set_class_attendance` (part
-- 2330): tenant staff, OR the coach named on the class — the second disjunct is
-- there because a coach whose tenant_id is not set would otherwise be locked
-- out of their own class.
create or replace function public.can_register_class(p_class uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from gym_classes gc
    where gc.id = p_class
      and ( ( gc.tenant_id is not null
              and gc.tenant_id = my_tenant()
              and my_role() in ('trainer', 'owner') )
            or gc.trainer_id = auth.uid() )
  );
$$;

revoke all on function public.can_register_class(uuid) from public, anon;
grant execute on function public.can_register_class(uuid) to authenticated;

comment on function public.can_register_class(uuid) is
  'Whether the caller may take the register for this class. Answers false — '
  'never null and never an error — for a class that does not exist, so a caller '
  'cannot use it to probe for class ids. Answers FALSE when there is no '
  'auth.uid(): a service_role or psql write to attended_at will not stamp '
  'register_taken_at, and that is deliberate — a backfill did not take a '
  'register, and dating one from it would manufacture the evidence these '
  'columns exist to start collecting. Such a write must call '
  'mark_register_taken() or set the column itself.';

-- Stamping the class from the ordinary act of ticking somebody in.
--
-- ── why this is guarded, and why that is not paranoia ──────────────────────
--
-- `class_bookings_self` is `for all using (user_id = auth.uid())`, so a MEMBER
-- can UPDATE their own booking row, `attended_at` included — the whole row, as
-- part 151's note on table-wide grants says. Without the guard below, any
-- member could set their own attended_at, stamp register_taken_at on the class,
-- and thereby convert every other member on that register into a recorded
-- no-show. The gym could then charge fees off a fact a stranger asserted.
--
-- AFTER, not BEFORE: this writes a different table, and a BEFORE trigger that
-- did so would be doing it before the change that justifies it has committed.
--
-- `when (register_taken_at is null)` in the UPDATE and not an IF: the first
-- tick is the one that dates the register, and a second tick five minutes later
-- must not move the timestamp forward — the register was taken when it was
-- first taken.
create or replace function public.gym_classes_stamp_register()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not can_register_class(new.class_id) then
    return null;
  end if;

  update gym_classes
     set register_taken_at = now(),
         register_taken_by = (select auth.uid())
   where id = new.class_id
     and register_taken_at is null;

  return null;
end $$;

drop trigger if exists trg_gym_classes_stamp_register on public.class_bookings;
create trigger trg_gym_classes_stamp_register
  after update of attended_at on public.class_bookings
  for each row
  -- Only when the tick actually MOVED. An unrelated update that happens to
  -- carry the same attended_at is not somebody working the register.
  when (new.attended_at is distinct from old.attended_at)
  execute function public.gym_classes_stamp_register();

revoke all on function public.gym_classes_stamp_register() from public, anon;

-- The explicit "I took this register", for the case the trigger above cannot
-- reach: a class where the register WAS taken and nobody attended. There is no
-- `attended_at` write on such a class, so nothing fires, and without this the
-- one class that most needs recording — twelve booked, none present — is the
-- one that stays unmarked.
--
-- Returns false rather than raising when the caller may not: the screen that
-- calls this is drawing a register, and the honest outcome is "this was not
-- recorded", which src/lib/classRegister.ts renders as unmarked. A raise here
-- would take a screen down over a permission the coach can do nothing about.
create or replace function public.mark_register_taken(p_class uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not can_register_class(p_class) then
    return false;
  end if;

  update gym_classes
     set register_taken_at = coalesce(register_taken_at, now()),
         register_taken_by = coalesce(register_taken_by, (select auth.uid()))
   where id = p_class;

  return found;
end $$;

revoke all on function public.mark_register_taken(uuid) from public, anon;
grant execute on function public.mark_register_taken(uuid) to authenticated;

comment on function public.mark_register_taken(uuid) is
  'Record that the register for this class was taken, without ticking anybody '
  'in. For the class where nobody attended, which is the one case the '
  'attended_at trigger cannot see. Idempotent: a second call leaves the first '
  'timestamp alone, because the register was taken when it was first taken. '
  'Returns false when the caller is not staff for this class rather than '
  'raising — a register screen must not fall over on a permission.';

-- ── 4 · what this part deliberately does NOT do ────────────────────────────
--
--   · It does not touch `cancel_class`, `book_class` or `set_class_attendance`.
--     The first is destructive and needs its own review; the header says
--     exactly what it and `book_class` must become. `set_class_attendance`
--     should be rewritten to call `can_register_class()` rather than carrying
--     its own copy of the same EXISTS — but rewriting a function body in this
--     part would silently revert whatever else is in flight against it, and a
--     duplicated guard that agrees is a smaller problem than a clobbered one.
--
--   · It backfills nothing. Every existing booking gets `cancelled_at` null,
--     which is true — it has not been cancelled — and `promoted_at` null, which
--     is the honest reading of a row whose history was never recorded rather
--     than a claim that it never queued. Every existing class gets
--     `register_taken_at` null, so every past class reads UNMARKED. That is
--     correct and it is not a regression: nothing anywhere ever knew whether
--     those registers were taken, and dating them from the newest attended_at
--     would be inventing the evidence this part exists to start collecting.
--
--   · It adds no 'no_show' status value. See the header; that would hand back a
--     seat the member kept.
--
--   · It changes no policy and adds no grant on either table. Both columns sets
--     land on tables whose `authenticated` grants are table-wide, so a new
--     column is reachable by exactly the roles that could already reach the row
--     — which is the case check:grants §2 exists to catch the absence of, and
--     is why there is no column-level grant to extend here.
--
--   · It writes no notification and queues no message. Recording that somebody
--     cancelled is not telling anybody they did. `class_cancelled_notify` and
--     src/lib/classOff.ts are the CLASS-being-called-off path and are a
--     different event with a different audience.
