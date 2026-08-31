-- ── A coach had no way to see who had written to them ──────────────────────
--
-- The client app has `/(client)/messages`, and it gets away with being a single
-- thread because a client has exactly one coach. The coach app has
-- `/(trainer)/chat`, which is ALSO a single thread — and a coach has many
-- clients. The three ways into it are a client's own detail screen, a tap on a
-- leaderboard row, and a push notification carrying `?clientId=…`. All three
-- start from a client the coach has already picked. None of them answers the
-- question a coach actually opens the app with, which is who is waiting on a
-- reply. src/ui/notifications.tsx has stated this asymmetry in a comment for a
-- while: "for a coach it is not: their threads are per-client".
--
-- `app/(trainer)/messages.tsx` is the list. This is the read behind it.
--
-- ── Why an RPC rather than a query the app assembles ───────────────────────
--
-- "The last message in each of my threads" is the shape PostgREST cannot ask
-- for. The two ways to get it from the app were both bad:
--
--   · one query per client. A coach with forty clients opens forty round trips
--     on a phone in a gym basement, and — worse than slow — gets forty
--     independent chances to fail. A list where six rows failed and thirty-four
--     succeeded has no honest rendering: the six are indistinguishable from
--     clients who have never written, which is the exact lie
--     src/ui/loadStatus.ts exists to stop.
--   · select every message for every client and reduce on the device. That is
--     the read most likely in this whole app to hit the 1000-row PostgREST cap
--     (src/lib/rowCap.ts) — a year of one busy thread is enough — and a capped
--     page reduces to a "last message" that is simply an older message, stated
--     with confidence. Truncation there does not lose rows off the end of a
--     list, it silently rewrites the content of the rows that remain.
--
-- One row per client, computed where the data is, is the only version whose
-- failure mode is a failure. The function returns AT MOST one row per client on
-- the caller's roster, so the app's `capLimit()` probe is measuring a set whose
-- size is the roster — a number the coach can reason about.
--
-- ── Unread is not defined here ─────────────────────────────────────────────
--
-- `coach_unread_counts()` (88-message-read-state.sql) already decides what
-- unread means for a coach: messages from the CLIENT side of the thread, newer
-- than the coach's own `message_reads.last_read_at` row, with the epoch as the
-- fallback so a coach who has never opened a thread has read nothing rather
-- than everything. It is what the Clients tab already badges with
-- (src/ui/roster.tsx) and what `mark_thread_read()` clears when a thread is
-- opened.
--
-- So this function JOINS that one rather than restating its subquery. Two
-- definitions of unread that drift apart is worse than none: the roster and the
-- inbox would badge the same client differently, on the same phone, at the same
-- moment, and nobody could say which was right. There is one definition, in one
-- place, and this is a caller of it.
--
-- ── Scope, and what a caller cannot ask ────────────────────────────────────
--
-- No arguments, exactly as `my_coach()` has none and for the same reason: there
-- is nothing to probe. `where c.trainer_id = auth.uid()` is the whole of the
-- scope, and it is the same predicate `coach_unread_counts()` uses, so the two
-- halves of every row are about the same set of people. An unauthenticated
-- caller has a null `auth.uid()`, which matches no row rather than every row.
--
-- SECURITY DEFINER because it reads `profiles` for the client's name and face.
-- `profiles_trainer_read` would allow that row by row for a linked client
-- anyway; running as definer is what makes it ONE plan instead of a per-row
-- policy evaluation, and the WHERE clause above is what keeps it honest.
--
-- ── Clients with no messages yet are IN this answer ────────────────────────
--
-- `left join lateral`, not `join`: a client the coach has never exchanged a
-- word with comes back with a null `last_at`. That is deliberate and it is what
-- lets the screen offer starting a conversation without a second read. What the
-- screen must NOT do is print twenty empty rows, and it does not — see the
-- header of app/(trainer)/messages.tsx. The database's job here is to say who
-- exists and what the last word was; deciding which of them is worth a row is
-- the screen's.
--
-- A hand-added `coach_clients` row is not in this answer at all, and cannot be:
-- `messages.client_id` references a real account, and somebody a coach typed
-- into their roster has none. Their name is joined in only as a fallback for a
-- linked client whose `profiles` row carries no name, which is the same second
-- look `useThreadPeerName` already takes.
create or replace function public.coach_threads()
returns table (
  client_id uuid,
  name text,
  avatar text,
  last_body text,
  last_sender text,
  last_kind text,
  last_at timestamptz,
  unread int
)
language sql stable security definer set search_path to 'public'
as $fn$
  select c.id,
         -- The client's own name first, the coach's note about them second.
         -- `nullif` on the empty string because a blank name is not a name, and
         -- returning '' here would draw a circle with no initials in it rather
         -- than the dash that says we could not say who this is.
         coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(cc.name), '')),
         nullif(btrim(p.avatar), ''),
         lm.body,
         lm.sender,
         lm.attachment_kind,
         lm.created_at,
         u.unread
    from clients c
    left join profiles p on p.id = c.id
    left join coach_clients cc on cc.id = c.id and cc.trainer_id = auth.uid()
    -- The one row this whole function exists for. `messages_client_id_created_at_idx`
    -- is scanned backwards for it, so this is an index hit per client and not a
    -- sort of the thread.
    left join lateral (
      select m.body, m.sender, m.attachment_kind, m.created_at
        from messages m
       where m.client_id = c.id
       order by m.created_at desc, m.id desc
       limit 1
    ) lm on true
    left join coach_unread_counts() u on u.client_id = c.id
   where c.trainer_id = auth.uid()
   -- Most recent first, and clients with nothing at the end. The screen sorts
   -- again for its own reasons; this order is what makes a capped read keep the
   -- conversations rather than the silence.
   order by lm.created_at desc nulls last, c.id;
$fn$;

comment on function public.coach_threads() is
  'One row per client on the calling coach''s roster: their name and avatar, the last message in the thread and who sent it, and the unread count from coach_unread_counts(). Takes no argument, so it can only ever answer about the caller. Clients with no messages come back with a null last_at rather than being omitted.';

-- Part 141's argument, applied to the function this part adds rather than left
-- for the next sweep to find: Postgres grants EXECUTE to PUBLIC on creation,
-- and Supabase's default privileges hand `anon` and `authenticated` their own
-- separate grants — so revoking PUBLIC alone leaves the publishable key able to
-- call it. All three are named.
revoke execute on function public.coach_threads() from public, anon;
grant execute on function public.coach_threads() to authenticated;
