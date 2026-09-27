-- ═══════════════════════════════════════════════════════════════════════════
-- A member filmed one set, asked a question, and had no way of being answered.
--
-- ── What part 2617 built, and the half it left ───────────────────────────
--
-- `form_clips` is the member's side of a form check and it is complete: they
-- film one set, attach it to the logged set, and write the question that is
-- most of the value — "does my knee cave on rep 4". The coach watches it on
-- app/(trainer)/client-training.tsx.
--
-- Then nothing. The table has no reply column, the coach's grant is
-- `for select` only, and there is no trigger on the insert — so a coach is not
-- told a clip arrived, and when they do find it the only way to answer the
-- question attached to it is to leave the screen, open the chat thread and
-- describe which set they mean. The question and the answer live in two
-- different places and neither one points at the other.
--
-- For a coach whose clients are online this is the whole review loop, and it
-- was open at both ends.
--
-- ── What this adds ───────────────────────────────────────────────────────
--
-- One column for the answer, one for when it was written, an update policy
-- narrow enough that a coach can write those two and nothing else, and the two
-- notifications that make it a conversation: the coach is told a clip arrived,
-- and the member is told their coach answered.
--
-- ── Why the column grant is written the way it is ────────────────────────
--
-- `grant update (coach_reply, coach_replied_at)` and NOT a table-level update.
-- In PostgreSQL a table-wide UPDATE grant supersedes a column-level one, so a
-- bare `grant update on form_clips to authenticated` would let a coach rewrite
-- the member's own `note` — the question they asked — and even the `path`, the
-- object the video lives at. Part 131 learned this on `public.trainers` and
-- part 2200 records it. A column grant is the only thing that actually holds
-- the line here, and the policy beside it decides WHOSE row, not which column.
--
-- The member keeps `for all` from part 2617, so they can still delete the clip
-- and the reply goes with it. That is the right way round: it is their video
-- and their body, and taking it back has to take everything about it back.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.form_clips
  add column if not exists coach_reply text,
  add column if not exists coach_replied_at timestamptz;

comment on column public.form_clips.coach_reply is
  'What the coach wrote back about this set. Written only by the coach who currently coaches the member, through a column-level UPDATE grant — a table-wide grant would also let them rewrite the member''s own question and the storage path.';

-- The coach writes the answer, and only the answer.
drop policy if exists form_clips_coach_reply on public.form_clips;
create policy form_clips_coach_reply on public.form_clips for update
  using (is_my_client(user_id))
  with check (is_my_client(user_id));

-- Columns, not the table — for UPDATE. See the header.
--
-- SELECT, INSERT and DELETE stay TABLE-WIDE, and that is deliberate rather
-- than an oversight the next reader should tidy up. check:grants exists
-- because a column-level grant does not extend to a column added later, and
-- naming a column grant here for reading would mean every future column of
-- this table has to be remembered in two places or PostgREST answers 403 for
-- everybody. The narrow grant belongs on the one verb where the narrowness is
-- the point: a coach may WRITE two columns and no others.
grant select, insert, delete on public.form_clips to authenticated;

-- The revoke is the part that actually does anything, and leaving it out is the
-- mistake this comment exists to prevent. `authenticated` already held UPDATE
-- on this table from the blanket grant in part 02, and in PostgreSQL a
-- table-wide grant SUPERSEDES a column-level one — so adding the column grant
-- below on its own changed nothing at all. Checked on the live database
-- immediately after the first apply: `information_schema.column_privileges`
-- still reported UPDATE on all nine columns, which is a coach who could
-- rewrite the member's question and the path their video lives at. The same
-- fact part 131 records for `public.trainers`, from the other direction.
revoke update on public.form_clips from authenticated;
-- The member's own question stays theirs to change. Their `for all` policy
-- from part 2617 is what keeps it to their own row.
grant update (note) on public.form_clips to authenticated;
grant update (coach_reply, coach_replied_at) on public.form_clips to authenticated;

-- The other six columns are readable and deliberately unwritable by anybody,
-- and they need no `grant-ok:` marker because the table-wide SELECT above
-- already names them: that marker is for a column NO grant reaches, and
-- check:grants rejects one that excuses nothing. Why they are unwritable:
-- `id`, `user_id`, `workout_id` and `set_index` say which set of whose workout
-- this clip belongs to, and rewriting one would move a video onto another
-- person's record; `path` is the object in the bucket, and a row pointed at a
-- different object is how one member's video gets served under another
-- member's grant. Nothing in the app updates any of them — a member who wants
-- a different clip deletes this one and sends another.

-- ── the clip arriving ────────────────────────────────────────────────────
--
-- Same rule as parts 614 and 3340 about what a push may say: a lock screen is
-- read by whoever is standing near the coach's phone. That a clip exists, and
-- who from. NOT the question the member asked — it is theirs, it often names a
-- body part, and it is two taps away on a screen that is already private.
create or replace function public.form_clip_notify_coach()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_coach uuid;
  v_name  text;
begin
  select c.trainer_id into v_coach
    from public.clients c
   where c.id = new.user_id
     and c.trainer_id is not null;

  -- No coach, no message. `clipRefusal` in src/lib/formCheck.ts already refuses
  -- to let a member film one with nobody to send it to, so this is the case
  -- where a coaching link ended between the filming and the upload.
  if v_coach is null then
    return null;
  end if;

  select nullif(btrim(coalesce(p.full_name, '')), '')
    into v_name
    from public.profiles p
   where p.id = new.user_id;

  insert into public.notifications (user_id, title, body, icon, route)
  values (
    v_coach,
    'A client has sent a form check',
    left(
      coalesce(v_name, 'A client')
      || ' filmed a set and asked you about it.'
      || ' The clip and their question are on their Training page.',
      500),
    'dumbbell',
    '/(trainer)/client-training?clientId=' || new.user_id::text
  );

  return null;
end $fn$;

comment on function public.form_clip_notify_coach() is
  'Tells the COACH that a named client attached a form-check clip to a set. Carries no video, no storage path, no clip id and not the question the member wrote — a push renders on a lock screen. One per clip, because part 2617 already allows one clip per set.';

drop trigger if exists form_clips_notify_coach on public.form_clips;
create trigger form_clips_notify_coach
  after insert on public.form_clips
  for each row execute function public.form_clip_notify_coach();

-- ── the answer coming back ───────────────────────────────────────────────
--
-- Fires only when the reply actually CHANGES to something non-empty. An update
-- that touches `coach_replied_at` alone, or that rewrites the same sentence, is
-- not a new answer and the member has already been told about the old one.
create or replace function public.form_clip_notify_member()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_coach text;
begin
  if nullif(btrim(coalesce(new.coach_reply, '')), '') is null
     or btrim(coalesce(new.coach_reply, '')) is not distinct from btrim(coalesce(old.coach_reply, '')) then
    return null;
  end if;

  -- Who answered. The member can already read their own coach's name
  -- (`my_coach`), so naming them here tells them nothing new — and a reply
  -- from nobody in particular is the shape that makes somebody open an app to
  -- find out who is talking to them.
  select nullif(btrim(coalesce(p.full_name, '')), '')
    into v_coach
    from public.clients c
    join public.profiles p on p.id = c.trainer_id
   where c.id = new.user_id;

  insert into public.notifications (user_id, title, body, icon, route)
  values (
    new.user_id,
    'Your coach answered your form check',
    left(
      coalesce(v_coach, 'Your coach')
      || ' has written back about the set you filmed.'
      -- Not the answer itself: it is about how their body moves under a bar,
      -- and it is one tap away in the app that is already theirs.
      || ' It is on the movement you sent it from.',
      500),
    'dumbbell',
    '/(client)/workouts'
  );

  return null;
end $fn$;

comment on function public.form_clip_notify_member() is
  'Tells the MEMBER their coach answered the set they filmed. Fires only when coach_reply changes to something non-empty, so re-saving the same sentence or stamping the time does not send a second message. Carries the coach''s name and not the answer.';

drop trigger if exists form_clips_notify_member on public.form_clips;
create trigger form_clips_notify_member
  after update of coach_reply on public.form_clips
  for each row execute function public.form_clip_notify_member();

-- Revoked from public, anon AND authenticated. Postgres checks EXECUTE when a
-- trigger is CREATED and not when it fires (parts 51, 141, 158, 202, 614), so a
-- trigger function needs no grant to anybody; Postgres grants EXECUTE to PUBLIC
-- on every new function and `anon` resolves through that grant, so both are
-- named.
revoke all on function public.form_clip_notify_coach() from public;
revoke all on function public.form_clip_notify_coach() from anon;
revoke all on function public.form_clip_notify_coach() from authenticated;
revoke all on function public.form_clip_notify_member() from public;
revoke all on function public.form_clip_notify_member() from anon;
revoke all on function public.form_clip_notify_member() from authenticated;
