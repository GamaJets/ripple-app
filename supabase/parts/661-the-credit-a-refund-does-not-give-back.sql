-- ═══════════════════════════════════════════════════════════════════════════
-- The session credit a refund does not give back.
--
-- `REFUND_DOES_NOT` in src/lib/refunds.ts is shown to the coach in the confirm
-- dialog, immediately before somebody's card is credited:
--
--   "A refund gives money back and does nothing else. It does not cancel a
--    subscription, IT DOES NOT PUT A SESSION CREDIT BACK ON A PACK, and it
--    does not tell your client anything."
--
-- Every clause of that is true and every clause but one has somewhere to go
-- afterwards. A subscription can be cancelled from the same screen; telling the
-- client is the coach's to do. The credit clause names a consequence and offers
-- no way to act on it, anywhere in the product.
--
-- What that means in practice: a coach refunds two sessions of a ten-pack,
-- because the client is moving away. The money goes back. The pack still says
-- eight left, and every one of those eight can still be booked. The client has
-- been given the money for two sessions AND kept the credits for them, and
-- nothing on either side of the app says so — the coach's Payments screen shows
-- the sale as partly refunded, the client's Packages screen shows a balance
-- that has not moved, and neither screen mentions the other.
--
-- ── Why refund_pack_session is not the answer ────────────────────────────
--
-- Part 123 has exactly the right function, pointed at the wrong person. It is
-- scoped `client_id = (select auth.uid())` — the CLIENT calls it, from
-- `cancelBookedSession`, when they cancel outside the notice window. A coach
-- calling it would either match nothing or, worse, operate on their own
-- purchases from some other coach.
--
-- It also chooses the pack for the caller: "the newest with usage". That is
-- right for a cancellation, where the credit belongs to whichever pack paid for
-- the session. It is wrong here, where the coach is looking at ONE sale they
-- have just refunded and means that one.
--
-- ── The pack this refuses to touch ───────────────────────────────────────
--
-- A pack whose window has CLOSED. `run_pack_expiry()` (part 612) reduces
-- `sessions_total` to `sessions_used`, which is how every draw site in the
-- database stops at an expired pack without one of them being rewritten.
-- Decrementing `sessions_used` on such a row leaves `sessions_total -
-- sessions_used = 1`: a credit that appears on the client's balance and that
-- nothing in this database will ever let them draw. `packBalance` in
-- src/lib/packDraw.ts counts exactly those under `onClosedPacks` because they
-- can already arrive that way through part 123, and this function refuses to
-- create another one — the coach is told to refund the money instead, which is
-- the thing that actually reaches the client.
--
-- ── What it still does not do ────────────────────────────────────────────
--
-- It does not refund money, and it is not called by anything that does. The two
-- are separate acts on the same screen and stay separate: a coach may take a
-- credit back without giving money back (a session delivered off the books) and
-- may give money back without taking a credit (a goodwill refund on a pack the
-- client is keeping). Bundling them would make one of those two impossible and
-- neither of them is rare.
--
-- It tells the client nothing. Their own balance is the artefact, exactly as
-- `REFUND_DOES_NOT` says of the money.
--
-- Idempotent; safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

/**
 * Take one session credit back off, or give one back to, a pack the signed-in
 * COACH sold.
 *
 * `p_delta` is +1 or -1 and nothing else. Two named directions rather than two
 * functions, because the row lock, the ownership check, the expiry refusal and
 * the row-count check are identical for both and a second copy of them is a
 * second place for one to be dropped.
 *
 *   +1  give a credit back — the coach refunded a session, or the client did
 *       not get what the pack was drawn for.
 *   -1  take a credit off — a session was delivered and never marked.
 *
 * Answers with a ROW saying what happened rather than relying on the absence of
 * an error, for part 123's reason: PostgREST reports no error for an UPDATE
 * matching zero rows, so "no error" is not evidence that a credit moved. A
 * credit the coach believes was returned and was not is one the client has paid
 * for twice.
 */
create or replace function public.adjust_pack_credit(p_purchase uuid, p_delta int)
returns table (outcome text, purchase_id uuid, sessions_left int, pack_total int)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare v_used int; v_total int; v_status text; v_expired timestamptz; n int;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  if p_purchase is null then
    raise exception 'No pack given.' using errcode = '22004';
  end if;
  if p_delta is null or p_delta not in (1, -1) then
    raise exception 'A credit moves by one at a time.' using errcode = '22023';
  end if;

  -- `for update` for part 123's reason: a client's own booking arriving here
  -- blocks until this commits and then re-reads, rather than reading the
  -- balance this transaction is about to change.
  --
  -- Scoped by `trainer_id = auth.uid()` INSIDE the function, because SECURITY
  -- DEFINER bypasses the row policies: without it any signed-in account could
  -- move credits on a stranger's pack.
  select cp.sessions_used, cp.sessions_total, cp.status, cp.expired_at
    into v_used, v_total, v_status, v_expired
    from public.client_purchases cp
   where cp.id = p_purchase
     and cp.trainer_id = (select auth.uid())
     for update;

  if not found then
    return query select 'no_pack'::text, null::uuid, null::int, null::int;
    return;
  end if;

  -- A membership has no credits to move; it is a thing with none, not a thing
  -- with none left. An abandoned checkout is not a pack anybody bought.
  if v_total is null or v_status is distinct from 'paid' then
    return query select 'no_pack'::text, p_purchase, null::int, null::int;
    return;
  end if;

  -- The window has closed. Giving a credit back here would put one on the
  -- client's balance that no draw site in this database will ever spend — see
  -- the header. Taking one off is refused too, and for a plainer reason: there
  -- is nothing left on it to take.
  if v_expired is not null then
    return query select 'expired'::text, p_purchase, greatest(0, v_total - v_used), v_total;
    return;
  end if;

  if p_delta = 1 and v_used <= 0 then
    -- Nothing has been drawn off it, so there is nothing to give back, and
    -- inventing one would hand the client a session they never paid for — the
    -- same defect as swallowing one, pointed the other way.
    return query select 'nothing_to_return'::text, p_purchase, v_total - v_used, v_total;
    return;
  end if;
  if p_delta = -1 and v_used >= v_total then
    return query select 'exhausted'::text, p_purchase, 0, v_total;
    return;
  end if;

  update public.client_purchases cp
     set sessions_used = cp.sessions_used - p_delta
   where cp.id = p_purchase
     and cp.sessions_used = v_used;
  get diagnostics n = row_count;

  if n <> 1 then
    raise exception 'That credit was not moved — nothing was changed.'
      using errcode = '40001';
  end if;

  return query select
    case when p_delta = 1 then 'returned' else 'drawn' end::text,
    p_purchase,
    (v_total - (v_used - p_delta)),
    v_total;
end $fn$;

revoke all on function public.adjust_pack_credit(uuid, int) from public, anon;
grant execute on function public.adjust_pack_credit(uuid, int) to authenticated;

comment on function public.adjust_pack_credit(uuid, int) is
  'Move one session credit on a pack the signed-in COACH sold, in either direction, atomically. The coach-side counterpart of refund_pack_session (part 123), which is scoped to the client and chooses the pack itself. Refuses a pack whose validity window has closed, because a credit returned to one can never be drawn. Answers with a row naming the outcome rather than reporting success over zero rows.';
