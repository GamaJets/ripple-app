-- COMMUNITY: A GYM'S OWN BOARD, AND THE TOOLS APPLE ASKS FOR
--
-- Members and coaches post short text to their gym. Two channels:
--   · 'members' — read and written by the gym's members, coaches and owner;
--   · 'coaches' — read and written by the gym's coaches and owner only.
-- "The gym" is profiles.tenant_id, the column every tenant-scoped policy tests
-- (part 28). Nobody outside the tenant reads a row, so one gym's community is
-- invisible to every other gym.
--
-- App Review guideline 1.2 (user-generated content) asks for four things and
-- each has a home here:
--   · a way to filter objectionable content: moderators (the gym's owner and
--     its coaches) hide posts and comments; members hide a post from their own
--     view (community_hides); the app screens words before sending
--     (src/lib/community.ts, a first line and not the only one);
--   · a way to report: community_reports, resolved by a moderator;
--   · a way to block: community_blocks. A viewer never reads a post or comment
--     by somebody they blocked, because the SELECT policy says so;
--   · accepted terms before posting: community_rules_acceptance. INSERT on a
--     post or comment is refused without a row at the current version, so the
--     rules gate is not only a sheet in the app.
--
-- What the caller must not choose (author, tenant, the author's name and role,
-- who hid or resolved a thing and when) is stamped by triggers.

-- ── who may read, who moderates ─────────────────────────────────────────────

create or replace function public.community_can_read(t uuid, ch text)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.tenant_id = t
       and (ch = 'members' or p.role in ('owner', 'trainer'))
  );
$$;

create or replace function public.community_moderates(t uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.tenant_id = t and p.role in ('owner', 'trainer')
  );
$$;

revoke execute on function public.community_can_read(uuid, text) from public, anon;
revoke execute on function public.community_moderates(uuid) from public, anon;
grant  execute on function public.community_can_read(uuid, text) to authenticated;
grant  execute on function public.community_moderates(uuid) to authenticated;

-- ── the rules, accepted once per version ────────────────────────────────────
-- COMMUNITY_RULES_VERSION in src/lib/community.ts. Raise both together, and the
-- `version >= 1` in the two insert policies below, to ask everyone again.

create table if not exists public.community_rules_acceptance (
  user_id     uuid        primary key default auth.uid() references public.profiles(id) on delete cascade,
  version     int         not null check (version >= 1),
  accepted_at timestamptz not null default now()
);

alter table public.community_rules_acceptance enable row level security;

drop policy if exists community_rules_own on public.community_rules_acceptance;
create policy community_rules_own on public.community_rules_acceptance
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.community_rules_acceptance from anon, authenticated, public;
grant select, insert, update on public.community_rules_acceptance to authenticated;
grant all on public.community_rules_acceptance to service_role;

-- ── blocks and personal hides: the caller's own rows ────────────────────────

create table if not exists public.community_blocks (
  blocker_id uuid        not null default auth.uid() references public.profiles(id) on delete cascade,
  blocked_id uuid        not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

alter table public.community_blocks enable row level security;

drop policy if exists community_blocks_own on public.community_blocks;
create policy community_blocks_own on public.community_blocks
  for all to authenticated
  using (blocker_id = (select auth.uid()))
  with check (blocker_id = (select auth.uid()));

revoke all on public.community_blocks from anon, authenticated, public;
grant select, insert, delete on public.community_blocks to authenticated;
grant all on public.community_blocks to service_role;

-- ── posts ───────────────────────────────────────────────────────────────────

create table if not exists public.community_posts (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null references public.tenants(id) on delete cascade,
  author_id   uuid        not null default auth.uid() references public.profiles(id) on delete cascade,
  -- First name and role at the time of posting, stamped by the trigger. A
  -- member cannot read another member's profile, and should not have to.
  author_name text        not null default '' check (length(author_name) <= 60),
  author_role text        not null default 'client' check (author_role in ('owner', 'trainer', 'client')),
  channel     text        not null check (channel in ('members', 'coaches')),
  body        text        not null check (char_length(btrim(body)) between 1 and 2000),
  created_at  timestamptz not null default now(),
  hidden_at   timestamptz,
  hidden_by   uuid        references public.profiles(id) on delete set null
);

comment on table public.community_posts is
  'A gym''s community board. Private to the tenant; the coaches channel is staff only. Moderators (owner, coaches) hide; authors delete. See part 3300 and src/lib/community.ts.';

create index if not exists community_posts_feed_idx on public.community_posts (tenant_id, channel, created_at desc, id desc);
create index if not exists community_posts_author_idx on public.community_posts (author_id);

create table if not exists public.community_hides (
  user_id    uuid        not null default auth.uid() references public.profiles(id) on delete cascade,
  post_id    uuid        not null references public.community_posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create or replace function public.community_posts_stamp()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare me public.profiles%rowtype;
begin
  if tg_op = 'INSERT' then
    select * into me from public.profiles where id = auth.uid();
    new.author_id := auth.uid();
    new.tenant_id := me.tenant_id;
    new.author_role := coalesce(me.role, 'client');
    new.author_name := left(coalesce(nullif(btrim(split_part(btrim(me.full_name), ' ', 1)), ''),
                         case when me.role = 'client' then 'Member' else 'Coach' end), 60);
    new.body := btrim(new.body);
    new.created_at := now();
    new.hidden_at := null;
    new.hidden_by := null;
  else
    -- Only hidden_at moves, and only a moderator's UPDATE policy reaches here.
    new.id := old.id; new.tenant_id := old.tenant_id; new.author_id := old.author_id;
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

drop trigger if exists community_posts_stamp on public.community_posts;
create trigger community_posts_stamp
  before insert or update on public.community_posts
  for each row execute function public.community_posts_stamp();

revoke execute on function public.community_posts_stamp() from public, anon, authenticated;

alter table public.community_posts enable row level security;
alter table public.community_hides enable row level security;

drop policy if exists community_hides_own on public.community_hides;
create policy community_hides_own on public.community_hides
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid())
              and exists (select 1 from public.community_posts p where p.id = post_id));

revoke all on public.community_hides from anon, authenticated, public;
grant select, insert, delete on public.community_hides to authenticated;
grant all on public.community_hides to service_role;

-- Read: the channel is yours, it is not hidden (unless you moderate), you did
-- not block the author, and you did not hide it from yourself.
drop policy if exists community_posts_read on public.community_posts;
create policy community_posts_read on public.community_posts
  for select to authenticated
  using (
    public.community_can_read(tenant_id, channel)
    and (hidden_at is null or public.community_moderates(tenant_id))
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
    and public.community_can_read(tenant_id, channel)
    and exists (select 1 from public.community_rules_acceptance a
                 where a.user_id = (select auth.uid()) and a.version >= 1)
  );

drop policy if exists community_posts_moderate on public.community_posts;
create policy community_posts_moderate on public.community_posts
  for update to authenticated
  using (public.community_moderates(tenant_id))
  with check (public.community_moderates(tenant_id));

drop policy if exists community_posts_delete_own on public.community_posts;
create policy community_posts_delete_own on public.community_posts
  for delete to authenticated
  using (author_id = (select auth.uid()));

revoke all on public.community_posts from anon, authenticated, public;
grant select, insert, update, delete on public.community_posts to authenticated;
grant all on public.community_posts to service_role;

-- ── likes ───────────────────────────────────────────────────────────────────
-- Readable and writable only on a post the caller can read: the EXISTS below
-- runs under community_posts' own SELECT policy.

create table if not exists public.community_likes (
  post_id    uuid        not null references public.community_posts(id) on delete cascade,
  user_id    uuid        not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists community_likes_user_idx on public.community_likes (user_id);

alter table public.community_likes enable row level security;

drop policy if exists community_likes_read on public.community_likes;
create policy community_likes_read on public.community_likes
  for select to authenticated
  using (exists (select 1 from public.community_posts p where p.id = post_id));

drop policy if exists community_likes_insert on public.community_likes;
create policy community_likes_insert on public.community_likes
  for insert to authenticated
  with check (user_id = (select auth.uid())
              and exists (select 1 from public.community_posts p where p.id = post_id));

drop policy if exists community_likes_delete on public.community_likes;
create policy community_likes_delete on public.community_likes
  for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.community_likes from anon, authenticated, public;
grant select, insert, delete on public.community_likes to authenticated;
grant all on public.community_likes to service_role;

-- ── comments ────────────────────────────────────────────────────────────────

create table if not exists public.community_comments (
  id          uuid        primary key default gen_random_uuid(),
  post_id     uuid        not null references public.community_posts(id) on delete cascade,
  -- The post's gym, stamped by the trigger, so moderation needs no join.
  tenant_id   uuid        not null references public.tenants(id) on delete cascade,
  author_id   uuid        not null default auth.uid() references public.profiles(id) on delete cascade,
  author_name text        not null default '' check (length(author_name) <= 60),
  author_role text        not null default 'client' check (author_role in ('owner', 'trainer', 'client')),
  body        text        not null check (char_length(btrim(body)) between 1 and 1000),
  created_at  timestamptz not null default now(),
  hidden_at   timestamptz,
  hidden_by   uuid        references public.profiles(id) on delete set null
);

create index if not exists community_comments_post_idx on public.community_comments (post_id, created_at, id);
create index if not exists community_comments_author_idx on public.community_comments (author_id);
create index if not exists community_comments_tenant_idx on public.community_comments (tenant_id);

create or replace function public.community_comments_stamp()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare me public.profiles%rowtype;
begin
  if tg_op = 'INSERT' then
    select * into me from public.profiles where id = auth.uid();
    new.author_id := auth.uid();
    select p.tenant_id into new.tenant_id from public.community_posts p where p.id = new.post_id;
    new.author_role := coalesce(me.role, 'client');
    new.author_name := left(coalesce(nullif(btrim(split_part(btrim(me.full_name), ' ', 1)), ''),
                         case when me.role = 'client' then 'Member' else 'Coach' end), 60);
    new.body := btrim(new.body);
    new.created_at := now();
    new.hidden_at := null;
    new.hidden_by := null;
  else
    new.id := old.id; new.post_id := old.post_id; new.tenant_id := old.tenant_id;
    new.author_id := old.author_id; new.author_name := old.author_name;
    new.author_role := old.author_role; new.body := old.body; new.created_at := old.created_at;
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

drop trigger if exists community_comments_stamp on public.community_comments;
create trigger community_comments_stamp
  before insert or update on public.community_comments
  for each row execute function public.community_comments_stamp();

revoke execute on function public.community_comments_stamp() from public, anon, authenticated;

alter table public.community_comments enable row level security;

drop policy if exists community_comments_read on public.community_comments;
create policy community_comments_read on public.community_comments
  for select to authenticated
  using (
    exists (select 1 from public.community_posts p where p.id = post_id)
    and (hidden_at is null or public.community_moderates(tenant_id))
    and not exists (select 1 from public.community_blocks b
                     where b.blocker_id = (select auth.uid()) and b.blocked_id = author_id)
  );

drop policy if exists community_comments_insert on public.community_comments;
create policy community_comments_insert on public.community_comments
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and exists (select 1 from public.community_posts p where p.id = post_id and p.hidden_at is null)
    and exists (select 1 from public.community_rules_acceptance a
                 where a.user_id = (select auth.uid()) and a.version >= 1)
  );

drop policy if exists community_comments_moderate on public.community_comments;
create policy community_comments_moderate on public.community_comments
  for update to authenticated
  using (public.community_moderates(tenant_id))
  with check (public.community_moderates(tenant_id));

drop policy if exists community_comments_delete_own on public.community_comments;
create policy community_comments_delete_own on public.community_comments
  for delete to authenticated
  using (author_id = (select auth.uid()));

revoke all on public.community_comments from anon, authenticated, public;
grant select, insert, update, delete on public.community_comments to authenticated;
grant all on public.community_comments to service_role;

-- ── reports ─────────────────────────────────────────────────────────────────
-- Filed on a post OR a comment the reporter can read. Moderators of the gym
-- read and resolve them; the reporter reads their own.

create table if not exists public.community_reports (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null references public.tenants(id) on delete cascade,
  post_id     uuid        references public.community_posts(id) on delete cascade,
  comment_id  uuid        references public.community_comments(id) on delete cascade,
  reporter_id uuid        not null default auth.uid() references public.profiles(id) on delete cascade,
  reason      text        not null check (reason in ('spam', 'harassment', 'hate', 'sexual', 'violence', 'other')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid        references public.profiles(id) on delete set null,
  outcome     text        check (outcome in ('hidden', 'dismissed')),
  check ((post_id is null) <> (comment_id is null)),
  check ((resolved_at is null) = (outcome is null))
);

create index if not exists community_reports_open_idx on public.community_reports (tenant_id, created_at desc) where resolved_at is null;
create index if not exists community_reports_post_idx on public.community_reports (post_id);
create index if not exists community_reports_comment_idx on public.community_reports (comment_id);
create index if not exists community_reports_reporter_idx on public.community_reports (reporter_id);

create or replace function public.community_reports_stamp()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.reporter_id := auth.uid();
    if new.post_id is not null then
      select p.tenant_id into new.tenant_id from public.community_posts p where p.id = new.post_id;
    else
      select c.tenant_id into new.tenant_id from public.community_comments c where c.id = new.comment_id;
    end if;
    new.created_at := now();
    new.resolved_at := null; new.resolved_by := null; new.outcome := null;
  else
    new.id := old.id; new.tenant_id := old.tenant_id; new.post_id := old.post_id;
    new.comment_id := old.comment_id; new.reporter_id := old.reporter_id;
    new.reason := old.reason; new.created_at := old.created_at;
    if new.outcome is null then
      new.resolved_at := null; new.resolved_by := null;
    else
      new.resolved_at := now(); new.resolved_by := auth.uid();
    end if;
  end if;
  return new;
end $$;

drop trigger if exists community_reports_stamp on public.community_reports;
create trigger community_reports_stamp
  before insert or update on public.community_reports
  for each row execute function public.community_reports_stamp();

revoke execute on function public.community_reports_stamp() from public, anon, authenticated;

alter table public.community_reports enable row level security;

drop policy if exists community_reports_read on public.community_reports;
create policy community_reports_read on public.community_reports
  for select to authenticated
  using (reporter_id = (select auth.uid()) or public.community_moderates(tenant_id));

drop policy if exists community_reports_insert on public.community_reports;
create policy community_reports_insert on public.community_reports
  for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and (
      (post_id is not null and exists (select 1 from public.community_posts p where p.id = post_id))
      or (comment_id is not null and exists (select 1 from public.community_comments c where c.id = comment_id))
    )
  );

drop policy if exists community_reports_resolve on public.community_reports;
create policy community_reports_resolve on public.community_reports
  for update to authenticated
  using (public.community_moderates(tenant_id))
  with check (public.community_moderates(tenant_id));

revoke all on public.community_reports from anon, authenticated, public;
grant select, insert, update on public.community_reports to authenticated;
grant all on public.community_reports to service_role;
