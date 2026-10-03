-- ═══════════════════════════════════════════════════════════════════════════
-- On a coach's own board, every step of moderation was dead.
--
-- Part 3370's commit said a coach's board has "the same reports, blocks and
-- hides a gym's has". Part 3390 found that untrue and fixed the half it saw:
-- `community_reports.tenant_id` was `not null`, so filing a report on a
-- coach-scoped post failed outright with 23502. It made the column nullable
-- and moved on.
--
-- That bought the ability to WRITE a report into a hole nobody could get it
-- out of. Four policies and one trigger still key on the tenant alone, and on
-- a coach's board the tenant is null:
--
--   community_reports_read       `community_moderates(tenant_id)` → the coach
--                               cannot see the report. Only its reporter can.
--   community_reports_resolve    the coach cannot dismiss or action it.
--   community_comments_moderate  the coach cannot hide a comment on their own
--                               board.
--   community_comments_read      `hidden_at is null or community_moderates(...)`
--                               → having hidden one, they cannot see it to
--                               change their mind.
--   community_reports_notify_moderators
--                               `where p.tenant_id = new.tenant_id`, and
--                               `null = null` is null, so the insert notified
--                               nobody at all.
--
-- So a client on a coach's cohort board could report a post, and the report
-- would be stored, announced to no one, visible to no one, and resolvable by
-- no one. This is the moderation path Apple requires of any feed with
-- user-generated content, which is the reason part 3370's header invokes it.
--
-- ── The lesson, which is part 3390's lesson a second time ────────────────
--
-- Part 3390 wrote: "a part that created something new, correctly, and did not
-- look at what already existed around it". Part 3390 then did the same thing.
-- It made a column nullable without asking which policies read that column,
-- and a nullable key silently fails every predicate built on it rather than
-- raising anything. `alter column ... drop not null` is not a local change; it
-- is a change to every expression that compares the column.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═════════════════════════════════════════════════════════════════════════
-- The board a post, comment or report belongs to
-- ═════════════════════════════════════════════════════════════════════════
--
-- Only `community_posts` carries `coach_id`; comments and reports reach it
-- through the post. Two small functions rather than repeated subqueries in
-- four policies, because the next policy to need this should not be a fifth
-- copy of the join.
--
-- SECURITY DEFINER and `stable`: these are read inside policies on the very
-- tables whose own policies would otherwise recurse. The same shape and the
-- same reason as `community_can_read` and `community_moderates`.
create or replace function public.community_post_coach(p_post uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.coach_id from public.community_posts p where p.id = p_post;
$$;

create or replace function public.community_report_coach(p_post uuid, p_comment uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_post is not null then public.community_post_coach(p_post)
    when p_comment is not null then (
      select public.community_post_coach(c.post_id)
        from public.community_comments c where c.id = p_comment
    )
    else null
  end;
$$;

-- The standing rule: a new function is granted to PUBLIC, and PUBLIC includes
-- anon. Revoke first, then grant the one role that may call it.
revoke execute on function public.community_post_coach(uuid) from public, anon;
revoke execute on function public.community_report_coach(uuid, uuid) from public, anon;
grant  execute on function public.community_post_coach(uuid) to authenticated;
grant  execute on function public.community_report_coach(uuid, uuid) to authenticated;


-- ═════════════════════════════════════════════════════════════════════════
-- 1 · A coach can read, and resolve, a report on their own board
-- ═════════════════════════════════════════════════════════════════════════
--
-- `coach_board_moderates` already returns false for a null argument — it opens
-- `c is not null and c = auth.uid()` — so a gym post, whose coach is null,
-- cannot reach the coach clause by accident. The gym clause is untouched.
drop policy if exists community_reports_read on public.community_reports;
create policy community_reports_read on public.community_reports
  for select to authenticated
  using (
    reporter_id = (select auth.uid())
    or public.community_moderates(tenant_id)
    or public.coach_board_moderates(public.community_report_coach(post_id, comment_id))
  );

drop policy if exists community_reports_resolve on public.community_reports;
create policy community_reports_resolve on public.community_reports
  for update to authenticated
  using (
    public.community_moderates(tenant_id)
    or public.coach_board_moderates(public.community_report_coach(post_id, comment_id))
  )
  with check (
    public.community_moderates(tenant_id)
    or public.coach_board_moderates(public.community_report_coach(post_id, comment_id))
  );


-- ═════════════════════════════════════════════════════════════════════════
-- 2 · A coach can hide a comment on their own board, and still see it
-- ═════════════════════════════════════════════════════════════════════════
--
-- The read clause matters as much as the write one. Hiding a comment a coach
-- could then no longer see is a decision they cannot revisit, and "I hid the
-- wrong one" is the ordinary case.
drop policy if exists community_comments_read on public.community_comments;
create policy community_comments_read on public.community_comments
  for select to authenticated
  using (
    exists (select 1 from public.community_posts p where p.id = community_comments.post_id)
    and (
      hidden_at is null
      or public.community_moderates(tenant_id)
      or public.coach_board_moderates(public.community_post_coach(post_id))
    )
    and not exists (
      select 1 from public.community_blocks b
       where b.blocker_id = (select auth.uid()) and b.blocked_id = community_comments.author_id
    )
  );

drop policy if exists community_comments_moderate on public.community_comments;
create policy community_comments_moderate on public.community_comments
  for update to authenticated
  using (
    public.community_moderates(tenant_id)
    or public.coach_board_moderates(public.community_post_coach(post_id))
  )
  with check (
    public.community_moderates(tenant_id)
    or public.coach_board_moderates(public.community_post_coach(post_id))
  );


-- ═════════════════════════════════════════════════════════════════════════
-- 3 · And somebody is told
-- ═════════════════════════════════════════════════════════════════════════
--
-- Two inserts rather than one statement with an OR, because the two boards
-- have different recipients and different routes: a gym's staff go to their
-- own variant's screen, and a coach goes to the coach app.
--
-- The route is '/(trainer)/community', which `notification_channel` already
-- maps to 'clients' (part 3320) — so this one reaches a phone. That is worth
-- stating, because part 3390 exists entirely because two notifications did
-- not, and the check is one query: a route this function writes must appear in
-- that function's CASE or `notifications_dispatch_push` drops the row.
create or replace function public.community_reports_notify_moderators()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_body  text;
  v_coach uuid;
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

  -- A gym's board: its staff, as before.
  if new.tenant_id is not null then
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
  end if;

  -- A coach's own board: the coach, who is the only moderator it has.
  v_coach := public.community_report_coach(new.post_id, new.comment_id);
  if v_coach is not null and v_coach <> new.reporter_id then
    insert into public.notifications (user_id, title, body, icon, route)
    values (v_coach, 'New Report In Your Group', v_body, 'bell', '/(trainer)/community');
  end if;

  return null;
exception when others then
  -- Unchanged, and deliberate: a report that is filed and not announced is bad,
  -- and a report that cannot be filed because announcing it failed is worse.
  return null;
end $function$;

revoke execute on function public.community_reports_notify_moderators() from public, anon, authenticated;
