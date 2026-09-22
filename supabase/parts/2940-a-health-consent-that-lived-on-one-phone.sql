-- ═══════════════════════════════════════════════════════════════════════════
-- A health consent that lived on one phone.
--
-- ── The defect ─────────────────────────────────────────────────────────────
--
-- The AI Coach asks a member whether it may send their health details — their
-- weight, their body fat, their skeletal muscle, their sleep, their readiness,
-- and `injurySummary(cd.injuries)`, which is "Left Knee (moderate, <the note>)"
-- — to a model. src/lib/coachShare.ts holds what that means and
-- `shareableContext` holds the lock. The ANSWER is in AsyncStorage, on the
-- handset, under 'repple.coachShare', as `{"shareHealth":true}`.
--
-- src/ui/coachShare.tsx says why, and says it honestly: "Following the account
-- would need a column and a migration, and this change is not permitted to
-- apply SQL. So it is device-local for now, and the cost is real and specific:
-- a member who reinstalls, or who signs in on a second handset, is ASKED
-- AGAIN."
--
-- That was the right trade for a change that could not touch the database. It
-- leaves three things wrong, and they are not equal:
--
--   · A REINSTALL LOSES IT. The member is asked again, by an app they already
--     answered, about their medical data. The answer it forgot may have been
--     NO, and a second asking of somebody who declined is the app behaving as
--     though the decline never happened.
--   · A SECOND HANDSET NEVER HAD IT. Somebody who declined on their phone is
--     asked afresh on their tablet, and a yes there governs a conversation the
--     phone will never show. One person, one body, two answers.
--   · THERE IS NO RECORD. The blob holds a boolean and not one word about
--     when. Nothing in this product can say when somebody agreed to send their
--     injuries to a model, which is the one question anybody would ever ask
--     about a health consent after the fact.
--
-- ── A CONSENT IS A RECORD, SO THIS IS A LOG AND NOT A FLAG ────────────────
--
-- The cheap answer is a boolean column on `clients`, or on `profiles`, moved by
-- an UPDATE. It is the wrong shape for the same reason part 84 gives about the
-- liability release and part 135 gives about a coach's own paperwork: an
-- acceptance is evidence, and evidence that can be edited in place is not
-- evidence. A column that goes true on Tuesday and false on Friday can say only
-- that it is false, and cannot say it was ever anything else.
--
-- So: one row per answer, newest wins, and withdrawing is a new row saying
-- false rather than a row being changed or removed. No UPDATE policy, no DELETE
-- policy, and both are named and dropped below rather than merely never
-- written, so that a policy added by somebody who wanted an edit button does
-- not survive a rebuild of this file.
--
-- ── `answered_at` IS NULLABLE, AND THAT IS THE POINT ──────────────────────
--
-- This is the column that makes the migration honest, so it is argued here
-- rather than left to a comment on the column.
--
-- The handset blob has never held a date. It is `{"shareHealth":true}` and
-- nothing else. So an answer carried up off a device CANNOT be dated, and the
-- date that is available — today — is not the day the person consented. It is
-- the day of the migration. Stamping it would manufacture a consent date, and
-- it would manufacture one in the direction that does damage: an answer given
-- last March would read as freshly given, on the record somebody would produce
-- if they were ever asked to show when a member agreed to this.
--
-- Hence two columns that are usually one:
--
--   answered_at   when the PERSON answered. Null when that is not known, which
--                 is exactly the carried-over case and nothing else.
--   recorded_at   when the ROW was written. Always known. Never presented to
--                 anybody as the day they consented.
--
-- `record_ai_coach_health_consent` below takes no date at all — it derives both
-- from `p_carried_over`, so there is no argument through which a caller could
-- backdate a consent or date an undated one, whether by mistake or otherwise.
--
-- ── NOBODY WHO HAS ANSWERED IS ASKED AGAIN ────────────────────────────────
--
-- The whole point of the change, and the half this file cannot do on its own.
-- There is NO BACKFILL here and there can be none: the answers are on handsets,
-- the database has never seen one, and a row invented for a member whose device
-- we cannot read would be Repple asserting a consent nobody gave — the same
-- refusal part 2790 makes about inventing a chase nobody made, on a subject
-- where it matters a great deal more.
--
-- The carrying up is therefore the app's, on the next launch, and the rule is
-- in src/lib/aiCoachConsent.ts · `resolveConsent`, which is pure and asserted:
--
--   · an answer ON THE ACCOUNT wins, in BOTH directions. The case a naive
--     merge gets wrong is an account 'no' against a stale handset 'yes' —
--     "any yes wins" would silently re-consent somebody who withdrew on
--     another device, which is the worst outcome available here;
--   · an answer on the handset with NOTHING on the account is that person's
--     answer: it is honoured, and written up with `p_carried_over => true`;
--   · a FAILED account read writes nothing at all. We do not know what is up
--     there, and a write on a guess can overwrite a withdrawal.
--
-- ── WHO MAY READ IT: THE SUBJECT, AND NOBODY ELSE ─────────────────────────
--
-- Subject-only, in the shape part 84 uses for the liability release: `client_id
-- = auth.uid()` and no second arm. Not the coach, not the gym owner, not
-- another member.
--
-- This is not a close call and it is not a gap to be filled later. The row says
-- whether a named person agreed to send their injuries and their body
-- composition to a model. It is a health-related decision about a person, of
-- the same kind as the injury document that person's coach is deliberately not
-- shown — the coach sees the extracted injury, never the file. A coach who
-- could read this would learn something about a member's attitude to their own
-- medical data that the member told the app and did not tell them, and there is
-- no coaching task that needs it.
--
-- Nothing in this part is a pattern for widening anything else. In particular
-- it is not a precedent to point at `liability_waivers`.
--
-- ── Shape of the change ────────────────────────────────────────────────────
--
-- Additive. One new table, one index, its policies, its grants, and two
-- SECURITY DEFINER functions. Nothing existing is altered, no trigger is
-- touched, no column is added to `clients` or `profiles`, and no row is
-- backfilled.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. the record ───────────────────────────────────────────────────────────

create table if not exists public.ai_coach_health_consents (
  id           uuid        primary key default gen_random_uuid(),

  -- `auth.users`, as part 84's `liability_waivers` does, and cascade: an
  -- account that is gone takes its consents with it. There is nothing here
  -- worth keeping about somebody who no longer exists, and a consent row
  -- outliving its subject is a health record with no one to own it.
  --
  -- NOT `clients`, and the reason is part 1140's, in its own words: a trainer
  -- tracking their own training uses the client screens and the client hooks,
  -- and has a profile but need not have a `clients` row. Keying on `clients`
  -- would make the consent write fail — and so, by the read-after-write the app
  -- does, make the read fail — for exactly the people who self-track. The AI
  -- Coach is one of those client screens. `auth.users` rather than `profiles`
  -- goes one step further for the same reason: it cannot be missing for a
  -- signed-in account at all, and the subject here is whoever is answering.
  client_id    uuid        not null references auth.users(id) on delete cascade,

  -- The answer. A 'no' is an ANSWER and is stored exactly as a 'yes' is —
  -- losing it is what re-asks somebody who declined.
  share_health boolean     not null,

  -- When the PERSON answered. Null only where that is genuinely unknown: an
  -- answer carried up from a handset whose stored blob never held a date. See
  -- the header; today is not a stand-in for it.
  answered_at  timestamptz,

  -- Where the answer came from. A closed set, because the whole value of the
  -- distinction is that 'device' is the one where `answered_at` is null and a
  -- reader must not take `recorded_at` for a consent date.
  source       text        not null default 'app'
               check (source in ('app', 'device')),

  -- When the ROW was written. Always known, and never the day somebody
  -- consented unless `answered_at` says the same thing.
  recorded_at  timestamptz not null default now(),

  -- The two facts have to agree, in the database and not only in the caller.
  -- An 'app' answer is given at the moment it is recorded and must carry its
  -- date; a 'device' answer was given at a moment nothing recorded and must
  -- not claim one. A function is a restriction that lives inside the one
  -- caller that respects it (part 127's stance); this is the restriction
  -- itself.
  constraint ai_coach_health_consents_dated_ck check (
    (source = 'app'    and answered_at is not null) or
    (source = 'device' and answered_at is null)
  )
);

comment on table public.ai_coach_health_consents is
  'One row per answer a member has given about sending their health details to the AI Coach. Append-only: newest row wins, withdrawing is a new row saying false, and there is no UPDATE or DELETE policy anywhere. Subject-only — a coach, a gym owner and another member can none of them read it, the same line part 84 draws around the liability release.';
comment on column public.ai_coach_health_consents.answered_at is
  'When the PERSON answered. NULL means the answer was carried up from a handset that never recorded a date — it is not a missing value to be filled in later, and recorded_at is not a substitute for it.';
comment on column public.ai_coach_health_consents.source is
  'app = answered in the app while signed in to this account, and answered_at is that moment. device = carried up from this account''s handset, where the stored answer is a bare boolean and the day it was given is not recoverable.';
comment on column public.ai_coach_health_consents.recorded_at is
  'When the row was written. A fact about the filing, not about the consent.';

-- The only read there is: this member's newest answer. `id` gives the ordering
-- a total order, so two rows written in the same instant — a carry-up racing a
-- fresh answer on a second device — resolve the same way every time rather than
-- alternating between two different consents on successive reads.
create index if not exists ai_coach_health_consents_client_idx
  on public.ai_coach_health_consents (client_id, recorded_at desc, id desc);


-- ── 2. who may read and write it ────────────────────────────────────────────
--
-- The subject, at select and insert, and nobody at anything else. There is no
-- coach arm, no owner arm and no tenant arm, and the header says why at length.
alter table public.ai_coach_health_consents enable row level security;

drop policy if exists ai_coach_health_consents_own_r on public.ai_coach_health_consents;
create policy ai_coach_health_consents_own_r on public.ai_coach_health_consents
  for select
  to authenticated
  using (client_id = (select auth.uid()));

-- Answer for yourself. `client_id = auth.uid()` in the CHECK is what makes the
-- row a record of somebody's own decision rather than an assertion by whoever
-- benefits from it — part 135's wording about acceptances, and the same
-- mechanism.
drop policy if exists ai_coach_health_consents_own_i on public.ai_coach_health_consents;
create policy ai_coach_health_consents_own_i on public.ai_coach_health_consents
  for insert
  to authenticated
  with check (client_id = (select auth.uid()));

-- Deliberately absent, and dropped by name so a later hand cannot leave one
-- behind: any UPDATE or DELETE policy, and any policy admitting somebody who is
-- not the subject.
drop policy if exists ai_coach_health_consents_own_u on public.ai_coach_health_consents;
drop policy if exists ai_coach_health_consents_own_d on public.ai_coach_health_consents;
drop policy if exists ai_coach_health_consents_coach_r on public.ai_coach_health_consents;
drop policy if exists ai_coach_health_consents_owner_r on public.ai_coach_health_consents;

-- RLS narrows a GRANT; it does not confer one. Supabase's stock default
-- privileges hand `anon` the full DML set on anything created in this schema
-- (parts 119, 120, 134), so without the revoke below this table arrives
-- reachable by the publishable key — and the missing UPDATE/DELETE policies
-- only hold while there is no grant behind them to narrow.
grant select, insert on public.ai_coach_health_consents to authenticated;
revoke update, delete on public.ai_coach_health_consents from authenticated;
revoke all on public.ai_coach_health_consents from public;
revoke all on public.ai_coach_health_consents from anon;
grant all on public.ai_coach_health_consents to service_role;


-- ── 3. the two calls the app makes ──────────────────────────────────────────

-- The member's current answer, or no row at all when they have never given one.
--
-- It takes NO ARGUMENT, for the reason part 2790's `my_coach_reviews()` gives:
-- an argument is a probe. Every row this can return was written by the caller,
-- so there is nothing to pass and nothing to guess at.
--
-- `limit 1` is a single-row lookup and not a ceiling over a set — see
-- scripts/check-sql-caps.mjs, which excludes it for exactly this shape. Nothing
-- counts these rows.
create or replace function public.my_ai_coach_health_consent()
returns table (
  share_health boolean,
  answered_at  timestamptz,
  source       text,
  recorded_at  timestamptz
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
  select c.share_health, c.answered_at, c.source, c.recorded_at
    from public.ai_coach_health_consents c
   where c.client_id = auth.uid()
   order by c.recorded_at desc, c.id desc
   limit 1;
$fn$;

revoke all on function public.my_ai_coach_health_consent() from public;
revoke all on function public.my_ai_coach_health_consent() from anon;
grant execute on function public.my_ai_coach_health_consent() to authenticated;

-- Record an answer. Returns true when a row was written, so the caller judges
-- the RETURN VALUE and never the absence of an error: a policy-filtered write
-- is zero rows and no error in PostgREST, and this codebase has been caught by
-- that shape more than once.
--
-- `p_carried_over` rather than a date, so there is no argument through which
-- anybody can backdate a consent or put today's date on an undated one. The
-- two cases are the whole of the distinction:
--
--   false — the member answered just now, in the app, signed in to this
--           account. That instant is the consent date.
--   true  — this is the answer already on their handset, being carried up
--           because the account holds none (src/lib/aiCoachConsent.ts ·
--           `resolveConsent`). The day it was first given is not recoverable
--           and is therefore not claimed.
--
-- SECURITY DEFINER with `search_path` pinned, and it still writes as the
-- caller's own row: `auth.uid()` is read here rather than taken as an argument,
-- so there is no parameter that could record an answer against somebody else.
create or replace function public.record_ai_coach_health_consent(
  p_share        boolean,
  p_carried_over boolean default false
)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  -- Not defaulted and not coerced. A null answer is not a decision about
  -- somebody's medical data, and writing one as false would record a decline
  -- nobody made.
  if p_share is null then
    raise exception 'An answer is required.' using errcode = '22004';
  end if;

  insert into public.ai_coach_health_consents (client_id, share_health, answered_at, source)
  values (
    v_uid,
    p_share,
    case when coalesce(p_carried_over, false) then null else now() end,
    case when coalesce(p_carried_over, false) then 'device' else 'app' end
  );
  return true;
end;
$fn$;

revoke all on function public.record_ai_coach_health_consent(boolean, boolean) from public;
revoke all on function public.record_ai_coach_health_consent(boolean, boolean) from anon;
grant execute on function public.record_ai_coach_health_consent(boolean, boolean) to authenticated;


-- ── 4. what this part deliberately does NOT do ──────────────────────────────
--
--   · It backfills nothing. Every existing answer is on a handset and the
--     database has never seen one; an invented row would be Repple asserting a
--     consent nobody gave.
--   · It does not delete the handset copy or stop it being written. The device
--     store stays as the source `resolveConsent` carries up from, and as the
--     answer a member keeps while an account read is failing — a decline must
--     not lapse into sending because a read timed out.
--   · It adds no way for anybody but the subject to read a row, and it is not
--     a precedent for adding one anywhere else.
--   · It does not re-ask anybody. That is the point of the whole change, and
--     the rule that delivers it is src/lib/aiCoachConsent.ts · `resolveConsent`.
