-- ═══════════════════════════════════════════════════════════════════════════
-- Three defects in parts 3340-3380, found by reviewing them after they were
-- applied.
--
-- All three are the same mistake wearing different clothes: a part that
-- created something new, correctly, and did not look at what already existed
-- around it. Recorded in that shape because the next part to add a route, a
-- board or a policy will be tempted by each one again.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═════════════════════════════════════════════════════════════════════════
-- 1 · Neither new notification was ever pushed
-- ═════════════════════════════════════════════════════════════════════════
--
-- Parts 3340 and 3350 insert rows into `notifications` with routes
-- '/(trainer)/checkins' and '/(client)/workouts'. `notification_channel` —
-- last defined in part 3320 — has never heard of either, so both fell to its
-- `else null`, and `notifications_dispatch_push` (part 900) filters on
-- `n.channel is not null`. Part 900's own comment says it: an unclassified row
-- is never pushed.
--
-- So the rows landed in the in-app bell and nothing reached a phone, which is
-- the entire stated purpose of both parts. "A check-in reaches the coach" did
-- not.
--
-- ── Why this was not caught ──────────────────────────────────────────────
--
-- There are two copies of this mapping and only one of them was updated.
-- src/lib/notifyDispatch.ts carries `CHANNEL_BY_ROUTE` for the app's own
-- switches and got both routes; this function is the half the DATABASE reads
-- when deciding whether to send, and it did not. Every test over
-- `SERVER_WRITTEN` passed, because the tests read the TypeScript copy.
--
-- The duplication is deliberate and documented (an edge function under Deno
-- cannot import the app's modules), so the lesson is not "remove one". It is
-- that a new server-written notification is TWO edits, and this part is the
-- second half of two of them.
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
      -- Part 3390, closing parts 3340 and 3350. The check-in a client sent
      -- and the coach's answer to a form check: both are the coaching
      -- relationship, which is what 'clients' has always meant, and both
      -- already carry that switch in src/lib/notifyDispatch.ts.
      when '/(trainer)/checkins'        then 'clients'
      when '/(client)/workouts'         then 'clients'

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


-- ═════════════════════════════════════════════════════════════════════════
-- 2 · A member could post an EVENT to their gym's board
-- ═════════════════════════════════════════════════════════════════════════
--
-- Part 3330 added `and (kind = 'post' or public.community_moderates(tenant_id))`
-- to `community_posts_insert`, under a heading saying resources and events are
-- staff's. Part 3370 recreated that policy to widen it for a coach's board and
-- rebuilt it from part 3300's text — the version BEFORE 3330 — so the clause
-- was dropped without anybody deciding to drop it.
--
-- The hole: any member of a gym could insert `kind = 'event'` on the members
-- channel, and it would then draw in `UpcomingEvents` on every member's
-- Community screen as a gym event. ('resource' stayed shut, but only by
-- accident: it requires the coaches channel, which `community_can_read`
-- already denies a client.)
--
-- The lesson is the one `git log -p -- <file>` answers and reading the latest
-- part does not: a policy may have been rewritten since the part that created
-- it, and recreating it from the original is a silent revert.
drop policy if exists community_posts_insert on public.community_posts;
create policy community_posts_insert on public.community_posts
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and (
      (tenant_id is not null and public.community_can_read(tenant_id, channel))
      or (coach_id is not null and public.coach_board_can_read(coach_id))
    )
    -- Restored from part 3330, widened for a coach's own board: on a gym's
    -- board the staff decide what is an event, and on a coach's board the
    -- coach does.
    and (
      kind = 'post'
      or (tenant_id is not null and public.community_moderates(tenant_id))
      or (coach_id is not null and public.coach_board_moderates(coach_id))
    )
    and exists (select 1 from public.community_rules_acceptance a
                 where a.user_id = (select auth.uid()) and a.version >= 1)
  );


-- ═════════════════════════════════════════════════════════════════════════
-- 3 · On a coach's board, nobody could reply to a post or report one
-- ═════════════════════════════════════════════════════════════════════════
--
-- `community_comments.tenant_id` and `community_reports.tenant_id` are both
-- `not null`, and both stamp triggers copy the value off the post. Part 3370
-- made a coach-scoped post's `tenant_id` null, so every comment and every
-- report on one failed with 23502 and the app drew its generic "could not be
-- saved" sentence.
--
-- Blocks and hides were unaffected, because they key on the post id and the
-- author id alone — which is why the commit claimed, wrongly, that a coach's
-- board had "the same reports, blocks and hides a gym's has". Two of the four
-- worked. REPORTING is the one that matters most: it is the moderation path
-- Apple requires of any feed, and part 3370's own header invokes it.
--
-- Both columns become nullable and carry the post's scope instead. The
-- policies are untouched: they are keyed on the post through
-- `community_can_read`-style EXISTS clauses over `community_posts`, which the
-- post's own SELECT policy already narrows correctly for both kinds of board.
alter table public.community_comments alter column tenant_id drop not null;
alter table public.community_reports  alter column tenant_id drop not null;

comment on column public.community_comments.tenant_id is
  'The gym whose board the parent post is on, or NULL when the post is on a coach''s own board (part 3370). Stamped from the post and never trusted from the client.';
comment on column public.community_reports.tenant_id is
  'The gym whose board the reported post is on, or NULL when it is on a coach''s own board (part 3370). Stamped from the post.';


-- ═════════════════════════════════════════════════════════════════════════
-- 4 · A NULL tenant made the image-path CHECK pass anything
-- ═════════════════════════════════════════════════════════════════════════
--
-- `community_posts_image_own_folder` (part 3330) is
-- `check (image_path is null or image_path like tenant_id::text || '/' || author_id::text || '/%')`.
-- With `tenant_id` null the pattern is null, the comparison is null, and a
-- CHECK constraint passes on null — so a coach-scoped post could name any
-- object key at all. The read policy on the bucket grants a read to anybody
-- who can read a post naming that object, so a fabricated key would be a
-- grant over somebody else's folder. It is hard to exploit (the key carries a
-- random token and has to be known exactly) and it is still wrong.
--
-- Rewritten so the scope decides the folder: a gym's post is under its tenant,
-- a coach's board post is under the coach. Photos on a coach's board are NOT
-- enabled by this — `communitymedia_obj_insert` still requires the uploader's
-- own tenant as the first folder, and `uploadCommunityImage` refuses without
-- one. Closing that properly is a storage-policy change and a decision about
-- whose folder a coach's cohort photo belongs in; this constraint is written
-- so that it cannot be the thing standing in the way, and so that a null
-- tenant can never again mean "any path is fine".
alter table public.community_posts drop constraint if exists community_posts_image_own_folder;
alter table public.community_posts add constraint community_posts_image_own_folder
  check (
    image_path is null
    or (tenant_id is not null and image_path like tenant_id::text || '/' || author_id::text || '/%')
    or (coach_id is not null and image_path like coach_id::text || '/' || author_id::text || '/%')
  );
