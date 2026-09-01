-- ─────────────────────────────────────────────────────────────────────────
-- The pack nobody told the coach was running out.
--
-- ── What was silent, and how that was established ────────────────────────
--
-- `packRunOut()` in src/lib/coachMoney.ts has been able to say that a paid
-- session pack has nothing left on it since it was written, and it is tested.
-- Exactly one thing renders it: app/(trainer)/payments.tsx, a screen a coach
-- opens when they are thinking about money, which is not the moment this
-- matters. The moment it matters is the session after the last one, when the
-- coach turns up and delivers a session nothing pays for.
--
-- The same sweep parts 158, 159 and 160 ran, narrowed to this row: grep
-- `notifications`, `notify_users`, `sendPush`, `sendPushChecked` and
-- `recordInbox` across app/, src/ and supabase/, and read every writer that can
-- touch `client_purchases`.
--
--   · `redeemSession` in the app increments `sessions_used` when a client books
--     a session against a pack.
--   · `promote_from_waitlist()` (setup.sql) increments it on the SERVER, when a
--     client is promoted off a waitlist while their phone is in their pocket —
--     its own comment explains that the draw-down has to happen there too or
--     "the queue is the cheapest way to book, and the coach delivers a session
--     nobody paid for".
--   · supabase/functions/stripe-webhook inserts the row and sets
--     `sessions_total`.
--
-- None of the three notifies anybody, and `client_purchases` carries no trigger
-- at all. Part 159 added `client_purchase_notify` for the row being BOUGHT; it
-- fires on insert and says nothing about the balance afterwards.
--
-- ── Why a trigger, and not a push from the booking screen ────────────────
--
-- Two writers, and one of them is not the app. `promote_from_waitlist()` runs
-- as a server function with the client's phone asleep; a push added to
-- `redeemSession` would cover the tap and miss the promotion — which is exactly
-- the half where nobody was watching. The same argument part 158 makes about
-- `join_by_code()`.
--
-- A trigger on the column is also the choke point: the next writer of
-- `sessions_used` cannot forget it. src/ui/pushNotifications.ts makes this
-- argument about recording at a choke point rather than at eleven call sites.
--
-- ── TWO messages, and why not one ────────────────────────────────────────
--
-- `packRunOut()` is `left === 0`, and a notification at zero is late: the coach
-- learns the pack is spent at the moment the last session is booked, which may
-- be the session they are about to deliver. So there are two crossings:
--
--   ONE LEFT   the coach can raise it in the session they are about to run,
--              which is the cheapest possible conversation about renewing.
--   NONE LEFT  the next session is not covered by anything.
--
-- Both fire only on a DOWNWARD crossing of their own threshold, so a pack going
-- 2 → 1 → 0 produces exactly two rows, and a pack that arrives at 1 in one step
-- from 5 produces one warning and no retrospective ones for 4, 3 and 2. An
-- UPDATE that does not move the balance — a status correction, a refund written
-- by hand that puts sessions back — produces nothing.
--
-- ── The guards, each of which is a way this could fail a booking ─────────
--
-- This fires inside the transaction of somebody booking a session, and one of
-- those transactions is `promote_from_waitlist()`. An exception here rolls back
-- the booking, and a client promoted off a waitlist would silently stay on it.
-- `notifications.user_id` is `not null references profiles(id)`, so the
-- recipient is the only realistic way that happens:
--
--   `client_purchases.trainer_id`  NULLABLE (on delete set null)  — GUARDED,
--                                  and it is the recipient, so a coach who
--                                  deleted their account costs this message
--                                  entirely rather than costing somebody a
--                                  booking.
--   `client_purchases.client_id`   NULLABLE (on delete set null)  — used only
--                                  as a NAME. A deleted client leaves the pack
--                                  behind, and the coach is still told about
--                                  the balance without one.
--
-- Deliberately NOT wrapped in `exception when others then null`, for part 158's
-- reason: that swallows a real defect silently and forever, and the foreign-key
-- reasoning above is the stronger guarantee.
--
-- ── What this must not say ───────────────────────────────────────────────
--
-- NO MONEY. `client_purchases.amount_cents` is nullable and carries no currency
-- of its own — `Purchase.currency` in src/lib/connect.ts is a separate column
-- written at checkout and null on older rows — Repple is white-labelled and
-- there is no default currency anywhere (part 150), and minor units are
-- formatted correctly in exactly one place already, src/lib/coachMoney.ts. A
-- second copy of that in plpgsql is the copy that drifts, and a drifted copy
-- tells a coach a figure that is not the figure. Parts 146, 158 and 160 all
-- made this call. The message states the COUNT, which is the thing the coach
-- has to act on, and sends them to the screen that knows how to price it.
--
-- ── And why the CLIENT is not told ───────────────────────────────────────
--
-- Considered, and refused on part 160's own test: the recipient must be able to
-- act AND have no other way to learn. A client fails the second half — they
-- just booked the session that spent the credit, they are holding the phone
-- that did it, and app/(client)/packages.tsx shows them the balance. Telling
-- somebody a thing they did is a receipt for a receipt.
--
-- The exception is a client promoted off a WAITLIST, who did not tap anything.
-- That is a real gap and it is left open here on purpose: the message that
-- notification wants is about the booking, not about the balance, and nobody
-- has taken that decision. Recorded so it is a decision rather than an
-- oversight.
--
-- Idempotent; safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.pack_balance_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_old_left integer;
  v_new_left integer;
  v_name     text;
  v_title    text;
  v_body     text;
begin
  -- Not a pack. A one-off membership has no credits to run out of, which is the
  -- same reason `packLeft()` returns null rather than 0 for one — "0 left"
  -- beside a membership reads as a client who has used everything they paid for.
  if new.sessions_total is null or new.trainer_id is null then
    return new;
  end if;

  -- Only a pack that is actually paid for draws down. A refunded or pending row
  -- reaching zero is not a coach's cue to sell another one.
  if new.status is distinct from 'paid' then
    return new;
  end if;

  -- Clamped at zero at both ends, matching `packLeft()`: a refund written by
  -- hand can take `sessions_used` past `sessions_total`, and a negative balance
  -- would make every comparison below mean something nobody intended.
  v_old_left := greatest(0, coalesce(old.sessions_total, new.sessions_total) - coalesce(old.sessions_used, 0));
  v_new_left := greatest(0, new.sessions_total - coalesce(new.sessions_used, 0));

  -- Only downward. An UPDATE that does not move the balance — a status
  -- correction, a webhook redelivered, sessions handed back — says nothing, and
  -- a pack going back up is not news that it is running out.
  if v_new_left >= v_old_left then
    return new;
  end if;

  -- The client's name, and it is theirs to give: the coach can already read it
  -- through `profiles_trainer_r_clients`, so this states nothing the recipient
  -- could not already see. A blank or missing name falls back to "A client",
  -- never to an empty string that would render a sentence starting with a space.
  select nullif(btrim(coalesce(p.full_name, '')), '')
    into v_name
    from public.profiles p
   where p.id = new.client_id;

  if v_new_left = 0 and v_old_left > 0 then
    v_title := 'A session pack has run out';
    v_body  := coalesce(v_name, 'A client')
      || ' has just used the last session on their pack. The next one they book is not covered by anything they have paid for.'
      || ' Open Payments & Packages to see the pack and what you sell.';
  elsif v_new_left = 1 and v_old_left > 1 then
    v_title := 'A session pack is nearly used up';
    v_body  := coalesce(v_name, 'A client')
      || ' has one session left on their pack. Raising it in that session is the easiest conversation you will have about renewing it.';
  else
    return new;
  end if;

  insert into public.notifications (user_id, title, body, icon, route)
  values (new.trainer_id, v_title, left(v_body, 500), 'grid', '/(trainer)/payments');

  return new;
end;
$function$;

comment on function public.pack_balance_notify() is
  'Tells the COACH when a paid session pack crosses down to one session left, and again when it reaches none. Both writers of sessions_used are covered, including promote_from_waitlist(), which runs on the server. No money in the message — see part 163.';

-- `of sessions_used` narrows the trigger to the column that can change a
-- balance, so a status correction or a name change on the row does not even
-- enter the function. The guards inside still stand: `update … set
-- sessions_used = sessions_used` is a write of that column that changes nothing,
-- and the downward-crossing check is what refuses it.
drop trigger if exists client_purchases_notify_balance on public.client_purchases;
create trigger client_purchases_notify_balance
  after update of sessions_used on public.client_purchases
  for each row execute function public.pack_balance_notify();

-- Revoked from public, anon AND authenticated. Postgres checks EXECUTE when a
-- trigger is CREATED, not when it fires, so a trigger function needs no grant to
-- anybody (parts 51, 141, 158). Postgres grants EXECUTE to PUBLIC on every new
-- function and `anon` resolves through that grant, so both are named.
revoke all on function public.pack_balance_notify() from public;
revoke all on function public.pack_balance_notify() from anon;
revoke all on function public.pack_balance_notify() from authenticated;
