-- ═════════════════════════════════════════════════════════════════════════
-- An enquiry that later joined, and a code that cost nothing.
--
-- Two small additions to two tables, and they are in one part because they are
-- one sentence: a coach cannot tell which of their channels produces CLIENTS
-- rather than clicks.
--
-- ── And the one that is deliberately NOT here ───────────────────────────
--
-- A `trainers.brand_logo` column was written and then removed from this part.
-- app/(trainer)/brand.tsx refuses a logo today and gives the reason: "no logo
-- upload… A second image column with no uploader behind it is precisely the
-- promise that had to be walked back" — which is what happened to the owner's
-- brand screen an hour before that one was written.
--
-- A coach's own mark on their own invoice IS theirs and the refusal is wrong
-- about that. But shipping it needs a storage bucket, its policies, an
-- uploader, and a read path that reaches a CLIENT's app through
-- `my_coach_brand()` — four things, none of which is the column. Adding the
-- column alone would re-create the exact defect that screen's header describes
-- finding. It is left for the wave that can do all four.
--
-- ═════════════════════════════════════════════════════════════════════════
-- 1 · The enquiry that became a client, and nobody could say so
-- ═════════════════════════════════════════════════════════════════════════
--
-- ── What part 157 decided, and why it is being revisited ────────────────
--
-- `coach_leads.state` is `new | contacted | closed` and the column's own
-- comment says: "There is deliberately no 'joined' — this database cannot know
-- that. An enquiry carries no account, so nothing can ever link it to the
-- `coach_requests` row that person may later create, and a state the app would
-- have to guess at is a number a coach would divide by."
--
-- That reasoning is right about a STATE and wrong about an EVIDENCED MATCH,
-- and the difference is the whole of this section. A fourth state would be the
-- app deciding; a match on the email address the person typed, against the
-- account that later joined through the SAME CODE, is a fact — and where the
-- match is absent nothing is claimed, which is exactly what "cannot know that"
-- should mean.
--
-- So `state` is untouched. It stays three values, it stays the coach's own
-- workflow, and nothing here writes to it. What is added is a separate,
-- nullable, evidence-carrying pair of columns, and a screen that reads them has
-- to say WHY it believes the match — which is why `joined_via` exists rather
-- than a bare boolean.
--
-- ── The match, and the two things it will not do ────────────────────────
--
--   IT WILL NOT MATCH ON A NAME. Two people called Sarah Ahmed is not an
--   unlikely coincidence on a coach's book, it is a Tuesday. A name match would
--   mark the wrong enquiry as converted and the coach would stop advertising
--   wherever the real one came from.
--
--   IT WILL NOT MATCH ACROSS CODES. An enquiry that arrived on FLYER7 and an
--   account that joined on INSTA2 is not evidence that the flyer worked; it is
--   evidence that somebody saw both, and attributing it to the first would be
--   the double-counting `attributeLeads` in src/lib/leads.ts exists to prevent.
--   Same code, same coach, or nothing.
--
-- The email itself is compared in `auth.users`, which no app can read — that is
-- why this is a trigger and not a query the coach's phone could run. The coach
-- never receives the email address of the account; they receive the fact that
-- THEIR OWN enquiry, whose contact details they already hold, matched.
--
-- ── Why a trigger on coach_requests and not a nightly pass ──────────────
--
-- The write that creates the link is `join_by_code()`, and it is the only
-- writer that sets `coach_requests.via_code`. A trigger on it fires exactly
-- once per join, inside the transaction, with the code in hand. A nightly pass
-- would have to re-derive the same thing from a growing table forever.
--
-- ── The guards, each of which is a way this could fail a join ───────────
--
-- This fires inside `join_by_code()`. An exception here rolls the join back and
-- somebody who typed a valid code would be told it did not work. So:
--
--   · the whole body is a single UPDATE that matches zero rows when there is no
--     enquiry to mark, which is the common case and is not an error;
--   · `via_code` is nullable on `coach_requests` (a directory request has none)
--     and is guarded;
--   · the email lookup is a subquery that yields null when the account has no
--     email, and a null never equals anything, so the UPDATE matches nothing.
--
-- Deliberately NOT wrapped in `exception when others then null`, for part 158's
-- reason: that swallows a real defect silently and forever.
-- ═════════════════════════════════════════════════════════════════════════

alter table public.coach_leads
  add column if not exists joined_at   timestamptz,
  -- Which account it matched. Nullable and `on delete set null`: an account
  -- that is later deleted leaves the FACT that this enquiry converted intact,
  -- because the conversion happened and a coach's channel figures must not
  -- change retroactively when somebody closes their account. Part 189 makes the
  -- same argument about a late fee outliving the coaching.
  add column if not exists joined_user uuid references public.profiles(id) on delete set null,
  -- HOW it was matched. A bare boolean would leave every screen unable to say
  -- why it believes this, and "she joined" is a claim a coach will act on. One
  -- value today; the column exists so that adding a second kind of evidence is
  -- a new value rather than a silent widening of what the first one meant.
  add column if not exists joined_via  text;

alter table public.coach_leads drop constraint if exists coach_leads_joined_via_chk;
alter table public.coach_leads add constraint coach_leads_joined_via_chk
  check (joined_via is null or joined_via in ('email-and-code'));

-- The three move together or not at all. A `joined_at` with no evidence behind
-- it is precisely the guess part 157 refused, reachable by a hand-written
-- UPDATE, and structural is the only place to stop that.
alter table public.coach_leads drop constraint if exists coach_leads_joined_together;
alter table public.coach_leads add constraint coach_leads_joined_together
  check (
    (joined_at is null and joined_via is null)
    or (joined_at is not null and joined_via is not null)
  );

comment on column public.coach_leads.joined_at is
  'When an account matching this enquiry joined through the SAME code. NULL means no match was found, which is not the same as "they did not join" — see part 211.';
comment on column public.coach_leads.joined_user is
  'The account that matched. Nullable and survives that account being deleted: the conversion happened, and a coach''s channel figures must not change retroactively.';
comment on column public.coach_leads.joined_via is
  'What the match was made on. Never a bare boolean, because a screen has to be able to say WHY it believes an enquiry converted.';

-- The coach's Enquiries screen filters on this. Partial, so it stays small: an
-- unmatched enquiry is the common row and is not in the index at all.
create index if not exists coach_leads_joined_idx
  on public.coach_leads (trainer_id, joined_at desc)
  where joined_at is not null;

create or replace function public.lead_joined_notice()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_email text;
begin
  -- A directory request carries no code, and there is nothing to attribute.
  if new.via_code is null or btrim(new.via_code) = '' then
    return new;
  end if;

  -- Read from auth.users, which no app may. The address never leaves this
  -- function: it is compared and discarded, and what the coach learns is that
  -- an enquiry THEY ALREADY HOLD matched.
  select lower(btrim(u.email)) into v_email
    from auth.users u where u.id = new.client_id;
  if v_email is null or v_email = '' then
    return new;
  end if;

  update public.coach_leads l
     set joined_at   = now(),
         joined_user = new.client_id,
         joined_via  = 'email-and-code'
   where l.trainer_id = new.trainer_id
     -- Same code, uppercased on both sides, exactly as `attributeLeads` and
     -- `matchAds` compare it. A second, looser rule for the same six characters
     -- would let one screen say a flyer produced a client and another say it
     -- produced nothing.
     and upper(l.via_code) = upper(btrim(new.via_code))
     and lower(btrim(l.contact)) = v_email
     -- Only an enquiry that predates the join. An enquiry left AFTER somebody
     -- joined is a different act — usually a client asking a question through
     -- the same form — and marking it converted would attribute a client to a
     -- channel twice.
     and l.at <= now()
     -- Idempotent: a re-join after a declined request must not restamp the
     -- date, which is the date a coach reads as "how long the flyer took".
     and l.joined_at is null;

  return new;
end;
$function$;

comment on function public.lead_joined_notice() is
  'Marks a coach_leads row as converted when an account with the SAME email joins through the SAME code. Never matches on a name and never across codes. Reads auth.users, which no app can — the address is compared and discarded.';

drop trigger if exists coach_requests_mark_lead_joined on public.coach_requests;
create trigger coach_requests_mark_lead_joined
  after insert on public.coach_requests
  for each row execute function public.lead_joined_notice();

-- Postgres checks EXECUTE when a trigger is CREATED and not when it fires, so a
-- trigger function needs no grant to anybody (parts 51, 141, 158). Postgres
-- grants EXECUTE to PUBLIC on every new function and `anon` resolves through
-- that grant, so both are named — and `authenticated` with them, because this
-- one reads auth.users.
revoke all on function public.lead_joined_notice() from public;
revoke all on function public.lead_joined_notice() from anon;
revoke all on function public.lead_joined_notice() from authenticated;


-- ═════════════════════════════════════════════════════════════════════════
-- 2 · A code that cost nothing, and was reported as costing an unknown amount
-- ═════════════════════════════════════════════════════════════════════════
--
-- `coach_code_spend` records what a coach says a code cost. A code with no row
-- there is reported as "cost unknown" — and app/(trainer)/ad-spend.tsx builds a
-- whole section out of those, on the reasonable premise that an unpriced code is
-- a gap in the record.
--
-- For a paid channel it is. For a code a coach read out at the end of a class,
-- put in an Instagram caption, or printed on a business card they had anyway,
-- it is not a gap — the cost is nothing, and that is a real answer. Today those
-- two are indistinguishable, so a coach with four organic codes and one
-- unpriced ad reads a list of five gaps and stops looking at it, which is where
-- the one that matters was.
--
-- ── Why a flag and not a spend of zero ──────────────────────────────────
--
-- A row in `coach_code_spend` with `cents = 0` says "I have measured this
-- channel and it cost nothing this period", which is a claim about a period.
-- `is_organic` says "this channel has no cost, ever", which is a claim about
-- the channel. They behave the same in an arithmetic sum and differently in
-- every sentence: only the second can honestly be left out of "codes you have
-- not priced yet", and a zero would have to be re-entered every month to keep
-- saying so.
-- ═════════════════════════════════════════════════════════════════════════

alter table public.coach_join_codes
  add column if not exists is_organic boolean not null default false;

comment on column public.coach_join_codes.is_organic is
  'The coach has said this channel costs nothing — read out in a class, in a caption, on a card. Not the same as a spend of zero: that is a measurement of a period, this is a statement about the channel, and only this one may be left out of "codes you have not priced yet".';

-- ── And a function to set it, because the table is NOT writable ─────────
--
-- The first draft of this part said "no policy change — `coach_join_codes` is
-- already writable by its owning coach". That is wrong, and it is wrong in the
-- direction that would have shipped a button doing nothing: part 152 ends with
--
--     grant select on public.coach_join_codes to authenticated;
--     revoke insert, update, delete on public.coach_join_codes from authenticated;
--
-- Every write to this table goes through a SECURITY DEFINER function, and a
-- PostgREST update matching zero rows is not an error (src/lib/wroteRows.ts) —
-- so an app writing this column directly would have reported success and
-- changed nothing, forever. That is exactly the failure part 153 describes
-- finding on the owner's brand screen.
--
-- So: one more definer function, on the same pattern as `create_join_code` and
-- `revoke_join_code`, and it returns a boolean rather than void for the reason
-- those do — a caller has to be able to tell "not yours" from "done".

create or replace function public.set_code_organic(p_id uuid, p_organic boolean)
returns boolean
language plpgsql
security definer
-- Pinned, as every definer in this schema is: without it `coach_join_codes`
-- resolves against the CALLER's search_path, and a caller who can create a
-- schema of their own chooses which table the ownership check reads.
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me uuid := auth.uid();
  v_n  integer;
begin
  if v_me is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  -- `trainer_id = v_me` is the whole of the authorisation and it is in the
  -- WHERE rather than in a prior existence check: one statement, so there is no
  -- window between deciding and writing, and a code belonging to somebody else
  -- matches zero rows rather than raising — which tells a caller nothing about
  -- whether that id exists. The same shape `revoke_join_code` uses.
  update public.coach_join_codes
     set is_organic = coalesce(p_organic, false)
   where id = p_id and trainer_id = v_me;

  get diagnostics v_n = row_count;
  -- False rather than an exception. "That is not your code" and "that code is
  -- gone" are both answers a screen can say, and neither is worth retrying.
  return v_n > 0;
end
$function$;

revoke all on function public.set_code_organic(uuid, boolean) from public, anon;
grant  execute on function public.set_code_organic(uuid, boolean) to authenticated;

comment on function public.set_code_organic(uuid, boolean) is
  'Marks one of the caller''s own join codes as costing nothing. A function rather than a policy because part 152 revokes UPDATE on this table from authenticated outright — a direct write would have matched zero rows and reported success.';
