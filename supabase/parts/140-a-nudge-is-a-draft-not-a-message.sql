-- ── The app worked out who was leaving and told nobody ─────────────────────
--
-- src/lib/clientDrift.ts has, for some time, been able to say which of a
-- coach's clients has broken their own training pattern and which of them the
-- record knows nothing about at all. The Clients tab sorts on it. That is the
-- whole of what happened next: a band heading, on a screen a coach opens for
-- another reason, which a coach with forty clients reads on the day they
-- happen to scroll far enough. The entire argument for computing drift was
-- that they would not.
--
-- app/(trainer)/nudges.tsx turns it into a list of suggestions with a message
-- already drafted. This table is the memory that stops that list becoming
-- noise, and it is the only server-side thing the feature needs.
--
-- ── What is NOT here, and will not be ──────────────────────────────────────
--
-- There is no message body, no queue, no scheduler, no `send_after`, and no
-- edge function. Nothing in this schema can cause a client to receive
-- anything. A nudge is a DRAFT: the coach reads it, edits it, and sends it
-- from the ordinary chat thread with their own hand, and the row below records
-- only that they did.
--
-- That is a hard limit rather than a stage of the work. `messages.sender` once
-- came from the caller's own request, so a client could post into their thread
-- as 'coach' and their phone would render it as words from their coach. It was
-- removed. A table that let this app compose and deliver a message under a
-- coach's name would put the same falsehood back, at scale, and with the app's
-- blessing — a client would be reading a sentence in their coach's voice that
-- their coach had never seen. Nothing about drift is urgent enough to be worth
-- that, and a coach who cannot spare ten seconds to read one sentence should
-- not be sending it.
--
-- ── Two acts, one table, and why both are recorded ─────────────────────────
--
-- `action` is 'sent' or 'dismissed', and both mute the client:
--
--   sent       the coach messaged them. Asking again next Monday would be
--              asking them to chase somebody they chased on Friday.
--   dismissed  the coach looked and said no. That is a decision, not an
--              omission, and re-offering it is how a suggestion list teaches a
--              coach to scroll past everything in it — including the real ones.
--
-- A suggestion engine that repeats is worse than no suggestion engine, because
-- it costs the attention of the person it was built for. So the never-nag rule
-- is not a nicety in the UI; it is why this table exists.
--
-- ── `muted_days` is written down, not worked out again ─────────────────────
--
-- The window comes from the client's OWN rhythm (`paceFor` in
-- src/lib/interventions.ts): two of their ordinary gaps between sessions,
-- floored at a week and capped at a month, so a client who trained daily is not
-- left for four weeks and a client who trained fortnightly is not chased in the
-- middle of an ordinary gap.
--
-- It is STORED, and the app reads it back rather than recomputing it, for two
-- reasons that both end the same way:
--
--   · a baseline moves. A client whose rate falls further after being
--     contacted would have their coach's fortnight of quiet silently shortened
--     by the very fall the coach already acted on;
--   · the constants are ordinary code and will be tuned. Lowering the cap must
--     not un-mute every client on every coach's phone at once, which is what
--     recomputing on read would do the morning the change shipped.
--
-- ── `observed` is what the app said, not what is true ──────────────────────
--
-- The sentence the coach was shown when they acted — "Nothing for 19 days —
-- was 3.5 days a week" — kept verbatim so a coach reading their own history in
-- November can see what they were told in September, rather than only what
-- they did about it. It is a claim about the RECORD and is worded that way
-- throughout (src/lib/nudge.ts, `NEVER_SAYS`). Drift is not a diagnosis: an
-- injury, a fortnight away, a change of gym, a lapsed payment and somebody who
-- simply stopped opening the app all produce this exact shape, and nothing in
-- this column may ever be read as a reason.
--
-- ── Access ─────────────────────────────────────────────────────────────────
--
-- `coach_id = auth.uid()` on every verb. There is no other coach's case, no
-- owner's case, and no client's case:
--
--   · another coach must not be able to READ this. Which of a rival's clients
--     have gone quiet is the most commercially sensitive thing this app holds
--     about a coaching business, and it is also the most personal thing it
--     holds about the clients in it;
--   · another coach must not be able to WRITE it either, and that is the half
--     that is easy to leave open. A row inserted with somebody else's coach_id
--     would mute a client on THEIR list — a silent denial of service that
--     stops a coach ever being told one of their own clients is leaving, with
--     no error and nothing on screen to notice;
--   · the CLIENT must not read it. `client_nudges` is a coach's working notes
--     about them, and a client discovering that their coach set them aside for
--     thirty days is a conversation nobody chose to have.
--
-- The read policy is `coach_id = auth.uid()` ALONE and deliberately does not
-- also require `is_my_client(client_id)`. A coach who has stopped working with
-- somebody keeps their own record of what they tried; deleting the history at
-- the moment the relationship ends erases the reason the last message was
-- never sent. The WRITE policies are the narrow ones — `is_my_client` as well,
-- so a nudge can only ever be recorded against a client who is yours right
-- now, and a coach cannot mint rows keyed to a stranger's uuid.
--
-- `is_my_client` is invoker-rights (not SECURITY DEFINER) with its search_path
-- already pinned, and resolves through `clients_trainer_read`. No new
-- SECURITY DEFINER function is introduced here, which is the preferred outcome:
-- the ones that exist are the holes that have to be got right.
--
-- ── The verbs, and the one that is missing ─────────────────────────────────
--
-- SELECT and INSERT for the coach. DELETE only on a row whose action is
-- 'dismissed'. No UPDATE at all.
--
-- The asymmetry is the point. A coach may bring back a client they set aside —
-- changing their mind about their own book is not a data-integrity question.
-- They may NOT erase the record that they messaged somebody, because that row
-- is the client's protection against being messaged twice about the same
-- silence, and a guarantee the constrained party can delete is not a guarantee.
-- And nothing may be UPDATEd: a row here is a statement about a moment, and a
-- moment that can be edited afterwards is not a record of anything.
--
-- The GRANT is written out rather than left to Supabase's stock default
-- privileges, which hand `anon` the full DML set on every table created in this
-- project — part 119 found that on 80 of 89 tables. RLS NARROWS a grant; it
-- does not confer one, and it is not what should be carrying the weight when
-- the grant itself has no business existing. `anon` cannot reach this table at
-- all: not refused by a policy, refused at the grant. TRUNCATE goes with it,
-- for part 119's reason — RLS does not apply to TRUNCATE.

create table if not exists public.client_nudges (
  id         uuid primary key default gen_random_uuid(),
  -- On auth.users, matching coach_prefs (part 129), not on `trainers`. The row
  -- belongs to the account that acted.
  coach_id   uuid not null references auth.users(id) on delete cascade,
  -- On `clients`, and that FK is load-bearing rather than tidy. A roster entry
  -- added by hand lives in `coach_clients` and has no Repple account: nothing
  -- can be read about their training and no thread exists to write in, so they
  -- can never legitimately be nudged. src/lib/nudge.ts withholds them by name
  -- ('no-account'); this makes the same rule true of the database, so a screen
  -- that ever gets it wrong fails loudly here instead of recording a mute for
  -- somebody nobody could have contacted.
  client_id  uuid not null references public.clients(id) on delete cascade,
  action     text not null check (action in ('sent', 'dismissed')),
  at         timestamptz not null default now(),
  -- The mute window as decided at the time. See the note above on why it is
  -- stored. Bounded on both sides: 0 would be a row that mutes nothing and
  -- looks like it does, and anything past a year is a client written off.
  muted_days integer not null check (muted_days between 1 and 365),
  -- The app's own sentence at the moment the coach acted. Nullable: a row whose
  -- observation could not be read is still a true record of the act.
  observed   text,
  -- Days since the newest thing on record, as the app had it. NULL means the
  -- window held nothing datable, which is not 0 — the same distinction
  -- src/lib/clientDrift.ts draws between silence and never.
  quiet_days integer check (quiet_days is null or quiet_days >= 0)
);

alter table public.client_nudges drop constraint if exists client_nudges_observed_sane;
alter table public.client_nudges add constraint client_nudges_observed_sane
  check (observed is null or char_length(observed) <= 500);

-- Every read is "this coach's records, newest first", so the coach is the
-- left-anchored prefix and `at` orders inside it. The client filter is done in
-- the app across a set that is one page per coach, not per client.
create index if not exists client_nudges_coach_at
  on public.client_nudges (coach_id, at desc);

alter table public.client_nudges enable row level security;

drop policy if exists client_nudges_coach_read on public.client_nudges;
create policy client_nudges_coach_read on public.client_nudges
  for select
  using (coach_id = (select auth.uid()));

drop policy if exists client_nudges_coach_write on public.client_nudges;
create policy client_nudges_coach_write on public.client_nudges
  for insert
  with check (coach_id = (select auth.uid()) and public.is_my_client(client_id));

-- Undo a set-aside, and nothing else. `action = 'dismissed'` is in the USING
-- clause, so a coach deleting their own 'sent' row is refused by the policy
-- rather than by a screen that happens not to offer the button.
drop policy if exists client_nudges_coach_undismiss on public.client_nudges;
create policy client_nudges_coach_undismiss on public.client_nudges
  for delete
  using (coach_id = (select auth.uid()) and action = 'dismissed');

comment on table public.client_nudges is
  'One row per act a coach took on a drift suggestion. NOT a message queue and not a message: nothing in this schema can cause a client to receive anything, and the body of what was sent lives in `messages`, written by the coach. Coach-only on every verb; no owner, no other coach, and not the client.';
comment on column public.client_nudges.muted_days is
  'How long this act keeps the client off the suggestion list, in days, AS DECIDED AT THE TIME. Read back verbatim — never recomputed, so re-tuning the pacing constants cannot un-mute a coach''s whole book.';
comment on column public.client_nudges.observed is
  'The app''s own sentence when the coach acted — a claim about the RECORD ("nothing logged for 11 days"), never about the person and never a cause. Injury, travel, a change of gym and a lapsed payment all produce the same signal.';
comment on column public.client_nudges.action is
  'sent = the coach messaged them from the thread, by hand. dismissed = the coach looked and set them aside. Both mute; only ''dismissed'' may be deleted.';

-- `authenticated` is revoked too, and that is not belt and braces. Supabase's
-- stock default privileges hand `authenticated` the full DML set on creation,
-- so revoking only `anon` left UPDATE and TRUNCATE standing on a table that has
-- no UPDATE policy at all. The absence of a policy does refuse the statement —
-- it comes back as zero rows changed — but leaning on that is the mistake this
-- schema keeps writing down: the rule is that RLS NARROWS a grant, and a verb
-- nothing is allowed to do should not be granted in the first place. TRUNCATE
-- in particular is not subject to RLS, so the grant is the only thing standing
-- between a coach and every coach's records at once (part 119).
revoke all on public.client_nudges from anon, authenticated, public;
grant select, insert, delete on public.client_nudges to authenticated;
grant all on public.client_nudges to service_role;
