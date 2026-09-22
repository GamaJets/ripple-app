-- ASSESSMENTS AND COMMUNITY REACH A PHONE
--
-- Three things happened in the database and told nobody:
--   · a coach recorded an assessment (part 3280), and the client found out
--     only if they opened Assessments;
--   · somebody replied to a community post (part 3300), and the author did not
--     hear;
--   · somebody reported a post or a comment (part 3300), and the gym's
--     moderators did not hear. Apple guideline 1.2 expects a report to be acted
--     on promptly, which starts with somebody knowing it exists.
--
-- Each is an AFTER INSERT trigger that writes a row into public.notifications
-- and does nothing else. Part 900's dispatcher turns the row into a push and
-- send-push applies the recipient's channel switch and quiet hours, so this
-- part needs no edge function and cannot route around either. The dispatcher
-- also skips the row addressed to the person who caused the write, which is
-- what keeps a comment on your own post silent.
--
-- The channel: `notification_channel` learns the four routes below and maps
-- them to 'clients' ("You And Your Coach" for a member, "Your Clients" for a
-- coach). A seventh switch was the other option and coachNotify.ts records why
-- this codebase declined one before: more switches on a screen whose problem
-- was blunt ones. The switch notes say community now rides on it.
--
-- Each trigger swallows its own errors. A failed notification must never roll
-- back the assessment, the comment, or the report it is about.
--
-- Mirrored by src/lib/communityNotify.ts (copy) and CHANNEL_BY_ROUTE in
-- src/lib/notifyDispatch.ts (routes).

-- ── 1 · notification_channel: part 1870's body plus four routes ──────────

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
      -- Part 3320.
      when '/(client)/assessments'      then 'clients'
      when '/(client)/community'        then 'clients'
      when '/(trainer)/community'       then 'clients'
      when '/(owner)/community'         then 'clients'

      when '/(trainer)/documents'       then 'admin'
      when '/(trainer)/client-intake'   then 'admin'
      when '/(trainer)/credentials'     then 'admin'
      when '/(client)/intake'           then 'admin'
      when '/(client)/injuries'         then 'admin'

      when '/(trainer)/invoices'        then 'book'
      when '/(trainer)/nudges'          then 'book'
      when '/(trainer)/builder'         then 'book'

      -- '/(client)/notices' stays deliberately unclassified; see part 1870.
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

revoke all on function public.notification_channel(text, text) from public;
revoke all on function public.notification_channel(text, text) from anon;
revoke all on function public.notification_channel(text, text) from authenticated;

-- ── 2 · a coach recorded an assessment ───────────────────────────────────
--
-- Labels match testLabel() in src/lib/assessments.ts. "Compares with last
-- time" only when there IS a last time for the same test.

create or replace function public.assessments_notify_client()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_label text;
  v_prior boolean;
begin
  v_label := case new.kind
    when 'movement' then 'Movement Screen'
    when 'mobility' then 'Mobility Check'
    when 'strength' then case new.test_key
      when 'back_squat'     then 'Back Squat'
      when 'bench_press'    then 'Bench Press'
      when 'deadlift'       then 'Deadlift'
      when 'overhead_press' then 'Overhead Press'
      else 'Strength Test' end
    else coalesce(nullif(left(btrim(new.results->>'name'), 60), ''), 'Custom Test')
  end;

  select exists (
    select 1 from public.assessments a
     where a.client_id = new.client_id and a.kind = new.kind and a.test_key = new.test_key
       and a.id <> new.id and a.recorded_at < new.recorded_at
  ) into v_prior;

  insert into public.notifications (user_id, title, body, icon, route)
  values (
    new.client_id,
    'New Assessment Recorded',
    v_label || ' · ' || case when v_prior then 'See how it compares with last time'
                             else 'See your first result' end,
    'bell',
    '/(client)/assessments'
  );
  return null;
exception when others then
  return null;
end $$;

drop trigger if exists assessments_notify_client on public.assessments;
create trigger assessments_notify_client
  after insert on public.assessments
  for each row execute function public.assessments_notify_client();

revoke execute on function public.assessments_notify_client() from public, anon, authenticated;

-- ── 3 · somebody replied to a post ───────────────────────────────────────
--
-- Nothing when a block stands in either direction: the author blocked the
-- commenter (they have said they do not want to hear from them, and the
-- comment is already invisible to them under community_comments_read), or the
-- commenter blocked the author. Own comments are skipped here and again by
-- the dispatcher.

create or replace function public.community_comments_notify_author()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_author uuid;
  v_role   text;
begin
  select p.author_id into v_author
    from public.community_posts p
   where p.id = new.post_id and p.hidden_at is null;

  if v_author is null or v_author = new.author_id then
    return null;
  end if;

  if exists (
    select 1 from public.community_blocks b
     where (b.blocker_id = v_author and b.blocked_id = new.author_id)
        or (b.blocker_id = new.author_id and b.blocked_id = v_author)
  ) then
    return null;
  end if;

  select pr.role into v_role from public.profiles pr where pr.id = v_author;

  insert into public.notifications (user_id, title, body, icon, route)
  values (
    v_author,
    'New Reply To Your Post',
    coalesce(nullif(btrim(new.author_name), ''), 'Someone') || ' replied to your post.',
    'bell',
    case v_role when 'owner' then '/(owner)/community'
                when 'trainer' then '/(trainer)/community'
                else '/(client)/community' end
  );
  return null;
exception when others then
  return null;
end $$;

drop trigger if exists community_comments_notify_author on public.community_comments;
create trigger community_comments_notify_author
  after insert on public.community_comments
  for each row execute function public.community_comments_notify_author();

revoke execute on function public.community_comments_notify_author() from public, anon, authenticated;

-- ── 4 · a report was filed ───────────────────────────────────────────────
--
-- Every moderator of the gym, which is community_moderates()' own test: an
-- owner or trainer profile in the report's tenant. The body names the reason
-- and never quotes the reported words onto a lock screen.

create or replace function public.community_reports_notify_moderators()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_body text;
begin
  v_body := 'A ' || case when new.post_id is not null then 'post' else 'comment' end
    || ' was reported for '
    || case new.reason
         when 'spam'       then 'spam'
         when 'harassment' then 'harassment'
         when 'hate'       then 'hate speech'
         when 'sexual'     then 'sexual content'
         when 'violence'   then 'violence'
         else 'another reason' end
    || '. Open Community to review it.';

  insert into public.notifications (user_id, title, body, icon, route)
  select p.id,
         'New Report In Community',
         v_body,
         'bell',
         case p.role when 'owner' then '/(owner)/community' else '/(trainer)/community' end
    from public.profiles p
   where p.tenant_id = new.tenant_id
     and p.role in ('owner', 'trainer')
     and p.id <> new.reporter_id;
  return null;
exception when others then
  return null;
end $$;

drop trigger if exists community_reports_notify_moderators on public.community_reports;
create trigger community_reports_notify_moderators
  after insert on public.community_reports
  for each row execute function public.community_reports_notify_moderators();

revoke execute on function public.community_reports_notify_moderators() from public, anon, authenticated;
