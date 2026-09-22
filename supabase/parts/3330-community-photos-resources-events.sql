-- COMMUNITY: A PHOTO ON A POST, A COACH'S RESOURCE, AND THE GYM'S EVENTS
--
-- Builds on part 3300 (the board, its policies and its stamp trigger).
--
--   · A post may carry ONE photo. The file lives in the private
--     community-media bucket at <tenant uuid>/<author uuid>/<file>, and the
--     post names it in image_path. A post needs words or a photo, not both.
--   · kind 'resource': a coach shares an https link with the gym's other
--     coaches. Coaches channel only, and the url is required.
--   · kind 'event': a title (the body), a time and a place, on either channel.
--     Members see the members channel's upcoming ones on their Community
--     screen; the read asks for event_at in the future, so past ones drop off.
--   · Resources and events are written by moderators only (the gym's owner and
--     coaches). A member's post is always kind 'post'.
--
-- Who may reach a photo is decided by the POST, not by the folder: the storage
-- read policy asks whether the caller can read a post naming that file, and
-- that EXISTS runs under community_posts_read, so the channel, blocks,
-- personal hides and moderator hides from part 3300 all apply to the photo as
-- they do to the words. The one addition is that an author reads their own
-- folder, which the upload itself needs.

-- ── columns ─────────────────────────────────────────────────────────────────

alter table public.community_posts
  add column if not exists image_path  text,
  add column if not exists kind        text not null default 'post',
  add column if not exists url         text,
  add column if not exists event_at    timestamptz,
  add column if not exists event_place text;

comment on column public.community_posts.image_path is
  'Key of the post''s photo in the private community-media bucket: <tenant_id>/<author_id>/<file>. See part 3330.';
comment on column public.community_posts.kind is
  '''post'', ''resource'' (an https url for the coaches channel) or ''event'' (event_at, event_place). See part 3330.';

-- The body check of part 3300 required words. A photo post may have none.
alter table public.community_posts drop constraint if exists community_posts_body_check;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.community_posts'::regclass and conname = 'community_posts_body_or_image') then
    alter table public.community_posts add constraint community_posts_body_or_image
      check (char_length(btrim(body)) <= 2000
             and (char_length(btrim(body)) >= 1 or (kind = 'post' and image_path is not null)));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.community_posts'::regclass and conname = 'community_posts_image_own_folder') then
    alter table public.community_posts add constraint community_posts_image_own_folder
      check (image_path is null
             or (image_path like tenant_id::text || '/' || author_id::text || '/%'
                 and length(image_path) <= 300
                 and position('..' in image_path) = 0));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.community_posts'::regclass and conname = 'community_posts_kind_shape') then
    alter table public.community_posts add constraint community_posts_kind_shape
      check (
        (kind = 'post' and url is null and event_at is null and event_place is null)
        or (kind = 'resource' and channel = 'coaches' and url is not null and event_at is null and event_place is null)
        or (kind = 'event' and event_at is not null and url is null)
      );
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.community_posts'::regclass and conname = 'community_posts_url_https') then
    alter table public.community_posts add constraint community_posts_url_https
      check (url is null or (url ~ '^https://[^[:space:]/]+\.[^[:space:]]+$' and length(url) <= 500));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.community_posts'::regclass and conname = 'community_posts_place_len') then
    alter table public.community_posts add constraint community_posts_place_len
      check (event_place is null or length(event_place) <= 120);
  end if;
end $$;

create index if not exists community_posts_kind_idx on public.community_posts (tenant_id, channel, kind, created_at desc);
create index if not exists community_posts_events_idx on public.community_posts (tenant_id, channel, event_at) where kind = 'event';
-- The storage read policy looks a post up by its photo on every signed URL.
create index if not exists community_posts_image_idx on public.community_posts (image_path) where image_path is not null;

-- ── the stamp trigger: the new columns are the author's, and fixed ──────────
-- Part 3300's function, with the five new columns pinned on UPDATE, so a
-- moderator's hide cannot also repoint a post's photo, link or time.

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
    new.url := nullif(btrim(new.url), '');
    new.event_place := nullif(btrim(new.event_place), '');
    new.created_at := now();
    new.hidden_at := null;
    new.hidden_by := null;
  else
    -- Only hidden_at moves, and only a moderator's UPDATE policy reaches here.
    new.id := old.id; new.tenant_id := old.tenant_id; new.author_id := old.author_id;
    new.author_name := old.author_name; new.author_role := old.author_role;
    new.channel := old.channel; new.body := old.body; new.created_at := old.created_at;
    new.image_path := old.image_path; new.kind := old.kind; new.url := old.url;
    new.event_at := old.event_at; new.event_place := old.event_place;
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

revoke execute on function public.community_posts_stamp() from public, anon, authenticated;

-- ── insert: resources and events are staff's ───────────────────────────────

drop policy if exists community_posts_insert on public.community_posts;
create policy community_posts_insert on public.community_posts
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and public.community_can_read(tenant_id, channel)
    and (kind = 'post' or public.community_moderates(tenant_id))
    and exists (select 1 from public.community_rules_acceptance a
                 where a.user_id = (select auth.uid()) and a.version >= 1)
  );

-- ── the bucket ──────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community-media', 'community-media', false, 5242880, array['image/png', 'image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects' and c.relrowsecurity
  ) then
    raise exception 'storage.objects does not have RLS enabled, so the community-media policies would be inert.';
  end if;
end $$;

-- Folders are compared as TEXT, never cast, so a garbage folder name matches
-- nothing instead of raising. No UPDATE policy: a photo is replaced by a new
-- object, never overwritten under a post that already names it.

drop policy if exists communitymedia_obj_insert on storage.objects;
create policy communitymedia_obj_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'community-media'
    and (storage.foldername(name))[1] = (select public.my_tenant())::text
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and array_length(storage.foldername(name), 1) = 2
  );

drop policy if exists communitymedia_obj_read on storage.objects;
create policy communitymedia_obj_read on storage.objects for select to authenticated
  using (
    bucket_id = 'community-media'
    and (
      exists (select 1 from public.community_posts p where p.image_path = objects.name)
      or ((storage.foldername(name))[1] = (select public.my_tenant())::text
          and (storage.foldername(name))[2] = (select auth.uid())::text)
    )
  );

drop policy if exists communitymedia_obj_delete on storage.objects;
create policy communitymedia_obj_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'community-media'
    and (
      ((storage.foldername(name))[1] = (select public.my_tenant())::text
       and (storage.foldername(name))[2] = (select auth.uid())::text)
      or exists (select 1 from public.tenants t
                  where t.id::text = (storage.foldername(name))[1] and public.community_moderates(t.id))
    )
  );

-- Grants: community_posts keeps part 3300's table-level grants, which cover
-- the new columns. No new functions are exposed.
