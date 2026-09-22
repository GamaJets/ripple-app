-- ═══════════════════════════════════════════════════════════════════════════
-- Two notifications for one thing, and ten for a cancelled term
-- ═══════════════════════════════════════════════════════════════════════════
--
-- APPLIED. Both trigger functions verified against the live database with
-- pg_get_functiondef before this file was written, and re-read after applying:
-- `coach_request_notify` now writes push_by 'caller' for a directory request
-- and 'server' for a join code, and `class_cancelled_notify` writes 'caller'.
-- The app halves ship in the same commit; see the note on ORDER at the foot.
--
-- src/lib/notifyCopy.ts states the rule this part enforces, in its own words:
-- double-pushing "is the thing that gets notifications turned off", and turning
-- them off is what took the money channel down with the chat channel in the
-- first place. Both halves below are that failure, shipped.
--
-- ── how a row gets pushed, and why two things pushed it ───────────────────
--
-- `notifications.push_by` defaults to 'server'. `notifications_dispatch_push`
-- is a statement-level AFTER INSERT trigger that claims every unpushed row with
-- `push_by = 'server'` and a non-null, non-chat channel, and posts it to the
-- send-push edge function. That is the whole server-side push path.
--
-- Two triggers write rows through it for events a HANDSET was already pushing.
-- Neither knew about the other, because one is SQL and one is TypeScript.
--
-- ── 1 · a coaching request, twice, in two wordings ────────────────────────
--
-- app/(client)/trainers.tsx inserts the `coach_requests` row and then sends its
-- own push, titled 'New coaching request'. `coach_requests_notify_trainer`
-- fires `after insert` on that same row and writes an inbox row titled 'A
-- coaching request', which the dispatcher then pushes.
--
-- So the coach's phone buzzed twice, seconds apart, in two different wordings —
-- which is worse than twice in one wording, because two look like two people
-- asking. Live evidence: `notifications` holds a row titled 'A coaching
-- request' with channel 'clients', push_by 'server' and `pushed_at` set — the
-- dispatcher did push it — and no row titled 'New coaching request', because
-- src/lib/notifyInbox.ts already refuses to record the handset's copy.
--
-- That refusal is the shape of the bug in miniature: somebody noticed the
-- duplicate ROW and stopped it, and the duplicate PUSH went on happening.
--
-- The file that sends it says, four lines above the send: "a client tapping
-- Request twice must not buzz the coach's phone twice for one request." It was
-- buzzing twice for every request, through a path that file cannot see.
--
-- ── the fix, and why `source` is the right discriminator ──────────────────
--
-- There are exactly two writers of `coach_requests`, and they differ in a
-- column that is already there:
--
--   · app/(client)/trainers.tsx writes `source: 'directory'` and pushes.
--   · join_by_code() writes `source = 'code'` and pushes NOTHING — it is a
--     definer, and src/ui/joinCode.ts sends no notification.
--
-- So the trigger can tell them apart without being told. 'directory' gets
-- `push_by = 'caller'`, which writes the inbox row and leaves the push to the
-- handset that is already sending one. Everything else keeps 'server', so the
-- join-code path is unaffected — it is the path with nothing else to push it.
--
-- ── 2 · nine weeks of a cancelled series, ten notifications ───────────────
--
-- `class_cancelled_notify` is `for each row`. `cancelSeriesFrom` is ONE update
-- over N classes, so it fires N times, and each firing runs its own INSERT
-- statement — which means N separate statement-level dispatches, each posting
-- its own push. On top of that, app/(trainer)/classes.tsx sends one aggregated
-- push worded for the member's own count ("3 of your Tuesday classes have been
-- called off").
--
-- A member booked on all nine weeks therefore received TEN notifications for
-- one cancellation: the one that was written for them, and nine that were not.
--
-- The digest cannot help. src/lib/notifyDigest.ts and `run_notices_with_digest()`
-- hold and group a pass, but the hold is set by that wrapper alone and the five
-- cron passes are its only callers. A coach pressing Call Off is not one.
--
-- ── the fix, and why it is the caller that keeps the push ─────────────────
--
-- The aggregated wording only exists on the caller's side: `classOffBuckets`
-- groups the roster by how many of THEIR OWN bookings went, so nobody is told a
-- figure about somebody else's diary. There is no per-user aggregate available
-- to a row trigger, and building one in SQL would be rewriting that function in
-- a language that cannot be unit-tested here.
--
-- So the row keeps being written by the trigger — it is the durable half, and
-- part 900 is right that it should be — and `push_by = 'caller'` stops the
-- dispatcher pushing it.
--
-- That leaves one thing this part could not fix on its own, and the commit
-- carries it: studio-web called classes off and sent NOTHING, leaning entirely
-- on the dispatcher. Its own prompt promises "Everybody booked or waiting is
-- sent this, with your reason in it", so silencing the dispatcher without
-- giving that screen a push would have turned a true sentence false. The coach
-- app's `tellTheRoom` moved to src/lib/classOff.ts unchanged, and studio-web
-- now calls it with a send-push wrapper of its own.
--
-- ── ORDER, and why there is no window ─────────────────────────────────────
--
-- Applying this before the OTA is safe, and the reason is worth writing down
-- because the instinct says otherwise. The bundle this part makes stale is the
-- one that ALREADY pushes: app/(client)/trainers.tsx and
-- app/(trainer)/classes.tsx have sent their own push all along, and that push
-- is the one being kept. A handset on the old bundle therefore sends exactly
-- one notification after this part and two before it. Nothing goes quiet.
--
-- studio-web is the half that was silent, and it has no deploy pipeline in this
-- repository — `npm run studio` runs it from source (package.json:21), so it
-- carries the fix the moment this branch is checked out.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 ──────────────────────────────────────────────────────────────────────
create or replace function public.coach_request_notify()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_name text; v_how text; v_mode text;
begin
  if new.status <> 'pending' then return new; end if;
  select nullif(btrim(coalesce(p.full_name, '')), '') into v_name
    from public.profiles p where p.id = new.client_id;
  v_how := case new.source
             when 'code'      then ' used your join code and has asked you to coach them'
             when 'directory' then ' found you in the directory and has asked you to coach them'
             else                  ' has asked you to coach them' end;
  v_mode := case new.mode
              when 'inperson' then ' in person.'
              when 'hybrid'   then ' both in person and online.'
              else                 ' online.' end;
  insert into public.notifications (user_id, title, body, icon, route, push_by)
  values (new.trainer_id, 'A coaching request',
    left(coalesce(v_name, 'Somebody') || v_how || v_mode
      || ' Accept or decline it on your Clients screen — until you do, they are waiting.', 500),
    'people', '/(trainer)/dashboard',
    -- The row is always written; only the PUSH is conditional. 'directory' is
    -- app/(client)/trainers.tsx, which sends its own. 'code' is join_by_code(),
    -- which sends nothing and needs the server to.
    case when new.source = 'directory' then 'caller' else 'server' end);
  return new;
end; $function$;

-- ── 2 ──────────────────────────────────────────────────────────────────────
create or replace function public.class_cancelled_notify()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_when text;
  v_why  text;
begin
  -- Only the transition ONTO cancelled. Not a re-save, and not a restore.
  if not (coalesce(old.status, 'scheduled') <> 'cancelled'
          and new.status = 'cancelled') then
    return new;
  end if;

  -- The member's own clock is the client screen's job; what a notification can
  -- honestly say is which class, on which day, in the gym's own words.
  v_when := to_char(new.starts_at, 'FMDay FMDD FMMon at HH24:MI');
  v_why := nullif(btrim(coalesce(new.cancel_reason, '')), '');

  insert into public.notifications (user_id, title, body, icon, route, push_by)
  select
    cb.user_id,
    'A class you booked is not running',
    left(
      '“' || coalesce(nullif(btrim(new.title), ''), 'A class') || '” on ' || v_when
      || ' has been called off'
      || coalesce(': ' || v_why, '')
      || '. '
      || case when cb.status = 'waitlist'
              then 'You were on the waiting list for it, so there is nothing to cancel.'
              else 'Your booking is kept on the record and there is nothing for you to do.'
         end
      || ' Your Classes screen has the rest of the timetable.',
      500)
    ,
    'calendar',
    '/(client)/classes',
    -- The row, not the push. This trigger is per ROW, so a nine-week series
    -- writes nine of these and the dispatcher would post nine pushes to one
    -- member — on top of the single aggregated one the caller sends. Both
    -- surfaces that can reach this now call tellTheCancelledRoom (see
    -- src/lib/classOff.ts), which sends one push per person, worded for that
    -- person's own count.
    'caller'
  from public.class_bookings cb
  where cb.class_id = new.id
    -- The person who called it off is watching it happen.
    and cb.user_id is distinct from auth.uid();

  return new;
end;
$function$;

-- Both are trigger functions and neither is called by anybody. Restated because
-- `create or replace` on a function that did not previously exist leaves
-- EXECUTE with PUBLIC, which in a Supabase project includes anon.
revoke all on function public.coach_request_notify() from public, anon, authenticated;
revoke all on function public.class_cancelled_notify() from public, anon, authenticated;
