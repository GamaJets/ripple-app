-- ═══════════════════════════════════════════════════════════════════════════
-- A statement that changes after the fact is worse than no statement.
--
-- `LATE_FEES_ONLY_CURRENT_CLIENTS` in src/lib/coachStatement.ts describes this
-- and calls it a permission rather than a gap:
--
--     Only fees recorded against clients you are still coaching are on here. A
--     fee recorded against somebody whose coaching has since ended is no longer
--     readable by this app under your account, so it is missing from this
--     section — in this period and in every earlier one.
--
-- It was right about the mechanism and too generous about the consequence.
-- `charges_trainer_rw` (part 142) is
--
--     exists (select 1 from clients c
--              where c.id = charges.client_id and c.trainer_id = auth.uid())
--
-- — the LIVE coaching relationship, not a coach recorded on the row. Ending
-- coaching sets `clients.trainer_id` to null (src/lib/endCoaching.ts), so from
-- that moment the fee is invisible to the person who recorded it. Nine of the
-- ten client rows in the live database already have a null trainer.
--
-- That is not a section that is short. It is a RETROACTIVE EDIT of every past
-- period: last year's statement, already printed and already handed to an
-- accountant, cannot be reproduced from this app, and the second copy differs
-- from the first with nothing on either to say which is which. A financial
-- summary that quietly changes when an unrelated relationship ends is a
-- correctness bug wearing an RLS costume.
--
-- ── What fixes it, and what does not ─────────────────────────────────────
--
-- Not a wider policy on its own. Widening `charges_trainer_rw` to "any client
-- who was ever mine" is not expressible — nothing records that they were — and
-- widening it to the tenant would show a coach their colleagues' fees.
--
-- The fix is a SNAPSHOT: who the fee was recorded by, written onto the row at
-- the moment it is raised, exactly as part 126 already snapshots the CURRENCY
-- onto the same row and for the same reason. "A fee raised last March was
-- raised in last March's money" is the same argument as "a fee raised last
-- March was raised by last March's coach".
--
-- ── Why a trigger and not an edit to cancel_my_session ───────────────────
--
-- `cancel_my_session` (part 126) is the only writer of `charges` today, and
-- copying its hundred lines here to add one column would leave two versions of
-- a billing function in this repository, differing by a line, for the next
-- person to pick the wrong one out of. A BEFORE INSERT trigger fills the column
-- for that writer and for every writer added later — including the ones added
-- by somebody who has not read this file, which is the case that matters.
--
-- It fills from the SESSION's trainer where there is a session, and falls back
-- to the client's current coach where there is not. The session is the better
-- source: it is what the fee is actually about, and it is already a snapshot of
-- who was going to deliver it.
--
-- ── Why the columns are then frozen ──────────────────────────────────────
--
-- The read policy below is widened to `coach_id = auth.uid()`. Without a guard,
-- a coach holding a row by that arm could UPDATE its `client_id` to a stranger
-- — and `charges_client_r` publishes a charge to the person named on it, so
-- that stranger would be shown a debt that had been invented for them. The two
-- identity columns are therefore immutable, which they were always meant to be:
-- a fee is a record of something that happened, and who it happened to is not
-- an editable field.
--
-- ── What this cannot recover ─────────────────────────────────────────────
--
-- The backfill can only reach fees whose client is STILL with the coach who
-- recorded them, because that relationship is the only record that the pair
-- ever existed. A fee recorded against somebody who has already moved on is
-- unrecoverable, and it stays unreadable. `LATE_FEES_ONLY_CURRENT_CLIENTS` is
-- rewritten to say exactly that rather than the wider claim it made before —
-- the honest sentence is narrower, and it now has a date on it.
--
-- auth.uid() throughout, never current_user: under PostgREST every signed-in
-- request runs as the shared `authenticated` role.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. The column ────────────────────────────────────────────────────────

alter table public.charges
  add column if not exists coach_id uuid references public.profiles(id) on delete set null;

comment on column public.charges.coach_id is
  'Who recorded this fee, snapshotted when it was raised. NOT a join to the live coaching relationship — that is exactly what made a past period''s statement change when coaching ended. NULL on rows raised before part 169 whose client had already moved on, which is unrecoverable.';

create index if not exists charges_coach_created_idx
  on public.charges (coach_id, created_at desc)
  where coach_id is not null;

-- Backfill as far as the evidence goes, and no further.
--
-- The session's trainer first, because that is what the fee is about and it
-- survives the client leaving. `clients.trainer_id` second, which only reaches
-- pairs still coaching together. A fee whose session is gone AND whose client
-- has moved on stays null: there is nowhere left that records who raised it,
-- and a guess would put somebody else's fee on a coach's statement.
update public.charges c
   set coach_id = s.trainer_id
  from public.sessions s
 where s.id = c.session_id
   and c.coach_id is null
   and s.trainer_id is not null;

update public.charges c
   set coach_id = cl.trainer_id
  from public.clients cl
 where cl.id = c.client_id
   and c.coach_id is null
   and cl.trainer_id is not null;

-- ── 2. The stamp ─────────────────────────────────────────────────────────

create or replace function public.charges_stamp_coach()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Only ever fills a hole. A caller that states a coach is taken at its word;
  -- the INSERT policy below is what stops that being somebody else's id.
  if new.coach_id is null then
    if new.session_id is not null then
      select s.trainer_id into new.coach_id from public.sessions s where s.id = new.session_id;
    end if;
    if new.coach_id is null and new.client_id is not null then
      select cl.trainer_id into new.coach_id from public.clients cl where cl.id = new.client_id;
    end if;
  end if;
  return new;
end $$;

revoke all on function public.charges_stamp_coach() from public, anon, authenticated;

drop trigger if exists charges_stamp_coach_ins on public.charges;
create trigger charges_stamp_coach_ins
  before insert on public.charges
  for each row execute function public.charges_stamp_coach();

-- ── 3. The two columns that say who this is about ────────────────────────

create or replace function public.charges_identity_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.client_id is distinct from old.client_id then
    raise exception 'a charge cannot be moved to another person';
  end if;
  -- Null to a value is the backfill and the stamp; anything else is a fee
  -- changing hands after it was raised, which is a past period being rewritten.
  if old.coach_id is not null and new.coach_id is distinct from old.coach_id then
    raise exception 'a charge cannot be moved to another coach';
  end if;
  return new;
end $$;

revoke all on function public.charges_identity_guard() from public, anon, authenticated;

drop trigger if exists charges_identity on public.charges;
create trigger charges_identity
  before update on public.charges
  for each row execute function public.charges_identity_guard();

-- ── 4. The policies, split so a wider READ is not a wider INSERT ─────────
--
-- `charges_trainer_rw` was one `for all` policy, so widening its USING clause
-- would have widened its WITH CHECK with it — and a WITH CHECK that accepts
-- `coach_id = auth.uid()` accepts an INSERT naming any client_id at all, which
-- `charges_client_r` would then publish to that person as a debt. Four narrow
-- policies say four different things instead of one clause trying to.
drop policy if exists charges_trainer_rw on public.charges;

-- READ: the fees I recorded, whether or not I still coach that person. This is
-- the whole point of the part.
drop policy if exists charges_trainer_read on public.charges;
create policy charges_trainer_read on public.charges
  for select
  to authenticated
  using (
    coach_id = (select auth.uid())
    or exists (select 1 from public.clients c
                where c.id = charges.client_id and c.trainer_id = (select auth.uid()))
  );

-- WRITE (waive, and reinstate): the same set. A coach who let somebody off
-- before that person moved on must still be able to see that they did, and a
-- coach settling a former client's account must still be able to forgive it.
drop policy if exists charges_trainer_update on public.charges;
create policy charges_trainer_update on public.charges
  for update
  to authenticated
  using (
    coach_id = (select auth.uid())
    or exists (select 1 from public.clients c
                where c.id = charges.client_id and c.trainer_id = (select auth.uid()))
  )
  with check (
    coach_id = (select auth.uid())
    or exists (select 1 from public.clients c
                where c.id = charges.client_id and c.trainer_id = (select auth.uid()))
  );

-- INSERT: narrow, and deliberately narrower than the read. A fee may only be
-- raised against somebody this coach is coaching NOW. The stamp above fills
-- `coach_id` when it is left out; a stated one has to be the caller's own.
drop policy if exists charges_trainer_insert on public.charges;
create policy charges_trainer_insert on public.charges
  for insert
  to authenticated
  with check (
    exists (select 1 from public.clients c
             where c.id = charges.client_id and c.trainer_id = (select auth.uid()))
    and (coach_id is null or coach_id = (select auth.uid()))
  );

-- DELETE: narrow for the same reason, and rarely wanted at all — a fee that was
-- not owed is WAIVED, which leaves the fact that it happened on the record.
drop policy if exists charges_trainer_delete on public.charges;
create policy charges_trainer_delete on public.charges
  for delete
  to authenticated
  using (
    exists (select 1 from public.clients c
             where c.id = charges.client_id and c.trainer_id = (select auth.uid()))
  );

revoke all on public.charges from anon;
