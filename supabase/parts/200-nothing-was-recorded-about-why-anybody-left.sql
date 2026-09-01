-- ═════════════════════════════════════════════════════════════════════════
-- Nothing was recorded about why anybody left.
--
-- ── What was measured ───────────────────────────────────────────────────
--
-- `end_coaching(p_other)` (part 68) takes ONE argument. It writes
-- `coaching_relationships.status = 'ended'`, `ended_at`, `ended_by` and
-- `clients.trainer_id = null`, and that is the whole of the record. Part 159
-- then sends the coach the notification "A client has ended their coaching",
-- with no route and nothing in it but the fact.
--
-- Churn is the single cheapest thing a coach can learn about their own
-- business, the ending is the only moment the answer exists, and this product
-- was discarding it at exactly that moment — every time, for every coach.
--
-- ── THE RULE THIS PART EXISTS TO HOLD ───────────────────────────────────
--
-- A REASON IS ATTRIBUTED TO WHOEVER SAID IT.
--
-- Two very different facts land in one column. A client who ends the coaching
-- and picks "the cost" has TOLD their coach something. A coach who ends it, or
-- who fills the reason in afterwards about a client who said nothing, has
-- recorded a BELIEF. Both are worth keeping and they are not the same
-- evidence — and six months later, on a churn list, they are indistinguishable
-- unless something keeps them apart.
--
-- So `end_reason_by` is written by the SERVER from auth.uid() and never from a
-- parameter. A client cannot record a reason as their coach and a coach cannot
-- record one as their client, because neither of them is passing the field.
-- src/lib/endCoaching.ts renders `reasonAttribution` off it and says which of
-- the two the reader is looking at, in words, every time.
--
-- ── Why 'unsaid' is a value and NULL is not ─────────────────────────────
--
-- NULL is "nobody recorded one". `'unsaid'` is "they were asked and would
-- rather not say". Collapsing those would make every hurried removal read as a
-- client who refused to explain themselves, and the difference decides whether
-- the coach's next move is to ask better questions or to stop asking. The
-- column is nullable for that reason and for no other.
--
-- ── Why two functions and not one ───────────────────────────────────────
--
-- `end_coaching_with_reason()` is the ending and the reason in ONE
-- transaction. Two calls have a state between them — ended, unexplained — that
-- every dropped connection reaches, and the ending is the only moment the
-- question makes sense to ask.
--
-- `record_end_reason()` is the other half, and it is the one that catches the
-- case the coach cares about most: the client left on their own, the coach
-- learned about it from a notification, and the answer exists only in the
-- coach's head. It writes onto an already-ended row.
--
-- The one-argument `end_coaching(uuid)` is UNTOUCHED and stays. Every existing
-- caller — including app/(client)/my-coach.tsx, which this part does not reach
-- into — keeps working and records nothing, which is exactly what it did
-- yesterday. A part that changed the meaning of an existing signature would be
-- a schema change disguised as a feature.
--
-- ── What this does NOT do ───────────────────────────────────────────────
--
-- It does not notify anybody. The ending already notifies (part 159) and a
-- second row saying "and here is why" would be a push about a push. It does not
-- expose the reason to anybody `cr_self` does not already admit — both parties
-- can read their own relationship row and always could, and that is the policy
-- being relied on rather than a new one.
--
-- Idempotent; safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════

-- ── 1 · the columns ─────────────────────────────────────────────────────

alter table public.coaching_relationships
  add column if not exists end_reason    text,
  add column if not exists end_note      text,
  add column if not exists end_reason_by uuid references public.profiles(id) on delete set null;

-- The closed set, mirroring `EndReason` in src/lib/endCoaching.ts. A CHECK
-- rather than an enum: adding a tenth reason to an enum needs a type change and
-- a lock, and this list will be tuned by somebody reading a churn report.
--
-- NULL is admitted and means "nobody recorded one" — see the header. It is NOT
-- the same as 'unsaid' and no query in this repository may treat it as such.
alter table public.coaching_relationships drop constraint if exists coaching_relationships_end_reason_chk;
alter table public.coaching_relationships add constraint coaching_relationships_end_reason_chk
  check (end_reason is null or end_reason in (
    'cost', 'schedule', 'moved', 'results', 'goal-reached',
    'health', 'coach-ended', 'unsaid', 'other'
  ));

-- Bounded, and blank-is-null. A note of 400kB is a paste accident and a note of
-- three spaces renders as an empty paragraph under a heading promising one.
alter table public.coaching_relationships drop constraint if exists coaching_relationships_end_note_chk;
alter table public.coaching_relationships add constraint coaching_relationships_end_note_chk
  check (end_note is null or (btrim(end_note) <> '' and length(end_note) <= 500));

-- A reason with nobody behind it is exactly the ambiguity this part exists to
-- remove: it would render as "we cannot tell who said this", which the app
-- then has to treat as the weaker of the two readings forever. Structural, so
-- it cannot be reached by any write path.
alter table public.coaching_relationships drop constraint if exists coaching_relationships_end_reason_attributed;
alter table public.coaching_relationships add constraint coaching_relationships_end_reason_attributed
  check (end_reason is null or end_reason_by is not null);

-- A note without a reason is a sentence filed under nothing. The picker always
-- sets a reason first, so this only refuses a write nobody makes on purpose.
alter table public.coaching_relationships drop constraint if exists coaching_relationships_end_note_needs_reason;
alter table public.coaching_relationships add constraint coaching_relationships_end_note_needs_reason
  check (end_note is null or end_reason is not null);

comment on column public.coaching_relationships.end_reason is
  'Why the coaching ended, from the closed set in src/lib/endCoaching.ts. NULL means nobody recorded one, which is NOT the same as ''unsaid'' — that is somebody who was asked and declined to say.';
comment on column public.coaching_relationships.end_note is
  'What was actually said, in the recorder''s words. Bounded at 500 characters.';
comment on column public.coaching_relationships.end_reason_by is
  'Who recorded the reason. Written by the server from auth.uid(), never from a parameter: a reason the client gave and a reason the coach believes are different evidence, and this column is the only thing that tells them apart.';

-- The coach's "why did they leave" card reads ended rows with no reason on
-- them, newest first. Partial on `end_reason is null` because the card is only
-- ever interested in that half and the index then stays small as a coach's
-- history of explained endings grows.
create index if not exists coaching_relationships_unexplained_idx
  on public.coaching_relationships (coach_id, ended_at desc)
  where status = 'ended' and end_reason is null;

-- ── 2 · ending it and saying why, in one transaction ────────────────────

create or replace function public.end_coaching_with_reason(
  p_other  uuid,
  p_reason text,
  p_note   text
)
returns boolean
language plpgsql
security definer
-- Pinned, for part 68's own reason: a SECURITY DEFINER function without this
-- resolves `clients` and `coaching_relationships` against the CALLER's
-- search_path, and a caller who can create a schema of their own then chooses
-- which tables the authorisation check reads.
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me     uuid := auth.uid();
  v_ended  boolean;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_me is null then
    raise exception 'not signed in';
  end if;

  -- The ending is delegated, deliberately. Part 68 holds a careful piece of
  -- reasoning — read-before-write so "we ended it just now" and "there was
  -- never anything here" stay apart, `status <> 'ended'` so a re-run does not
  -- restamp `ended_at` and re-fire the photo-revocation trigger, and matching
  -- on `trainer_id = <the other party>` so nobody else's link is disturbed. A
  -- second copy of that here is the copy that drifts, and the thing it would
  -- drift into is somebody's progress photos being un-shared twice.
  v_ended := public.end_coaching(p_other);

  -- Nothing was ended, so there is nothing to attach a reason to. Returning
  -- false rather than raising: "the two were never linked" is part 68's own
  -- true answer and this function must not turn it into an error.
  if not v_ended then
    return false;
  end if;

  if v_reason is null then
    return true;
  end if;

  -- The CHECK will refuse a reason outside the set, and that is the right place
  -- for it: a caller sending a reason this build does not know is a bug in the
  -- caller, and silently dropping it would leave a coach believing they had
  -- recorded something.
  --
  -- `end_reason is null` in the predicate is not redundant. Two coaches cannot
  -- reach one relationship, but a re-run of this call can, and the second run
  -- must not overwrite the first answer — which, on the row this fires against,
  -- is the answer the coach gave a moment ago.
  update public.coaching_relationships
     set end_reason    = v_reason,
         end_note      = left(v_note, 500),
         -- From auth.uid() and never from a parameter. See the header: this is
         -- the whole of the attribution.
         end_reason_by = v_me
   where status = 'ended'
     and end_reason is null
     and ((coach_id = v_me    and client_id = p_other)
       or (coach_id = p_other and client_id = v_me));

  return true;
end
$function$;

revoke execute on function public.end_coaching_with_reason(uuid, text, text) from public, anon;
grant  execute on function public.end_coaching_with_reason(uuid, text, text) to authenticated;

comment on function public.end_coaching_with_reason(uuid, text, text) is
  'Ends the coaching relationship between the caller and p_other AND records why, in one transaction. Delegates the ending itself to end_coaching(uuid) rather than copying its logic. end_reason_by is taken from auth.uid(). Returns false, having written nothing, when the two were never linked.';

-- ── 3 · saying why, afterwards ──────────────────────────────────────────

create or replace function public.record_end_reason(
  p_other  uuid,
  p_reason text,
  p_note   text
)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me     uuid := auth.uid();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_n      integer;
begin
  if v_me is null then
    raise exception 'not signed in';
  end if;
  if p_other is null then
    raise exception 'no one to end coaching with';
  end if;
  if v_reason is null then
    raise exception 'a reason is required';
  end if;

  -- Only an ALREADY-ENDED relationship, and only one the caller is in. The
  -- symmetric predicate is part 68's and is repeated here rather than shared,
  -- because it is three lines of literal column equality with no reasoning in
  -- it — unlike the write ordering above, which is where the danger was.
  --
  -- `end_reason is null` OR `end_reason_by = v_me` is the whole authorisation
  -- of an overwrite: a coach may correct their own account of why somebody
  -- left, and neither party may overwrite the other's. That second clause is
  -- what stops a coach filing their guess over a reason the client gave.
  update public.coaching_relationships
     set end_reason    = v_reason,
         end_note      = left(v_note, 500),
         end_reason_by = v_me
   where status = 'ended'
     and (end_reason is null or end_reason_by = v_me)
     and ((coach_id = v_me    and client_id = p_other)
       or (coach_id = p_other and client_id = v_me));

  get diagnostics v_n = row_count;

  -- False, not an exception. Three different things land here — no ended
  -- relationship, no relationship at all, and the other party got there first —
  -- and every one of them is "your note was not kept", which is a sentence the
  -- app can say. An exception would be reported as a failure the coach should
  -- retry, and retrying will not change any of the three.
  return v_n > 0;
end
$function$;

revoke execute on function public.record_end_reason(uuid, text, text) from public, anon;
grant  execute on function public.record_end_reason(uuid, text, text) to authenticated;

comment on function public.record_end_reason(uuid, text, text) is
  'Records why an already-ended coaching relationship ended. Either party may, but neither may overwrite the other''s answer — end_reason_by is auth.uid() and the update requires end_reason to be null or already theirs. Returns false when there was nothing to write onto.';
