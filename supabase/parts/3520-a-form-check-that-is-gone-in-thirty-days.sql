-- Form checks: thirty days, then gone — the row AND the video.
--
-- Additive. What this part adds, and what it fixes:
--
--   1. Retention. A form-check clip is a video of a member's body, their gym
--      and often other people in the background. It exists to get one answer
--      from one coach, so it is kept for FORM_CLIP_DAYS (30) and no longer.
--      `expire_form_clips()` deletes the rows; the delete trigger below queues
--      each object onto `public.object_purge` (part 1120), which the existing
--      `purge-account-files` job drains every five minutes. Hourly schedule:
--      `expire-form-clips` at 41 * * * *.
--
--   2. Every delete takes the video with it. The member's own delete removes
--      the object from the app AND the row; a workout deleted underneath a
--      clip, an erased account or the expiry above removes only the row. The
--      trigger queues the object in every case, and a 404 from storage for an
--      object the app already removed is recorded as "already absent".
--
--   3. A timestamp on the coach's answer. `coach_reply_at_ms` is the moment
--      in the clip the reply is about ("at 0:12, your knees cave"). Nullable;
--      a reply about the whole set has none. Written through the same
--      column-level grant as the reply itself (part 3350).
--
--   4. A bug: `form_clips_freeze_members_own()` (part 3400) read `new.set_id`,
--      a column form_clips has never had, so EVERY update by someone other
--      than the member — i.e. every coach reply — failed with "record new has
--      no field set_id". The set is `workout_id` + `set_index`.
--
--   5. The bucket refuses anything over 60 MB server-side, matching
--      MAX_CLIP_BYTES in src/lib/formCheck.ts.
--
-- No policy is widened: the owner, reception and other coaches still read
-- nothing (part 2617). No column is dropped, no row is touched except by the
-- expiry it describes.

-- ── 3. the timestamp ────────────────────────────────────────────────────
alter table public.form_clips
  add column if not exists coach_reply_at_ms integer;

alter table public.form_clips drop constraint if exists form_clips_reply_at_sane;
alter table public.form_clips add constraint form_clips_reply_at_sane
  check (coach_reply_at_ms is null or (coach_reply_at_ms >= 0 and coach_reply_at_ms <= 600000));

comment on column public.form_clips.coach_reply_at_ms is
  'Where in the clip the coach''s reply points, in milliseconds from the start. Null for a reply about the whole set.';

grant update (coach_reply_at_ms) on public.form_clips to authenticated;

-- ── 4. the freeze trigger, on columns that exist ────────────────────────
create or replace function public.form_clips_freeze_members_own()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is distinct from old.user_id then
    if new.note is distinct from old.note then
      raise exception 'The question on a form check belongs to the person who asked it.'
        using errcode = '42501';
    end if;
    if new.path is distinct from old.path then
      raise exception 'A form check''s video cannot be repointed.'
        using errcode = '42501';
    end if;
    if new.user_id is distinct from old.user_id
       or new.workout_id is distinct from old.workout_id
       or new.set_index is distinct from old.set_index then
      raise exception 'A form check cannot be moved to another person or another set.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;
revoke execute on function public.form_clips_freeze_members_own() from public, anon, authenticated;

-- ── 2. the purge queue learns this bucket ───────────────────────────────
alter table public.object_purge drop constraint if exists object_purge_bucket_is_ours;
alter table public.object_purge add constraint object_purge_bucket_is_ours
  check (bucket_id in (
    'injury-docs', 'message-media', 'avatars',
    'coach-logos', 'coach-docs', 'exercise-videos',
    'form-checks'       -- part 2617, via the table trigger (added here)
  ));

create or replace function public.purge_stored_object(p_bucket text, p_path text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_key text;
  v_req bigint;
  v_shape_ok boolean;
begin
  if p_bucket is null or p_path is null or not exists (
    select 1 from public.object_purge
     where bucket_id = p_bucket and path = p_path and purged_at is null
  ) then
    return;
  end if;

  v_shape_ok := case p_bucket
    when 'injury-docs'     then p_path ~ '^[0-9a-fA-F-]{36}/[A-Za-z0-9._-]{1,120}$'
    when 'avatars'         then p_path ~ '^[0-9a-fA-F-]{36}/[A-Za-z0-9._-]{1,120}$'
    when 'coach-logos'     then p_path ~ '^[0-9a-fA-F-]{36}/[A-Za-z0-9._-]{1,120}$'
    when 'coach-docs'      then p_path ~ '^[0-9a-fA-F-]{36}/[A-Za-z0-9._-]{1,120}$'
    when 'exercise-videos' then p_path ~ '^[0-9a-fA-F-]{36}/[A-Za-z0-9._-]{1,120}$'
    when 'form-checks'     then p_path ~ '^[0-9a-fA-F-]{36}/[A-Za-z0-9._-]{1,120}$'
    when 'message-media'   then p_path ~ '^[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}/[A-Za-z0-9._-]{1,120}$'
    else false
  end;

  if not v_shape_ok then
    update public.object_purge
       set note = 'path is not the expected shape for ' || p_bucket || '. NOT sent',
           attempts = attempts + 1,
           last_attempt_at = now()
     where bucket_id = p_bucket and path = p_path;
    return;
  end if;

  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'storage_service_key' limit 1;

  if v_key is null or v_key = '' then
    update public.object_purge
       set note = 'no storage_service_key in Vault. File NOT deleted',
           attempts = attempts + 1,
           last_attempt_at = now()
     where bucket_id = p_bucket and path = p_path;
    return;
  end if;

  select net.http_delete(
    url     := 'https://phgfwzpkkwdysftlgkoq.supabase.co/storage/v1/object/'
               || p_bucket || '/' || p_path,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'apikey',        v_key)
  ) into v_req;

  update public.object_purge
     set request_id = v_req,
         attempts = attempts + 1,
         last_attempt_at = now(),
         note = 'sent'
   where bucket_id = p_bucket and path = p_path;
end $$;

revoke execute on function public.purge_stored_object(text, text) from public, anon, authenticated;

create or replace function public.form_clip_queue_purge()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.path is not null and old.path <> '' then
    insert into public.object_purge (bucket_id, path, subject_id, note)
    values ('form-checks', old.path, old.user_id, 'form check deleted')
    on conflict (bucket_id, path) do nothing;
  end if;
  return null;
end
$$;
revoke execute on function public.form_clip_queue_purge() from public, anon, authenticated;

drop trigger if exists form_clips_queue_purge on public.form_clips;
create trigger form_clips_queue_purge
  after delete on public.form_clips
  for each row execute function public.form_clip_queue_purge();

-- ── 1. thirty days ──────────────────────────────────────────────────────
create or replace function public.expire_form_clips()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n int;
begin
  delete from public.form_clips where created_at < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end
$$;
revoke execute on function public.expire_form_clips() from public, anon, authenticated;

comment on function public.expire_form_clips() is
  'Deletes form-check rows older than 30 days. The after-delete trigger queues each video onto object_purge, which purge-account-files drains.';

create extension if not exists pg_cron;
do $$
begin
  if exists (select 1 from cron.job where jobname = 'expire-form-clips') then
    perform cron.unschedule('expire-form-clips');
  end if;
end $$;
select cron.schedule('expire-form-clips', '41 * * * *', $cron$ select public.expire_form_clips(); $cron$);

-- ── 5. the size cap, server-side ────────────────────────────────────────
update storage.buckets set file_size_limit = 62914560 where id = 'form-checks';
