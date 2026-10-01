-- ═══════════════════════════════════════════════════════════════════════════
-- A coach's clients are a group. Until now only a GYM could have a board.
--
-- ── What part 3300 built, and who it leaves out ──────────────────────────
--
-- `community_posts.tenant_id` is `not null references tenants(id)`, the stamp
-- trigger fills it from the author's own profile, and every policy on the
-- table routes through `community_can_read(tenant_id, channel)`. That is the
-- right shape for a gym: the board is the building, and everybody in it is a
-- member of the same tenant.
--
-- An independent online coach is in no building. They have a roster, a dozen
-- people doing the same twelve-week block, and the only group-shaped thing in
-- this app is app/(trainer)/broadcast.tsx, which writes N separate private
-- messages. Nobody can reply to each other. The thing that keeps an online
-- cohort alive — somebody posting that they finally hit the lift, and four
-- people answering — had nowhere to happen.
--
-- ── The shape ────────────────────────────────────────────────────────────
--
-- One more column, and exactly one of the two is set. A post belongs to a GYM
-- or to a COACH and never to both, which is a check constraint rather than a
-- convention — the alternative is a row that two different boards both think
-- they own, and two sets of moderation rules disagreeing about who may hide
-- it.
--
-- The policies are not rewritten so much as widened: every one of them already
-- asked a function, so the functions are what change. `community_can_read` and
-- `community_moderates` keep the gym's answer exactly as it was, and two new
-- ones answer for a coach's board. A policy now asks whichever pair the row's
-- own scope names.
--
-- ── Who is in a coach's board ────────────────────────────────────────────
--
-- The coach, and the people they currently coach. Both halves are read through
-- the links that already exist — `clients.trainer_id` — so the board's
-- membership is the roster and cannot drift from it. A client whose coaching
-- ends stops being able to read it at the same moment they stop being a
-- client, which is the same rule `is_my_client` gives every other table.
--
-- There is no 'coaches' channel on a coach's board. That channel exists on a
-- gym's board so staff can talk where members cannot see; a coach's board has
-- exactly one coach on it, and a private channel for an audience of one is a
-- notes app. The check constraint says so rather than leaving it to the app.
--
-- ── Moderation is the coach's, and it has to be somebody's ───────────────
--
-- Apple requires a moderation path on any feed, and part 3300 answers that
-- with reports, blocks, hides and a moderator who can take a post down. On a
-- gym's board that is the owner and the coaches. On a coach's board it is the
-- coach: they are the only person who is not a member of the audience, and a
-- board whose moderator is one of twelve clients is not moderated.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.community_posts
  add column if not exists coach_id uuid references public.profiles(id) on delete cascade;

-- A gym's board or a coach's, never both and never neither. Written as one
-- constraint because "which board is this post on" is one question.
alter table public.community_posts alter column tenant_id drop not null;
alter table public.community_posts drop constraint if exists community_posts_scope_chk;
alter table public.community_posts add constraint community_posts_scope_chk
  check (
    (tenant_id is not null and coach_id is null)
    or (tenant_id is null and coach_id is not null and channel = 'members')
  );

comment on column public.community_posts.coach_id is
  'The coach whose own board this post is on, when it is not a gym''s. Exactly one of tenant_id and coach_id is set — see community_posts_scope_chk. A coach''s board has no coaches channel: a private channel for an audience of one is a notes app.';

create index if not exists community_posts_coach_feed_idx
  on public.community_posts (coach_id, created_at desc, id desc)
  where coach_id is not null;

-- ── who may read a coach's board ─────────────────────────────────────────
create or replace function public.coach_board_can_read(c uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select c is not null and (
    -- The coach themselves.
    c = auth.uid()
    -- Or somebody they currently coach. Read off `clients.trainer_id`, which
    -- is the same live link every other coach-to-client policy uses, so the
    -- board's membership IS the roster.
    or exists (
      select 1 from public.clients cl
       where cl.id = auth.uid() and cl.trainer_id = c
    )
  );
$$;

-- ── who may take a post down on one ──────────────────────────────────────
create or replace function public.coach_board_moderates(c uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select c is not null and c = auth.uid();
$$;

revoke execute on function public.coach_board_can_read(uuid) from public, anon;
revoke execute on function public.coach_board_moderates(uuid) from public, anon;
grant  execute on function public.coach_board_can_read(uuid) to authenticated;
grant  execute on function public.coach_board_moderates(uuid) to authenticated;

-- ── the policies, widened rather than rewritten ──────────────────────────
--
-- Each one keeps the gym's clause untouched and adds the coach's beside it.
-- The blocks and hides tests are unchanged and apply to both boards: somebody
-- who blocked another member does not start seeing them again because the
-- board has a different owner.

drop policy if exists community_posts_read on public.community_posts;
create policy community_posts_read on public.community_posts
  for select to authenticated
  using (
    (
      (tenant_id is not null and public.community_can_read(tenant_id, channel))
      or (coach_id is not null and public.coach_board_can_read(coach_id))
    )
    and (
      hidden_at is null
      or (tenant_id is not null and public.community_moderates(tenant_id))
      or (coach_id is not null and public.coach_board_moderates(coach_id))
    )
    and not exists (select 1 from public.community_blocks b
                     where b.blocker_id = (select auth.uid()) and b.blocked_id = author_id)
    and not exists (select 1 from public.community_hides h
                     where h.user_id = (select auth.uid()) and h.post_id = community_posts.id)
  );

drop policy if exists community_posts_insert on public.community_posts;
create policy community_posts_insert on public.community_posts
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and (
      (tenant_id is not null and public.community_can_read(tenant_id, channel))
      or (coach_id is not null and public.coach_board_can_read(coach_id))
    )
    -- The rules are accepted once, by version, and apply to every board a
    -- person can post on. Somebody who has agreed to how to behave has agreed
    -- to it in both rooms.
    and exists (select 1 from public.community_rules_acceptance a
                 where a.user_id = (select auth.uid()) and a.version >= 1)
  );

drop policy if exists community_posts_moderate on public.community_posts;
create policy community_posts_moderate on public.community_posts
  for update to authenticated
  using (
    (tenant_id is not null and public.community_moderates(tenant_id))
    or (coach_id is not null and public.coach_board_moderates(coach_id))
  )
  with check (
    (tenant_id is not null and public.community_moderates(tenant_id))
    or (coach_id is not null and public.coach_board_moderates(coach_id))
  );

-- ── the stamp trigger stops forcing a tenant ─────────────────────────────
--
-- It filled `tenant_id` from the author's own profile on every insert, which
-- would overwrite a coach-scoped post with the author's gym — or with null for
-- somebody who has no gym, failing the new constraint. It now fills the tenant
-- ONLY for a post that did not name a coach's board, and leaves everything
-- else exactly as it was: the author id, the stamped name and role, and the
-- refusal to let an update move any of them.
create or replace function public.community_posts_stamp()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare me public.profiles%rowtype;
begin
  if tg_op = 'INSERT' then
    select * into me from public.profiles where id = auth.uid();
    new.author_id := auth.uid();
    -- The one change on this branch. It used to be `new.tenant_id := me.tenant_id`
    -- unconditionally, which would stamp a coach-scoped post with the author's
    -- gym — or with null for somebody who has none, failing the new constraint.
    if new.coach_id is null then
      new.tenant_id := me.tenant_id;
    else
      new.tenant_id := null;
    end if;
    new.author_role := coalesce(me.role, 'client');
    new.author_name := left(coalesce(nullif(btrim(split_part(btrim(me.full_name), ' ', 1)), ''),
                         case when me.role = 'client' then 'Member' else 'Coach' end), 60);
    new.body := btrim(new.body);
    new.created_at := now();
    new.hidden_at := null;
    new.hidden_by := null;
  else
    -- Only hidden_at moves, and only a moderator's UPDATE policy reaches here.
    -- `coach_id` joins the frozen list for the same reason `tenant_id` is on
    -- it: an update that could move a post between boards is an update that
    -- could move it out from under the moderation that applies to it.
    new.id := old.id; new.tenant_id := old.tenant_id; new.coach_id := old.coach_id;
    new.author_id := old.author_id;
    new.author_name := old.author_name; new.author_role := old.author_role;
    new.channel := old.channel; new.body := old.body; new.created_at := old.created_at;
    if new.hidden_at is null then
      new.hidden_by := null;
    elsif old.hidden_at is null then
      new.hidden_at := now(); new.hidden_by := auth.uid();
    else
      new.hidden_at := old.hidden_at; new.hidden_by := old.hidden_by;
    end if;
  end if;
  return new;
end $$;

revoke all on function public.community_posts_stamp() from public;
revoke all on function public.community_posts_stamp() from anon;
revoke all on function public.community_posts_stamp() from authenticated;
