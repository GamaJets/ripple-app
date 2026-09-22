-- ─────────────────────────────────────────────────────────────────────────
-- Whether they signed is not what they signed.
--
-- A deliberate, reviewed narrowing of the boundary part 84 drew. Read the whole
-- of this header before you touch any of it: a future reader has to be able to
-- tell that this was decided, by a named person, against a refusal that was
-- correct — and not that somebody widened a legal record because a screen
-- looked empty.
--
-- ── What part 84 said ─────────────────────────────────────────────────────
--
-- `liability_waivers` has exactly one read policy, `liability_waivers_own_r`,
-- and part 84 gives the reason in its own words:
--
--     "Read your own. A coach or owner has no business reading it through the
--      app; it is a legal record, not roster data."
--
-- Two other places in this repository were built ON that sentence and cite it:
--
--   · supabase/parts/159 §6 made the "a liability release was signed"
--     notification deliberately ROUTELESS — it opens no screen — because
--     "there is nowhere to send them", quoting part 84 verbatim;
--   · app/(trainer)/documents.tsx:9 tells the coach the platform release is
--     "deliberately unreadable to the coach — correctly, because it is the
--     client's legal record and not roster data".
--
-- A lane asked to build backlog item Coach #34 ("show whether a client has
-- signed the release, and which version") REFUSED it on exactly that ground,
-- and the refusal was right on the argument it made. Part 84 is about the
-- DOCUMENT. A document somebody signs about their own body, their own health
-- and their own risk is theirs; a coach reading it through the app is reading
-- a legal instrument they are not a party to, at their leisure, over the
-- roster. Nothing below disturbs that.
--
-- ── What was wrong with it anyway ─────────────────────────────────────────
--
-- "Has this person signed" is a different question from "what does their
-- signed document say", and part 84's argument is only about the second one. A
-- coach who takes somebody through a first session without knowing whether a
-- release exists is carrying a liability they cannot see, and cannot act on:
-- the one thing they would do about it — ask the person to sign before they
-- start — is precisely the thing the closed door prevents. The routeless
-- notification in part 159 is the same defect in its most visible form: the
-- app tells the coach a release was signed and then refuses to let them
-- confirm it.
--
-- ── Who decided, and exactly what they approved ───────────────────────────
--
-- The owner of this product reviewed that refusal on 13 September 2026 and
-- reversed it, narrowly. His ruling, in full:
--
--     "Approve, but narrowly — status only: signed yes/no and which version,
--      never the body, the signature or the date of birth. Written as an
--      explicit column-limited policy rather than a SECURITY DEFINER function,
--      so it can be audited later."
--
-- So the widening is two facts and no more: a row exists for this person, and
-- the version string it names. That is the whole of it.
--
-- ── What remains refused, stated so nobody has to infer it ────────────────
--
--   · THE DOCUMENT BODY REMAINS UNREADABLE TO EVERY COACH AND EVERY OWNER.
--     The wording somebody agreed to lives in src/lib/waiver.ts behind
--     `WAIVER_VERSION`, and the record of their agreement to it lives in
--     `liability_waivers`. No coach may read that table. This part adds no
--     policy to it, drops none, and changes none of its grants.
--   · `accepted_at` — WHEN they signed — is refused. It is a status column by
--     any reasonable reading and it is still refused, because the ruling said
--     "signed yes/no and which version" and a date nobody asked for is the
--     first step of a log of somebody's movements through the app. A coach who
--     genuinely needs the date has a person standing in front of them to ask.
--   · `released_liability` and `physician_ack` are refused, and would carry
--     nothing anyway: part 84's `liability_waivers_both_given` check makes
--     both of them true on every row that exists.
--   · A GYM OWNER is not widened. The ruling is about a coach training a named
--     person; an owner is not that, and `is_owner_of()` appears nowhere below.
--   · A coach who is NO LONGER this person's coach sees nothing, because the
--     policy resolves through `is_my_client()` — `clients.trainer_id` as it is
--     right now — exactly like every other coach-side read in this schema.
--
-- The body, the signature and the date of birth the ruling names are worth one
-- more sentence, because `liability_waivers` holds none of them: it is
-- (user_id, version, released_liability, physician_ack, accepted_at) and
-- nothing else. Free-text, signatures and dates of birth live on the GYM's
-- paperwork — `gym_agreement_signatures` (parts 185 and 520) — and on a coach's
-- own documents (part 135). This part touches neither of those and widens
-- nothing about either.
--
-- ── Why a table with a policy, and not a view ─────────────────────────────
--
-- The ruling asked for a column-limited policy rather than a SECURITY DEFINER
-- function, and said why: a definer function is the same widening through a
-- side door, and it is harder to audit later. Agreed, and there is no definer
-- function in the read path below. Getting there took ruling out both of the
-- other shapes, and the reasoning is recorded because the next person will
-- reach for them in the same order:
--
--   · A SECOND POLICY ON `liability_waivers` CANNOT BE COLUMN-LIMITED. RLS
--     restricts ROWS; column privileges restrict COLUMNS, and they are granted
--     per ROLE, not per policy. The coach and the client are the same role —
--     `authenticated` — which already holds a table-wide SELECT (part 84). So
--     a coach policy on that table would hand the coach `accepted_at` along
--     with everything else, directly over PostgREST, whatever any view above
--     it selected. There is no arrangement of grants that gives the subject
--     all five columns and their coach two.
--
--   · A VIEW CANNOT CARRY RLS. PostgreSQL has no `create policy` on a view;
--     a view is as wide as whatever runs it. `security_invoker = true` makes
--     it as wide as the reader, which lands it back on the table's own RLS and
--     on the paragraph above. Turning it off would make it a definer view —
--     the thing the ruling refused, in another costume — and this repository
--     forbids that outright: `npm run check:views` fails any view in
--     supabase/parts that does not restate `security_invoker = true`, after
--     part 2370 dropped the flag off `pending_deletions` by accident and made
--     every gym's deletion queue readable by anon.
--
-- What is left is a table whose COLUMNS ARE THE LIMIT. `liability_waiver_status`
-- holds the two facts the ruling approved and physically cannot hold a third;
-- its policy is an ordinary `create policy` that reads like every other
-- coach-side policy in this schema and is found by every tool that finds those.
-- A reviewer auditing this in 2029 reads one policy and one two-column table,
-- and the question "could a coach have got at the document" is answered by the
-- shape of the table before they read a line of SQL.
--
-- ── The one SECURITY DEFINER here is the WRITE, and that is not the widening
--
-- The mirror is maintained by an AFTER INSERT trigger on `liability_waivers`,
-- and its function is SECURITY DEFINER with a pinned `search_path`, like every
-- other trigger in this schema — the client's own session inserts the waiver
-- and has no write of any kind on the status table. That is a definer function
-- in the write path, where it copies two columns it is handed; it is not a
-- definer function in the read path, which is what the ruling was about and
-- what an auditor is looking for.
--
-- ── Why a mirror cannot drift, which is the honest objection to one ────────
--
-- A derived copy that stops matching its source is a coach reading a stale
-- answer about a legal record, so the reasons this one cannot are load-bearing:
--
--   · INSERT is the only write part 84 permits. It has no UPDATE policy and no
--     DELETE policy — "a release that can be withdrawn is not a release" — so
--     a version can never be edited out from under the mirror and a row can
--     never disappear from beneath it.
--   · TRUNCATE is revoked from every role by part 119.
--   · The trigger fires for every inserting role, service_role included.
--   · Both tables cascade from the same `auth.users` row, so an erasure takes
--     the pair together.
--
-- The backfill below is idempotent and claims nothing the source does not
-- already say.
--
-- ── For the record, this does not become an export gap ────────────────────
--
-- `src/lib/gdpr.ts` exports `liability_waivers` itself (part 84 ·
-- liability_waivers_own_r), so every fact in the mirror is already in the
-- subject's own bundle, under the table that is the actual record. The subject
-- can read their own mirror row too — see the second policy — because a record
-- kept about somebody that they cannot see is what part 2660 is about.
--
-- Additive and idempotent.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. the two facts, and no room for a third ──────────────────────────────

create table if not exists public.liability_waiver_status (
  -- `auth.users`, not `profiles`, because that is what the source references
  -- and a mirror keyed differently from its source is a mirror that can fail to
  -- find a row. Part 159 §6 makes the same point about the same column.
  user_id uuid not null references auth.users(id) on delete cascade,
  version text not null,
  -- One row per (person, version), exactly as part 84 keys its own: re-wording
  -- the release ADDS a row rather than editing what somebody agreed to, and the
  -- mirror has to be able to say they signed the old one and not the new one.
  primary key (user_id, version)
);

comment on table public.liability_waiver_status is
  'Whether somebody has signed the platform liability release, and which version — nothing else. A derived, column-limited mirror of public.liability_waivers, which stays readable only by its own subject (part 84). Approved by the owner on 13 September 2026 as a narrow, status-only reversal of that refusal: see the header of supabase/parts/2671 for what was widened, what is still refused, and why this is a table with a policy rather than a view or a SECURITY DEFINER function.';
comment on column public.liability_waiver_status.user_id is
  'The person who signed. References auth.users, like liability_waivers.user_id — a signer may be a coach or an owner and have no clients row at all.';
comment on column public.liability_waiver_status.version is
  'The version string of the wording they agreed to (src/lib/waiver.ts · WAIVER_VERSION). It identifies the wording; it is not the wording, and the wording is not readable here by anybody.';

alter table public.liability_waiver_status enable row level security;

-- ── 2. who may read it ─────────────────────────────────────────────────────

-- The subject. A record kept about somebody that the person it is about cannot
-- see is the defect part 2660 exists for, and it would be a strange one to
-- introduce in the same file that lets their coach see it.
drop policy if exists liability_waiver_status_own_r on public.liability_waiver_status;
create policy liability_waiver_status_own_r on public.liability_waiver_status
  for select using (user_id = (select auth.uid()));

-- The coach they have RIGHT NOW, and nobody else. `is_my_client()` reads
-- `clients.trainer_id` live, so a coach who has ended the coaching stops being
-- able to read this the moment the relationship ends — the same scoping, the
-- same helper and the same `(select …)` shape as every other coach-side policy
-- in this schema (part 1903: one evaluation, not one per row).
--
-- This is the whole of the widening the owner approved. It is two columns wide
-- because the table is two columns wide.
drop policy if exists liability_waiver_status_coach_r on public.liability_waiver_status;
create policy liability_waiver_status_coach_r on public.liability_waiver_status
  for select using (public.is_my_client(user_id));

-- There is no INSERT, UPDATE or DELETE policy, for anybody. The trigger in §4
-- is the only writer, and part 84's rule that nobody may alter or withdraw the
-- record after the fact has to hold for the mirror or the mirror is a way
-- around it.

-- ── 3. the grants ──────────────────────────────────────────────────────────
--
-- Supabase's ALTER DEFAULT PRIVILEGES hands `anon` and `authenticated` a full
-- set of table privileges on anything created in `public`, so the grant that
-- matters here is the one nobody wrote. Revoked from all three by name first —
-- part 820's rule: a table's privileges are stated, never inherited, because
-- RLS is the fence and a grant left sitting behind it is what a later,
-- unrelated policy turns into a door.
revoke all on public.liability_waiver_status from public, anon, authenticated;

-- SELECT only, and table-level rather than column-level on purpose: every
-- column of this table is a column the reader is entitled to, so there is
-- nothing to withhold and nothing for `npm run check:grants` §2 to find missing
-- when somebody adds a column in future — they will hit the policies above and
-- this comment first.
grant select on public.liability_waiver_status to authenticated;
grant all on public.liability_waiver_status to service_role;

-- ── 4. how a row gets here ─────────────────────────────────────────────────

/**
 * Copy the two status columns of a new waiver into the mirror.
 *
 * SECURITY DEFINER because the inserting session is the client's own and has
 * no write on the mirror — deliberately, since nobody may write it directly.
 * The definer function is therefore in the WRITE path; the read path is the two
 * policies above and contains no function at all. See the header.
 *
 * It copies; it does not decide. `new.user_id` and `new.version` are the only
 * two values it reads off the row, so there is no arrangement of the source
 * that makes this function emit anything the header did not approve — a third
 * column added to `liability_waivers` later is not silently mirrored.
 *
 * `on conflict do nothing` because the primary keys match: a re-insert of the
 * same (person, version) is the same fact, and the trigger is not the place to
 * argue about it. The backfill below relies on the same clause.
 *
 * search_path pinned, per scripts/check-definer.mjs: an unpinned definer
 * function resolves `public.liability_waiver_status` against whatever the
 * caller set, and this one runs as `postgres` with RLS off.
 */
create or replace function public.liability_waiver_mirror_status()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  insert into public.liability_waiver_status (user_id, version)
  values (new.user_id, new.version)
  on conflict (user_id, version) do nothing;
  return null;
end;
$function$;

comment on function public.liability_waiver_mirror_status() is
  'Mirrors (user_id, version) — and nothing else — from a new liability_waivers row into liability_waiver_status, which is the only surface a coach may read the fact of a signature from. See supabase/parts/2671.';

drop trigger if exists liability_waivers_mirror_status on public.liability_waivers;
create trigger liability_waivers_mirror_status
  after insert on public.liability_waivers
  for each row execute function public.liability_waiver_mirror_status();

-- A trigger function is not callable by anybody, and `anon` is revoked BY NAME
-- rather than left to `public`: part 2050's function was granted to PUBLIC by
-- Postgres the moment it was created, which in a Supabase project includes
-- anon, and it answered strangers for four hours. Part 141 §2 is the rule;
-- scripts/check-grants.mjs is what keeps it.
revoke all on function public.liability_waiver_mirror_status() from public;
revoke all on function public.liability_waiver_mirror_status() from anon;
revoke all on function public.liability_waiver_mirror_status() from authenticated;

-- ── 5. the releases already signed ─────────────────────────────────────────
--
-- Without this the widening is a promise to new clients only, and a coach would
-- read "has not signed" about everybody who signed before tonight — which is
-- the exact false sentence this whole part exists to stop being generated. It
-- claims nothing the source does not already say: two columns, copied, with the
-- same conflict clause the trigger uses so re-applying this part is a no-op.

insert into public.liability_waiver_status (user_id, version)
select w.user_id, w.version
  from public.liability_waivers w
on conflict (user_id, version) do nothing;
