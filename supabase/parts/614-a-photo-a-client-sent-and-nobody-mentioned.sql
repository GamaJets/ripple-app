-- ═══════════════════════════════════════════════════════════════════════════
-- A client sent their coach a progress photo, and nothing said so.
--
-- ── What was silent, and how that was established ────────────────────────
--
-- app/(trainer)/client-photos.tsx says it in its own header: a coach can see
-- "exactly the photos this client sent to this coach … not 'my clients' photos'
-- — there is no such read, at either layer". That is the right design and it
-- has a consequence nobody had closed: with no cross-client read, a coach can
-- only discover a photo exists by opening a NAMED client and looking. So the
-- discovery mechanism for a photo is remembering to check, one person at a
-- time, on the off-chance.
--
-- Grep `SERVER_WRITTEN` in src/lib/notifyInbox.ts and there is no photo row.
-- Grep `progress_photo_shares` in supabase/parts and part 47 creates it, two
-- triggers DELETE from it when a coaching link ends, and nothing anywhere
-- notifies on the insert.
--
-- The cost is small and it compounds: sending a photo is the most exposed thing
-- a client does in this product, and the reply arriving three days late reads
-- as indifference to somebody who has just photographed themselves in
-- underwear in a bathroom to show their coach.
--
-- ══ WHAT THIS NOTIFICATION MAY CONTAIN, AND WHY IT IS SO LITTLE ══════════
--
-- A push is rendered on a LOCK SCREEN. It is read by whoever is standing near
-- the coach's phone: a partner, a colleague, the next client on the gym floor.
-- That is the audience this message is actually written for, and it decides
-- every word of it.
--
-- The rule is the one src/lib/injuryDocView.ts arrives at for a stored medical
-- report — the promise the database makes must not be broken by the convenience
-- at the other end. Part 45 closed coach access to progress photos at BOTH
-- layers because "a progress photo is typically taken in underwear, alone, in a
-- bathroom"; part 47 reopened it one photo at a time, to one named person, with
-- the grant revocable and re-checked against a live coaching link on every
-- read; and photoShare.ts mints coach URLs with a five-minute signature so that
-- taking a photo back actually takes it back. A notification carrying the image
-- itself, or a thumbnail, or a storage path, would hand a copy of that photo to
-- the notification service, to the lock screen and to the phone's own
-- notification history — none of which is reachable by a revocation, and all of
-- which outlive the five-minute window the whole feature is built on.
--
-- So, said as a list, because a future edit will be tempted by each of them:
--
--   NO IMAGE and NO THUMBNAIL. Nothing that renders as a picture.
--   NO STORAGE PATH and NO PHOTO ID. Not a URL, not an object name, not the
--     primary key — nothing another request could be built out of.
--   NOTHING ABOUT THE BODY. Not the weight or the body-fat percentage that
--     live on the same `progress_photos` row, not the pose, not a date the
--     photo was TAKEN, and not a comparison with anything. The screen refuses
--     to say anything about the body in the picture (client-photos.tsx, failure
--     3) and a notification is not the place that rule gets relaxed.
--   NO COUNT of how many they have ever sent. That is a shape of somebody's
--     habits and it is nobody's business on a lock screen.
--
-- What is left is the whole of the message: a photo exists, and who from. The
-- name is theirs to give in the same sense parts 202, 470 and 471 use — the
-- coach can already read it through `profiles_trainer_r_clients` — and without
-- it the notification opens a screen the coach then has to guess at.
--
-- ── Why the coach and not the client ─────────────────────────────────────
--
-- Part 160's test: the recipient must be able to act, AND have no other way to
-- learn. The coach passes both. The client fails the second half completely —
-- they are the one who pressed send.
--
-- ── One message for a handful of photos ──────────────────────────────────
--
-- Sending three photos is one act and writes three grant rows. Three pushes for
-- one act is the nagging every notification in this product refuses, so a grant
-- stays silent when the same client already granted this coach something in the
-- previous hour.
--
-- The guard is written as "is there an EARLIER grant", not "is there another
-- one", and the difference is not cosmetic: an AFTER ROW trigger fires once
-- every row of the statement is in, so on a three-photo send all three rows can
-- see the other two and "is there another" would silence every one of them.
-- Ordering on `(shared_at, photo_id)` makes exactly one win. See the trigger.
--
-- The window is an hour rather than a minute deliberately — somebody sending
-- four photos one at a time over ten minutes has done one thing, and being told
-- about it once is what they would expect. The cost is stated: a genuinely
-- separate photo sent forty minutes later is silent, and the coach finds it
-- when they open the screen the first message sent them to.
--
-- Idempotent; safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.progress_photo_share_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_name text;
begin
  -- This fires inside the transaction of a client pressing Send. An exception
  -- here rolls that back, and they would tap and watch nothing happen — so
  -- every reachable failure is guarded rather than raised.
  --
  -- `progress_photo_shares.coach_id` is `not null references profiles(id)` and
  -- `notifications.user_id` requires exactly that, so the recipient cannot be
  -- missing. It is not wrapped in `exception when others then null` either,
  -- for part 158's reason: that swallows a real defect silently and forever.

  -- One act, one message.
  --
  -- The test is "is there an EARLIER grant to this coach in the last hour",
  -- not "is there another one" — and the difference is the whole correctness of
  -- this guard. An AFTER ROW trigger fires once every row of the statement has
  -- been inserted, so on a three-photo send all three rows can see the other
  -- two: "is there another" would be true for every one of them and the coach
  -- would be told nothing at all.
  --
  -- Ordering on `(shared_at, photo_id)` is what makes exactly one win. Every
  -- row of one statement carries the same `shared_at` — it defaults to now(),
  -- which is the transaction's timestamp — so the tie breaks on the photo id,
  -- which is unique. A photo sent forty minutes later has a strictly later
  -- `shared_at` and is suppressed by the row before it, which is the intended
  -- behaviour rather than a side effect: the first message already sent the
  -- coach to the screen that lists everything.
  if exists (
    select 1 from public.progress_photo_shares s
     where s.coach_id  = new.coach_id
       and s.client_id = new.client_id
       and s.photo_id <> new.photo_id
       and s.shared_at > now() - interval '1 hour'
       and (s.shared_at, s.photo_id) < (new.shared_at, new.photo_id)
  ) then
    return null;
  end if;

  select nullif(btrim(coalesce(p.full_name, '')), '')
    into v_name
    from public.profiles p
   where p.id = new.client_id;

  insert into public.notifications (user_id, title, body, icon, route)
  values (
    new.coach_id,
    'A client has sent you a progress photo',
    left(
      -- A blank or missing name falls back to "A client" and never to an empty
      -- string, which would render a sentence starting with a space.
      coalesce(v_name, 'A client')
      || ' has shared a progress photo with you.'
      -- Said out loud, because the coach should know it and because the person
      -- standing next to them reading this should know it too.
      || ' The photo itself is not in this message and is not on your lock screen —'
      || ' it opens on their Progress Photos page and nowhere else.'
      -- The one thing a coach has to understand about looking at these, and the
      -- reason to look today rather than on Friday.
      || ' They can take it back whenever they like, and it goes from your app the moment they do.',
      500),
    'heart',
    -- The parameter is the point, as it is for the coach's chat thread and
    -- their client's intake: client-photos.tsx reads `clientId` when it is given
    -- one and falls back to its own picker when it is not, so a missing id turns
    -- a notification about a named person into a list of everybody.
    '/(trainer)/client-photos?clientId=' || new.client_id::text
  );

  return null;
end $fn$;

comment on function public.progress_photo_share_notify() is
  'Tells the COACH that a named client has shared a progress photo. Carries NO image, no thumbnail, no storage path, no photo id, no date the photo was taken and nothing about the body — a push renders on a lock screen, and part 45''s reason for closing coach access in the first place applies there most of all. One message per hour per client, so a batch of photos is one act.';

drop trigger if exists progress_photo_shares_notify on public.progress_photo_shares;
create trigger progress_photo_shares_notify
  after insert on public.progress_photo_shares
  for each row execute function public.progress_photo_share_notify();

-- Revoked from public, anon AND authenticated. Postgres checks EXECUTE when a
-- trigger is CREATED and not when it fires (parts 51, 141, 158, 202), so a
-- trigger function needs no grant to anybody; Postgres grants EXECUTE to PUBLIC
-- on every new function and `anon` resolves through that grant, so both are
-- named.
revoke all on function public.progress_photo_share_notify() from public;
revoke all on function public.progress_photo_share_notify() from anon;
revoke all on function public.progress_photo_share_notify() from authenticated;
