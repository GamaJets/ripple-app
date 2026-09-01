-- ─────────────────────────────────────────────────────────────────────────
-- Three things a coach was never told.
--
-- ── What was actually measured ───────────────────────────────────────────
--
-- Every notification in this product was found by grepping `sendPush`,
-- `sendPushChecked`, `recordInbox` and `notify_users` across app/, src/ and
-- supabase/, and reading the recipient of each. A coach is told about exactly
-- THREE things:
--
--   · a client booked a PT slot       app/(client)/calendar.tsx
--   · a client cancelled one          src/ui/sessions.tsx (late cancels included)
--   · a client sent a message         supabase/functions/notify-message, and
--                                     again from src/ui/messaging.ts
--
-- Everything else a client does reaches their coach only if the coach happens
-- to go looking at the right screen. The roadmap named three of those, and this
-- part is those three.
--
--   1. A COACHING REQUEST. `coach_requests` has two writers — the directory
--      insert in app/(client)/trainers.tsx and `join_by_code()`, which is how
--      somebody who was handed a code joins — and neither notifies anybody. The
--      request appears as a card on the coach's client list (src/ui/CoachRequests.tsx)
--      and nowhere else, so a coach who does not open that screen for a week has
--      a person waiting a week to find out whether they have a coach. That
--      component's own comment says what the silence costs: "a client asks to be
--      coached, the coach never learns they asked, and both sides wait on the
--      other."
--
--   2. A SUBSCRIPTION STARTING, FAILING OR ENDING. `client_subscriptions` is
--      written only by supabase/functions/stripe-webhook, which contains the
--      strings `notification`, `notify`, `sendPush` and `push_token` zero times.
--      A card failing and a client churning are money, and the first a coach
--      hears of either is the next time they count the rows on Payments &
--      Packages.
--
--   3. AN ACCEPTED DOCUMENT. `coach_document_acceptances` is the evidence half
--      of part 135 — the record that somebody read a waiver and agreed to it —
--      and the coach who asked for it is told nothing when it arrives.
--
-- ── Why all three are triggers and none is a push ────────────────────────
--
-- Not a style choice; each of the three refuses the app-side route for its own
-- reason.
--
--   · `notify_users()` (part 122) authorises the recipient against the CALLER's
--     relationships: the recipient must be the caller, their client, their
--     coach, or a member of a gym they own. A client requesting coaching from
--     the directory has NO relationship with that coach — that is the entire
--     content of the request — so notify_users() would correctly write nothing
--     and report 0. Widening it to admit "somebody I have a pending request
--     with" was considered and rejected: it makes a general-purpose fan-out
--     function's authorisation depend on a table it otherwise knows nothing
--     about, to serve one caller, and the same row can be written from SQL for
--     free.
--
--   · `join_by_code()` inserts a `coach_requests` row on the server. A push
--     added to the app would cover the directory path and miss that one, which
--     is the half where the client was handed a code by the coach in person and
--     is standing in front of them.
--
--   · `client_subscriptions` is written by a webhook running as the service
--     role, where `auth.uid()` is null and the app is not involved at all. There
--     is no screen that could send it.
--
-- Triggers also mean these cannot be forgotten by the next writer of any of the
-- three tables, which is the argument src/ui/pushNotifications.ts already makes
-- about recording at a choke point rather than at eleven call sites.
--
-- ── SECURITY DEFINER, and the two things that protects against ───────────
--
-- `notif_self` is `for all using (user_id = auth.uid())`, which is exactly
-- backwards for a notification addressed to somebody else — the same reason
-- part 122 and part 146 give. `search_path` is pinned so the tables these
-- functions resolve cannot be chosen by whoever happens to be inserting, and
-- each is revoked from public, anon AND authenticated: Postgres checks EXECUTE
-- when a trigger is CREATED, not when it fires, so a trigger function needs no
-- grant to anybody (part 51, part 141).
--
-- ── A notification must never fail the write it is about ─────────────────
--
-- These fire inside the transaction of the thing they describe. An exception
-- here would roll back a coaching request, an acceptance, or — worst — a Stripe
-- webhook, which Stripe would then retry forever. `notifications.user_id` is
-- `not null references profiles(id)`, so the recipient is the only way that
-- could happen, and each function is guarded on it:
--
--   `coach_requests.trainer_id`      not null references profiles(id)   — safe
--   `coach_documents.coach_id`       not null references trainers(id),
--                                    and trainers.id references profiles(id)   — safe
--   `client_subscriptions.trainer_id` NULLABLE (on delete set null)  — GUARDED
--
-- Deliberately not wrapped in `exception when others then null`. That would
-- swallow a real defect silently and forever, and the FK reasoning above is a
-- stronger guarantee than a catch-all; if one of those foreign keys is ever
-- relaxed, this comment is the thing that should stop it.
--
-- ── What none of these say ───────────────────────────────────────────────
--
-- No money. `client_subscriptions.amount_cents` and `.currency` are both
-- nullable, Repple is white-labelled and has no default currency anywhere, and
-- formatting minor units correctly is already done once in src/lib/coachMoney.ts
-- — restating it in plpgsql would be the copy that drifts, and the failure mode
-- of a drifted copy is a coach told a figure that is not the figure. Part 146
-- made the same call for the same reasons. The notifications state WHAT
-- happened and send the coach to the screen that already knows how to render
-- the numbers.
--
-- Idempotent; safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════
-- 1 · A coaching request
-- ═════════════════════════════════════════════════════════════════════════
--
-- INSERT only, and only for a row that lands 'pending'. A declined request can
-- be sent again later (`coach_requests_one_pending` is a partial unique index
-- on pending rows precisely so it can), and that second attempt is a second
-- insert — so it is a second notification, correctly, because it is a person
-- asking again.
--
-- Not fired on UPDATE. A coach answering a request is not news to themselves,
-- and the client's side of that answer is a separate decision about wording
-- that has not been taken.
--
-- The client's name is read from `profiles` and it is theirs to give: the coach
-- can already read it — `profiles_requesting_client_r` (part 142) exists so
-- that the request card can show who is asking — so this states nothing the
-- recipient could not already see. A blank or missing name falls back to
-- "Somebody", never to an empty string that would render as a sentence starting
-- with a space.

create or replace function public.coach_request_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_name text;
  v_how  text;
  v_mode text;
begin
  if new.status <> 'pending' then
    return new;
  end if;

  select nullif(btrim(coalesce(p.full_name, '')), '')
    into v_name
    from public.profiles p
   where p.id = new.client_id;

  -- How they found the coach. `source` is null for rows predating part 56, and
  -- a null says nothing rather than guessing one of the two — a coach told
  -- someone used their join code when nobody knows that would be a fabricated
  -- fact about their own marketing.
  v_how := case new.source
             when 'code'      then ' used your join code and has asked you to coach them'
             when 'directory' then ' found you in the directory and has asked you to coach them'
             else                  ' has asked you to coach them'
           end;

  v_mode := case new.mode
              when 'inperson' then ' in person.'
              when 'hybrid'   then ' both in person and online.'
              else                 ' online.'
            end;

  insert into public.notifications (user_id, title, body, icon, route)
  values (
    new.trainer_id,
    'A coaching request',
    left(coalesce(v_name, 'Somebody') || v_how || v_mode
         || ' Accept or decline it on your Clients screen — until you do, they are waiting.', 500),
    'people',
    '/(trainer)/dashboard'
  );

  return new;
end;
$function$;

comment on function public.coach_request_notify() is
  'Writes the coach one inbox row when a client asks to be coached, from the directory or by join code. See part 158.';

drop trigger if exists coach_requests_notify_trainer on public.coach_requests;
create trigger coach_requests_notify_trainer
  after insert on public.coach_requests
  for each row execute function public.coach_request_notify();

revoke all on function public.coach_request_notify() from public;
revoke all on function public.coach_request_notify() from anon;
revoke all on function public.coach_request_notify() from authenticated;


-- ═════════════════════════════════════════════════════════════════════════
-- 2 · An accepted document
-- ═════════════════════════════════════════════════════════════════════════
--
-- INSERT only, which is the whole of what this table permits: part 135 gives it
-- no UPDATE policy and no DELETE policy, because evidence that can be withdrawn
-- is not evidence. There is exactly one event to report.
--
-- The document's title is quoted so the coach knows WHICH document without
-- opening anything. It is their own text — they typed it when they uploaded the
-- file — so nothing here is putting words in anybody's mouth.

create or replace function public.coach_doc_acceptance_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_coach uuid;
  v_doc   text;
  v_name  text;
begin
  select d.coach_id, d.title
    into v_coach, v_doc
    from public.coach_documents d
   where d.id = new.document_id;

  -- Cannot happen through the foreign key, and checked anyway: this runs inside
  -- the transaction that records somebody agreeing to a waiver, and that write
  -- is worth more than this one.
  if v_coach is null then
    return new;
  end if;

  select nullif(btrim(coalesce(p.full_name, '')), '')
    into v_name
    from public.profiles p
   where p.id = new.client_id;

  insert into public.notifications (user_id, title, body, icon, route)
  values (
    v_coach,
    'Paperwork accepted',
    left(coalesce(v_name, 'A client') || ' has accepted “' || coalesce(v_doc, 'a document') || '”.'
         || ' It is recorded against their name, and it cannot be withdrawn by either of you.', 500),
    'pencil',
    '/(trainer)/documents'
  );

  return new;
end;
$function$;

comment on function public.coach_doc_acceptance_notify() is
  'Writes the coach one inbox row when a client accepts one of their documents. See part 158.';

drop trigger if exists coach_doc_acceptances_notify_coach on public.coach_document_acceptances;
create trigger coach_doc_acceptances_notify_coach
  after insert on public.coach_document_acceptances
  for each row execute function public.coach_doc_acceptance_notify();

revoke all on function public.coach_doc_acceptance_notify() from public;
revoke all on function public.coach_doc_acceptance_notify() from anon;
revoke all on function public.coach_doc_acceptance_notify() from authenticated;


-- ═════════════════════════════════════════════════════════════════════════
-- 3 · A subscription starting, failing or ending
-- ═════════════════════════════════════════════════════════════════════════
--
-- ── This block MIRRORS src/lib/subscriptionScope.ts · subChange() ────────
--
-- The rule is a reading of Stripe's status vocabulary and there is already
-- exactly one place in this repository that owns that vocabulary — `subState`,
-- `LIVE` and `ENDED` in src/lib/subscriptionScope.ts, which the coach's
-- Payments screen and the client's Memberships screen both read. A second copy
-- of those word lists is the copy that drifts.
--
-- So the decision is stated once in TypeScript, with a transition-by-transition
-- truth table in src/lib/subscriptionScope.test.ts, and this function mirrors it
-- line for line. `subChange()` has no runtime caller in the app and that is
-- deliberate: it is the specification, and the test is the only place this rule
-- can be proved, because the only thing that ever fires this trigger is a Stripe
-- webhook that no test in this repository can reach.
--
-- IF YOU CHANGE ONE, CHANGE BOTH. The TypeScript is the original.
--
-- The three transitions, and why they are movements between bands rather than
-- arrivals at words:
--
--   started  reaching 'active'/'trialing' from a status that has NEVER charged
--            — nothing at all, or 'incomplete'. A signup is two writes
--            ('incomplete' then 'active') and a coach told twice about one
--            subscriber learns to ignore the notification. Not from 'past_due'
--            (a card recovering), not from 'paused' (a subscriber they already
--            had), and not from a word this app does not recognise, because a
--            resume and a signup are indistinguishable from the outside.
--   failed   reaching 'past_due'. Still inside the live band — a failed card
--            has not ended anything — and the one of the three a coach can act
--            on the same day.
--   ended    reaching one of Stripe's three words for over, from outside that
--            band. 'unpaid' then 'canceled' is one ending, not two.
--
-- Anything else, including a status Stripe invents after this was written, is
-- silence. The Payments screen already shows such a row and quotes Stripe's own
-- word back (`unsettledNote`); a notification cannot do that in a way anybody
-- could act on.
--
-- ── Fires on INSERT as well as UPDATE ────────────────────────────────────
--
-- The webhook creates the row and then updates it, and a subscription that
-- arrives already 'active' would otherwise never be reported. On INSERT the
-- previous status is the empty string, which is what makes that a 'started'.
--
-- `old.status is not distinct from new.status` returns early on UPDATE, which
-- covers the ordinary case of a redelivered webhook rewriting a row with the
-- status it already had. Stripe retries; a retry is not a second event, and a
-- coach told twice that a client churned would go and ask them about it.

create or replace function public.client_subscription_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  -- Nothing here reads NEW or OLD. A DECLARE initialiser that did would be
  -- evaluated before the guard below has had a chance to return, which is fine
  -- today and is the kind of thing that stops being fine when somebody adds a
  -- lookup to one of them.
  v_before text := '';
  v_after  text;
  v_name   text;
  v_change text;
  v_title  text;
  v_body   text;
begin
  -- NULLABLE, unlike the recipients in sections 1 and 2 — `trainer_id` is
  -- `on delete set null`, so a coach who deleted their account leaves rows
  -- behind with nobody to tell. Returning early is the whole of the protection
  -- this function needs against failing a Stripe webhook.
  if new.trainer_id is null then
    return new;
  end if;

  v_after := lower(btrim(coalesce(new.status, '')));

  if tg_op = 'UPDATE' then
    v_before := lower(btrim(coalesce(old.status, '')));
    if v_before = v_after then
      return new;
    end if;
  end if;

  -- ── subChange(), in the same order and with the same sets ──────────────
  if v_after in ('canceled', 'incomplete_expired', 'unpaid')
     and v_before not in ('canceled', 'incomplete_expired', 'unpaid') then
    v_change := 'ended';
  elsif v_after = 'past_due' then
    v_change := 'failed';
  elsif v_after in ('trialing', 'active') and v_before in ('', 'incomplete') then
    v_change := 'started';
  else
    return new;
  end if;

  select nullif(btrim(coalesce(p.full_name, '')), '')
    into v_name
    from public.profiles p
   where p.id = new.client_id;

  -- No figure, in any branch. See the header: there is no default currency in
  -- this product and the column is nullable, so the amount belongs on the
  -- screen that already knows how to render it or nowhere.
  if v_change = 'ended' then
    v_title := 'A subscription has ended';
    v_body  := coalesce(v_name, 'A client')
            || ' is no longer subscribed to you. Nothing further will be charged on it.'
            || ' Your Payments & Packages screen has the detail.';
  elsif v_change = 'failed' then
    v_title := 'A subscription payment failed';
    v_body  := 'A payment from ' || coalesce(v_name, 'a client') || ' did not go through.'
            || ' The subscription has not ended — Stripe will retry the card, and it is worth a word with them.';
  else
    v_title := 'A subscription has started';
    v_body  := coalesce(v_name, 'A client') || ' has started subscribing to you.'
            || ' Your Payments & Packages screen has the amount and the renewal date.';
  end if;

  insert into public.notifications (user_id, title, body, icon, route)
  values (new.trainer_id, v_title, left(v_body, 500), 'grid', '/(trainer)/payments');

  return new;
end;
$function$;

comment on function public.client_subscription_notify() is
  'Writes the coach one inbox row when a client subscription starts, fails a payment or ends. Mirrors subChange() in src/lib/subscriptionScope.ts — change both. See part 158.';

drop trigger if exists client_subscriptions_notify_trainer on public.client_subscriptions;
create trigger client_subscriptions_notify_trainer
  after insert or update of status on public.client_subscriptions
  for each row execute function public.client_subscription_notify();

revoke all on function public.client_subscription_notify() from public;
revoke all on function public.client_subscription_notify() from anon;
revoke all on function public.client_subscription_notify() from authenticated;
