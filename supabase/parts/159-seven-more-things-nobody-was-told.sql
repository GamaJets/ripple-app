-- ─────────────────────────────────────────────────────────────────────────
-- Seven more things that happen and tell nobody.
--
-- Part 158 is the precedent and this is its second half. That file found that a
-- coach is told about exactly three things a client does — a booking, a
-- cancellation, a message — and closed three of the silences. The same sweep
-- named seven more, and this is those seven.
--
-- ── How each one was established ─────────────────────────────────────────
--
-- The same method as 158: grep `sendPush`, `sendPushChecked`, `recordInbox`,
-- `notify_users` and `notifications` across app/, src/ and supabase/, then read
-- the WRITER of each table below and check whether any of those strings appears
-- anywhere on the path. Seven writers, zero hits:
--
--   1+2. `end_coaching()` (part 68) writes `coaching_relationships.status =
--        'ended'` and `clients.trainer_id = null`. src/lib/endCoaching.ts is
--        careful copy for the person PRESSING the button and there is nothing
--        at all for the person it happens to. Either party may call it, so this
--        is two silences and not one, and they are different silences.
--
--   3.   `client_purchases` is written by supabase/functions/stripe-webhook
--        (`checkout.session.completed`, upserted on `stripe_session_id`). That
--        function contains `notification`, `notify`, `sendPush` and `push_token`
--        zero times — the same finding 158 recorded for `client_subscriptions`,
--        in the same file. Somebody handed the coach money and nothing said so.
--
--   4.   `cancel_class()` (part 38, and part 02 before it) promotes the head of
--        a class waiting list into a freed seat with a bare UPDATE. Compare the
--        PT path: `_promote_session_waitlist` (part 126) is followed by an app
--        that sends "The slot you were waiting for is yours" — twice, once from
--        each side that can free a slot. The class path has the identical
--        promotion and no push at either call site.
--
--   5.   `clients.intake` (part 127). src/ui/intake.ts SENDS a push asking for
--        the intake ('Your coach asked for your intake') and nothing answers it.
--        The ask is loud and the reply is silent, which is the worst possible
--        arrangement of the two.
--
--   6.   `liability_waivers` (part 84) is inserted by src/ui/waiver.tsx and read
--        by nobody but its own author.
--
--   7.   `coach_reviews` (part 139) is written by `write_coach_review()`. The
--        coach's reply box sits on Credentials & Reviews and nothing tells them
--        there is something to reply to.
--
-- ── Why all seven are triggers ───────────────────────────────────────────
--
-- 158's argument, and each of the seven meets at least one half of it.
--
--   · `notify_users()` (part 122) authorises the RECIPIENT against the CALLER's
--     live relationships — you may write to yourself, your client, your coach,
--     or a member of a gym you own. For 1 and 2 the caller is ending exactly the
--     relationship that authorisation is read from, and `end_coaching()` clears
--     `clients.trainer_id` in the same transaction, so by the time there is news
--     to send the sender no longer has standing to send it. An app-side push
--     placed BEFORE the call would announce an ending that then fails; placed
--     after, it is refused. That is not a bug in notify_users(), it is what it
--     is for.
--
--   · There is no `auth.uid()` on the path at all for 3: the Stripe webhook runs
--     as the service role and the app is not involved. Same reason 158 gave for
--     `client_subscriptions`, same file writing it.
--
--   · For 4 the caller is the person LEAVING the class and the recipient is a
--     stranger to them — two members of the same gym have no relationship
--     notify_users() can see, and the promotion is deliberately anonymous in
--     both directions.
--
--   · 5, 6 and 7 could each have been a push from the screen that writes them,
--     and would each then have been one call site somebody has to remember. The
--     argument in src/ui/pushNotifications.ts is that a choke point beats eleven
--     call sites; a trigger is the same argument one layer down, and it also
--     covers `write_coach_review()`'s ON CONFLICT branch, which is a second
--     writer inside the one function.
--
-- ── SECURITY DEFINER, and the grants ─────────────────────────────────────
--
-- `notif_self` is `for all using (user_id = auth.uid())`, which is backwards for
-- a row addressed to somebody else — parts 122, 146 and 158 all say so. Every
-- function below is `security definer` with `search_path` pinned to
-- 'public','pg_temp' so the tables it resolves cannot be chosen by whoever is
-- inserting, and every one is revoked from public, anon AND authenticated:
-- Postgres checks EXECUTE when a trigger is CREATED, not when it fires, so a
-- trigger function needs no grant to anybody (parts 51, 141, 158).
--
-- ── A notification must never fail the write it is about ─────────────────
--
-- These fire inside the transaction of the thing they describe. An exception
-- here would roll back somebody leaving their coach, a Stripe webhook Stripe
-- would then retry forever, or — worst of the seven — a signed liability
-- release. `notifications.user_id` is `not null references profiles(id)`, so the
-- recipient is the only realistic way that could happen, and every function is
-- guarded on it:
--
--   coaching_relationships.coach_id   not null references profiles(id)  — safe
--   coaching_relationships.client_id  not null references profiles(id)  — safe
--   class_bookings.user_id            not null references profiles(id)  — safe
--   coach_reviews.coach_id            not null references profiles(id)  — safe
--   client_purchases.trainer_id       NULLABLE (on delete set null)  — GUARDED
--   clients.trainer_id                NULLABLE (on delete set null)  — GUARDED
--   liability_waivers.user_id         references auth.users, NOT profiles, and
--                                     the recipient is that user's coach —
--                                     two lookups, both GUARDED
--
-- Deliberately not wrapped in `exception when others then null`, for 158's
-- reason: that swallows a real defect silently and forever, and the foreign-key
-- reasoning above is the stronger guarantee. If one of those keys is ever
-- relaxed, this comment is the thing that should stop it.
--
-- ── No money, and no clock either ────────────────────────────────────────
--
-- NO MONEY. `client_purchases.amount_cents` and `.currency` are both nullable,
-- Repple is white-labelled and has no default currency anywhere (part 150), and
-- minor units are formatted correctly in exactly one place already —
-- src/lib/coachMoney.ts. A second copy in plpgsql is the copy that drifts, and
-- a drifted copy tells a coach a figure that is not the figure. Parts 146 and
-- 158 made the same call. Section 3 says a package was bought and sends the
-- coach to the screen that already renders the amount.
--
-- NO CLOCK TIME, for a reason with the same shape. `gym_classes` has no time
-- zone column, `tenants` has none, and this database's own zone is a server
-- setting rather than a fact about the member reading the row — so any
-- "Thursday, 7:00pm" written here is right for whoever the server happens to
-- agree with and wrong for everybody else. src/lib/notifyInbox.ts already
-- refuses calendar dates in the inbox for exactly this reason ("a duration is
-- the same number everywhere"). Section 4 therefore states how long until the
-- class starts, which is true in every zone, and sends the member to the screen
-- that renders the wall-clock time on their own device.
--
-- That wording is `classStartsIn()` in src/lib/notifyCopy.ts, tested there, and
-- section 4 mirrors it band for band. IF YOU CHANGE ONE, CHANGE BOTH. The
-- TypeScript is the original; the SQL is the copy, in the same order.
--
-- ── Every route here is answerable, or there is no route ─────────────────
--
-- 158's own report names this as a live failure it had to fix: a route that
-- does not survive `safeRoute` for the RECIPIENT's build, or that
-- `ICON_BY_ROUTE` has no entry for, produces a row that renders perfectly and
-- either opens nothing or wears the generic bell. Every route below is in
-- SERVER_WRITTEN in src/lib/notifyInbox.ts and notifyInbox.test.ts checks both
-- properties for each one.
--
-- Two of the seven have NO route, and that is an answer rather than an omission:
--
--   · Section 2 tells a client their training history, photos and measurements
--     are still theirs. Those are three different screens and there is no one
--     screen that holds them, so a route would be a coin toss between three.
--   · Section 6 tells a coach a liability release was signed. `liability_waivers`
--     has NO coach read policy at all, by design (part 84) — there is no screen
--     that could show it to them, and there should not be.
--
-- Part 146 set that precedent: the bell is what a row with nowhere to go is
-- drawn with, and the words are still worth reading.
--
-- Idempotent; safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════
-- 1 · A client ended the coaching  ·  2 · A coach ended the coaching
-- ═════════════════════════════════════════════════════════════════════════
--
-- One row transition, read two ways, so one function with two branches rather
-- than two triggers racing on the same UPDATE.
--
-- ── Which way round, and what happens when we cannot tell ────────────────
--
-- `ended_by` is written by `end_coaching()` in the same statement as `status`,
-- from `auth.uid()`, and it is the ONLY thing here that knows which of the two
-- people pressed the button. The two messages are not interchangeable — one
-- says a client has gone, the other says a coach has — so a row whose
-- `ended_by` is neither party is silence, in 158's manner: an unrecognised case
-- gets no notification rather than a guessed one. In practice that is a
-- hand-written UPDATE by somebody with database access, who can tell both
-- parties themselves.
--
-- `ended_by` is `on delete set null`, so it can BECOME null later when the
-- person who ended it deletes their account. That does not re-fire this: the
-- foreign key's SET NULL touches `ended_by` alone, and this trigger is
-- `after update of status`, which fires only when `status` is in the UPDATE's
-- SET list.
--
-- ── The one path this does not see ───────────────────────────────────────
--
-- `end_coaching()` writes two records and part 68's header is explicit that
-- either may exist without the other in a drifted pair — a live
-- `clients.trainer_id` with no relationship row. This trigger is on
-- `coaching_relationships` only, so an ending that cleans up such a pair
-- notifies nobody. That is the right side to be wrong on: a trigger on
-- `clients.trainer_id` as WELL would fire a second time for every ordinary
-- ending, and two notifications about one departure is worse than none about a
-- row that should not exist. Every relationship made by `link_coaching()` or
-- `join_by_code()` has the row.
--
-- ── What each side is told, and what neither is ──────────────────────────
--
-- No reason is asked for and none is offered. Nothing here speculates about
-- why, nothing suggests either party do anything about it, and the coach's
-- message does not ask them to win anybody back.
--
-- What each message DOES do is answer the question its reader actually has.
--
--   · The coach's first worry is their own work, and it is unfounded: nothing
--     cascades on an ending. `program_templates.coach_id` is `on delete cascade`
--     from the COACH's own profile and nothing else touches it; `sessions`,
--     `payroll_settlements`, `coach_invoices` and `client_tags` are all keyed on
--     the coach's own id (part 68, "what a coach keeps"). `assigned_programs`
--     rows are not deleted either — but part 69 gates the coach's read of them
--     on `is_my_client()`, which this ending has just made false, so the honest
--     sentence is that nothing was deleted AND that they can no longer open the
--     client's side of it. Both halves are true and only saying the first would
--     be the lie.
--
--   · The client's first worry is that their data left with the coach, and
--     answering that IS the message. A client who has paid for coaching assumes
--     the record belongs to the person they paid. It does not: `workouts`,
--     `measurements`, `check_ins`, `scans`, `food_logs` and the photos are all
--     theirs and none of them is touched. What ends is the coach's READ of them,
--     and the progress-photo grants, which part 47 deletes rather than flags.
--
-- Neither message quotes anybody. Both name the other party from `profiles`,
-- which each side could already read while the relationship was live.

create or replace function public.coaching_end_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_name text;
begin
  if new.status <> 'ended' then
    return new;
  end if;

  -- A re-run of `end_coaching()` on an already-ended pair writes nothing —
  -- part 68 guards its UPDATE with `status <> 'ended'` — so this is belt and
  -- braces against any other writer restamping the row.
  if old.status = 'ended' then
    return new;
  end if;

  if new.ended_by = new.client_id then
    -- ── 1 · the client left. Tell the coach. ──────────────────────────────
    select nullif(btrim(coalesce(p.full_name, '')), '')
      into v_name
      from public.profiles p
     where p.id = new.client_id;

    insert into public.notifications (user_id, title, body, icon, route)
    values (
      new.coach_id,
      'A client has ended their coaching',
      left(coalesce(v_name, 'A client') || ' has ended their coaching with you.'
           || ' Nothing you built was deleted — your program templates are untouched, and your record of the'
           || ' sessions you delivered is unchanged. You can no longer open their training data, and any session'
           || ' already booked with them stands until one of you cancels it.', 500),
      'people',
      '/(trainer)/dashboard'
    );

  elsif new.ended_by = new.coach_id then
    -- ── 2 · the coach ended it. Tell the client. ──────────────────────────
    select nullif(btrim(coalesce(p.full_name, '')), '')
      into v_name
      from public.profiles p
     where p.id = new.coach_id;

    -- Routeless. See the header: the three things this sentence promises are
    -- still theirs live on three different screens.
    insert into public.notifications (user_id, title, body, icon, route)
    values (
      new.client_id,
      'Your coaching has ended',
      left(coalesce(v_name, 'Your coach') || ' has ended your coaching.'
           || ' Your training history, photos and measurements stay in your account — nothing of yours has been'
           || ' deleted, and they can no longer see any of it. Sessions you have already booked are not'
           || ' cancelled, so cancel those yourself if you no longer want them.', 500),
      'bell',
      null
    );
  end if;

  return new;
end;
$function$;

comment on function public.coaching_end_notify() is
  'Writes one inbox row when a coaching relationship ends: to the coach when the client ended it, to the client when the coach did. Silent when ended_by names neither party. See part 159.';

drop trigger if exists coaching_relationships_notify_ended on public.coaching_relationships;
create trigger coaching_relationships_notify_ended
  after update of status on public.coaching_relationships
  for each row execute function public.coaching_end_notify();

revoke all on function public.coaching_end_notify() from public;
revoke all on function public.coaching_end_notify() from anon;
revoke all on function public.coaching_end_notify() from authenticated;


-- ═════════════════════════════════════════════════════════════════════════
-- 3 · A package or a session pack was bought
-- ═════════════════════════════════════════════════════════════════════════
--
-- INSERT only, and that is not a shortcut. The webhook writes this row with
-- `.upsert(…, { onConflict: 'stripe_session_id' })`, so Stripe redelivering
-- `checkout.session.completed` — which it does, freely — arrives as an UPDATE
-- and produces no second notification. A coach told twice that one person
-- bought one thing goes and asks them about it.
--
-- `status` is checked even though the webhook only ever writes 'paid': this
-- notification says somebody paid, and if a later writer records a pending or
-- refunded row, the sentence must not be written over it.
--
-- The package's name is the coach's OWN text — they typed it on Payments &
-- Packages — so quoting it puts no words in anybody's mouth, and it is what
-- makes this a notification about a specific sale rather than a ping. It is
-- read through a nullable `package_id` (`on delete set null`), so a coach who
-- deleted the package since gets "a package" and not an empty pair of quotes.
--
-- `sessions_total` is stated when there is one, because it is the difference
-- between a membership and a pack of sessions somebody now owes work for, and
-- it is a COUNT rather than an amount — the no-money rule in the header is
-- about currency, which this has none of.

create or replace function public.client_purchase_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_name text;
  v_pack text;
  v_body text;
begin
  -- NULLABLE, `on delete set null`: a coach who deleted their account leaves
  -- sales behind with nobody to tell. Returning early is the whole of the
  -- protection this function needs against failing a Stripe webhook.
  if new.trainer_id is null then
    return new;
  end if;

  if new.status is distinct from 'paid' then
    return new;
  end if;

  select nullif(btrim(coalesce(p.full_name, '')), '')
    into v_name
    from public.profiles p
   where p.id = new.client_id;

  select nullif(btrim(coalesce(tp.name, '')), '')
    into v_pack
    from public.trainer_packages tp
   where tp.id = new.package_id;

  v_body := coalesce(v_name, 'A client') || ' has bought '
         || case when v_pack is null then 'one of your packages' else '“' || v_pack || '”' end
         || '.';

  if new.sessions_total is not null and new.sessions_total > 0 then
    v_body := v_body || ' It carries ' || new.sessions_total || ' sessions for you to deliver.';
  end if;

  -- No figure. See the header: there is no default currency in this product,
  -- both money columns are nullable, and the amount belongs on the screen that
  -- already knows how to render it or nowhere.
  v_body := v_body || ' Your Payments & Packages screen has the amount and the currency it was charged in.';

  insert into public.notifications (user_id, title, body, icon, route)
  values (new.trainer_id, 'A package was bought', left(v_body, 500), 'grid', '/(trainer)/payments');

  return new;
end;
$function$;

comment on function public.client_purchase_notify() is
  'Writes the coach one inbox row when a client buys a package or a session pack. INSERT only, so a redelivered Stripe webhook does not notify twice. See part 159.';

drop trigger if exists client_purchases_notify_trainer on public.client_purchases;
create trigger client_purchases_notify_trainer
  after insert on public.client_purchases
  for each row execute function public.client_purchase_notify();

revoke all on function public.client_purchase_notify() from public;
revoke all on function public.client_purchase_notify() from anon;
revoke all on function public.client_purchase_notify() from authenticated;


-- ═════════════════════════════════════════════════════════════════════════
-- 4 · A waitlisted member was promoted into a class
-- ═════════════════════════════════════════════════════════════════════════
--
-- The one of the seven with a DEADLINE. Everything else here keeps: a review
-- read a week late is the same review, and a package bought on Monday is still
-- bought on Friday. A seat in a class is worth nothing the moment the class
-- starts, and the member did not ask for it today — they asked days ago, were
-- told they were on a list, and stopped thinking about it. Nobody re-opens the
-- Classes screen on the off-chance.
--
-- ── On the table, not inside cancel_class() ──────────────────────────────
--
-- `cancel_class()` is the only promoter today, but the promotion is an UPDATE
-- on `class_bookings` and putting this on the table catches any future one —
-- an instructor moving somebody up by hand from the Studio, a backfill, a
-- second RPC. It is also the difference between reading `cancel_class()`'s
-- subquery correctly and reading it nearly correctly.
--
-- ── Why the promoter must not be the promoted ────────────────────────────
--
-- `book_class()` ends in `on conflict (class_id, user_id) do update set status
-- = excluded.status`, so a member sitting on the waiting list who taps Book
-- again while a seat happens to be free makes the SAME waitlist → booked
-- transition this trigger fires on. They are looking at the screen; it just
-- said 'booked'; a push telling them a place has opened is the app narrating
-- their own tap back at them.
--
-- `auth.uid()` is the CALLER even inside a SECURITY DEFINER function — it reads
-- a GUC set from the request's JWT, which is why part 68 insists on it over
-- `current_user` — so it is the canceller in `cancel_class()` and the member
-- themselves in `book_class()`. Under the service role it is null, which is
-- `distinct from` any member and therefore notifies, correctly: a promotion
-- nobody in the app performed is exactly the one nobody has been told about.
--
-- ── The class, and how long until it ─────────────────────────────────────
--
-- `starts_at` is `timestamptz not null` and `gym_classes.title` is `not null`,
-- so both halves of "which class and when" exist for every row. The "when" is a
-- duration and never a clock time — see the header, and `classStartsIn()` in
-- src/lib/notifyCopy.ts, which this mirrors band for band:
--
--     past          It has already started.
--     < 1 hour      It starts in under an hour.
--     1 hour        It starts in about an hour.
--     < 24 hours    It starts in about N hours.
--     ~1 day        It starts in about a day.
--     otherwise     It starts in about N days.
--
-- Rounding matches: `round(numeric)` and JavaScript's `Math.round` both go away
-- from zero at a half, and every value here is positive.
--
-- The already-started branch exists because it is reachable — a member
-- cancelling as a class begins promotes somebody into a seat that is no longer
-- worth having — and saying so is better than a countdown that reads "in about
-- 0 hours" or a cheerful message about a class they have missed.

create or replace function public.class_promotion_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_title  text;
  v_starts timestamptz;
  v_secs   numeric;
  v_hours  numeric;
  v_days   numeric;
  v_when   text;
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  if not (old.status = 'waitlist' and new.status = 'booked') then
    return new;
  end if;

  -- The member promoted themselves by re-booking. They are watching it happen.
  if auth.uid() is not distinct from new.user_id then
    return new;
  end if;

  select gc.title, gc.starts_at
    into v_title, v_starts
    from public.gym_classes gc
   where gc.id = new.class_id;

  -- Cannot happen through `class_bookings.class_id`, which is `not null
  -- references gym_classes(id) on delete cascade`, and checked anyway: this
  -- runs inside the transaction that gave somebody a seat.
  if v_starts is null then
    return new;
  end if;

  -- ── classStartsIn(), in the same order and with the same bands ─────────
  v_secs := extract(epoch from (v_starts - now()));
  if v_secs <= 0 then
    v_when := 'It has already started.';
  elsif v_secs < 3600 then
    v_when := 'It starts in under an hour.';
  else
    v_hours := round(v_secs / 3600.0);
    if v_hours = 1 then
      v_when := 'It starts in about an hour.';
    elsif v_hours < 24 then
      v_when := 'It starts in about ' || v_hours || ' hours.';
    else
      v_days := round(v_secs / 86400.0);
      if v_days <= 1 then
        v_when := 'It starts in about a day.';
      else
        v_when := 'It starts in about ' || v_days || ' days.';
      end if;
    end if;
  end if;

  insert into public.notifications (user_id, title, body, icon, route)
  values (
    new.user_id,
    'A place has opened in a class',
    left('You were on the waiting list for “' || coalesce(nullif(btrim(v_title), ''), 'a class')
         || '” and a place has opened, so you are booked in. ' || v_when
         || ' Your Classes screen has the time on your own clock and the room, and is where to cancel'
         || ' if you can no longer go.', 500),
    'calendar',
    '/(client)/classes'
  );

  return new;
end;
$function$;

comment on function public.class_promotion_notify() is
  'Writes the member one inbox row when a class booking moves from waitlist to booked and somebody other than that member moved it. Mirrors classStartsIn() in src/lib/notifyCopy.ts — change both. See part 159.';

drop trigger if exists class_bookings_notify_promoted on public.class_bookings;
create trigger class_bookings_notify_promoted
  after update of status on public.class_bookings
  for each row execute function public.class_promotion_notify();

revoke all on function public.class_promotion_notify() from public;
revoke all on function public.class_promotion_notify() from anon;
revoke all on function public.class_promotion_notify() from authenticated;


-- ═════════════════════════════════════════════════════════════════════════
-- 5 · An intake came back
-- ═════════════════════════════════════════════════════════════════════════
--
-- The coach is already waiting for this one. `askIntake` in src/ui/intake.ts
-- pushes 'Your coach asked for your intake' to the client, so the request is a
-- notification and the reply was nothing at all — the coach's only way to learn
-- was to reopen the client's page and look.
--
-- ── ARRIVAL, not completion, and why the difference is deliberate ────────
--
-- Fires the first time a `clients.intake` document exists and never again. It
-- would be better to fire when the form is FINISHED, and that is not available
-- here: "finished" is `INTAKE_SECTIONS.every(s => s.done(i))` in
-- src/lib/intake.ts — seven per-section predicates over a jsonb document,
-- including "answered all seven readiness questions" and "gave a headline".
-- Restating those in plpgsql would be a second copy of the form's own shape,
-- and the failure mode of a drifted copy is a coach told a client is finished
-- when they are not, or never told at all. Part 158 refused a copy of
-- `subChange()` for weaker reasons than these.
--
-- So the body says what is actually known — it came back — and points at the
-- screen, which reads `intakeProgress()` and says "4 of 7 parts answered" from
-- the one place that rule lives. A client who saves half, comes back and
-- finishes gets ONE notification, at the start rather than the end, which is
-- the right end of the process for a coach who is waiting to write a programme.
--
-- ── Fires on INSERT too, and why that is not dead code ───────────────────
--
-- No path in the app creates a `clients` row with an intake already in it —
-- provisioning writes the row long before the form exists — but `intake` is a
-- plain nullable column with no default and any future importer or backfill
-- could. One line, and it is the line that stops a migration filling in
-- everybody's intake silently.
--
-- Not fired on later edits. A client correcting an answer is not a second
-- arrival, and `clients_intake_guard` (part 127) already refuses anybody but
-- the client to make one.

create or replace function public.client_intake_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_name text;
begin
  if new.intake is null then
    return new;
  end if;

  -- OLD is read inside its own IF and never in a compound condition beside
  -- `tg_op`. A row-level INSERT trigger has no OLD assigned, and plpgsql does
  -- not promise to stop evaluating an `and` once the left side is false — part
  -- 158 keeps the same shape for the same reason.
  if tg_op = 'UPDATE' then
    if old.intake is not null then
      return new;
    end if;
  end if;

  -- NULLABLE, `on delete set null`: a client between coaches fills in their
  -- intake for the next one, and there is nobody to tell yet.
  if new.trainer_id is null then
    return new;
  end if;

  select nullif(btrim(coalesce(p.full_name, '')), '')
    into v_name
    from public.profiles p
   where p.id = new.id;

  insert into public.notifications (user_id, title, body, icon, route)
  values (
    new.trainer_id,
    'An intake has come back',
    left(coalesce(v_name, 'A client') || ' has sent back their intake.'
         || ' Their readiness answers, training history, goals and availability are on it, in their own words,'
         || ' and the screen says how much of the form they have answered so far.', 500),
    'pencil',
    '/(trainer)/client-intake?clientId=' || new.id::text
  );

  return new;
end;
$function$;

comment on function public.client_intake_notify() is
  'Writes the coach one inbox row the first time a client''s intake document exists. Arrival, not completion — see part 159 for why completeness is not restated in plpgsql.';

drop trigger if exists clients_notify_intake on public.clients;
create trigger clients_notify_intake
  after insert or update of intake on public.clients
  for each row execute function public.client_intake_notify();

revoke all on function public.client_intake_notify() from public;
revoke all on function public.client_intake_notify() from anon;
revoke all on function public.client_intake_notify() from authenticated;


-- ═════════════════════════════════════════════════════════════════════════
-- 6 · A liability release was signed
-- ═════════════════════════════════════════════════════════════════════════
--
-- INSERT only, which is the whole of what part 84 permits: `liability_waivers`
-- has no UPDATE policy and no DELETE policy, for the same reason part 135's
-- acceptances have none — a release that can be withdrawn is not a release.
--
-- ── Two lookups, because the signer is not the recipient ─────────────────
--
-- Every other recipient in this file is a column on the row that fired. This
-- one is not: `liability_waivers.user_id` references `auth.users`, not
-- `profiles`, and the person to tell is that user's coach. So the coach is
-- reached through `clients.trainer_id`, and both hops can miss:
--
--   · no `clients` row — the signer is a coach or an owner. src/ui/waiver.tsx
--     gates the client portal, but the table has no constraint saying only
--     clients may sign, and inventing a recipient for a row that has none is
--     how a coach gets told about a stranger.
--   · a null `trainer_id` — somebody signing on the way in, before they have a
--     coach. Extremely common: the release is asked for at the portal door and
--     joining a coach happens after.
--
-- Both return quietly. A release that reaches nobody is still recorded, which is
-- what it is for.
--
-- ── A second version is a second notification ────────────────────────────
--
-- The primary key is `(user_id, version)` and part 84 is explicit that
-- re-wording the release adds a row rather than editing what somebody agreed
-- to. So a client asked again after a re-wording, and agreeing again, notifies
-- again — correctly. It is a new agreement to new words, not a repeat of the
-- old one.
--
-- ── Routeless, and that is the honest shape of it ────────────────────────
--
-- There is nowhere to send them. `liability_waivers` has exactly one policy,
-- `liability_waivers_own_r`, and part 84 says why: "a coach or owner has no
-- business reading it through the app; it is a legal record, not roster data."
-- The notification says so out loud rather than opening a screen that would
-- have to explain the same thing. It also does not name Repple: the product is
-- white-labelled, and "the liability release every client agrees to when they
-- join" is true under every brand running it.

create or replace function public.liability_waiver_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_coach uuid;
  v_name  text;
begin
  select c.trainer_id
    into v_coach
    from public.clients c
   where c.id = new.user_id;

  if v_coach is null then
    return new;
  end if;

  select nullif(btrim(coalesce(p.full_name, '')), '')
    into v_name
    from public.profiles p
   where p.id = new.user_id;

  insert into public.notifications (user_id, title, body, icon, route)
  values (
    v_coach,
    'A client has signed the release',
    left(coalesce(v_name, 'A client') || ' has agreed to the liability release and the physician'
         || ' acknowledgement that every client signs when they join. It is their own legal record and no'
         || ' coach can read it in the app, so there is nothing here to open — this is the notice that it'
         || ' exists.', 500),
    'bell',
    null
  );

  return new;
end;
$function$;

comment on function public.liability_waiver_notify() is
  'Writes the coach one inbox row when their client signs the platform liability release. Routeless: no coach may read liability_waivers, by design (part 84). See part 159.';

drop trigger if exists liability_waivers_notify_coach on public.liability_waivers;
create trigger liability_waivers_notify_coach
  after insert on public.liability_waivers
  for each row execute function public.liability_waiver_notify();

revoke all on function public.liability_waiver_notify() from public;
revoke all on function public.liability_waiver_notify() from anon;
revoke all on function public.liability_waiver_notify() from authenticated;


-- ═════════════════════════════════════════════════════════════════════════
-- 7 · A review was left
-- ═════════════════════════════════════════════════════════════════════════
--
-- ── Every rating, and the app does not get a vote ────────────────────────
--
-- Filtering this by star rating was considered and REFUSED. A product that
-- notifies a coach about a five and stays quiet about a one has decided what
-- its users are allowed to hear about their own business, and it decides it in
-- the direction that flatters the product. The coach can reply — part 139 built
-- `reply_to_coach_review()` for exactly that — and a reply is worth most on the
-- review that stings, which is precisely the one a filter would hide.
--
-- The body is neutral for the same reason and does two things carefully:
--
--   · it does not characterise the review. Not "a great review", not "some
--     feedback", not a rating in the sentence. The coach reads it and decides.
--   · it does not quote the text, and does not name the reviewer. Part 139 is
--     deliberate that `client_id` never leaves the database — "the withheld
--     column identifies a third party rather than the subject" — and the read
--     function hands the coach a FIRST NAME and nothing more. A notification
--     that carried the reviewer's full name would hand over more than the
--     screen it links to, from a table with no grant to anybody.
--
-- ── Which writes count as a review being left ────────────────────────────
--
-- `write_coach_review()` is an upsert on `(coach_id, client_id)`, so a client
-- revising their review is an UPDATE and is a real event: the words the coach
-- may reply to have changed, and part 139 clears the coach's existing reply on
-- that same statement because "a reply must not survive the text it answered".
-- Being told the reply was thrown away is the point.
--
-- Three writes to this table must NOT notify, and each is excluded by a
-- different mechanism:
--
--   · A COACH'S OWN REPLY. `reply_to_coach_review()` sets `coach_reply` and
--     `coach_replied_at` and nothing else, so it is not in this trigger's
--     column list at all and the function never runs. A coach notified about
--     their own typing is the most obviously wrong row this file could write.
--   · A WITHDRAWAL. `withdraw_coach_review()` sets `withdrawn_at`, which IS in
--     the column list — deliberately, because the same column coming back to
--     null is a review returning — so the body guard is what refuses it. There
--     is nothing to tell somebody about a review they can no longer read.
--   · A NO-OP REWRITE. Somebody saving the identical rating and text.
--
-- A column-level UPDATE trigger fires on the columns NAMED in the SET list
-- whether or not the values changed, which is why the guards below compare
-- values rather than trusting the trigger definition to have done it.

create or replace function public.coach_review_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  -- Withdrawn on the way in, or withdrawn by this very statement. Either way
  -- there is nothing for the coach to open.
  if new.withdrawn_at is not null then
    return new;
  end if;

  -- Nothing about the review itself moved: same rating, same words, and it was
  -- already readable before this statement.
  --
  -- OLD is read inside the `tg_op` test and never beside it in one condition. A
  -- row-level INSERT trigger has no OLD assigned, and plpgsql does not promise
  -- to stop evaluating an `and` once the left side is false.
  if tg_op = 'UPDATE' then
    if new.rating is not distinct from old.rating
       and new.body is not distinct from old.body
       and old.withdrawn_at is null then
      return new;
    end if;
  end if;

  insert into public.notifications (user_id, title, body, icon, route)
  values (
    new.coach_id,
    'A client has left you a review',
    left('A client has written a review of you. It is on your Credentials & Reviews screen, with the box'
         || ' to reply to it.', 500),
    'trophy',
    '/(trainer)/credentials'
  );

  return new;
end;
$function$;

comment on function public.coach_review_notify() is
  'Writes the coach one inbox row when a client leaves or revises a review, at every rating. Silent for a withdrawal, for the coach''s own reply, and for a no-op rewrite. See part 159.';

drop trigger if exists coach_reviews_notify_coach on public.coach_reviews;
create trigger coach_reviews_notify_coach
  after insert or update of rating, body, withdrawn_at on public.coach_reviews
  for each row execute function public.coach_review_notify();

revoke all on function public.coach_review_notify() from public;
revoke all on function public.coach_review_notify() from anon;
revoke all on function public.coach_review_notify() from authenticated;
