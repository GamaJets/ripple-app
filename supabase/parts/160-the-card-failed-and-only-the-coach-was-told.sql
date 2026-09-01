-- ─────────────────────────────────────────────────────────────────────────
-- The card failed, and only the coach was told.
--
-- ── What was silent, and how that was established ────────────────────────
--
-- Part 158 section 3 put a trigger on `client_subscriptions` and closed three
-- silences for the COACH: a subscription starting, failing a payment, and
-- ending. `client_subscription_notify()` reads `subChange()`'s three bands and
-- then writes exactly one row, `values (new.trainer_id, …)`. One recipient, in
-- all three branches.
--
-- The middle band is the one that does not belong to the coach. A card
-- declining is the client's card, on the client's account, and the coach cannot
-- fix it — the only person who can is the one who was not told.
--
-- The sweep behind this is the same one parts 158 and 159 ran, narrowed to the
-- one event: grep `notifications`, `notify_users`, `sendPush`, `sendPushChecked`
-- and `recordInbox` across app/, src/ and supabase/, and read every writer that
-- can fire on a `past_due` subscription.
--
--   · supabase/functions/stripe-webhook is the ONLY writer of
--     `client_subscriptions` (part 97 gives the table no insert, update or
--     delete policy at all — writes belong to the service role). That function
--     contains `notification`, `notify`, `sendPush` and `push_token` zero times.
--     Part 158's header records the same finding.
--   · supabase/parts/158 · `client_subscription_notify()` is the only trigger on
--     the table, and its insert names `new.trainer_id`.
--   · The client's own path to this news is app/(client)/packages.tsx, which
--     draws a `t.crit` banner under any row whose `status` is 'past_due':
--     "Your last payment did not go through. The subscription has not ended —
--     update your card and it carries on." Correct, and it is waiting on a
--     screen rather than arriving. A client who does not open Memberships &
--     Packs — and nobody opens it weekly — finds out when their coaching stops.
--
-- So the client is told here, by the same mechanism and on the same event, and
-- part 158 is left alone: parts are applied in order and 158 is already live.
-- A second function with a second trigger is also the honest shape — these are
-- two different messages to two different people about one row, exactly as
-- `coaching_end_notify()` in part 159 is one function writing two different
-- rows for the two sides of an ending.
--
-- ── Only the failure, and why not the other two bands ────────────────────
--
-- 'started' and 'ended' are deliberately not mirrored to the client.
--
--   · A subscription STARTING is something the client just did. They are
--     holding the phone that did it, and Stripe emails them a receipt. A
--     notification there is a receipt for a receipt.
--   · A subscription ENDING is either something they cancelled — same argument
--     — or the tail of this failure, and telling somebody twice about one card
--     is how a notification stops being read. If that ever needs saying, it
--     needs saying with wording about what they have lost access to, which is a
--     decision nobody has taken.
--
-- 'failed' is the one band where the recipient can act and has no other way to
-- learn. That is the whole test this file applies.
--
-- ── The band, mirrored rather than re-derived ────────────────────────────
--
-- `subChange()` in src/lib/subscriptionScope.ts owns Stripe's status vocabulary
-- for this product, part 158 mirrors it line for line, and this mirrors 158's
-- 'failed' branch — reaching 'past_due' from any other status. Not "is
-- past_due": Stripe redelivers, and a redelivered webhook rewriting a row with
-- the status it already had is not a second decline. Same guard as 158:
-- `old.status is not distinct from new.status` returns early on UPDATE, and on
-- INSERT the previous status is the empty string, so a row that arrives already
-- past_due is reported once.
--
-- IF 158's BAND CHANGES, CHANGE THIS ONE. The TypeScript is still the original.
--
-- ── SECURITY DEFINER, and the two things that protects against ───────────
--
-- `notif_self` is `for all using (user_id = auth.uid())`, which is backwards for
-- a row addressed to somebody else — parts 122, 146, 158 and 159 all say so, and
-- the writer here is a webhook where `auth.uid()` is null in any case.
-- `search_path` is pinned to 'public','pg_temp' so the tables this resolves
-- cannot be chosen by whoever is inserting, and it is revoked from public, anon
-- AND authenticated: Postgres checks EXECUTE when a trigger is CREATED, not when
-- it fires, so a trigger function needs no grant to anybody (parts 51, 141, 158).
--
-- ── A notification must never fail the write it is about ─────────────────
--
-- This fires inside the transaction of a Stripe webhook. An exception here
-- rolls that webhook back, and Stripe retries a failed webhook — forever, on a
-- schedule, for an event that will fail the same way every time.
-- `notifications.user_id` is `not null references profiles(id)`, so the
-- recipient is the only realistic way that could happen, and:
--
--   `client_subscriptions.client_id`  NULLABLE (on delete set null)  — GUARDED
--   `client_subscriptions.trainer_id` NULLABLE (on delete set null)  — GUARDED,
--                                     and only as a NAME, not as a recipient:
--                                     a coach who deleted their account costs
--                                     this message its coach's name and not the
--                                     message.
--
-- `client_id` being nullable is the trap part 158 documented from the other
-- side. 158 guards `trainer_id` because that is who it writes to; the recipient
-- here is the other column, and it is nullable for the same reason — a client
-- who deleted their account leaves the subscription row behind with nobody to
-- tell. Not wrapped in `exception when others then null`, for 158's reason:
-- that swallows a real defect silently and forever, and the foreign-key
-- reasoning above is the stronger guarantee.
--
-- ── What this must not say ───────────────────────────────────────────────
--
-- NO MONEY. `client_subscriptions.amount_cents` and `.currency` are both
-- nullable, Repple is white-labelled and there is no default currency anywhere
-- (part 150), and minor units are formatted correctly in exactly one place
-- already — src/lib/coachMoney.ts. A second copy in plpgsql is the copy that
-- drifts, and a drifted copy tells somebody a figure that is not the figure.
-- Parts 146, 158 and 159 all made the same call. The row says what happened and
-- sends the client to the screen that already renders the amount in the
-- currency Stripe billed it in.
--
-- NO DEADLINE. This database does not know one. Stripe's retry schedule and
-- what happens at the end of it are settings on the Stripe account, not columns
-- here, so "you have seven days" or "it will be cancelled on Friday" would be
-- invented — and invented in the direction that makes somebody panic or relax
-- on a date nobody chose. `current_period_end` is NOT that date either: it is
-- when the period ends, not when a dunning cycle gives up. The row states the
-- position as it is now — the subscription has not ended — and what to do about
-- it, which is true on every one of those days.
--
-- ── The route is answerable ──────────────────────────────────────────────
--
-- '/(client)/packages' is Memberships & Packs, which holds the subscription
-- row, the `past_due` banner quoted above, and the "Payment & Invoices" button
-- that opens Stripe's own portal where a card is actually changed. It survives
-- `safeRoute(…, 'client')`, and `ICON_BY_ROUTE` in src/lib/notifyInbox.ts now
-- carries an entry for it so the row draws the 'trophy' that CLIENT_NAV already
-- gives that screen rather than the generic bell. Both properties are asserted
-- in src/lib/notifyInbox.test.ts, per part 159's rule that a route which does
-- not survive the recipient's build renders perfectly and opens nothing.
--
-- Idempotent; safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════
-- A payment that failed, told to the person whose card it was
-- ═════════════════════════════════════════════════════════════════════════

create or replace function public.client_subscription_notify_client()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  -- Nothing here reads NEW or OLD, for part 158's reason: a DECLARE initialiser
  -- that did would be evaluated before the guard below has had a chance to
  -- return, which is fine today and stops being fine the moment somebody adds a
  -- lookup to one of them.
  v_before text := '';
  v_after  text;
  v_coach  text;
begin
  -- NULLABLE — `client_id` is `on delete set null`, so a client who deleted
  -- their account leaves rows behind with nobody to tell. Returning early is
  -- the whole of the protection this function needs against failing a Stripe
  -- webhook that Stripe would then retry forever.
  if new.client_id is null then
    return new;
  end if;

  v_after := lower(btrim(coalesce(new.status, '')));

  if tg_op = 'UPDATE' then
    v_before := lower(btrim(coalesce(old.status, '')));
    if v_before = v_after then
      return new;
    end if;
  end if;

  -- The 'failed' band of subChange(), and only that band. See the header for
  -- why 'started' and 'ended' are not mirrored to this recipient.
  if v_after <> 'past_due' then
    return new;
  end if;

  -- The coach's name, so a client who buys from two coaches knows which
  -- subscription this is. Theirs to give — the client can already read it, and
  -- does, on the screen this row opens. A blank or missing name falls back to
  -- 'your coach', never to an empty string that would render as a sentence with
  -- a hole in it.
  select nullif(btrim(coalesce(p.full_name, '')), '')
    into v_coach
    from public.profiles p
   where p.id = new.trainer_id;

  insert into public.notifications (user_id, title, body, icon, route)
  values (
    new.client_id,
    'Your payment did not go through',
    -- Nothing here says the coach has been told. They usually have — part 158
    -- writes them a row on the same transition — but that row is guarded on
    -- `trainer_id`, which is exactly the column that is null when this message
    -- falls back to 'your coach'. The one case where the sentence would be
    -- wrong is the one case where it would be printed, so it is not printed.
    left('A payment on your subscription with ' || coalesce(v_coach, 'your coach')
         || ' was declined. The subscription has not ended — open Memberships & Packs,'
         || ' then Payment & Invoices, and update the card there. It carries on from'
         || ' the moment a payment goes through.', 500),
    'trophy',
    '/(client)/packages'
  );

  return new;
end;
$function$;

comment on function public.client_subscription_notify_client() is
  'Writes the CLIENT one inbox row when their subscription payment fails. The coach''s half of this is client_subscription_notify() in part 158; mirrors the ''failed'' band of subChange() in src/lib/subscriptionScope.ts — change all three. See part 160.';

drop trigger if exists client_subscriptions_notify_client on public.client_subscriptions;
create trigger client_subscriptions_notify_client
  after insert or update of status on public.client_subscriptions
  for each row execute function public.client_subscription_notify_client();

revoke all on function public.client_subscription_notify_client() from public;
revoke all on function public.client_subscription_notify_client() from anon;
revoke all on function public.client_subscription_notify_client() from authenticated;
