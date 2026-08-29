-- ─────────────────────────────────────────────────────────────────────────
-- Ending a coaching relationship. The other half of `link_coaching()`.
--
-- 06-account-provisioning.sql has made a coach↔client link since the first
-- week of this project, and it writes the link in TWO places in one statement:
--
--     insert into coaching_relationships … status = 'active';
--     update clients set trainer_id = p_coach where id = p_client;
--
-- Nothing has ever undone either one. Grep the repo before this file and there
-- is no writer of `status = 'ended'` and none of `trainer_id = null`; the
-- header of 47-share-progress-photo.sql says so out loud, and adds that the
-- shape of the future unlink is unknown and "may well write only one of the
-- two". This is that file, and it writes BOTH or neither.
--
-- Until now a client could not leave a coach and a coach could not let a
-- client go. `removeClient` in src/ui/roster.tsx deleted a `coach_clients`
-- row — the manually-added-client table, which a linked client has no row in —
-- and returned true, so the coach watched somebody vanish from the roster and
-- come back on the next launch with full access to their body data intact.
--
-- ── WHO MAY CALL IT ───────────────────────────────────────────────────────
--
-- Either party, and nobody else. The only argument is the OTHER person, so
-- there is no way to name a pair the caller is not in: every predicate below
-- pins one side of the pair to `auth.uid()`, and the caller supplies the other.
--
-- The identity test is on `auth.uid()` and NEVER on `current_user`. Inside a
-- SECURITY DEFINER function `current_user` is the function's OWNER, so a
-- `current_user` guard reads as protection while providing none — 47's header
-- records that exact bug shipping in this project. `auth.uid()` reads the
-- request's JWT claim out of a GUC, so it is the CALLER either way and is
-- unaffected by SECURITY DEFINER. That is the only reason this can be definer.
--
-- Definer is not a convenience here, it is required in both directions:
--   · a coach has no UPDATE on `clients` at all (08-roster-access.sql grants
--     them SELECT and nothing more), so a coach cannot clear `trainer_id`;
--   · a client has no way to reach the coach's side of anything.
-- One function, owned by the database, is the only place both writes can
-- happen together.
--
-- ── ATOMIC, BECAUSE HALF OF THIS IS THE BUG ───────────────────────────────
--
-- A function that set `status = 'ended'` and then failed before clearing
-- `trainer_id` would leave exactly the drift this exists to remove — and the
-- worse half of it, because `is_my_client()` reads `trainer_id`, so the coach
-- would keep every ounce of access while both apps showed the relationship as
-- over. plpgsql gives that for free and it is worth saying why: a function body
-- runs inside the caller's transaction, PostgREST wraps each request in one, so
-- an exception anywhere in here aborts the whole call and neither write lands.
-- Nothing below commits, and nothing below is allowed to swallow an exception.
--
-- ── WHAT A COACH LOSES ────────────────────────────────────────────────────
--
-- Clearing `clients.trainer_id` is the load-bearing half. `is_my_client(c)` is
--
--     exists (select 1 from clients where id = c and trainer_id = auth.uid())
--
-- and it governs the coach's read of `workouts`, `measurements`, `check_ins`,
-- `habit_logs` (02-domain-schema.sql), `messages` (10), `goal_targets` (59),
-- `coach_checklist_items` (58) and `day_types` (62). The same shape written
-- long-hand governs `scans` and `food_logs` (01-schema.sql) and the client's
-- own `profiles` row (08). All of it goes dark in the same statement:
--
--   · every workout, measurement, check-in and habit log
--   · every InBody scan and food log
--   · the message thread (read AND write — `msg_coach` is FOR ALL)
--   · goals, checklist items and day types
--   · the client's name and avatar, so the roster stops listing them
--   · progress photos, twice over — see the trigger section below
--   · the ability to be booked: `book_session()` requires the link, so the
--     client can no longer take a slot from this coach's calendar
--
-- ── WHAT A COACH KEEPS, AND WHY THAT IS DELIBERATE ────────────────────────
--
-- A coach's own record of work they did and were paid for is theirs. None of
-- it is keyed on `clients.trainer_id`, so none of it moves:
--
--   · `sessions` — `sessions_trainer` is `trainer_id = auth.uid()` on the
--     session's OWN column (09-sessions-access.sql). Every session they ever
--     delivered stays readable, with its date, duration and outcome.
--   · `payroll_settlements` (36), `invoices`, `subscriptions`,
--     `billing_customers` (20, 39) — all keyed on the coach's own id.
--   · `client_tags` (14) — `coach_id = auth.uid()`, the coach's own notes.
--
-- One honest cost of that, stated rather than hidden: those session and payroll
-- rows carry a client_id, and the coach can no longer read that person's
-- `profiles` row, so a past client's NAME on a historical session renders as a
-- dash. The row, the money and the date all survive; the name does not. That is
-- the safe direction — a policy wide enough to keep the name would outlive the
-- relationship and the client could never take it back — and it is the reason
-- this file adds no new SELECT policy to `profiles`.
--
-- Booked future sessions are NOT cancelled. A slot somebody paid for is not
-- swept away by an unlink happening in another screen; either party cancels it
-- deliberately, and the client keeps reading it through `client_id =
-- auth.uid()` either way.
--
-- ── THE RESIDUE THIS FILE DOES NOT CLEAR ──────────────────────────────────
--
-- `coach_feedback`, `coach_nutrition` and `assigned_programs` are policed in
-- 02-domain-schema.sql as `coach_id = auth.uid() or client_id = auth.uid()` —
-- keyed on the relationship's own coach_id column, NOT on `trainer_id`. So a
-- former coach keeps read and write on the feedback, macro adjustments and
-- assigned programs they wrote for this client. Those are their own words about
-- their own work, which is arguable either way, but the WRITE half is not: a
-- coach who was let go can still assign a program. Narrowing those three
-- policies is a change to 02, not to this file, and it is named here so the
-- next reader finds it rather than discovers it.
--
-- ── THE PHOTO TRIGGER, WHICH HAS NEVER ONCE FIRED ─────────────────────────
--
-- 47-share-progress-photo.sql created two triggers whose entire purpose is this
-- moment, and neither has ever run, because nothing in the repo unlinked:
--
--     on_coaching_unlink_revoke_photo_shares
--       after update or delete on coaching_relationships, for each row
--     on_trainer_change_revoke_photo_shares
--       after update of trainer_id on clients, for each row
--       when (NEW.trainer_id is distinct from OLD.trainer_id)
--
-- Both fire on this function, and it is worth being precise about how that was
-- established rather than assumed:
--
--   · The first has no WHEN clause and covers plain UPDATE. The statement below
--     is an UPDATE on `coaching_relationships` matching the pair's row, so the
--     trigger runs with TG_OP = 'UPDATE'. `revoke_photo_shares_on_unlink()`
--     takes its third branch — `elsif NEW.status <> 'active'` — because the row
--     now says 'ended', and DELETEs every `progress_photo_shares` grant for
--     that (client, coach).
--   · The second is gated on `trainer_id` actually changing. The second
--     statement sets it to null and is guarded by `trainer_id is not null`, so
--     NEW is distinct from OLD whenever it matches at all, and the trigger
--     runs. It takes the first branch — `TG_TABLE_NAME = 'clients'` — and
--     deletes every grant that client holds, whoever it was addressed to.
--   · Neither trigger tests any identity, so it does not matter which party
--     made the call. They decide from OLD and NEW alone, which is a fact about
--     the row rather than a claim about who is speaking.
--
-- Either statement alone would revoke the grants; both firing is belt and
-- braces, and the delete is idempotent. Access itself was already closed by
-- `coaching_link_active()`, which requires BOTH links — the triggers exist so
-- the client's "what can my coach see" list stops listing grants that no longer
-- grant anything. Section 0 asserts the first trigger is really there, because
-- this file's central claim is false without it.
--
-- Re-hiring the same coach does NOT bring the old photo grants back. The rows
-- are deleted, not flagged, and 47 chose that on purpose.
--
-- ── ENDED, NOT DELETED — AND REVERSIBLE ───────────────────────────────────
--
-- `status = 'ended'` rather than `delete from coaching_relationships`, and the
-- `unique (coach_id, client_id)` row is kept. Three reasons, in order of how
-- much they cost if ignored:
--
--   1. That the two of you worked together is a FACT, and one both parties may
--      later need — a dispute about a session, a payroll settlement that names
--      a client the coach can otherwise no longer identify, a client asking who
--      wrote a program they are still following. A delete destroys it silently
--      and there is no recovering it.
--   2. `link_coaching()` is already written as `on conflict (coach_id,
--      client_id) do update set status = 'active'`, so re-hiring is a single
--      existing call that flips the same row back and rewrites `trainer_id`.
--      Ending is therefore reversible BY DESIGN, not by accident: nothing here
--      is destructive except the photo grants, which 47 decided must be.
--   3. A deleted row and a never-existed row are indistinguishable, which is
--      the same class of lie this codebase keeps finding on its screens.
--
-- `ended_at` and `ended_by` are added below so "ended" is a record and not just
-- a flag. Without them the row still says the relationship is over but cannot
-- say when, and `created_at` alone would have the roster reporting a span that
-- is still open.
--
-- Idempotent throughout: `add column if not exists`, `create or replace`, and a
-- second call for a pair that is already ended writes nothing and still answers
-- true, because the honest answer to "are we unlinked" does not change on the
-- second ask.
-- ─────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════
-- 0 · Assertions — the dependencies this file's promises rest on
-- ═════════════════════════════════════════════════════════════════════════
--
-- Asserted rather than assumed, in the manner of 45 and 47. Each of these is
-- something the header above claims; if one were false the claim would be a
-- comment rather than a behaviour.

do $$
begin
  -- The whole point of the photo trigger is that it fires HERE. If 47 has not
  -- been applied, this function would end the relationship and leave the
  -- client's shared-photo list naming grants that no longer grant anything.
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.coaching_relationships'::regclass
       and tgname = 'on_coaching_unlink_revoke_photo_shares'
       and not tgisinternal
  ) then
    raise exception 'on_coaching_unlink_revoke_photo_shares is missing from coaching_relationships — apply 47-share-progress-photo.sql first, or ending a relationship will leave live photo grants listed to the client (see 47 §7).';
  end if;

  -- 'ended' has been a legal value of the CHECK constraint since 06 and has
  -- never been written. If a later edit narrowed it, every call below would
  -- fail at the first statement — which is the safe half of the transaction to
  -- fail in, but a failure nobody could explain from the app.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.coaching_relationships'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%ended%'
  ) then
    raise exception 'coaching_relationships has no CHECK admitting status = ''ended'' — end_coaching() could never write it.';
  end if;
end $$;


-- ═════════════════════════════════════════════════════════════════════════
-- 1 · When it ended, and who ended it
-- ═════════════════════════════════════════════════════════════════════════
--
-- Both nullable and both null for every row that exists today, which is
-- correct: no relationship in the database has ever been ended, so there is no
-- date to backfill and inventing one would be worse than the gap. A row with
-- status = 'ended' and a null ended_at can only be one written by hand before
-- this file existed, and reads as "we do not know when" rather than as a date.
--
-- ended_by is `on delete set null` rather than cascade for the same reason the
-- relationship row is kept at all: if the person who ended it later deletes
-- their account, THAT the relationship ended is still true, and taking the row
-- with them would erase a fact about somebody else's history.

alter table public.coaching_relationships
  add column if not exists ended_at timestamptz;
alter table public.coaching_relationships
  add column if not exists ended_by uuid references public.profiles(id) on delete set null;

comment on column public.coaching_relationships.ended_at is
  'When end_coaching() ended this relationship. Null on an active or pending row, and also on an ''ended'' row written before 68-end-coaching.sql — which means the date is unknown, not that it ended at the epoch.';
comment on column public.coaching_relationships.ended_by is
  'Which of the two parties called end_coaching(). Either may; null once that account is deleted.';


-- ═════════════════════════════════════════════════════════════════════════
-- 2 · The unlink
-- ═════════════════════════════════════════════════════════════════════════
--
-- ── Why the pair is treated as unordered ──────────────────────────────────
--
-- The obvious version works out which party is calling and branches. This does
-- not, and the symmetry is what makes it safe to read: every predicate below is
-- "(this side is me and that side is them) OR (this side is them and that side
-- is me)". The caller can only ever name the OTHER person, and `auth.uid()`
-- appears on one side of every disjunct, so there is no pair reachable from
-- here that the caller is not half of. No role detection, and nothing to get
-- backwards.
--
-- It also handles the one case a role branch would get wrong: `unique
-- (coach_id, client_id)` permits rows in both directions, so two coaches who
-- coach each other have two relationships. Ending is mutual, so both go.
--
-- ── Why the return value is what it is ────────────────────────────────────
--
-- `true`  — there was a record of a link between you two, and there is now no
--           live one. Answered from state read BEFORE the writes, so a second
--           call on an already-ended pair still says true. The caller asked to
--           be unlinked; they are unlinked; saying false the second time would
--           read as a failure.
-- `false` — no record of any link between you and that person, in either
--           direction, of any status. NOTHING was written. src/ui/roster.tsx
--           relies on this to tell a real linked client from a manually-added
--           `coach_clients` row, which is a different table with different ids.
--
-- It raises rather than returning false for the three things that are mistakes
-- rather than answers — no session, no argument, yourself — because each one
-- means the caller is confused about what they are asking, and a quiet false
-- would be indistinguishable from "you two were never linked".

create or replace function public.end_coaching(p_other uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me    uuid := auth.uid();
  v_known boolean;
begin
  if v_me is null then
    raise exception 'not signed in';
  end if;

  if p_other is null then
    raise exception 'no one to end coaching with';
  end if;

  -- `link_coaching()` carries no such guard — only `join_by_code()` in part 55
  -- refuses your own code — so a self-referential row is reachable and the
  -- symmetric predicates below would match it twice. Refusing here keeps the
  -- answer honest as well as the SQL: there is no relationship to leave.
  if p_other = v_me then
    raise exception 'you cannot end a coaching relationship with yourself';
  end if;

  -- Read BEFORE the writes. Afterwards there is nothing left to distinguish
  -- "we ended it just now" from "there was never anything here", and those are
  -- the two answers this function exists to keep apart.
  --
  -- Either record on its own counts. A pair that has already drifted — a live
  -- `trainer_id` with no relationship row, or the reverse — is exactly the
  -- state this file was written to clean up, and refusing to touch it because
  -- the other half is missing would strand it forever.
  select
    exists (
      select 1 from public.coaching_relationships r
       where (r.coach_id = v_me     and r.client_id = p_other)
          or (r.coach_id = p_other  and r.client_id = v_me)
    )
    or exists (
      select 1 from public.clients c
       where (c.id = p_other and c.trainer_id = v_me)
          or (c.id = v_me    and c.trainer_id = p_other)
    )
  into v_known;

  if not v_known then
    return false;
  end if;

  -- Record one. `status <> 'ended'` keeps a re-run from restamping ended_at
  -- with a later date and re-firing the photo trigger for grants that were
  -- deleted the first time — the second call must be a no-op, not a rewrite of
  -- when the relationship ended.
  update public.coaching_relationships
     set status   = 'ended',
         ended_at = now(),
         ended_by = v_me
   where status <> 'ended'
     and ((coach_id = v_me    and client_id = p_other)
       or (coach_id = p_other and client_id = v_me));

  -- Record two, and the one that actually closes the coach's reads —
  -- `is_my_client()` is a lookup of this exact column.
  --
  -- Matching on `trainer_id = <the other party>` rather than on the client id
  -- alone is what makes a re-run harmless AND what makes the photo trigger
  -- correct: a row is only touched when it currently names the other party, so
  -- NEW.trainer_id is always distinct from OLD.trainer_id when this matches,
  -- which is precisely the WHEN clause on on_trainer_change_revoke_photo_shares.
  -- A row already cleared, or since re-linked to a different coach, matches
  -- nothing and is left alone — nobody else's link is disturbed by this call.
  update public.clients
     set trainer_id = null
   where (id = p_other and trainer_id = v_me)
      or (id = v_me    and trainer_id = p_other);

  return true;
end
$function$;


-- ═════════════════════════════════════════════════════════════════════════
-- 3 · Grants
-- ═════════════════════════════════════════════════════════════════════════
--
-- Matching 67-coach-name-for-client.sql. `anon` must not reach a definer
-- function that writes to `clients` and `coaching_relationships`, even one that
-- can only act on a pair containing auth.uid() — with no session auth.uid() is
-- null and the first statement raises, but the honest place to stop that is the
-- grant rather than the function body.

revoke execute on function public.end_coaching(uuid) from public, anon;
grant  execute on function public.end_coaching(uuid) to authenticated;

comment on function public.end_coaching(uuid) is
  'Ends the coaching relationship between the caller and p_other, writing both records — coaching_relationships.status = ''ended'' and clients.trainer_id = null — or neither. Callable by either party only. Returns false, having written nothing, when the two were never linked.';
