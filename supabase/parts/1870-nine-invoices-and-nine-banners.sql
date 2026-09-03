-- ═══════════════════════════════════════════════════════════════════════════
-- A coach who bills twenty clients on the first of the month gets twenty
-- banners on the eighth.
--
-- ── WHAT WAS MEASURED ─────────────────────────────────────────────────────
--
-- Six pg_cron jobs write a coach's notifications, all of them live today:
--
--   overdue-client-notices     12 7 * * *   run_overdue_client_notices     (202)
--   credential-expiry-notices  19 7 * * *   run_credential_expiry_notices  (202)
--   block-ended-notices        26 7 * * *   run_block_ended_notices        (471)
--   pack-expiry                33 7 * * *   run_pack_expiry                (612)
--   invoice-ageing-notices     40 7 * * *   run_invoice_ageing_notices     (613)
--   open-slot-extension        48 7 * * *   run_open_slot_extension        (650)
--
-- Every one of the five that notifies is shaped
--
--     for r in select … loop
--       …
--       insert into public.notifications (…) values (…);
--     end loop;
--
-- — ONE INSERT STATEMENT PER ROW. `notifications_dispatch_push` (part 900) is
-- an AFTER INSERT trigger `for each statement`, and its grouping is what makes
-- "forty members of a cancelled class one post with forty ids rather than forty
-- posts" true. That grouping cannot see across two statements. So a pass that
-- writes nine rows for one coach makes nine posts to send-push and nine banners
-- at that coach's phone inside a minute.
--
-- It is not a rare shape. Part 613 fires when an invoice crosses into a new
-- band of `ageBucket()`, and a coach who invoices twenty clients on the first
-- of the month has twenty invoices with one due date and therefore twenty
-- crossing into '1-7' on one night. Part 202's client pass fires on the day a
-- client passes their own median gap, and a coach coming back from a fortnight
-- away has a roster that crossed together.
--
-- ── WHY THAT IS THE EXPENSIVE KIND OF WRONG ───────────────────────────────
--
-- src/lib/coachNotify.ts already made this decision for the half of the
-- `book` channel the HANDSET computes, and gave the reason:
--
--   "ONE banner and not four, and the order is the argument. A phone that
--    fires four notifications in a row about the same business on the same
--    morning is a phone whose notifications get turned off, and turning them
--    off is what took the money channel down with the chat channel in the
--    first place."
--
-- The handset half has held to that since `bookAlert` was written. The server
-- half — added by parts 202, 471, 612 and 613, and only actually delivered by
-- part 900 — never had it, and the server half is the one that reaches somebody
-- who is not looking.
--
-- ── WHAT THIS CHANGES, AND WHAT IT DELIBERATELY DOES NOT TOUCH ────────────
--
-- NOT the five pass functions. Every one of them is sixty to a hundred and
-- twenty lines of plpgsql whose every clause carries its own argument, and
-- re-emitting five of those to move an INSERT is five chances to break a
-- nightly job that works. The cron COMMAND is what changes: each pass is now
-- invoked through `run_notices_with_digest(<name>)`, which is a wrapper, and
-- the pass itself is called unaltered from inside it.
--
-- NOT the ordinary path either. A trigger firing on somebody's booking, a
-- package purchase, a chargeback, a signed release — none of those runs inside
-- the wrapper, no hold is set, and `notifications_dispatch_push` posts exactly
-- what it posts today, byte for byte. This changes the five nightly passes and
-- nothing else in the product.
--
-- NOT the rows. All nine are written, all nine are in the coach's notifications
-- list, all nine are counted by the bell. What is coalesced is the PUSH — the
-- same distinction `CHANNEL_STILL_RECORDED` draws for muting and send-push
-- draws for quiet hours: "muting is 'do not buzz me about this', not 'do not
-- tell me'".
--
-- NOT across passes. A coach with something waiting in four of the five still
-- gets four banners between 07:12 and 07:40. Four different subjects is
-- defensible in a way nine invoices is not, and narrowing it further would mean
-- holding a push back in the hope of a later one — which nothing in this system
-- can do, for the reason src/lib/quietHours.ts gives at length.
--
-- ── THE WORDING ───────────────────────────────────────────────────────────
--
-- One row's own body, verbatim, and a clause counting the rest. NOT a composed
-- plural heading: the rows in a group do not share a title (part 613 emits 'An
-- invoice has gone past its date' below eight days and 'An invoice is still
-- unpaid' above it), pluralising an arbitrary English title is not something
-- plpgsql can do, and the count is what the coach actually needs — the
-- difference between believing one invoice is late and knowing twenty are.
--
-- It does not claim the row it shows is the worst of them. Within one pass the
-- rows are one kind and nothing on the row ranks them, so "one of them" is what
-- is true and "here is the most urgent" would be an order this invented.
--
-- Mirrored by `digestPushes` / `digestBody` / `digestNote` in
-- src/lib/notifyDigest.ts, which is where the rule is under test.
-- `to_char(n, 'FM9,999,999')` is `num()` from src/lib/format.ts: a literal
-- comma in a to_char template is locale-independent, so the two agree.
--
-- ── SAFE TO RE-RUN ────────────────────────────────────────────────────────
--
-- Idempotent. Every function is `create or replace`, the cron jobs are
-- unscheduled before being scheduled, and the temp table is per-transaction.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · The clause ────────────────────────────────────────────────────────
--
-- `digestNote` and `digestBody` in src/lib/notifyDigest.ts, in plpgsql.
--
-- The clause is NEVER what gets cut. Every writer of `notifications.body` in
-- the numbered parts stores `left(<body>, 500)`, so a digest composed from a
-- body already at that ceiling would lose its own count off the end — and the
-- count is the one part of a digest that is not in the row it was built from.
-- A coach could not tell a digest whose count had been truncated from an
-- ordinary single notification. So the clause is subtracted first and the BODY
-- is what carries the three dots.
create or replace function public.notification_digest_body(p_body text, p_more integer)
returns text
language plpgsql
immutable
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_more integer := greatest(0, coalesce(p_more, 0));
  v_note text;
  v_room integer;
begin
  if v_more = 0 then
    return left(v_body, 500);
  end if;
  v_note := case
    when v_more = 1
      then ' There is one more like this. Both are in your notifications list.'
    else ' There are ' || to_char(v_more, 'FM9,999,999') || ' more like this. All '
           || to_char(v_more + 1, 'FM9,999,999') || ' are in your notifications list.'
  end;
  v_room := 500 - length(v_note);
  -- Only reachable if somebody makes the clause enormous. The count survives
  -- and the body does not, which is the right way round.
  if v_room <= 3 then
    return left(btrim(v_note), 500);
  end if;
  return case
           when length(v_body) <= v_room then v_body
           else rtrim(left(v_body, v_room - 3)) || '...'
         end || v_note;
end
$function$;

revoke all on function public.notification_digest_body(text, integer) from public;
revoke all on function public.notification_digest_body(text, integer) from anon;
revoke all on function public.notification_digest_body(text, integer) from authenticated;

comment on function public.notification_digest_body(text, integer) is
  'One notification body plus a clause counting the rest of its batch, inside the 500 characters notifications.body is stored under. The clause is given its room before the body, because a truncated count turns a digest back into a single notification with no way for the reader to tell. Mirrored by digestBody() in src/lib/notifyDigest.ts.';

-- ── 2 · The route table gains the screen a session request opens ──────────
--
-- '/(trainer)/sessions' — Mark What Happened, where app/(client)/request-session.tsx
-- sends 'A session request'. It was the one route this repo actually pushes
-- that `notification_channel()` returned null for, and null means never
-- dispatched. It costs nothing today because that push is sent by a handset
-- which passes the channel itself; it costs the whole kind on the day part
-- 740's answer moves server-side, as parts 202, 471 and 613 moved theirs.
--
-- '/(client)/injuries' for the same reason, and it is 'admin' for the reason
-- '/(client)/intake' already is: both are a form the coach needs before they
-- may write a programme, which is what that switch's label means by paperwork.
--
-- Everything else in this function is byte for byte part 900's. Mirrored by
-- CHANNEL_BY_ROUTE in src/lib/notifyDispatch.ts, whose test now checks
-- KNOWN_PUSHES as well as SERVER_WRITTEN — which is what made the gap visible.
create or replace function public.notification_channel(p_route text, p_title text)
returns text
language plpgsql
immutable
set search_path to 'public', 'pg_temp'
as $function$
declare
  r text := split_part(btrim(coalesce(p_route, '')), '?', 1);
  t text := btrim(coalesce(p_title, ''));
begin
  if r <> '' then
    return case r
      when '/(client)/messages'         then 'chat'
      when '/(trainer)/chat'            then 'chat'

      when '/(trainer)/calendar'        then 'bookings'
      when '/(client)/calendar'         then 'bookings'
      when '/(client)/bookings'         then 'bookings'
      when '/(client)/pt-sessions'      then 'bookings'
      when '/(client)/classes'          then 'bookings'
      when '/(client)/request-session'  then 'bookings'
      -- The addition. See the header of this section.
      when '/(trainer)/sessions'        then 'bookings'

      when '/(trainer)/payments'        then 'money'
      when '/(client)/packages'         then 'money'
      when '/(client)/explore'          then 'money'
      when '/(client)/offers'           then 'money'

      when '/(trainer)/dashboard'       then 'clients'
      when '/(trainer)/leads'           then 'clients'
      when '/(trainer)/client-goals'    then 'clients'
      when '/(trainer)/client-training' then 'clients'
      when '/(trainer)/client-photos'   then 'clients'
      when '/(client)/my-coach'         then 'clients'
      when '/(client)/trainers'         then 'clients'

      when '/(trainer)/documents'       then 'admin'
      when '/(trainer)/client-intake'   then 'admin'
      when '/(trainer)/credentials'     then 'admin'
      when '/(client)/intake'           then 'admin'
      -- The second addition.
      when '/(client)/injuries'         then 'admin'

      when '/(trainer)/invoices'        then 'book'
      when '/(trainer)/nudges'          then 'book'
      when '/(trainer)/builder'         then 'book'

      -- '/(client)/notices' is deliberately absent and not an oversight: all
      -- six switches are things a COACH receives, and a notice is the one kind
      -- in this product nobody receives on a switch — the coach and the owner
      -- are the senders and the recipient is a member, who has no switches.
      -- src/lib/notifyDispatch.ts carries that argument in full and its test
      -- names this route so the gap is an assertion rather than a hole.
      else null
    end;
  end if;

  -- The three routeless kinds, matched on the literals in parts 146 and 159.
  return case t
    when 'An invoice from your gym'        then 'money'
    when 'Your coaching has ended'         then 'clients'
    when 'A client has signed the release' then 'admin'
    else null
  end;
end
$function$;

revoke all on function public.notification_channel(text, text) from public;
revoke all on function public.notification_channel(text, text) from anon;
revoke all on function public.notification_channel(text, text) from authenticated;

comment on function public.notification_channel(text, text) is
  'Which of the coach''s six notification switches a written row answers to, from its route and — for the three routeless kinds — its title. Mirrored by notificationChannel() in src/lib/notifyDispatch.ts, which is tested against both SERVER_WRITTEN and KNOWN_PUSHES in notifyInbox.ts. Whole-route matching with the query string removed, exactly as inboxIcon does it. NULL means unclassified, and an unclassified row is never pushed.';

-- ── 3 · The dispatcher learns to be held ──────────────────────────────────
--
-- One branch added and nothing else touched. `repple.push_hold` is a
-- TRANSACTION-LOCAL setting — `set_config(..., true)` — so it cannot leak into
-- another session, cannot survive a rollback, and is unset for every caller
-- that is not the wrapper below. With it unset this function does exactly what
-- part 900's does.
--
-- The hold is also refused unless the buffer table actually exists. A flag
-- naming a table that is not there would raise inside a trigger whose whole
-- contract is to swallow errors, and swallowing THAT would drop the push
-- silently — the failure mode this file exists to avoid, arriving by the door
-- marked "fix".
create or replace function public.notifications_dispatch_push()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_key  text;
  v_me   uuid := (select auth.uid());
  v_hold boolean := coalesce(current_setting('repple.push_hold', true), '') = 'on'
                    and to_regclass('pg_temp.repple_push_hold') is not null;
  r      record;
begin
  if not v_hold then
    select decrypted_secret into v_key
      from vault.decrypted_secrets
     where name = 'storage_service_key'
     limit 1;
    -- No key configured: skip rather than post a request send-push will refuse.
    -- The rows are already written.
    if v_key is null or v_key = '' then
      return null;
    end if;
  end if;

  for r in
    with claimed as (
      update public.notifications n
         set pushed_at = now()
        from ins i
       where n.id = i.id
         and n.pushed_at is null
         and n.push_by = 'server'
         and n.channel is not null
         and n.channel <> 'chat'
         and (v_me is null or n.user_id <> v_me)
      returning n.user_id, n.channel, n.title, n.body, n.route
    )
    select c.channel,
           coalesce(nullif(btrim(c.title), ''), 'Repple') as title,
           c.body,
           coalesce(btrim(c.route), '')                   as route,
           array_agg(distinct c.user_id)                  as user_ids
      from claimed c
     where c.body is not null and btrim(c.body) <> ''
     group by c.channel, coalesce(nullif(btrim(c.title), ''), 'Repple'), c.body, coalesce(btrim(c.route), '')
  loop
    if v_hold then
      -- Buffered, not posted. The wrapper groups the whole pass afterwards and
      -- posts once per recipient per (channel, route). The rows are ALREADY
      -- claimed by the update above, so a wrapper that then failed would leave
      -- them unpushed rather than pushed twice — which is the direction part
      -- 900 chose for the same reason: the inbox row is the durable half.
      insert into repple_push_hold (user_id, channel, title, body, route)
      select u, r.channel, r.title, r.body, r.route from unnest(r.user_ids) as u;
    else
      perform net.http_post(
        url     := 'https://phgfwzpkkwdysftlgkoq.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || v_key,
          'apikey',        v_key
        ),
        body    := jsonb_build_object(
          'user_ids', to_jsonb(r.user_ids),
          'title',    r.title,
          'body',     r.body,
          'channel',  r.channel,
          'data',     case when r.route = '' then '{}'::jsonb
                           else jsonb_build_object('route', r.route) end
        )
      );
    end if;
  end loop;

  return null;
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
  'Turns a written notification into a push. Statement-level with a transition table, so one statement is one post per distinct message with the recipients aggregated. Claims rows with an UPDATE on pushed_at, so a row is dispatched at most once. Skips rows a handset already pushed (push_by = ''caller''), chat, rows with no channel, and the actor''s own row. Posts to send-push, which holds the channel filter and quiet hours. When the transaction-local setting repple.push_hold is ''on'' and the buffer table exists, the claimed rows are BUFFERED instead of posted and run_notices_with_digest() posts one digest per recipient — that is the nightly-pass path and nothing else sets the flag. Swallows every error: the inbox row is the durable half.';

-- ── 4 · The wrapper the cron jobs call ────────────────────────────────────
--
-- Calls a notice pass unaltered, with the dispatcher held, then posts one push
-- per recipient per (channel, route).
--
-- The `p_fn` argument is checked against a fixed list rather than executed as
-- given. This function is SECURITY DEFINER and `execute format('select
-- public.%I()', p_fn)` with an unchecked name is a way to call any function in
-- the schema as the owner — and it is only ever called by cron with one of five
-- literals, so the allow-list costs nothing and closes it completely.
create or replace function public.run_notices_with_digest(p_fn text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_key    text;
  v_result jsonb;
  v_posts  integer := 0;
  v_rows   integer := 0;
  r        record;
begin
  if p_fn not in (
    'run_overdue_client_notices',
    'run_credential_expiry_notices',
    'run_block_ended_notices',
    'run_pack_expiry',
    'run_invoice_ageing_notices'
  ) then
    raise exception 'run_notices_with_digest: % is not one of the notice passes', p_fn;
  end if;

  -- `seq` is what makes "the first row's own words" a fact rather than
  -- whichever row the planner happened to return. It is the order the pass
  -- wrote them in, which is the order of its own select — deterministic, and
  -- not claimed to be a ranking of urgency.
  create temp table if not exists repple_push_hold (
    seq     bigint generated always as identity,
    user_id uuid not null,
    channel text not null,
    title   text not null,
    body    text not null,
    route   text not null
  ) on commit drop;
  delete from repple_push_hold;

  perform set_config('repple.push_hold', 'on', true);
  begin
    execute format('select public.%I()', p_fn) into v_result;
  exception when others then
    -- The hold must come off even when the pass fails, or a later statement in
    -- this transaction would buffer a push nobody ever sends.
    perform set_config('repple.push_hold', 'off', true);
    raise;
  end;
  perform set_config('repple.push_hold', 'off', true);

  select count(*) into v_rows from repple_push_hold;

  select decrypted_secret into v_key
    from vault.decrypted_secrets
   where name = 'storage_service_key'
   limit 1;
  if v_key is null or v_key = '' then
    -- Nothing to post with. The rows are written and claimed, exactly as they
    -- are when part 900's dispatcher finds no key.
    return coalesce(v_result, '{}'::jsonb) || jsonb_build_object('digest_rows', v_rows, 'digest_posts', 0);
  end if;

  for r in
    -- Stage one: per recipient per (channel, route), decide the ONE message.
    with decided as (
      select h.user_id,
             h.channel,
             h.route,
             count(*)                                          as n,
             (array_agg(h.title order by h.seq))[1]            as title,
             (array_agg(h.body  order by h.seq))[1]            as body
        from repple_push_hold h
       group by h.user_id, h.channel, h.route
    ),
    worded as (
      select d.user_id, d.channel, d.route, d.title,
             case when d.n = 1 then d.body
                  else public.notification_digest_body(d.body, d.n - 1) end as body
        from decided d
    )
    -- Stage two: identical messages share a post, which is what part 900's
    -- dispatcher does for forty members of a cancelled class. Two coaches with
    -- one aged invoice each get one post with two ids; two coaches with nine
    -- each get two, because their bodies name different invoices.
    select w.channel, w.title, w.body, w.route,
           array_agg(distinct w.user_id) as user_ids
      from worded w
     group by w.channel, w.title, w.body, w.route
  loop
    perform net.http_post(
      url     := 'https://phgfwzpkkwdysftlgkoq.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_key,
        'apikey',        v_key
      ),
      body    := jsonb_build_object(
        'user_ids', to_jsonb(r.user_ids),
        'title',    r.title,
        'body',     r.body,
        'channel',  r.channel,
        'data',     case when r.route = '' then '{}'::jsonb
                         else jsonb_build_object('route', r.route) end
      )
    );
    v_posts := v_posts + 1;
  end loop;

  -- Counted, and the two figures are the point: `digest_rows` is what was
  -- written and `digest_posts` is what buzzed. They were equal before this
  -- part, and cron.job_run_details keeps the answer, so the saving is
  -- measurable rather than asserted.
  return coalesce(v_result, '{}'::jsonb)
         || jsonb_build_object('digest_rows', v_rows, 'digest_posts', v_posts);
end
$function$;

revoke all on function public.run_notices_with_digest(text) from public;
revoke all on function public.run_notices_with_digest(text) from anon;
revoke all on function public.run_notices_with_digest(text) from authenticated;

comment on function public.run_notices_with_digest(text) is
  'Runs one of the five nightly notice passes with the push dispatcher held, then posts ONE push per recipient per (channel, route) instead of one per row. The pass itself is called unaltered. Returns the pass''s own answer plus digest_rows (written) and digest_posts (pushed), so the saving is a figure in cron.job_run_details rather than a claim. Mirrored by digestPushes() in src/lib/notifyDigest.ts.';

-- ── 5 · The schedule ──────────────────────────────────────────────────────
--
-- Same minutes, same passes, same order. Only the command changes.
--
-- 'open-slot-extension' (part 650) is deliberately NOT wrapped: it extends open
-- slots and writes no notifications, so there is nothing for a digest to
-- coalesce and wrapping it would be a claim that it notifies.
create extension if not exists pg_cron;

do $$
declare
  j record;
begin
  for j in
    select * from (values
      ('overdue-client-notices',    '12 7 * * *', 'run_overdue_client_notices'),
      ('credential-expiry-notices', '19 7 * * *', 'run_credential_expiry_notices'),
      ('block-ended-notices',       '26 7 * * *', 'run_block_ended_notices'),
      ('pack-expiry',               '33 7 * * *', 'run_pack_expiry'),
      ('invoice-ageing-notices',    '40 7 * * *', 'run_invoice_ageing_notices')
    ) as v(jobname, sched, fn)
  loop
    if exists (select 1 from cron.job where jobname = j.jobname) then
      perform cron.unschedule(j.jobname);
    end if;
    perform cron.schedule(
      j.jobname,
      j.sched,
      format('select public.run_notices_with_digest(%L);', j.fn)
    );
  end loop;
end $$;

-- ── 6 · What is outstanding, for whoever applies this ─────────────────────
--
--   · Nothing needs redeploying. send-push is unchanged; it receives the same
--     request shape it already handles, with a different body string and a
--     shorter list of them.
--
--   · The saving is readable the morning after:
--
--       select j.jobname, d.start_time, d.return_message
--         from cron.job_run_details d
--         join cron.job j on j.jobid = d.jobid
--        where j.jobname in ('invoice-ageing-notices', 'overdue-client-notices')
--        order by d.start_time desc limit 20;
--
--     `digest_rows` above `digest_posts` is the fix working. Equal is a night
--     on which nobody had two of anything, which is the ordinary night.
--
--   · What this does NOT fix, and is the larger finding it sits next to: all
--     six jobs run at a fixed UTC minute. 07:12 UTC is 03:12 in New York and
--     00:12 in Los Angeles — the exact "a coach whose insurance notification
--     arrives at 03:17 is a coach who turns notifications off" that parts 202,
--     471, 612 and 613 each say in their own headers they were avoiding. Quiet
--     hours do not rescue it either way: a coach who has set none is woken, and
--     a coach who has SUPPRESSES the push entirely and hears nothing at all.
--     Fixing it means running the passes hourly and notifying only the coaches
--     for whom it is 07:00 locally, which needs a zone per coach —
--     `trainer_availability.tz` and `notify_quiet_hours.tz` both hold one — and
--     is its own part.
