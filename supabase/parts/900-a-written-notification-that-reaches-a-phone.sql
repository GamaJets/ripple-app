-- ═══════════════════════════════════════════════════════════════════════════
-- Twenty-eight kinds of notification were written down and never sent.
--
-- ── WHAT WAS MEASURED, AND WHERE THE FIRST GUESS WAS WRONG ────────────────
--
-- `COACH_CHANNELS` in src/lib/coachNotify.ts offers six switches. Two of them
-- — `money` and `admin` — had NO SENDER ANYWHERE. Grep the three apps for
-- `sendPushChecked` and read the fifth argument: 'chat' (src/ui/messaging.ts),
-- 'bookings' (app/(client)/calendar.tsx) and 'clients' (src/lib/prNotifyStore.ts)
-- are the only channel strings any handset has ever passed. A coach could mute
-- Money and Paperwork, and nothing had ever sent on either.
--
-- The sweep that found this said the cause was `notify_users()` writing a row
-- and nothing else. That is half right and the wrong half is load-bearing:
--
--   `notify_users()` (part 122) IS NOT WHAT WRITES THOSE ROWS. Every one of
--   the server-side notifications is a DIRECT `insert into public.notifications`
--   inside a trigger or a nightly pass — twenty-two such statements across parts
--   146, 158, 159, 160, 163, 202, 470, 471, 493, 611, 612, 613 and 614 — and
--   each of those files says in its own header why it does not go through
--   `notify_users()`. Part 146 puts it plainest: `notify_users()` authorises on
--   `auth.uid()`, and these rows are written by a job or by the service role
--   where `auth.uid()` is null and the function correctly returns 0, notifying
--   nobody.
--
-- So a dispatch bolted into `notify_users()` would have reached EXACTLY the set
-- that is already pushed — its only callers are `recordInbox` in
-- src/ui/pushNotifications.ts, which `sendPush` and `sendPushChecked` call
-- alongside their own send — and NONE of the set that is not. Precisely
-- backwards, and it would have doubled every push in the product on the way.
--
-- The dispatch therefore goes on the TABLE, as an AFTER INSERT trigger. That is
-- the one place every writer passes through: a trigger, a cron pass, an edge
-- function, and the RPC. It is the same argument part 251 makes about putting
-- the channel filter in send-push rather than at the call sites, and the same
-- one the master switch makes about `push_tokens` — the gate goes where a
-- sender cannot route around it, because a check at the call site is a check
-- somebody forgets at the twenty-first call site.
--
-- ── THE FIVE THINGS THIS HAD TO GET RIGHT ─────────────────────────────────
--
-- 1 · A FAILED PUSH MUST NEVER LOSE THE ROW.
--
--     The inbox row is the durable half. A push is gone the moment it is
--     swiped and does not exist at all on a build without expo-notifications;
--     the row is on the bell in the morning. So if only one of the two can
--     happen it must be the one that survives — the rule
--     `sendPushChecked` already states in src/ui/pushNotifications.ts, from the
--     other end of the same wire.
--
--     This is an AFTER trigger, so the INSERT has already happened when it
--     runs. An unhandled exception in an AFTER trigger aborts the whole
--     transaction — which here is not just the notification but the business
--     write that caused it: the package purchase, the subscription update, the
--     signed release. A `pg_net` outage would therefore roll back somebody's
--     payment. `exception when others then return null` is what stops that, and
--     it is part 26's shape character for character:
--
--         -- A failed notification must never block the message itself from
--         -- being written.
--         exception when others then return NEW;
--
--     Nothing is retried. `net.http_post` is asynchronous — it queues and a
--     background worker sends — so a failure lands in `net._http_response` and
--     nothing here reads it back. Part 45 built a queue with confirmation for
--     the storage purge because a file that is not deleted stays undeleted for
--     ever; a push that did not arrive is a push, and the row is already in the
--     inbox. Promising a retry this does not perform would be worse than not
--     retrying.
--
-- 2 · WHICH SWITCH EACH KIND ANSWERS TO.
--
--     supabase/functions/send-push drops muted recipients ONLY when a `channel`
--     is passed — "a send with no channel is not filtered at all" is in its own
--     header, and it is the compatibility promise that let part 251 ship. So a
--     dispatch that passed no channel would push every coach who had muted
--     anything, on every switch. Six controls on the settings screen, all of
--     them ignored by the newest sender: the master switch's original defect
--     pointing the other way.
--
--     The channel is DERIVED from what the row already carries, by
--     `notification_channel()` below, and stamped into a new `channel` column
--     by a BEFORE INSERT trigger. No existing trigger is touched. That is
--     deliberate: naming the channel at each of the twenty-two insert
--     sites is twenty-two edits in thirteen files owned by different lanes, and
--     the twenty-third would be written without one.
--
--     The primary signal is the ROUTE, which is the signal src/ui/notifications.tsx
--     already uses in preference to the `icon` column a trigger wrote —
--     `rowToItem` recomputes the icon from the route and ignores what was
--     stored, because a route is a structural fact about what the notification
--     is about and an icon is a choice somebody made in passing. A notification
--     that opens Payments is about money whoever wrote it.
--
--     Three server-written rows carry no route, each for a reason its own part
--     states, and those are matched on their TITLE. That is brittle in the way
--     src/lib/notifyInbox.ts says title matching is brittle, and tolerable only
--     because of which way it falls: a reword produces NULL, null is not
--     dispatched, and not dispatched is exactly what those three rows do today.
--     A reword cannot ever produce a push on the wrong switch.
--
--     A row the mapping cannot place gets NULL and IS NOT SENT. That is the one
--     place this codebase does not err towards the notification, and it needs
--     its own argument: the usual rule ("a failed read SENDS", part 251 rule 2)
--     is about a transient fault swallowing a notification that exists. This is
--     about a kind nobody has classified, where the two outcomes are "push it
--     unmutably for ever" and "leave it exactly as silent as it already is".
--     The second loses nothing that is not already lost, and
--     src/lib/notifyDispatch.test.ts fails the build if a kind in
--     `SERVER_WRITTEN` has no channel — so an unclassified route is caught by a
--     test rather than by a coach who was never told.
--
-- 3 · NEVER PUSH SOMEBODY ABOUT THEIR OWN ACTION.
--
--     `auth.uid()` reads the request's JWT claim from a session GUC, so it is
--     still the CALLER inside a SECURITY DEFINER function. A recipient equal to
--     `auth.uid()` is the person who caused the write, and they are skipped.
--
--     Three cases and all three come out right. A client buys a package: uid is
--     the client, the recipient is the coach, nothing is skipped. A coach
--     writes to their own inbox: skipped. A nightly pass: uid is null, nothing
--     is skipped, which is correct — an invoice ageing has no actor at all and
--     skipping on a null uid would silence every cron-written kind in the
--     product.
--
-- 4 · IDEMPOTENCY, WHICH IS TWO SEPARATE PROBLEMS.
--
--     (a) ONE STATEMENT, ONE PUSH PER MESSAGE. The dispatcher is a STATEMENT-
--         level trigger with a transition table, not a row-level one. A
--         statement that writes forty rows — the class cancellation in part 493
--         writes one per booked or waitlisted member — fires this once, and the
--         recipients are aggregated into one `user_ids` array, which is the
--         shape send-push already takes. A row-level trigger would have made
--         forty HTTP posts for one cancelled class.
--
--     (b) ONE ROW, ONE PUSH, EVER. Rows are CLAIMED by an
--         `update … set pushed_at = now() … where pushed_at is null returning`,
--         and only what that update actually returned is posted. The claim is
--         atomic and takes a row lock, so a trigger that somehow fires twice,
--         or two transactions racing, produce one push and one empty second
--         claim. `pushed_at` is the record of it and is readable afterwards.
--
--     What this deliberately does NOT deduplicate is two DIFFERENT rows written
--     for one event — the pair src/lib/notifyInbox.ts catalogues under
--     `SERVER_WRITE_THE_ROW`, where a handset and a trigger both write about the
--     same coaching request. Two rows is two notifications in somebody's inbox,
--     and a dispatcher that pushed one and swallowed the other would be
--     deciding that an inbox row is wrong. That is an upstream defect, it is
--     already named in TypeScript, and it is not this function's to hide.
--
-- 5 · QUIET HOURS, WHICH ARE NOT IMPLEMENTED HERE ON PURPOSE.
--
--     Part 530 built `notify_quiet_now`, a view that answers "who is asleep
--     right now, in their own stored zone" with no date arithmetic anywhere
--     outside Postgres. supabase/functions/send-push already reads it, after
--     the channel filter and against the remaining recipients so the two
--     compose.
--
--     So this dispatcher's whole obligation to quiet hours is to GO THROUGH
--     send-push rather than around it, and to pass the channel so both filters
--     have what they need. Re-implementing the window in plpgsql would be a
--     second copy of a rule that already exists, in a second language, and part
--     530 spends forty lines on why the hour arithmetic lives in exactly one
--     place. Two copies is how a coach comes to be quiet at eleven for chat and
--     awake at eleven for money.
--
--     A caveat the operator has to hold, because this part cannot check it:
--     `notify_quiet_hours_rollout.enforced` ships false, and it is flipped by
--     hand once send-push and notify-message are deployed reading the view. The
--     source of send-push in this tree does read it. Whether the DEPLOYED
--     version does is not knowable from here. Until that flag is true the app
--     draws no quiet-hours switch, so nothing is promised that is not kept —
--     but this dispatcher makes the number of pushes a coach receives go from
--     nearly none to all of them, which is the moment quiet hours start to
--     matter. Deploy send-push, flip the flag.
--
-- ── WHY IT AUTHENTICATES WITH THE SERVICE KEY AND NOT A HOOK SECRET ───────
--
-- Part 26 posts to `notify-message`, which is deployed `--no-verify-jwt` and
-- whose only authentication is a shared secret from Vault. send-push is NOT:
-- supabase/README.md records it as `verify_jwt` still true, because handsets
-- invoke it with `supabase.functions.invoke` under the caller's own JWT. A
-- pg_net post carrying no Authorization header would get a 401 and this whole
-- part would be inert.
--
-- So it carries a bearer token, and the token is the project's service_role key
-- read from Vault at call time — the pattern `purge_photo_file()` in part 45
-- already uses against the Storage API, for the reason part 26 gives about the
-- hook secret: a key in a function body is readable by anything that can read
-- `pg_proc`.
--
-- It reads the EXISTING secret, `storage_service_key`, rather than introducing a
-- second one. The name is about where the key was first needed and is now
-- slightly wrong, and that is the lesser cost: a second Vault entry holding the
-- same value is a second thing to rotate and a second thing to forget, and a
-- new secret that nobody creates means this part applies cleanly and silently
-- does nothing. Reading the one that is already there means the dispatch works
-- the moment this is applied.
--
-- WITHOUT THE SECRET: no secret, no post, and the notification row is still
-- written. The same early return part 26 makes rather than sending an
-- unauthenticated request that would be refused anyway.
--
-- ── WHAT THIS DOES TO ROWS THAT ALREADY EXIST ─────────────────────────────
--
-- Nothing. The dispatcher only ever reads the transition table of the statement
-- that just inserted, so no historic row is re-read and nobody's phone lights up
-- with two years of backlog when this is applied. Existing rows get
-- `push_by = 'server'` from the column default and `pushed_at` null, and both
-- are simply never looked at again.
--
-- Idempotent; safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · The three columns ─────────────────────────────────────────────────

alter table public.notifications
  -- Which switch governs this row. NULL means "nobody has classified this",
  -- which is not dispatched — see rule 2 in the header. Stamped by the BEFORE
  -- trigger below from the route and the title, and left alone if a writer sets
  -- it explicitly, so a future trigger that knows better than the route table
  -- can say so without editing the table.
  add column if not exists channel text,
  -- Who is responsible for pushing it. 'server' is the default and means "this
  -- row was written by something that does not push"; 'caller' is stamped by
  -- notify_users() below and means "a handset wrote this and has either sent
  -- its own push or decided on purpose not to". Both of those are answers, and
  -- overruling the second is how src/ui/coachInvoices.ts's deliberate silence
  -- ("an invoice is not worth waking a phone") would have become a 3am buzz.
  add column if not exists push_by text not null default 'server',
  -- When this dispatcher posted the row to send-push. The claim that makes a
  -- second dispatch of one row impossible, and afterwards the only record that
  -- a push was attempted at all. NULL means either "not eligible" or "not yet";
  -- it deliberately does not distinguish, because nothing would read the
  -- difference and a fourth state would be a promise to.
  add column if not exists pushed_at timestamptz;

-- Mirrors `CoachChannel` in src/lib/coachNotify.ts and the CHECK on
-- `notify_channel_prefs` (parts 251 and 730). A CHECK rather than an enum for
-- the reason part 251 gives: this list gets tuned by somebody reading a support
-- thread, and an enum change takes a lock.
alter table public.notifications
  drop constraint if exists notifications_channel_chk;
alter table public.notifications
  add constraint notifications_channel_chk
  check (channel is null or channel in ('chat', 'bookings', 'money', 'clients', 'admin', 'book'));

alter table public.notifications
  drop constraint if exists notifications_push_by_chk;
alter table public.notifications
  add constraint notifications_push_by_chk
  check (push_by in ('server', 'caller'));

comment on column public.notifications.channel is
  'Which of the coach''s notification switches governs this row — mirrors CoachChannel in src/lib/coachNotify.ts. Derived from the route (and, for the three routeless kinds, the title) by notification_channel(); a writer may set it explicitly and the trigger will not overwrite it. NULL means unclassified, and an unclassified row is never pushed: send-push does not filter a channelless send at all, so pushing one would ignore every preference the recipient has set.';
comment on column public.notifications.push_by is
  '''caller'' for a row written through notify_users(), whose callers in src/ui/pushNotifications.ts send their own push or have decided not to. ''server'' — the default — for a row written by a trigger, a nightly pass or an edge function, which is the set the dispatch trigger exists for.';
comment on column public.notifications.pushed_at is
  'When notifications_dispatch_push() posted this row to send-push. Set by the claiming UPDATE that makes a second dispatch of one row impossible. NULL means not eligible or not yet, and does not distinguish the two.';

-- ── 2 · Which switch a row answers to ─────────────────────────────────────
--
-- The mirror of `notificationChannel` in src/lib/notifyDispatch.ts, and the two
-- are one decision written twice: this is the copy that runs, that one is the
-- copy that can be tested without a database. src/lib/notifyDispatch.test.ts
-- checks the TypeScript half against `SERVER_WRITTEN` in notifyInbox.ts, which
-- is the hand-maintained catalogue of every row the schema writes.
--
-- Whole-route matching with the query string taken off, exactly as `inboxIcon`
-- does it — NOT prefix matching. '/(trainer)/client-goals-archive' is a
-- different screen from '/(trainer)/client-goals' and gets nothing.
--
-- IMMUTABLE and reads no table, so it is safe in the BEFORE trigger and cheap.
create or replace function public.notification_channel(p_route text, p_title text)
returns text
language plpgsql
immutable
set search_path to 'public', 'pg_temp'
as $function$
declare
  r text := split_part(btrim(coalesce(p_route, '')), '?', 1);
  t text := btrim(coalesce(p_title, ''));
  c text;
begin
  c := case r
    -- chat · classified here and excluded from dispatch below. Both are true
    -- and they are different facts: the channel is what the coach's switch
    -- governs, the exclusion is about who sends it.
    when '/(client)/messages'         then 'chat'
    when '/(trainer)/chat'            then 'chat'

    -- bookings · 'A client booking a session, cancelling one, or a slot
    -- re-opening.' Both calendars, the two client screens that are a calendar
    -- under another name, the class seat that opened (part 159) and the answer
    -- to a request for an hour the coach had not opened (part 740).
    when '/(trainer)/calendar'        then 'bookings'
    when '/(client)/calendar'         then 'bookings'
    when '/(client)/bookings'         then 'bookings'
    when '/(client)/pt-sessions'      then 'bookings'
    when '/(client)/classes'          then 'bookings'
    when '/(client)/request-session'  then 'bookings'

    -- money · one of the two switches that had no sender. Payments & Packages
    -- is where parts 158, 159, 163, 611 and 612 send a coach: a subscription
    -- started, failed or ended; a package bought; a pack nearly used up, used
    -- up, or out of time; a chargeback opened or decided. Eight kinds, and this
    -- is the switch carrying CHANNEL_QUIET_COST_MONEY — "a failed subscription
    -- payment is a client who has quietly stopped paying you".
    when '/(trainer)/payments'        then 'money'
    when '/(client)/packages'         then 'money'
    -- A gym's offer. Client-directed and pushed today by the owner's handset,
    -- so this is inert at runtime; it is here so the column is not silently
    -- null on a row somebody later moves server-side.
    when '/(client)/explore'          then 'money'
    when '/(client)/offers'           then 'money'

    -- clients · the switch whose LABEL was wrong, not its key. It read
    -- 'Joining And Leaving' and named two things, while the schema had been
    -- writing five kinds to these routes: a coaching request and a coaching
    -- ending (158, 159), a goal reached (202), a progress photo sent (614) and
    -- an enquiry from somebody with no account yet (470) — plus the personal
    -- best src/lib/prNotifyStore.ts sends on it. The label moved; see
    -- src/lib/coachNotify.ts.
    when '/(trainer)/dashboard'       then 'clients'
    when '/(trainer)/leads'           then 'clients'
    when '/(trainer)/client-goals'    then 'clients'
    when '/(trainer)/client-training' then 'clients'
    when '/(trainer)/client-photos'   then 'clients'
    when '/(client)/my-coach'         then 'clients'
    when '/(client)/trainers'         then 'clients'

    -- admin · the other switch that had no sender. 'An intake coming back, a
    -- document accepted, a release signed, and a review left' (158, 159), and
    -- one the label did not name: a coach's own credential or insurance nearing
    -- expiry (202), which shares '/(trainer)/credentials' with the review. A
    -- route cannot separate those two and does not need to — an insurance
    -- certificate with a date on it is paperwork by any reading of that label,
    -- and the label now says so.
    when '/(trainer)/documents'       then 'admin'
    when '/(trainer)/client-intake'   then 'admin'
    when '/(trainer)/credentials'     then 'admin'
    when '/(client)/intake'           then 'admin'

    -- book · the coach's own book. These three routes are named almost word for
    -- word by that channel's own note: 'A session waiting on an outcome, an
    -- invoice past its due date, and a client who has stopped training.'
    -- `CoachChannelDef.local` is true for `book` and says nothing about a
    -- coach's book has another person's action behind it to hang a trigger on.
    -- That was true when it was written; parts 202, 471 and 613 made it half
    -- false by adding NIGHTLY PASSES, which are about the absence of a write and
    -- need nobody's action at all. One switch now governs a banner the handset
    -- computes and a push a cron job sends, and it has to honour both or it lies
    -- about one of them.
    when '/(trainer)/invoices'        then 'book'
    when '/(trainer)/nudges'          then 'book'
    -- A training block that ran out under a client (471). The coach's own
    -- programme going stale, and what a coach does about it is write the next
    -- block — which is this switch's question, not `clients`'.
    when '/(trainer)/builder'         then 'book'
    else null
  end;

  if c is not null then
    return c;
  end if;

  -- The three server-written rows that carry no route, each routeless for a
  -- reason its own part states: there is no member screen for `gym_invoices`
  -- (146); the sentence about coaching ending promises three screens and
  -- picking one would be a coin toss (159); `liability_waivers` has no coach
  -- read policy and should not have one (159, and part 84).
  --
  -- Matched on the whole title. A reword in those parts without one here
  -- returns null, and null is not dispatched — which is what those three rows
  -- do today, so the brittleness costs them nothing they have not already lost.
  return case t
    when 'An invoice from your gym'        then 'money'
    when 'Your coaching has ended'         then 'clients'
    when 'A client has signed the release' then 'admin'
    else null
  end;
end
$function$;

-- Not granted to anybody. It is called by a trigger, and Postgres checks
-- EXECUTE when a trigger is created rather than when it fires — the rule parts
-- 51 and 141 apply to every trigger function in this schema. `anon` is revoked
-- BY NAME as well as through PUBLIC, because Supabase's ALTER DEFAULT
-- PRIVILEGES grant to anon is a separate ACL entry that revoking from PUBLIC
-- leaves standing (part 122's argument, and it opened a real hole here once).
revoke all on function public.notification_channel(text, text) from public;
revoke all on function public.notification_channel(text, text) from anon;
revoke all on function public.notification_channel(text, text) from authenticated;

comment on function public.notification_channel(text, text) is
  'Which of the coach''s six notification switches a written row answers to, from its route and — for the three routeless kinds — its title. Mirrored by notificationChannel() in src/lib/notifyDispatch.ts, which is tested against the SERVER_WRITTEN catalogue in notifyInbox.ts. Whole-route matching with the query string removed, exactly as inboxIcon does it. NULL means unclassified, and an unclassified row is never pushed.';

-- ── 3 · Stamping it on the way in ─────────────────────────────────────────
--
-- BEFORE INSERT, so the column is right for every writer without any of them
-- knowing this exists. A writer that sets `channel` itself is left alone: the
-- derivation is a default, not an override, and a future trigger that knows
-- something the route does not should be able to say so.
create or replace function public.notifications_set_channel()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.channel is null then
    new.channel := public.notification_channel(new.route, new.title);
  end if;
  return new;
end
$function$;

revoke all on function public.notifications_set_channel() from public;
revoke all on function public.notifications_set_channel() from anon;
revoke all on function public.notifications_set_channel() from authenticated;

drop trigger if exists notifications_set_channel on public.notifications;
create trigger notifications_set_channel
  before insert on public.notifications
  for each row execute function public.notifications_set_channel();

-- ── 4 · notify_users(), marking its own rows ──────────────────────────────
--
-- Re-emitted from part 122 with ONE change: `push_by` is set to 'caller'. The
-- authorisation, the DISTINCT, the join to profiles, the truncations and the
-- row count are byte for byte what part 122 wrote and the reasoning for every
-- one of them is in that file rather than repeated here.
--
-- WHY THE FUNCTION HAS TO BE TOUCHED AT ALL. Its callers are `recordInbox` in
-- src/ui/pushNotifications.ts and nothing else, and every one of those paths
-- has already decided about the push: `sendPush` and `sendPushChecked` send one
-- themselves, and src/ui/coachInvoices.ts calls `recordInbox` alone on purpose
-- because "an invoice is not urgent". Dispatching those rows would double the
-- first and overrule the second. There is no signal in the row itself that
-- separates them from a trigger's write — `current_user` is `postgres` inside
-- every one of these definer functions, and `auth.uid()` is the client in both
-- cases when a client's action fires a trigger — so the writer has to say so,
-- and this is the only writer that has to say anything.
--
-- IF PART 122 EVER CHANGES, this copy has to change with it. That is a real
-- cost and it is smaller than the alternative, which was twenty-two edits
-- in thirteen files to mark the other side.
create or replace function public.notify_users(
  p_user_ids   uuid[],
  p_title      text,
  p_body       text,
  p_icon       text default null,
  p_route      text default null,
  p_session_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me    uuid    := (select auth.uid());
  v_title text    := nullif(btrim(coalesce(p_title, '')), '');
  v_body  text    := nullif(btrim(coalesce(p_body,  '')), '');
  v_icon  text    := nullif(btrim(coalesce(p_icon,  '')), '');
  v_route text    := nullif(btrim(coalesce(p_route, '')), '');
  v_n     integer := 0;
begin
  if v_me is null or v_body is null then
    return 0;
  end if;

  with wanted as (
    select distinct u as uid
      from unnest(coalesce(p_user_ids, '{}'::uuid[])) as u
     where u is not null
     limit 2000
  ),
  allowed as (
    select w.uid
      from wanted w
      join public.profiles p on p.id = w.uid
     where w.uid = v_me
        or exists (select 1 from public.clients c where c.id = w.uid and c.trainer_id = v_me)
        or exists (select 1 from public.clients c where c.id = v_me  and c.trainer_id = w.uid)
        or exists (select 1 from public.clients c where c.id = w.uid and public.is_owner_of(c.tenant_id))
        or public.is_owner_of(p.tenant_id)
  )
  insert into public.notifications (user_id, title, body, icon, route, session_id, push_by)
  select a.uid,
         left(v_title, 120),
         left(v_body, 500),
         left(v_icon, 40),
         left(v_route, 200),
         p_session_id,
         -- The one line this copy adds. See the header above.
         'caller'
    from allowed a;

  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

revoke all on function public.notify_users(uuid[], text, text, text, text, uuid) from public;
revoke all on function public.notify_users(uuid[], text, text, text, text, uuid) from anon;
grant execute on function public.notify_users(uuid[], text, text, text, text, uuid) to authenticated;

-- ── 5 · The dispatch ──────────────────────────────────────────────────────
--
-- A STATEMENT-level AFTER INSERT trigger with a transition table. Row-level
-- would have meant one HTTP post per row, and part 493 writes one row per
-- member of a cancelled class.
--
-- SECURITY DEFINER because it must UPDATE `notifications` past `notif_self`,
-- which is `using (user_id = auth.uid())` and therefore refuses every row this
-- function is interested in — the same reason part 122 gives. `search_path` is
-- pinned so the tables it resolves cannot be chosen by whoever happens to be
-- inserting.
create or replace function public.notifications_dispatch_push()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_key text;
  v_me  uuid := (select auth.uid());
  r     record;
begin
  select decrypted_secret into v_key
    from vault.decrypted_secrets
   where name = 'storage_service_key'
   limit 1;

  -- No key configured: skip rather than post a request send-push will refuse.
  -- Part 26's early return, for the same reason. The rows are already written.
  if v_key is null or v_key = '' then
    return null;
  end if;

  for r in
    with claimed as (
      update public.notifications n
         set pushed_at = now()
        from ins i
       where n.id = i.id
         -- (b) of the idempotency argument: the claim. Atomic, row-locked, and
         -- a second firing gets nothing back.
         and n.pushed_at is null
         -- A handset wrote it and has already decided about the push.
         and n.push_by = 'server'
         -- Nobody has said which switch governs it. Not sent — see rule 2.
         and n.channel is not null
         -- notify-message writes this row AND pushes it (part 26), and
         -- src/ui/messaging.ts pushes the coach's side. A third push would make
         -- every message in the product arrive twice.
         and n.channel <> 'chat'
         -- Never about your own action. Null uid is a cron pass and skips
         -- nobody, which is correct: an ageing invoice has no actor.
         and (v_me is null or n.user_id <> v_me)
      returning n.user_id, n.channel, n.title, n.body, n.route
    )
    -- (a) of the idempotency argument: grouped, so forty members of a cancelled
    -- class are one post with forty ids rather than forty posts. `title` and
    -- `body` are part of the key because two different messages in one
    -- statement are two different pushes.
    select c.channel,
           coalesce(nullif(btrim(c.title), ''), 'Repple') as title,
           c.body,
           coalesce(btrim(c.route), '')                   as route,
           array_agg(distinct c.user_id)                  as user_ids
      from claimed c
     where c.body is not null and btrim(c.body) <> ''
     group by c.channel, coalesce(nullif(btrim(c.title), ''), 'Repple'), c.body, coalesce(btrim(c.route), '')
  loop
    perform net.http_post(
      url     := 'https://phgfwzpkkwdysftlgkoq.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        -- send-push is deployed with verify_jwt TRUE (supabase/README.md), so
        -- an unauthenticated post would be a 401 and this part would be inert.
        'Authorization', 'Bearer ' || v_key,
        'apikey',        v_key
      ),
      body    := jsonb_build_object(
        'user_ids', to_jsonb(r.user_ids),
        'title',    r.title,
        'body',     r.body,
        -- The whole point. send-push filters muted recipients ONLY when this is
        -- present, and applies quiet hours after it against what is left.
        'channel',  r.channel,
        -- `data.route` is what addNotificationTapListener() navigates to, and
        -- src/lib/notifyInbox.ts `safeRoute` validates it again on the way out.
        'data',     case when r.route = '' then '{}'::jsonb
                         else jsonb_build_object('route', r.route) end
      )
    );
  end loop;

  return null;
-- A failed push must never lose the row, and must never roll back the business
-- write that caused it. This is an AFTER trigger inside somebody's transaction:
-- an uncaught error here would abort the package purchase, the subscription
-- update or the signed release along with the notification. Part 26's rule,
-- and the reason it is stated out loud in both places.
exception when others then
  return null;
end
$function$;

revoke all on function public.notifications_dispatch_push() from public;
revoke all on function public.notifications_dispatch_push() from anon;
revoke all on function public.notifications_dispatch_push() from authenticated;

drop trigger if exists notifications_dispatch on public.notifications;
create trigger notifications_dispatch
  after insert on public.notifications
  referencing new table as ins
  for each statement execute function public.notifications_dispatch_push();

comment on function public.notifications_dispatch_push() is
  'Turns a written notification into a push. Statement-level with a transition table, so one statement is one post per distinct message with the recipients aggregated. Claims rows with an UPDATE on pushed_at, so a row is dispatched at most once. Skips rows a handset already pushed (push_by = ''caller''), chat (notify-message pushes its own), rows with no channel (send-push does not filter a channelless send, so an unmutable push would ignore every preference set) and the actor''s own row. Posts to send-push, which holds the channel filter and quiet hours — neither is re-implemented here. Swallows every error: the inbox row is the durable half and a pg_net fault must not roll back the write that caused it.';

-- ── 6 · What is outstanding, for whoever applies this ─────────────────────
--
-- Two things this part cannot do and one it deliberately did not.
--
--   · supabase/functions/send-push must be DEPLOYED for any of this to arrive,
--     and the deployed version must be the one in this tree that reads
--     `notify_quiet_now`. Then:
--         update public.notify_quiet_hours_rollout set enforced = true;
--     which is what makes the quiet-hours switch appear on the coach's screen.
--
--   · Vault must hold `storage_service_key` (Dashboard ▸ Project Settings ▸
--     Vault). It already does if progress-photo purging works. Without it every
--     notification is still written and none is pushed, which is the state this
--     part was written to end — so check it rather than assuming it:
--         select count(*) from vault.decrypted_secrets where name = 'storage_service_key';
--
--   · The three routeless kinds are matched on their titles, and the honest
--     version of that is for parts 146 and 159 to set `channel` in their own
--     inserts — the column accepts it and this file will not overwrite it.
--     Those files belong to other lanes and were not edited.
--
-- To see what is being classified and what is not, once this is applied:
--
--     select channel, push_by, count(*), count(pushed_at) as pushed
--       from public.notifications
--      where created_at > now() - interval '7 days'
--      group by 1, 2 order by 3 desc;
--
-- A `channel` of null with `push_by = 'server'` is a kind nobody has classified
-- and nobody is being told about. That is the number this part exists to drive
-- to zero, and src/lib/notifyDispatch.test.ts is what stops it climbing again.
