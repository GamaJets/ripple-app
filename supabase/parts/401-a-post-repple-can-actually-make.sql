-- ─────────────────────────────────────────────────────────────────────────
-- An Instagram account a coach has actually connected, and a record of what
-- was actually posted.
--
-- ── The rule this part keeps, which is part 16's and part 360's ──────────
--
-- A Meta access token is a standing credential. Anybody holding one can post to
-- a business's Instagram feed under its own name until it is revoked. Part 16
-- settled how this repo stores those and parts 100 and 360 followed it exactly:
-- the service role writes, there is NO select policy and NO grant for
-- `authenticated`, and the screen asks a SECURITY DEFINER function for FLAGS.
--
-- Part 77 records what happens when a display bug tempts somebody to relax
-- that: the app needed to know whether WHOOP was connected, and the honest fix
-- was a function returning names rather than a policy handing every signed-in
-- user their own OAuth tokens in order to answer a question about a label.
-- `my_instagram_account()` below is that shape again.
--
-- ── Why the posts table exists ──────────────────────────────────────────
--
-- Because a container that was created and a post that was published are two
-- events, and only the second is a post.
--
-- This product has been here before. `publishToSocials` in src/lib/social.ts
-- named four networks, showed a green dot beside each and uploaded nothing to
-- any of them, ever, while the screen above it announced "Posted to YouTube,
-- Instagram, Facebook." The Instagram-shaped version of that failure is
-- announcing success on the CONTAINER call, which is the one that returns
-- quickly and succeeds most often and which publishes nothing at all.
--
-- So `status` distinguishes them, `media_id` is null until Meta returned one,
-- and a row exists for a failed attempt as well as a successful one. A coach
-- looking at this can tell "Instagram refused us" from "we never asked".
--
-- ── What is NOT here ────────────────────────────────────────────────────
--
-- Any write for `authenticated`, on either table. A coach cannot insert a post
-- record, so nothing on this screen can be made to say a post happened by
-- anything other than a post happening. And no storage policy of any kind: the
-- public bucket is part 400's and it has none by design.
--
-- Idempotent; safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════
-- 0 · Assertions
-- ═════════════════════════════════════════════════════════════════════════
do $$
begin
  if to_regclass('public.trainers') is null then
    raise exception 'public.trainers is missing — part 01 must be applied before part 401.';
  end if;
  if to_regclass('public.share_card_objects') is null then
    raise exception 'public.share_card_objects is missing — part 400 must be applied before part 401.';
  end if;
end $$;


-- ═════════════════════════════════════════════════════════════════════════
-- 1 · The connection
-- ═════════════════════════════════════════════════════════════════════════
--
-- One row per coach. Instagram's Content Publishing API only publishes to a
-- BUSINESS or CREATOR account that is linked to a Facebook Page, so both sides
-- of that pair are stored: the Page is what the token is issued against and the
-- Instagram account is what the post lands on.
--
-- `ig_user_id` is nullable and null is a real state, exactly as
-- `external_account_id` is in part 100: the coach has authorised us and has not
-- yet said WHICH of their Pages this is about, or the Page they picked has no
-- Instagram account linked to it. Publishing refuses in that state and the
-- screen asks, rather than choosing a Page on their behalf and posting a gym's
-- card to whichever account happened to sort first.
create table if not exists public.instagram_accounts (
  trainer_id       uuid        not null references public.trainers(id) on delete cascade,
  -- The Facebook Page the token is issued against.
  page_id          text,
  page_name        text,
  -- The Instagram Business/Creator account linked to that Page, and its handle
  -- for the screen. Null until a Page with one has been chosen.
  ig_user_id       text,
  ig_username      text,
  -- A long-lived Page access token. Never returned to a device, never logged.
  access_token     text        not null,
  -- Meta's long-lived user tokens last about 60 days; Page tokens derived from
  -- one do not expire on their own but DO die with it. Null where Meta did not
  -- say, and null is not "never expires" — the screen says "not known".
  expires_at       timestamptz,
  -- What Meta actually granted, which is not always what was asked for. Kept so
  -- that a publish failing with a permissions error can name the permission.
  scopes           text,
  connected_at     timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (trainer_id)
);

comment on table public.instagram_accounts is
  'OAuth tokens for a coach''s connected Instagram Business account. Service role only — no authenticated policy or grant exists, and none may be added. Flags reach the app through my_instagram_account().';

alter table public.instagram_accounts enable row level security;

-- RLS with no policy already refuses `authenticated`. The revoke means a future
-- part that adds a policy by accident still cannot read a token, because the
-- privilege is not there to be policed. Part 100's words, and its reasoning.
revoke all on public.instagram_accounts from authenticated, anon;

-- Deliberately absent, and dropped rather than merely not created.
drop policy if exists instagram_accounts_own on public.instagram_accounts;
drop policy if exists instagram_accounts_read on public.instagram_accounts;


-- ═════════════════════════════════════════════════════════════════════════
-- 2 · What was posted, and what only nearly was
-- ═════════════════════════════════════════════════════════════════════════
--
-- `status` is the whole point of the table:
--
--   'published'  Meta returned a media id. This is a post.
--   'container'  Meta accepted the image and did not publish it. NOT a post.
--   'failed'     Meta refused, or we never got that far. Nothing happened.
--
-- `object_key` is the public object this attempt created, carried so that a
-- human reading a failed row can find the ledger entry in part 400 and see
-- whether the bytes were cleaned up.
create table if not exists public.instagram_posts (
  id           uuid        primary key default gen_random_uuid(),
  trainer_id   uuid        not null references public.trainers(id) on delete cascade,
  status       text        not null check (status in ('published', 'container', 'failed')),
  -- Meta's container id, where one was created. Present on 'container' and
  -- usually on 'published'; absent on a 'failed' that never got a container.
  container_id text,
  -- Meta's media id. NULL unless status is 'published'. This is the difference
  -- between a post and an upload, and it is a column rather than a flag so that
  -- no reader has to take anybody's word for which one happened.
  media_id     text,
  permalink    text,
  -- Which card, roughly: 'week' or 'result'. Not the caption's contents and not
  -- the figures — a record that a post was made does not need to keep a copy of
  -- what was on it.
  card_kind    text,
  object_key   text,
  -- Meta's own words on a failure. A flattened "posting failed" cannot tell a
  -- coach whether to reconnect, wait, or ask Meta for App Review.
  failure      text,
  created_at   timestamptz not null default now(),
  published_at timestamptz
);

comment on table public.instagram_posts is
  'One row per publish attempt. status ''container'' means Instagram took the image and did not publish it, which is not a post.';
comment on column public.instagram_posts.media_id is
  'Meta''s media id. Null unless the post was actually published — a container id is not a post.';

create index if not exists idx_instagram_posts_trainer
  on public.instagram_posts (trainer_id, created_at desc);

alter table public.instagram_posts enable row level security;

-- The coach may READ their own attempts and write none of them. That asymmetry
-- is the load-bearing half: a post record is a claim that something reached the
-- public internet, and the only thing entitled to make that claim is the code
-- that watched it happen.
revoke all on public.instagram_posts from anon;
grant select on public.instagram_posts to authenticated;

drop policy if exists instagram_posts_own_read on public.instagram_posts;
create policy instagram_posts_own_read on public.instagram_posts for select to authenticated
  using (trainer_id = (select auth.uid()));

-- Deliberately absent: any coach-side write.
drop policy if exists instagram_posts_own_write on public.instagram_posts;


-- ═════════════════════════════════════════════════════════════════════════
-- 3 · What the screen may know
-- ═════════════════════════════════════════════════════════════════════════
--
-- Flags and names, never token material. The screen has to answer four
-- questions: is anything connected, which account will a post land on, will the
-- connection survive the week, and has a Page with an Instagram account
-- actually been chosen. None of those needs a token and all four were
-- unanswerable without a select policy, which is the trade part 77 refused.
--
-- SECURITY DEFINER with auth.uid(), never current_user: under PostgREST every
-- signed-in request runs as the same `authenticated` role, so current_user
-- names the role rather than the person and would hand one coach another
-- coach's connection.
create or replace function public.my_instagram_account()
returns table (
  page_name    text,
  ig_username  text,
  ready        boolean,
  expires_soon boolean,
  scopes       text,
  connected_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select a.page_name,
         a.ig_username,
         -- A connection that cannot be posted with is not a connection the
         -- screen may describe as ready. Null ig_user_id is the half-made
         -- state: authorised, no Page with an Instagram account chosen yet.
         (a.ig_user_id is not null) as ready,
         (a.expires_at is not null and a.expires_at < now() + interval '7 days') as expires_soon,
         a.scopes,
         a.connected_at
  from public.instagram_accounts a
  where a.trainer_id = (select auth.uid());
$$;

revoke all on function public.my_instagram_account() from public, anon;
grant execute on function public.my_instagram_account() to authenticated;

comment on function public.my_instagram_account is
  'Whether the signed-in coach has an Instagram account connected, and which one. Flags and names only — never token material.';


-- ═════════════════════════════════════════════════════════════════════════
-- 4 · Disconnecting
-- ═════════════════════════════════════════════════════════════════════════
--
-- A coach may always drop their own credential, even if the edge function is
-- unreachable. Part 360 makes the same argument for calendar_links and this is
-- the same shape: DELETE only, only your own row, and it takes the token with
-- it because the token IS the row.
--
-- The post history stays. What was published last month did not stop having
-- been published, and deleting the record of it would leave a coach unable to
-- tell whether a post they can see on their feed came from here.
create or replace function public.disconnect_instagram()
returns void
language sql
security definer
set search_path = public
volatile
as $$
  delete from public.instagram_accounts where trainer_id = (select auth.uid());
$$;

revoke all on function public.disconnect_instagram() from public, anon;
grant execute on function public.disconnect_instagram() to authenticated;

comment on function public.disconnect_instagram is
  'Removes the signed-in coach''s Instagram credential. The post history is kept.';
