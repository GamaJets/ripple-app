-- ── A credit is spent once, and the app is told whether it was ─────────────
--
-- Session packs are the one thing in this product a client pays for up front
-- and draws down later, and until now the drawing down was two round trips of
-- client-side arithmetic:
--
--     select * from client_purchases where client_id = uid …   -- read
--     update client_purchases set sessions_used = <read + 1>   -- write
--         where id = <the row we read>
--
-- Three things are wrong with that, and all three were confirmed against this
-- live database before this file was written.
--
-- 1. THE WRITE CANNOT REPORT THAT IT DID NOTHING. PostgREST answers an UPDATE
--    that matched no rows with `error: null` and an empty body — identical, to
--    the caller, to one that matched. Proven here: as the signed-in client,
--    an UPDATE aimed at another client's purchase reported success and changed
--    nothing, because `cp_self` filtered the row away rather than raising.
--    `redeemSession` read that as ok and returned a `remaining` it had
--    calculated locally — a balance the app printed and the database had never
--    agreed to.
--
-- 2. IT IS A LOST UPDATE WAITING TO HAPPEN. Two bookings in flight both read
--    `sessions_used = 3`, both write 4, and two sessions come off one credit.
--    Nothing about the outcome looks wrong afterwards.
--
-- 3. NOTHING BOUNDED THE COLUMN. Also proven live: as the client, an UPDATE
--    setting `sessions_used = 500` on a ten-session pack was ACCEPTED. There
--    was no constraint. A pack could go past its own total, or negative, and
--    the only thing between a client's balance and an arbitrary number was
--    application code being careful.
--
-- What was NOT wrong, and is worth recording because a review claimed it was:
-- the write DOES match its own row. `cp_self` is FOR ALL (part 121), and an
-- UPDATE by the client on their own purchase returned 1 row here. Redemption
-- has always actually decremented. The bug was never that it did nothing; it
-- was that nothing could tell the difference.
--
-- ── What this part does about it ───────────────────────────────────────────
--
-- The arithmetic moves into the database, where a row count is a fact rather
-- than an inference:
--
--   · one statement, so there is no window between reading a balance and
--     writing it;
--   · `for update` on the chosen pack, so a second booking waits rather than
--     reading the same number;
--   · `get diagnostics n = row_count` after the write, and n <> 1 RAISES.
--     Silence is not success anywhere in this file;
--   · a CHECK constraint, so no caller — these functions, a hand-written
--     update, a future webhook — can leave a balance outside 0..total.
--
-- `cp_self` is deliberately NOT narrowed here. It is what the currently
-- shipped app writes through, and taking the write away tonight would stop
-- redemption dead in every build already in the field while the functions
-- below went unused. Once every build calls these two functions, `cp_self`
-- should become SELECT-only and the write should exist only here — until then
-- a client can still set their own `sessions_used`, bounded by the constraint
-- but not otherwise supervised. That is a pre-existing exposure this part
-- narrows rather than closes, and it is written down so the next pass can
-- finish it.

-- ── the floor and the ceiling ──────────────────────────────────────────────
--
-- A membership (`sessions_total is null`) has no credits and is unconstrained
-- beyond the floor. A pack may never be drawn past its size, and may never go
-- negative — "-1 sessions left" is not a sentence anyone should read about
-- their own money, and `packLeft` in src/lib/coachMoney.ts clamping it on the
-- way to the screen only hides it.
--
-- Verified before adding: zero rows in this table violate it.
alter table public.client_purchases
  drop constraint if exists client_purchases_sessions_used_ck;
alter table public.client_purchases
  add constraint client_purchases_sessions_used_ck
  check (
    sessions_used >= 0
    and (sessions_total is null or sessions_used <= sessions_total)
  );

comment on constraint client_purchases_sessions_used_ck on public.client_purchases is
  'A pack cannot be drawn past its size or below zero. The last line of defence under redeem_pack_session/refund_pack_session, and the only one that also covers a direct write through cp_self.';

-- ── spend one credit ───────────────────────────────────────────────────────
--
-- Draws from the OLDEST pack with room. That ordering is the client's money:
-- packs do not expire in this schema, but the oldest is the one they have been
-- carrying longest, and spending it first is the order a person expects and
-- the order that leaves the newest purchase intact if anything is refunded.
--
-- The three answers are distinct on purpose, because the app says a different
-- sentence for each and two of them are about somebody's money:
--
--   'drawn'      a credit came off; `sessions_left` is what the database now
--                holds, not what the caller calculated.
--   'exhausted'  they hold packs from this coach and every one is used up.
--   'no_pack'    they hold no pack from this coach at all — a pay-per-session
--                client, for whom nothing went wrong.
--
-- A read that FAILS is none of the three. It raises, and the caller reports
-- "could not be drawn down", which is not "you have none left".
create or replace function public.redeem_pack_session(p_trainer uuid)
returns table (outcome text, purchase_id uuid, sessions_left int, pack_total int)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare v_id uuid; v_used int; v_total int; n int;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  if p_trainer is null then
    raise exception 'No coach given.' using errcode = '22004';
  end if;

  -- `for update` is the whole difference between this and the two round trips
  -- it replaces. A second booking arriving here blocks until this transaction
  -- commits, then re-reads — rather than reading the balance this one is about
  -- to change.
  select cp.id, cp.sessions_used, cp.sessions_total
    into v_id, v_used, v_total
    from public.client_purchases cp
   where cp.client_id = (select auth.uid())
     and cp.trainer_id = p_trainer
     and cp.status = 'paid'
     and cp.sessions_total is not null
     and cp.sessions_used < cp.sessions_total
   order by cp.created_at asc, cp.id asc
   limit 1
     for update;

  if v_id is null then
    -- Holding a used-up pack and never having bought one are different facts
    -- about a person, and the booking screen only warns the first of them.
    if exists (
      select 1 from public.client_purchases cp
       where cp.client_id = (select auth.uid())
         and cp.trainer_id = p_trainer
         and cp.status = 'paid'
         and cp.sessions_total is not null
    ) then
      return query select 'exhausted'::text, null::uuid, 0, null::int;
    else
      return query select 'no_pack'::text, null::uuid, null::int, null::int;
    end if;
    return;
  end if;

  update public.client_purchases cp
     set sessions_used = cp.sessions_used + 1
   where cp.id = v_id
     and cp.sessions_used = v_used;
  get diagnostics n = row_count;

  -- The line this function exists for. Zero rows here means the row moved or
  -- vanished between the lock and the write, and reporting that as a
  -- successful redemption is how a client comes to be charged for a session
  -- their pack still shows as unspent.
  if n <> 1 then
    raise exception 'Your session pack was not drawn down — nothing was changed.'
      using errcode = '40001';
  end if;

  return query select 'drawn'::text, v_id, (v_total - v_used - 1), v_total;
end $fn$;

revoke all on function public.redeem_pack_session(uuid) from public, anon;
grant execute on function public.redeem_pack_session(uuid) to authenticated;

comment on function public.redeem_pack_session(uuid) is
  'Spend one credit from the caller''s oldest pack with room for this coach, atomically. Returns outcome drawn/exhausted/no_pack and the balance the DATABASE holds. Raises rather than reporting success on a write that changed nothing.';

-- ── put one credit back ────────────────────────────────────────────────────
--
-- Returns to the NEWEST pack that has usage, which is the exact inverse of
-- drawing from the oldest with room: under oldest-first, the most recent
-- credit spent came off the newest pack that had been reached. Refunding
-- oldest-first instead would move credits from a pack a client bought last
-- year onto one they bought last week, and the totals would still add up — so
-- nothing would ever surface it.
--
-- The caller decides WHETHER a refund is owed (the 24-hour rule lives in
-- src/ui/sessions.tsx and is not duplicated here). This decides where it goes.
create or replace function public.refund_pack_session(p_trainer uuid)
returns table (outcome text, purchase_id uuid, sessions_left int, pack_total int)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare v_id uuid; v_used int; v_total int; n int;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  if p_trainer is null then
    raise exception 'No coach given.' using errcode = '22004';
  end if;

  select cp.id, cp.sessions_used, cp.sessions_total
    into v_id, v_used, v_total
    from public.client_purchases cp
   where cp.client_id = (select auth.uid())
     and cp.trainer_id = p_trainer
     and cp.status = 'paid'
     and cp.sessions_total is not null
     and cp.sessions_used > 0
   order by cp.created_at desc, cp.id desc
   limit 1
     for update;

  if v_id is null then
    if exists (
      select 1 from public.client_purchases cp
       where cp.client_id = (select auth.uid())
         and cp.trainer_id = p_trainer
         and cp.status = 'paid'
         and cp.sessions_total is not null
    ) then
      -- They hold a pack and have spent nothing off it. There is no credit to
      -- give back, and inventing one would hand them a session they never paid
      -- for — the same defect as swallowing one, pointed the other way.
      return query select 'nothing_to_return'::text, null::uuid, null::int, null::int;
    else
      return query select 'no_pack'::text, null::uuid, null::int, null::int;
    end if;
    return;
  end if;

  update public.client_purchases cp
     set sessions_used = cp.sessions_used - 1
   where cp.id = v_id
     and cp.sessions_used = v_used;
  get diagnostics n = row_count;

  if n <> 1 then
    raise exception 'Your session credit was not returned — nothing was changed.'
      using errcode = '40001';
  end if;

  return query select 'returned'::text, v_id, (v_total - v_used + 1), v_total;
end $fn$;

revoke all on function public.refund_pack_session(uuid) from public, anon;
grant execute on function public.refund_pack_session(uuid) to authenticated;

comment on function public.refund_pack_session(uuid) is
  'Return one credit to the caller''s newest pack that has usage for this coach, atomically — the inverse of redeem_pack_session. Whether a refund is owed is decided by the caller; this decides which pack it lands on. Raises rather than reporting success on a write that changed nothing.';

-- ── the index the two functions read through ───────────────────────────────
--
-- `idx_purchases_client` (part 21) is (client_id, created_at desc), which
-- serves the refund ordering and the client's own history. The redemption
-- picks the OLDEST, and both filter on trainer_id, so neither existing index
-- is the one being asked for.
create index if not exists idx_purchases_client_trainer_packs
  on public.client_purchases (client_id, trainer_id, created_at asc)
  where sessions_total is not null;
