-- A receipt the other side can see, and a watermark that only ever moves
-- forward.
--
-- ── What part 88 built, and the half it did not ────────────────────────────
--
-- 88-message-read-state.sql created `message_reads` (one row per thread per
-- SIDE), `mark_thread_read()` to move a side's watermark to `now()`, and the
-- two unread counts the coach's roster and inbox badge with. All of that is
-- wired and working: src/ui/roster.tsx reads `coach_unread_counts()` and
-- src/ui/coachThreads.ts joins it.
--
-- What nobody can do under part 88 is SEE THE OTHER SIDE'S ROW. Read its two
-- policies again:
--
--   message_reads_client   reader = 'client' and client_id = auth.uid()
--   message_reads_coach    reader = 'coach'  and is_my_client(client_id)
--
-- A client may read only the 'client' row — their own. A coach may read only
-- the 'coach' row — their own. Neither policy grants either person sight of the
-- other's `last_read_at`, so a read RECEIPT — "they have seen this" — is not
-- merely unimplemented in the app, it is unexpressible against this table. That
-- is the privacy decision part 88 took, and taking it back is what this part is
-- for, so it is argued below rather than assumed.
--
-- ── The privacy decision, and why it is SYMMETRIC ──────────────────────────
--
-- A read receipt tells one person when another person looked at their phone.
-- That is a real disclosure and it is not made lightly.
--
-- It is symmetric — the coach sees when the client read, the client sees when
-- the coach read — for one reason: the asymmetric version is the coach watching
-- the client. The coach ALREADY has the stronger signal in aggregate, because
-- `coach_unread_counts()` tells them, per client, how many of that client's
-- messages are unopened, which is a statement about the coach's own reading.
-- What the coach does not have, and what the client does not have either, is
-- whether the person they wrote to has opened it. Giving that to only one of
-- them, in a relationship where one party is paying the other and one party
-- holds the roster, would make it a monitoring feature. Given to both, it is
-- the ordinary courtesy every messenger has offered for fifteen years: I can
-- see whether you have seen what I sent you, and you can see the same of me.
--
-- The disclosure is bounded three ways and it is worth naming each:
--
--   · ONE TIMESTAMP PER THREAD PER SIDE. Not per message, not a history. It
--     says "the last time you opened this conversation", and nothing about how
--     often, how long, or what was on screen.
--   · ONLY TO THE OTHER PERSON ON THE THREAD. `thread_read_receipt` is scoped
--     by the same two predicates the policies use; a coach who is not this
--     client's coach, an owner, another member, an anon caller, all get null.
--   · NULL IS THE ANSWER TO EVERY QUESTION THIS FUNCTION WILL NOT ANSWER. An
--     unauthorised caller gets exactly what a caller whose peer has never
--     opened the thread gets, so the function's silence tells nobody anything
--     about whether the thread exists.
--
-- The app narrows it further and that is a presentation choice, not a promise
-- of this function: src/lib/readReceipt.ts renders the word "Read" under a
-- bubble and never a time, so the screen says the fact and not the hour.
--
-- ── The watermark moves FORWARD only, and is clamped to server time ────────
--
-- `mark_thread_read()` wrote `now()`, so the only value it could ever set was
-- one the server chose and one later than what was there. Marking read up to a
-- CALLER-SUPPLIED moment — which is what "the newest message actually on the
-- reader's screen" needs — reopens both directions:
--
--   · BACKWARD. A second phone, a stale screen, a retry with an old value:
--     any of them would un-read messages the reader has already read, and the
--     other person's "Read" would blink back to "Sent". `greatest()` in the
--     conflict clause makes that impossible.
--   · FORWARD PAST THE PRESENT. A device whose clock is hours fast would mark
--     read every message the next few hours bring — messages that do not exist
--     yet, on a screen nobody has looked at. `least(p_at, now())` makes the
--     caller's clock evidence about the past only. A phone that is slow simply
--     under-claims, which is the harmless direction: the badge stays up.
--
-- `mark_thread_read()` is kept and REDEFINED to delegate here, so there is one
-- implementation of the write rather than two that could drift on the clamp or
-- on the monotonicity. Its behaviour is unchanged: `now()` is trivially
-- forward and trivially not in the future.
--
-- It is kept rather than dropped even though the app has stopped calling it.
-- The one call site — `useThread` in src/ui/messaging.ts, which fired the
-- instant the initial read settled — has moved to `mark_thread_read_at` in
-- src/ui/readReceipts.ts, because `now()` is a claim about a screen nobody has
-- necessarily looked at and that claim is now shown to somebody else. But this
-- part is applied to a database that phones talk to over the air, and the
-- bundle on a phone that has not taken the update yet still calls the old name.
-- Dropping it would turn "the badge does not clear" into "the badge does not
-- clear on every phone that has not restarted", for the sake of removing eight
-- lines. It goes when the old bundles do.
--
-- ── What this part does NOT do ─────────────────────────────────────────────
--
-- It does not change what UNREAD means. `coach_unread_counts()` and
-- `client_unread_count()` are untouched and still compare `messages.created_at`
-- against the same watermark, so the roster badge, the coach's inbox and the
-- receipt are three readings of ONE number. Part 148's argument against a
-- second definition of unread holds here and this part is a caller of the
-- first, not an author of a second.

-- Mark this side of the thread read up to a moment the caller names.
--
-- The side is inferred rather than passed, exactly as in part 88 and for the
-- same reason: a caller must not be able to mark the OTHER person's side read.
-- Returns false rather than raising for every refusal, because the app's caller
-- swallows failure by design — an unmarked thread keeps claiming a message is
-- waiting, which overstates and never hides.
create or replace function public.mark_thread_read_at(p_client uuid, p_at timestamptz)
returns boolean
language plpgsql security definer set search_path to 'public'
as $fn$
declare v_role text; v_at timestamptz;
begin
  if auth.uid() is null or p_client is null or p_at is null then return false; end if;
  if p_client = auth.uid() then
    v_role := 'client';
  elsif exists (select 1 from clients c where c.id = p_client and c.trainer_id = auth.uid()) then
    v_role := 'coach';
  else
    return false;
  end if;
  -- The caller's clock is not evidence about the future.
  v_at := least(p_at, now());
  insert into message_reads (client_id, reader, last_read_at)
       values (p_client, v_role, v_at)
  on conflict (client_id, reader) do update
     set last_read_at = greatest(message_reads.last_read_at, excluded.last_read_at);
  return true;
end $fn$;

-- The zero-argument spelling, unchanged in behaviour and now one line thick.
create or replace function public.mark_thread_read(p_client uuid)
returns boolean
language sql security definer set search_path to 'public'
as $fn$
  select public.mark_thread_read_at(p_client, now());
$fn$;

-- When the OTHER person on this thread last opened it, or null.
--
-- Null covers three different facts on purpose — they have never opened it, the
-- caller is not on this thread, and nobody is signed in — because separating
-- them would turn this into a probe for whether a given uuid is somebody's
-- client. The app treats null as "not read", which is the pessimistic reading
-- and the only safe one.
create or replace function public.thread_read_receipt(p_client uuid)
returns timestamptz
language sql stable security definer set search_path to 'public'
as $fn$
  select r.last_read_at
    from message_reads r
   where r.client_id = p_client
     and r.reader = case
           when p_client = auth.uid() then 'coach'
           when exists (select 1 from clients c
                         where c.id = p_client and c.trainer_id = auth.uid()) then 'client'
           else null
         end;
$fn$;

revoke execute on function public.mark_thread_read_at(uuid, timestamptz) from public, anon;
grant execute on function public.mark_thread_read_at(uuid, timestamptz) to authenticated;
revoke execute on function public.thread_read_receipt(uuid) from public, anon;
grant execute on function public.thread_read_receipt(uuid) to authenticated;
