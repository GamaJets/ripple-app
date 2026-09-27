-- ═══════════════════════════════════════════════════════════════════════════
-- A client filled in their weekly check-in and nothing told the coach.
--
-- ── What was silent, and how that was established ────────────────────────
--
-- `check_ins` is the spine of online coaching: once a week a client sits down
-- and writes their coach a weight, four self-ratings and a paragraph about
-- their week. src/lib/coachCheckins.ts was written on 20 Sep 2026 precisely
-- because nothing on the coach side had ever read the note, and its header
-- records the measurement — four coach-side reads existed, and between them
-- they took the weight, the timestamp and the adherence number. That module
-- fixed the READING. It did not fix the TELLING, and this is that half.
--
-- Grep `check_ins` across supabase/parts: part 02 creates the table, part 202
-- counts rows off it for the nightly "gone quiet" sweep, and nothing anywhere
-- fires on the insert. Grep `SERVER_WRITTEN` in src/lib/notifyInbox.ts and
-- there is no check-in row. So the discovery mechanism for a check-in is the
-- coach remembering to open a named client and look — one person at a time, on
-- the off-chance, which is the same failure part 614 closed for a progress
-- photo and part 159 closed for an intake form.
--
-- It costs most where the product is weakest. A coach with a gym floor sees
-- their clients; a coach with twelve online clients has the check-in and the
-- chat thread and nothing else, and a check-in read on Thursday is a week of
-- coaching that did not happen.
--
-- ══ WHAT THIS MESSAGE MAY CONTAIN ════════════════════════════════════════
--
-- A push renders on a LOCK SCREEN, read by whoever is standing near the
-- coach's phone. Part 614 settles what that means for a progress photo and the
-- same reasoning decides every word here, because a check-in row is health
-- data about a named person:
--
--   NO WEIGHT. `check_ins.weight_kg` is on the row and is nobody's business on
--     a lock screen. It is also the number most likely to be read over a
--     shoulder and understood instantly.
--   NO RATINGS. Energy, sleep, mood and adherence are four statements about a
--     person's state, and "Sarah rated her mood 2 out of 5" is a sentence this
--     app will not put on a lock screen.
--   NO NOTE. It is a paragraph written to one person. Quoting even its first
--     line is quoting it.
--   NO STREAK OR COUNT. How many weeks somebody has or has not checked in is a
--     shape of their habits, and part 614 refuses the same thing for photos.
--
-- What is left is the whole of the message: a check-in exists, and who from.
-- The name is the coach's to read already — `profiles_trainer_r_clients` — and
-- without it the notification opens a queue the coach then has to search.
--
-- ── One message per client per hour ──────────────────────────────────────
--
-- The same guard part 614 uses, for a different reason. A check-in is weekly,
-- so a duplicate is not a batch send — it is somebody submitting twice because
-- the first one did not look like it saved. Two identical pushes for that is
-- the app reporting its own uncertainty, so the earlier row suppresses the
-- later one.
--
-- ── Who this is sent to ──────────────────────────────────────────────────
--
-- `clients.trainer_id`, which is the live coaching link and the same join part
-- 202 uses. A client with no coach produces no notification and no error: the
-- majority of members have no coach, their check-ins are their own, and a
-- trigger that raised on them would fail the insert and lose the check-in.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.check_in_notify_coach()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_coach uuid;
  v_name  text;
begin
  -- This fires inside the transaction of a client pressing Send on their own
  -- check-in. An exception here rolls that back and they would watch the form
  -- do nothing, so every reachable failure is guarded rather than raised — and
  -- not with `exception when others then null`, which swallows a real defect
  -- silently and forever (part 158).

  select c.trainer_id into v_coach
    from public.clients c
   where c.id = new.user_id
     and c.trainer_id is not null;

  -- A member with no coach. The common case, and not a failure.
  if v_coach is null then
    return null;
  end if;

  -- An earlier check-in from the same client in the last hour has already sent
  -- this coach to the same screen. Ordering on `(at, id)` is what makes exactly
  -- one win, for the reason part 614 sets out at length.
  if exists (
    select 1 from public.check_ins ci
     where ci.user_id = new.user_id
       and ci.id <> new.id
       and ci.at > now() - interval '1 hour'
       and (ci.at, ci.id) < (new.at, new.id)
  ) then
    return null;
  end if;

  select nullif(btrim(coalesce(p.full_name, '')), '')
    into v_name
    from public.profiles p
   where p.id = new.user_id;

  insert into public.notifications (user_id, title, body, icon, route)
  values (
    v_coach,
    'A client has sent a check-in',
    left(
      -- A blank or missing name falls back to "A client" rather than to an
      -- empty string, which would render a sentence opening with a space.
      coalesce(v_name, 'A client')
      || ' has filled in their check-in.'
      -- Said out loud, for the coach and for whoever is reading their lock
      -- screen over their shoulder.
      || ' What they wrote is not in this message — it opens on your Check-Ins page.',
      500),
    'heart',
    -- The parameter is the point: the queue opens on the person the message is
    -- about, and falls back to the whole list when it is missing.
    '/(trainer)/checkins?clientId=' || new.user_id::text
  );

  return null;
end $fn$;

comment on function public.check_in_notify_coach() is
  'Tells the COACH that a named client has filled in their weekly check-in. Carries NO weight, no ratings and no note — a push renders on a lock screen and every figure on that row is health data about a named person. One message per client per hour, so a double submission is one event. Silent for a member with no coach, which is most members.';

drop trigger if exists check_ins_notify_coach on public.check_ins;
create trigger check_ins_notify_coach
  after insert on public.check_ins
  for each row execute function public.check_in_notify_coach();

-- Revoked from public, anon AND authenticated. Postgres checks EXECUTE when a
-- trigger is CREATED and not when it fires (parts 51, 141, 158, 202), so a
-- trigger function needs no grant to anybody; Postgres grants EXECUTE to PUBLIC
-- on every new function and `anon` resolves through that grant, so both are
-- named.
revoke all on function public.check_in_notify_coach() from public;
revoke all on function public.check_in_notify_coach() from anon;
revoke all on function public.check_in_notify_coach() from authenticated;
