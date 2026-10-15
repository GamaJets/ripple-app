-- A week with nothing logged, said by something that is awake.
--
-- ── the notification that was true when it was armed ──────────────────────
--
-- 14 Oct 2026, 19:00, on the owner's own handset: "It has been a week —
-- Nothing logged for 17 days." He had logged a cycling session that morning,
-- in the app, at 04:02. `workouts.logged_by` is null on that row, which is
-- what self-logged means here.
--
-- The sentence was correct when it was armed and false when it was delivered,
-- and src/ui/motivationNudges.tsx now re-plans whenever the log moves. That
-- narrows the window to "the app was not opened in between" and cannot close
-- it, because a local notification cannot re-read anything when it fires.
-- src/lib/motivationNudge.ts has said so since it was written:
--
--     "They do NOT reach somebody who has not opened the app for a week, and
--      that is the case a 'you have not trained in a week' nudge most wants to
--      reach. Closing that needs a server."
--
-- This is that server.
--
-- ── why this needed a seventh channel rather than an existing one ─────────
--
-- src/lib/notifyDispatch.ts states the rule: "an unclassified route is a kind
-- that silently never pushes". A notification whose route maps to no channel
-- lands in the in-app list and stops there, so shipping this against `null`
-- would have been the bug unfixed, dressed as fixed.
--
-- None of the six fitted. A nudge about your own training is not a client
-- message, a booking, money, paperwork, or the coach's own book — and riding
-- one of them means one switch mutes two unrelated things. `/(client)/workouts`
-- was already taken: part 3350 maps it to 'clients' for a coach's answer to a
-- filmed set.
--
-- So: a 'training' channel, and the route is '/(client)/consistency' — which
-- is both free and the right screen to land on, being the one that shows the
-- weeks with nothing in them.
--
-- It is a COACH channel as well as a member one, because coaches train too:
-- my-training, my-progress and my-nutrition are their own screens, and a quiet
-- week is the same fact about whoever it is said to. That also keeps
-- `MemberChannel` a subset of `CoachChannel`, which is what src/lib's notify
-- modules are written against.
--
-- ── when it fires, and the fact that decided it ───────────────────────────
--
-- Hourly at :55, which is clear of the six passes already scheduled (:12, :19,
-- :26, :33, :40, :48 — part 1890). The work is gated by `claim_notice_pass`,
-- which is part 1890's machinery and does two things in one statement: it is
-- only true when it is the intended hour in THAT PERSON'S zone, and it claims
-- the person for the UTC day so two ticks racing cannot both send.
--
-- The hour passed in is 15. Measured on the live database before choosing it:
--
--     members 16 · with a stored zone 0 · ever trained 4 · quiet >= 7 days 3
--
-- Not one member has a zone today, so `notice_hour_due` falls to its no-zone
-- branch and every one of them gets the exact UTC hour. 15:00 UTC is 19:00 in
-- Asia/Dubai, which is where this product's members are and which is the same
-- EVENING_HOUR src/ui/motivationNudges.tsx uses on the handset. A member who
-- later sets quiet hours acquires a zone and moves to their own 19:00-21:00,
-- with no change here.
--
-- Blast radius on the first tick is three people.
--
-- ── what it refuses to say ────────────────────────────────────────────────
--
-- Nothing to somebody who has never logged anything. "It has been a week" to a
-- member who has not started is not a nudge, it is a stranger's assumption,
-- and src/lib/motivationNudge.ts already refuses it — `Infinity` is "not a
-- quiet week" there rather than a very long one. The `exists` clause below is
-- that same refusal.
--
-- Nothing after ninety days. Past that a member has not lapsed, they have
-- left, and a cheerful note about a short session counting is the app not
-- having noticed.
--
-- Not twice in a week. The claim stops a second send the same day; the
-- `not exists` on the last seven days of this route is what stops it becoming
-- a daily one. That is the nagging this family of notifications refuses, in
-- part 612's words.
--
-- The member's own switch is honoured without this file doing anything: the
-- row carries the route, part 900's dispatcher derives 'training' from it
-- through `notification_channel` below, and send-push applies the switch and
-- the quiet hours. This part cannot route around either, which is the point of
-- writing a row rather than calling the sender.

-- ── 1 · the channel vocabulary, widened in both places that police it ─────
--
-- Both constraints list the channels by value, so a 'training' row would be
-- refused by the first and a 'training' preference by the second. Dropped and
-- re-added rather than altered, which is how a CHECK is changed.
alter table public.notifications
  drop constraint if exists notifications_channel_chk;
alter table public.notifications
  add constraint notifications_channel_chk
  check (channel is null or channel = any (array['chat','bookings','money','clients','admin','book','training']));

alter table public.notify_channel_prefs
  drop constraint if exists notify_channel_prefs_channel_chk;
alter table public.notify_channel_prefs
  add constraint notify_channel_prefs_channel_chk
  check (channel = any (array['chat','bookings','money','clients','admin','book','training']));

-- ── 2 · the route map, taken from the live database and added to ──────────
--
-- The body below is `pg_get_functiondef` output with exactly one line added.
-- Written that way on purpose: a previous part in this repository was
-- hand-typed from an older copy and silently dropped a `verification =
-- self_declared` clause, which would have published credentials nobody had
-- declared. Thirty-seven routes in, thirty-eight out, checked.

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
      when '/(client)/assessments'      then 'clients'
      when '/(client)/community'        then 'clients'
      when '/(trainer)/community'       then 'clients'
      when '/(owner)/community'         then 'clients'
      when '/(trainer)/checkins'        then 'clients'
      when '/(client)/workouts'         then 'clients'

      when '/(trainer)/documents'       then 'admin'
      when '/(trainer)/client-intake'   then 'admin'
      when '/(trainer)/credentials'     then 'admin'
      when '/(client)/intake'           then 'admin'
      when '/(client)/injuries'         then 'admin'

      when '/(client)/consistency'      then 'training'

      when '/(trainer)/invoices'        then 'book'
      when '/(trainer)/nudges'          then 'book'
      when '/(trainer)/builder'         then 'book'

      else null
    end;
  end if;

  return case t
    when 'An invoice from your gym'        then 'money'
    when 'Your coaching has ended'         then 'clients'
    when 'A client has signed the release' then 'admin'
    else null
  end;
end
$function$;

-- No revokes re-stated. `create or replace` keeps the grants a function
-- already has, parts 900 and 1870 already revoked this one from public, anon
-- and authenticated, and part 3390 — the previous part to redefine it — states
-- none for the same reason. There is a second reason too:
-- scripts/check-notify-routes.mjs finds the definition by searching a part
-- for the LAST mention of this routine's qualified name, so anything after
-- the body carrying that name again — a revoke, or a comment like this one
-- spelling it out — makes the gate read that instead and classify no routes
-- at all. Which it did, twice, while this part was being written.

-- ── 3 · the pass ──────────────────────────────────────────────────────────

create or replace function public.run_quiet_week_nudges()
returns integer
language plpgsql
volatile
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_due  uuid[];
  v_sent int := 0;
  r      record;
begin
  -- Who is due THIS tick. `claim_notice_pass` is part 1890's: it keeps only
  -- the people for whom it is currently the intended local hour, and claims
  -- each of them for the UTC day in the same statement, so a second tick in
  -- the same hour finds nothing left to do.
  select public.claim_notice_pass(
           'quiet-week',
           coalesce(array_agg(c.id), '{}'::uuid[]),
           15)
    into v_due
    from public.clients c
   where exists (select 1 from public.workouts w where w.user_id = c.id)
     and (select max(w.performed_at) from public.workouts w where w.user_id = c.id)
           between now() - interval '90 days' and now() - interval '7 days';

  for r in
    select c.id,
           (select max(w.performed_at) from public.workouts w where w.user_id = c.id) as last_at
      from public.clients c
     where c.id = any(coalesce(v_due, '{}'::uuid[]))
  loop
    -- Re-checked rather than trusted from the claim. The claim was made
    -- against a set gathered at the top of this function; a member who logged
    -- a session in the seconds since is no longer quiet, and telling them
    -- otherwise is the exact defect this whole part is about.
    if r.last_at is null or r.last_at > now() - interval '7 days' then
      continue;
    end if;

    -- Not twice in a week. See the header.
    if exists (
      select 1
        from public.notifications n
       where n.user_id = r.id
         and n.route = '/(client)/consistency'
         and n.created_at > now() - interval '7 days'
    ) then
      continue;
    end if;

    -- The same words the handset uses, so a member who gets one from each
    -- source over a fortnight is not reading two different apps. Sentence
    -- case: src/lib/motivationNudge.ts says "it is a notification title, not a
    -- label", and every other row in this table is written the same way.
    insert into public.notifications (user_id, title, body, icon, route)
    values (
      r.id,
      'It has been a week',
      'Nothing logged for ' || greatest(1, (current_date - r.last_at::date))
        || ' days. A short session counts. It is the coming back that matters.',
      'train',
      '/(client)/consistency');

    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end $fn$;

revoke all on function public.run_quiet_week_nudges() from public, anon, authenticated;

comment on function public.run_quiet_week_nudges() is
  'Writes one "it has been a week" notification per member who has trained before, whose last session was between seven and ninety days ago, for whom it is currently the intended local hour, and who has not had this notification in the last seven days. Returns how many were written. The push, the channel switch and the quiet hours are all part 900''s dispatcher and send-push; this writes a row and nothing else.';

-- ── 4 · hourly, on a minute nothing else uses ─────────────────────────────
select cron.unschedule('quiet-week-nudges')
 where exists (select 1 from cron.job where jobname = 'quiet-week-nudges');

select cron.schedule('quiet-week-nudges', '55 * * * *', $cron$select public.run_quiet_week_nudges();$cron$);
