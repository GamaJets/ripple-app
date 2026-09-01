-- ═══════════════════════════════════════════════════════════════════════════
-- The coach's most valuable client is the one whose money the app refused to
-- track.
--
-- A one-off booking draws a credit off a session pack. A STANDING appointment
-- does not, and `RECURRING_CREDIT_NOTE` in src/lib/recurring.ts says so on both
-- screens that render it: "It doesn't draw credits from a session pack in
-- advance — your coach settles what's owed with you."
--
-- So a client on a ten-pack with a standing Tuesday 6:30 consumes zero credits,
-- forever. The pack balance on the coach's Payments screen is wrong, the
-- run-out alert never fires, and the renewal conversation — the single most
-- valuable moment in a coaching relationship — never arrives.
--
-- ── Where the divergence actually is ─────────────────────────────────────
--
-- A one-off is booked by the CLIENT, on their phone, and
-- app/(client)/calendar.tsx calls `redeemSession` immediately afterwards. A
-- recurring occurrence is created by `_materialise_session_series` (part 135)
-- on a cron, eight weeks ahead, with no device involved at all — so the
-- client-side redeem simply never runs, and there was nowhere for it to run.
--
-- ── Why this does NOT draw at materialisation ────────────────────────────
--
-- Part 135's own header refuses that, and it is right. The materialiser runs 56
-- days ahead, so drawing there would take eight weeks of credits off a pack for
-- sessions nobody has had yet — a client would open the app and find their
-- ten-pack empty in the first fortnight — and ending the series would then have
-- to hand every one of them back, which is a refund path this product does not
-- have.
--
-- It draws AT DELIVERY instead: one credit when the session is marked
-- completed. That is the moment the thing the credit pays for has actually
-- happened, it needs no forecast, and it needs no unwind when a series ends,
-- because a session that never happened was never marked.
--
-- ── Why it is a trigger and not a line in a screen ───────────────────────
--
-- An outcome is written from at least three places — app/(trainer)/sessions.tsx,
-- class-checkin.tsx, and the client's own cancellation path — and a rule about
-- money that lives in one of three writers is a rule that is wrong in the other
-- two the day somebody adds a fourth. The trigger covers every writer, present
-- and future, including the ones added by somebody who has not read this file.
--
-- ── Why it cannot draw twice, and why it gives back ──────────────────────
--
-- `sessions.pack_drawn_at` is the marker. The draw happens only on a transition
-- INTO 'completed' from something else, and only when the marker is null; the
-- marker is set in the same statement. So re-marking a session completed, or a
-- screen that writes the same outcome twice, draws once.
--
-- Marking it back OFF 'completed' RETURNS the credit. A coach who ticks the
-- wrong client and corrects it must not leave that person a session short — and
-- the client cannot see the correction happen, so an app that quietly kept the
-- credit would be taking a session off somebody who never had one.
--
-- ── Why only recurring occurrences ───────────────────────────────────────
--
-- `series_id is not null` is the discriminator, and it is exact rather than
-- convenient. A one-off booking ALREADY drew its credit at booking time, on the
-- client's phone; drawing again at delivery would take two credits for one
-- session, which is the same class of error as the lost update part 123 exists
-- to prevent and is worse, because it is silent and systematic rather than a
-- race. A session carrying a series_id was created by the materialiser and has
-- never been through `redeem_pack_session`.
--
-- ── What it deliberately does not do ─────────────────────────────────────
--
-- It does not charge anybody, does not create a pack, and does not fail the
-- session write when there is no pack to draw from. A client with no credits is
-- an ordinary and common state — they may be on a membership, or paying the
-- coach in cash — and refusing to record that a session happened because
-- nothing was there to deduct would break attendance for everybody who is not
-- on a pack. It draws where there is something to draw from, records that it
-- did, and is silent otherwise.
--
-- auth.uid() is NOT used anywhere below. This runs inside a trigger on behalf
-- of whoever marked the session, and the client whose pack it draws is named on
-- the session row.
-- ─────────────────────────────────────────────────────────────────────────

-- ── The marker ───────────────────────────────────────────────────────────

alter table public.sessions add column if not exists pack_drawn_at timestamptz;
alter table public.sessions add column if not exists pack_drawn_purchase_id uuid
  references public.client_purchases(id) on delete set null;

comment on column public.sessions.pack_drawn_at is
  'When a session-pack credit was drawn for this session. NULL means none was — which includes a client on a membership, a client paying cash, and a one-off booking that drew its credit at booking time instead.';
comment on column public.sessions.pack_drawn_purchase_id is
  'WHICH pack the credit came off, so returning it puts it back on the same one rather than on whichever pack happens to be oldest today. ON DELETE SET NULL: a deleted purchase leaves the credit unreturnable, which is honest — there is nothing left to return it to.';

create index if not exists sessions_pack_drawn_idx
  on public.sessions (pack_drawn_purchase_id)
  where pack_drawn_purchase_id is not null;

-- ── Draw, and give back ──────────────────────────────────────────────────

create or replace function public.sessions_pack_draw()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_id uuid;
  v_used int;
  n int;
begin
  -- Only a standing appointment. A one-off already drew its credit at booking
  -- time and drawing again here would take two for one session.
  if new.series_id is null then
    return new;
  end if;

  -- ── giving it back ─────────────────────────────────────────────────────
  --
  -- Checked FIRST, because a correction is the case where getting it wrong
  -- costs a client a session they never had. Off 'completed', with a credit
  -- recorded against this session: put it back on the SAME pack it came off.
  if old.outcome = 'completed'
     and new.outcome is distinct from 'completed'
     and new.pack_drawn_purchase_id is not null then
    update public.client_purchases cp
       set sessions_used = greatest(0, cp.sessions_used - 1)
     where cp.id = new.pack_drawn_purchase_id;
    get diagnostics n = row_count;
    -- The pack row is gone (the FK set the column to null on delete, so this is
    -- only reachable in the same transaction as a delete). Nothing to give back
    -- to, and clearing the marker anyway would let the next completion draw a
    -- second credit for the same session.
    if n = 1 then
      new.pack_drawn_at := null;
      new.pack_drawn_purchase_id := null;
    end if;
    return new;
  end if;

  -- ── drawing it ─────────────────────────────────────────────────────────
  --
  -- Only on the transition INTO 'completed', and only when nothing has been
  -- drawn for this session yet. Both conditions, not either: the transition
  -- alone would draw again on a session corrected twice, and the marker alone
  -- would draw on any update at all to an already-completed session.
  if new.outcome = 'completed'
     and old.outcome is distinct from 'completed'
     and new.pack_drawn_at is null
     and new.client_id is not null
     and new.trainer_id is not null then

    -- The oldest pack with room, held for update — the same rule and the same
    -- lock `redeem_pack_session` uses (part 123). Oldest first so a client who
    -- has bought two packs finishes the first one, which is what they expect
    -- and what the expiry conversation depends on.
    select cp.id, cp.sessions_used
      into v_id, v_used
      from public.client_purchases cp
     where cp.client_id = new.client_id
       and cp.trainer_id = new.trainer_id
       and cp.status = 'paid'
       and cp.sessions_total is not null
       and cp.sessions_used < cp.sessions_total
     order by cp.created_at asc, cp.id asc
     limit 1
       for update;

    -- No pack, or none with anything left. NOT an error: the client may be on a
    -- membership or paying in cash, and refusing to record that a session
    -- happened because nothing was there to deduct would break attendance for
    -- everybody who is not on a pack.
    if v_id is null then
      return new;
    end if;

    update public.client_purchases cp
       set sessions_used = cp.sessions_used + 1
     where cp.id = v_id
       and cp.sessions_used = v_used;
    get diagnostics n = row_count;

    -- Zero rows means the row moved between the lock and the write. Marking the
    -- session as drawn anyway would record a credit that was never taken, and
    -- the client would be a session short on paper and not in fact — so the
    -- marker is set ONLY when the database confirms the write.
    if n = 1 then
      new.pack_drawn_at := now();
      new.pack_drawn_purchase_id := v_id;
    end if;
  end if;

  return new;
end $fn$;

revoke all on function public.sessions_pack_draw() from public, anon, authenticated;

-- BEFORE, not AFTER, so the marker columns are written as part of the same row
-- update rather than as a second statement that could fail on its own and leave
-- a credit drawn with nothing recording it.
drop trigger if exists sessions_pack_draw_on_outcome on public.sessions;
create trigger sessions_pack_draw_on_outcome
  before update of outcome on public.sessions
  for each row execute function public.sessions_pack_draw();
