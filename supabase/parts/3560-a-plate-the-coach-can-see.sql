-- A plate the coach can see.
--
-- The food log could already READ a photo (photo → AI estimate, behind the
-- member's consent) but kept nothing: the picture was analysed and dropped.
-- This keeps it, for exactly two people. A member photographs a meal, adds a
-- note or macros if they like, and their coach sees a feed per client and can
-- comment. Nothing else can read it: private bucket, ten-minute signed URLs
-- from the app, and policies on both the rows and the objects.
--
--   · meal-photos bucket: private, 8 MB, JPEG/PNG/WebP. Key is
--     '<client id>/<file>', and the first folder IS the owner — the same
--     shape as form-checks and message-media.
--   · meal_photos: the member writes their own; their coach (is_my_client)
--     reads. meal_photo_comments: either side of that pair reads and writes
--     as themselves.
--   · Notices: a new photo tells the coach at most once per client per three
--     hours (channel 'clients'); a coach comment tells the member (channel
--     'chat'); a member reply tells the coach. send-push applies switches and
--     quiet hours to all three.
--
-- Additive only: one bucket, two tables, their policies, two triggers.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('meal-photos', 'meal-photos', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create table if not exists public.meal_photos (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  path        text not null,
  taken_at    timestamptz not null default now(),
  meal        text,
  note        text,
  kcal        integer,
  protein     numeric,
  carbs       numeric,
  fat         numeric,
  created_at  timestamptz not null default now(),
  constraint meal_photos_path_chk check (path like client_id::text || '/%'),
  constraint meal_photos_meal_chk check (meal is null or meal in ('breakfast', 'lunch', 'dinner', 'snack')),
  constraint meal_photos_note_chk check (note is null or char_length(note) <= 500),
  constraint meal_photos_macros_chk check (
    (kcal is null or kcal between 0 and 10000) and (protein is null or protein between 0 and 1000)
    and (carbs is null or carbs between 0 and 1000) and (fat is null or fat between 0 and 1000))
);

create index if not exists meal_photos_client_idx on public.meal_photos (client_id, taken_at desc);

alter table public.meal_photos enable row level security;

drop policy if exists meal_photos_own on public.meal_photos;
create policy meal_photos_own on public.meal_photos
  for all to authenticated
  using (client_id = (select auth.uid()))
  with check (client_id = (select auth.uid()));

drop policy if exists meal_photos_coach_r on public.meal_photos;
create policy meal_photos_coach_r on public.meal_photos
  for select to authenticated
  using (public.is_my_client(client_id));

revoke all on table public.meal_photos from public, anon;
grant select, insert, update, delete on table public.meal_photos to authenticated;

create table if not exists public.meal_photo_comments (
  id          uuid primary key default gen_random_uuid(),
  photo_id    uuid not null references public.meal_photos(id) on delete cascade,
  author_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  author_role text not null check (author_role in ('client', 'coach')),
  body        text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at  timestamptz not null default now()
);

create index if not exists meal_photo_comments_photo_idx on public.meal_photo_comments (photo_id, created_at);
create index if not exists meal_photo_comments_author_idx on public.meal_photo_comments (author_id);

alter table public.meal_photo_comments enable row level security;

drop policy if exists meal_photo_comments_r on public.meal_photo_comments;
create policy meal_photo_comments_r on public.meal_photo_comments
  for select to authenticated
  using (exists (select 1 from public.meal_photos p where p.id = photo_id
                  and (p.client_id = (select auth.uid()) or public.is_my_client(p.client_id))));

drop policy if exists meal_photo_comments_i on public.meal_photo_comments;
create policy meal_photo_comments_i on public.meal_photo_comments
  for insert to authenticated
  with check (author_id = (select auth.uid()) and exists (
    select 1 from public.meal_photos p where p.id = photo_id
       and ((author_role = 'client' and p.client_id = (select auth.uid()))
         or (author_role = 'coach' and public.is_my_client(p.client_id)))));

drop policy if exists meal_photo_comments_d on public.meal_photo_comments;
create policy meal_photo_comments_d on public.meal_photo_comments
  for delete to authenticated
  using (author_id = (select auth.uid()));

revoke all on table public.meal_photo_comments from public, anon;
grant select, insert, delete on table public.meal_photo_comments to authenticated;

-- ── the objects ───────────────────────────────────────────────────────────
drop policy if exists meal_photos_obj_own_i on storage.objects;
create policy meal_photos_obj_own_i on storage.objects
  for insert to authenticated
  with check (bucket_id = 'meal-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists meal_photos_obj_own_d on storage.objects;
create policy meal_photos_obj_own_d on storage.objects
  for delete to authenticated
  using (bucket_id = 'meal-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists meal_photos_obj_r on storage.objects;
create policy meal_photos_obj_r on storage.objects
  for select to authenticated
  using (bucket_id = 'meal-photos' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (select 1 from public.meal_photos p
                where p.path = name and public.is_my_client(p.client_id))));

-- ── who is told ───────────────────────────────────────────────────────────
create or replace function public.meal_photo_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_coach uuid;
  v_name  text;
begin
  select c.trainer_id into v_coach from public.clients c where c.id = new.client_id;
  if v_coach is null or v_coach = new.client_id then
    return null;
  end if;
  if exists (select 1 from public.meal_photos p
              where p.client_id = new.client_id and p.id <> new.id
                and p.created_at > now() - interval '3 hours') then
    return null;
  end if;
  select nullif(btrim(coalesce(full_name, '')), '') into v_name from public.profiles where id = new.client_id;
  insert into public.notifications (user_id, title, body, icon, route, channel)
  values (v_coach, 'New meal photo',
          left(coalesce(v_name, 'A client') || ' shared a meal photo.', 500),
          'meals', '/(trainer)/client-food?clientId=' || new.client_id::text, 'clients');
  return null;
end $fn$;

revoke all on function public.meal_photo_notify() from public, anon, authenticated;

drop trigger if exists meal_photos_notify on public.meal_photos;
create trigger meal_photos_notify after insert on public.meal_photos
  for each row execute function public.meal_photo_notify();

create or replace function public.meal_photo_comment_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_client uuid;
  v_coach  uuid;
  v_name   text;
begin
  select p.client_id, c.trainer_id into v_client, v_coach
    from public.meal_photos p join public.clients c on c.id = p.client_id
   where p.id = new.photo_id;
  if new.author_role = 'coach' then
    insert into public.notifications (user_id, title, body, icon, route, channel)
    values (v_client, 'Your coach commented on your meal',
            left(new.body, 200), 'meals', '/(client)/meal-photos', 'chat');
  elsif v_coach is not null and v_coach <> v_client then
    select nullif(btrim(coalesce(full_name, '')), '') into v_name from public.profiles where id = v_client;
    insert into public.notifications (user_id, title, body, icon, route, channel)
    values (v_coach, 'Reply on a meal photo',
            left(coalesce(v_name, 'A client') || ': ' || new.body, 200),
            'meals', '/(trainer)/client-food?clientId=' || v_client::text, 'clients');
  end if;
  return null;
end $fn$;

revoke all on function public.meal_photo_comment_notify() from public, anon, authenticated;

drop trigger if exists meal_photo_comments_notify on public.meal_photo_comments;
create trigger meal_photo_comments_notify after insert on public.meal_photo_comments
  for each row execute function public.meal_photo_comment_notify();

comment on table public.meal_photos is
  'A member''s meal photos (part 3560): private bucket meal-photos, keyed <client id>/..., readable by the member and their coach only.';
