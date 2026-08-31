-- The notification inbox: a table that has existed since part 01 with almost
-- nothing behind it.
--
-- ── What was there before this part ────────────────────────────────────────
--
-- `notifications` (user_id, icon, body, session_id, read, created_at) was
-- created in 01-schema.sql and given one policy, `notif_self`, in the same
-- file. In the whole repository exactly ONE statement touched it: the
-- `notify-message` edge function's `insert({ user_id, icon: 'message', body })`
-- after a chat message. Nothing read it. Not one screen in the three apps, not
-- the web console, nothing. The client dashboard grew a bell icon that routed
-- to the message thread because there was nowhere else for it to go.
--
-- So the product's entire notification story was a push: fire-and-forget, lost
-- the moment it was swiped away, invisible to anyone who had the app closed on
-- a phone with notifications off — which, on the current binary, is EVERYBODY,
-- because expo-notifications is not in the build yet and src/ui/pushNotifications.ts
-- no-ops. Every "Session cancelled" and "A new offer" sent to date reached
-- nobody and left no trace that it had been sent.
--
-- ── Why a SECURITY DEFINER function and not a plain insert ─────────────────
--
-- `notif_self` is `for all using (user_id = auth.uid())` with no `with check`,
-- and Postgres uses the USING expression as the check when one is omitted from
-- a FOR ALL policy. So an authenticated client may insert notifications for
-- THEMSELVES and nobody else — which is exactly backwards for this feature.
-- Every notification worth having is addressed to someone other than the person
-- who caused it: the coach cancels, the CLIENT needs the row; the client books,
-- the COACH needs the row.
--
-- Loosening `notif_self` was the wrong fix and was not done. A policy wide
-- enough to let a coach write to a client's inbox would, written naively, let
-- anybody write to anybody's, and an inbox that strangers can post into is a
-- spam channel with the gym's name on it. So the write goes through one
-- function that decides, per recipient, whether the caller is allowed to reach
-- them — and the table's own policy stays as narrow as it was.
--
-- The relationships it accepts are the ones the product already has, and each
-- mirrors a rule that exists elsewhere in this schema rather than inventing a
-- second version of it:
--
--   self          — a user may write to their own inbox. `notif_self` already
--                   allows this directly; it is here so callers need only one
--                   path.
--   my client     — `clients.trainer_id = auth.uid()`, the same join
--                   `is_my_coach()` reads from the other end, and the same one
--                   `end_coaching()` clears. A coach a client has left stops
--                   being able to reach them, deliberately.
--   my coach      — the mirror, so a booking reaches the trainer.
--   my member     — `is_owner_of(clients.tenant_id)`, character-for-character
--                   the test inside `all_member_ids()`, which is the function
--                   the owner's promotions screen already uses to choose who to
--                   push to. If the two ever disagree, an owner is told an
--                   offer went to N members and N inbox rows do not appear.
--   my staff      — `is_owner_of(profiles.tenant_id)` for a trainer or owner in
--                   the gym, who has no `clients` row to be found by.
--
-- Recipients that match none of them are SKIPPED, not rejected. A coach
-- broadcasting to forty clients, two of whom left last week, should reach the
-- thirty-eight; failing the statement would mean one stale roster entry silently
-- costing everybody else their notification. The function returns how many rows
-- it actually wrote, so a caller can never be told "recorded" for a write that
-- reached nobody — the count is the only honest answer to "did that land".
--
-- ── Why the two new columns ────────────────────────────────────────────────
--
-- `title` and `route`. Both nullable, so the existing writer (`notify-message`,
-- which sets neither) keeps working untouched and every row already in the
-- table stays valid.
--
--   title  Every push in this codebase is a title AND a body — 'Session
--          cancelled' / 'Your 6:30 session on Tuesday was cancelled.' The table
--          had one text column, so the alternative was gluing them together and
--          hoping the seam never showed. An inbox is a list, and a list needs
--          something short and bold on the first line.
--
--   route  Every push already carries `data.route`, which is what
--          addNotificationTapListener() navigates to when the banner is tapped.
--          Without somewhere to keep it, an inbox row is a dead end: the
--          notification you tapped from the lock screen takes you to the
--          session, and the same notification read a day later in the app takes
--          you nowhere. The client validates it before navigating (see
--          src/lib/notifyInbox.ts) — this column holds a string a caller
--          supplied, and is not trusted on the way out.
--
-- ── Grants ─────────────────────────────────────────────────────────────────
--
-- `revoke ... from public` is NOT sufficient here and the file says so out
-- loud, because getting this wrong opened a real hole in this project. Supabase
-- has ALTER DEFAULT PRIVILEGES in the public schema granting EXECUTE to `anon`,
-- `authenticated` and `service_role` by name. A default grant to PUBLIC and an
-- explicit grant to `anon` are two separate entries in the ACL; revoking the
-- first leaves the second standing, and a SECURITY DEFINER function callable by
-- `anon` runs as its owner for anybody holding the publishable key. So `anon`
-- is revoked explicitly and by name, and only `authenticated` is granted back.
--
-- Idempotent; safe to re-run.

-- ── Columns ────────────────────────────────────────────────────────────────

alter table public.notifications
  add column if not exists title text,
  add column if not exists route text;

-- The inbox reads `where user_id = ? order by created_at desc`. The index from
-- part 01 is (user_id, read), which serves the unread COUNT and not the list.
create index if not exists notifications_user_recent
  on public.notifications (user_id, created_at desc);

-- ── The write path ─────────────────────────────────────────────────────────

create or replace function public.notify_users(
  p_user_ids   uuid[],
  p_title      text,
  p_body       text,
  p_icon       text default null,
  p_route      text default null,
  p_session_id uuid default null
)
returns integer
language plpgsql
security definer
-- Pinned. A SECURITY DEFINER function without this resolves `clients`,
-- `profiles` and `is_owner_of` against the CALLER's search_path, and a caller
-- who can create a schema of their own can therefore choose which tables the
-- authorisation check reads.
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me    uuid    := (select auth.uid());
  v_title text    := nullif(btrim(coalesce(p_title, '')), '');
  v_body  text    := nullif(btrim(coalesce(p_body,  '')), '');
  v_icon  text    := nullif(btrim(coalesce(p_icon,  '')), '');
  v_route text    := nullif(btrim(coalesce(p_route, '')), '');
  v_n     integer := 0;
begin
  -- No session, or nothing to say. Zero, not an exception: this is called
  -- alongside a push that is itself best-effort, and a signed-out caller is a
  -- condition the UI already handles by saying nothing was recorded.
  if v_me is null or v_body is null then
    return 0;
  end if;

  with wanted as (
    -- DISTINCT because a roster can list the same person twice (the merge in
    -- src/lib/rosterMerge.ts joins two sources), and two identical rows in an
    -- inbox read as the message having been sent twice.
    select distinct u as uid
      from unnest(coalesce(p_user_ids, '{}'::uuid[])) as u
     where u is not null
     limit 2000
  ),
  allowed as (
    select w.uid
      from wanted w
      -- The join is the reason a recipient with no account cannot break the
      -- statement. The coach's roster merges real `clients` with hand-added
      -- `coach_clients`, whose ids have no profile behind them, and
      -- notifications.user_id is a foreign key to profiles(id) — a single
      -- multi-row insert containing one of them would be rejected in full.
      -- This is the same trap broadcast.tsx hit with `messages`.
      join public.profiles p on p.id = w.uid
     where w.uid = v_me
        or exists (select 1 from public.clients c where c.id = w.uid and c.trainer_id = v_me)
        or exists (select 1 from public.clients c where c.id = v_me  and c.trainer_id = w.uid)
        or exists (select 1 from public.clients c where c.id = w.uid and public.is_owner_of(c.tenant_id))
        or public.is_owner_of(p.tenant_id)
  )
  insert into public.notifications (user_id, title, body, icon, route, session_id)
  select a.uid,
         left(v_title, 120),
         left(v_body, 500),
         left(v_icon, 40),
         left(v_route, 200),
         p_session_id
    from allowed a;

  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

revoke all on function public.notify_users(uuid[], text, text, text, text, uuid) from public;
revoke all on function public.notify_users(uuid[], text, text, text, text, uuid) from anon;
grant execute on function public.notify_users(uuid[], text, text, text, text, uuid) to authenticated;

-- ── Marking read ───────────────────────────────────────────────────────────
--
-- `notif_self` already permits the UPDATE, so this is not about permission —
-- it is about being able to say what happened. PostgREST does not error on an
-- UPDATE that matches zero rows; it answers 200 with an empty body, which is
-- indistinguishable from "there was nothing unread" and from "the read that
-- built this screen was refused". The client asks for the changed ids back
-- (`.select('id')`) and counts them, and this function is the same answer for
-- the mark-everything case, where sending 200 ids up the wire to change them
-- all is the wasteful way to ask.
--
-- Deliberately NOT security definer, unlike notify_users() above. This one has
-- no cross-user work to do, so it needs no privilege the caller does not
-- already have, and running as the invoker keeps `notif_self` in force
-- underneath the `where user_id = v_me` rather than making that WHERE clause
-- the only thing standing between one user and another's rows. search_path is
-- pinned anyway: it costs nothing and the next person to add `security
-- definer` to this function should not have to remember it too.
create or replace function public.mark_notifications_read()
returns integer
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me uuid    := (select auth.uid());
  v_n  integer := 0;
begin
  if v_me is null then
    return 0;
  end if;
  update public.notifications
     set read = true
   where user_id = v_me
     and read = false;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

revoke all on function public.mark_notifications_read() from public;
revoke all on function public.mark_notifications_read() from anon;
grant execute on function public.mark_notifications_read() to authenticated;
