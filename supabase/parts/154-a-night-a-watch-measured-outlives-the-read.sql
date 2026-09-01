-- ═══════════════════════════════════════════════════════════════════════════
-- A night a watch measured, kept — so readiness stops evaporating.
--
-- 109-wellness-and-announcements.sql stored the sleep a client TYPES, and its
-- header is the argument for this file too. It ends: "for a client with no
-- watch or ring, this typed log is the ONLY sleep readiness has … an
-- evaporating log does not degrade the score, it deletes it."
--
-- The other half was left where it was. Sleep a DEVICE measured — the half the
-- product actually leads with, and the only sleep a client with a WHOOP or an
-- Oura has — is read fresh from each provider on every launch and held in React
-- state (src/ui/deviceSleep.tsx). Nothing keeps it. So the biggest number on
-- the home screen changes for reasons the member cannot see:
--
--   · A gym with no reception. The cloud providers fail, the merge reports the
--     week as UNKNOWN — correctly — and readiness, which refuses to score from
--     a night nobody recorded, goes to a dash. It was 83 an hour ago. Nothing
--     about the member's sleep changed.
--   · A WHOOP token that expired overnight. Same dash, same silence.
--   · A second handset. The client signs in on a new phone or an iPad, the
--     watch is paired to neither, and their sleep history is simply not there —
--     in an app whose whole position is that a client's record follows them to
--     any device they sign in to.
--
-- A score that moves without a cause is worse than no score, and every one of
-- those moves is invisible to the person it happens to.
--
--
-- ── What a row here is, and what it is not ────────────────────────────────
--
-- One row is one night, for one member, as ONE NAMED DEVICE reported it. That
-- constraint is src/lib/sleepMerge.ts's, not this file's, and it is repeated
-- here because a table is where it would be easiest to lose:
--
--   · Never an average. 7h04 and 6h32 do not become 6h48, because no device
--     recorded 6h48 and there is nobody left to ask about it afterwards.
--     `minutes_asleep` is always a figure `mergeSleepNight` CHOSE, and
--     `source_name` says whose it is.
--   · Only nights that were MEASURED. A night no device recorded, and a night
--     we failed to read, are two different absences and neither is a row here.
--     Writing either one down would turn "we do not know" into a stored fact,
--     which is the failure this codebase keeps finding in new shapes.
--   · No default sleep, ever. Every column that carries what the devices said
--     is NOT NULL with NO DEFAULT, so a write that does not say how long
--     somebody slept, or which device said so, fails with 23502 instead of
--     filing a night nobody had. 150-there-is-no-default-currency.sql removed
--     seven invented defaults for this reason; this part does not add an
--     eighth.
--
--
-- ── Why (user_id, night) is the key ───────────────────────────────────────
--
-- Unlike `sleep_logs`, this is not a log. `sleep_logs` is append-only because a
-- client can file two entries and the Recovery screen lists each with its own
-- quality mark. Here there is exactly one answer per night — the one the merge
-- chose from however many devices answered — and a second row for the same
-- night would be a second answer to a question that has one.
--
-- The key also makes the write an UPSERT rather than an insert, which is what
-- lets a provider REVISE a night. WHOOP re-scores a night once its processing
-- catches up; pinning the first figure Repple ever saw would leave the app
-- quietly disagreeing with the vendor's own screen forever. `withStored()` in
-- src/lib/deviceSleepStore.ts runs the same way round: a fresh measurement wins,
-- and the stored copy only fills a night the devices did not answer for today.
--
--
-- ── Owner-scoped, and only owner-scoped ──────────────────────────────────
--
-- No coach policy, for exactly the reason 109 gives for `sleep_logs`, and here
-- it is not even a judgement call: device sleep is ALREADY behind a per-client
-- sharing switch (src/lib/wearables/sleepAccess.ts). A coach who is entitled to
-- see these nights sees them through that switch. A blanket read here would
-- route around it by the back door, for the same data, from a second table.
--
-- RLS selects ROWS. It does not confer a grant, and a policy with no matching
-- GRANT is inert — the failure mode is 42501 on every read with the policy
-- looking perfectly correct in the dashboard. So the grant is explicit.
--
-- The REVOKE is not decoration and is not inherited from 109. This project's
-- default privileges in `public` were re-measured immediately before writing
-- this:
--
--     postgres, objtype r  →  anon=arwdm/postgres
--
-- INSERT, SELECT, UPDATE, DELETE, to `anon`, on every table `create table`
-- makes. `anon` is the key compiled into the shipped app. Without the revoke,
-- one correct policy would be the only thing standing between an
-- unauthenticated caller and a member's sleep — and Supabase grants to `anon`
-- and to `authenticated` SEPARATELY, so nothing that has ever been said to
-- `public` or to `authenticated` covers it.
--
--
-- ── What is deliberately NOT constrained ─────────────────────────────────
--
-- `provider` and `family` are free text. They are identifiers minted by the
-- app's own registry (src/lib/wearables/registry.ts, src/lib/sleepMerge.ts) and
-- that list grows: a CHECK naming today's six would turn "Repple added
-- Withings" into refused writes, discovered by a client noticing their sleep
-- had stopped being kept. The read side already defends itself —
-- `rowToStored()` drops a row it cannot make sense of rather than showing an
-- unattributed figure.
--
-- `basis` IS constrained, because it is not an identifier, it is a two-value
-- distinction the screen's wording depends on: "in bed" runs twenty to forty
-- minutes longer than "asleep" and the Recovery screen says so out loud.
-- `rowToStored()` reads anything that is not 'in-bed' as 'asleep', which is
-- only safe because this constraint means nothing else can be in there.
--
-- ── Proved, not assumed ──────────────────────────────────────────────────
--
-- `device_sleep_nights` did not exist before this. It was then proved by
-- EXPLOITING it: one fixture night filed for account A, and every other party
-- sent at it in turn, with `set local role` plus `request.jwt.claims` for real
-- account ids, inside a transaction that was rolled back.
--
--     owner select                1 row: AUDIT-A-WHOOP @451
--     stranger select             0 rows
--     stranger update             0 rows changed
--     stranger delete             0 rows deleted
--     stranger insert as owner    refused 42501   (the WITH CHECK)
--     anon select                 refused 42501
--     anon insert                 refused 42501
--     zero minutes                refused 23514
--     basis 'guessed'             refused 23514
--     minutes_asleep omitted      refused 23502   — there is no default night
--
-- Note lines three and four, because they are the shape this codebase keeps
-- getting caught by: the stranger's UPDATE and DELETE did not fail. They
-- matched no rows and returned no error, which over PostgREST is a 204 with
-- `error: null`. RLS selects ROWS, so a write that is refused is a write that
-- silently touches nothing — and any caller that needs to know a write LANDED
-- has to count rows rather than check for an error (src/lib/wroteRows.ts). The
-- one caller here, `disconnect()` in src/ui/wearables.tsx, deliberately does
-- not: a member with no stored nights for that device is the ordinary case, so
-- zero rows there is success, not silence.
--
-- The app's own two writes were proved the same way, as the signed-in owner,
-- in a second rolled-back transaction:
--
--     upsert 400 then 462 for one night   1 row, minutes 462
--     disconnect delete (provider whoop)  1 row removed, night gone
--
-- — so a vendor revising a night replaces it rather than filing a second
-- answer, and disconnecting a watch actually takes its readings away.
--
-- Afterwards, against the live table: 0 rows, 0 fixtures, RLS on, 1 policy, and
-- `anon` holding no grant of any kind.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.device_sleep_nights (
  -- Cascade: a deleted account's sleep is nobody's record. Matches sleep_logs,
  -- hydration_logs, habit_logs and measurements, all of which cascade here.
  user_id uuid not null references public.profiles(id) on delete cascade,

  -- The local calendar night, as `nightKey()` computes it — attributed by when
  -- the sleep ENDED, which is the convention every vendor uses for "last night"
  -- and the one a client means when they look at today's row. A date, not a
  -- timestamp: the app has already decided which day this is, in the client's
  -- own timezone, and re-deriving it here from an instant would move nights
  -- across the date line for everybody west of Greenwich.
  night date not null,

  -- How long one device says they slept. No default: a write that does not say
  -- fails, rather than filing a night nobody had.
  --
  -- The bounds are the range in which the number can be a duration of sleep at
  -- all. Zero is refused because zero is not a measurement of a sleepless
  -- night — `mergeSleepNight` already drops a zero reading for that reason, and
  -- a stored 0 would render as "0h" on the Recovery screen as a fact. 1440 is
  -- the ceiling a day has.
  minutes_asleep int not null check (minutes_asleep > 0 and minutes_asleep <= 1440),

  -- Who said so. All three, all NOT NULL, because a figure without its source
  -- cannot be checked by the person it is about — which was the whole complaint
  -- sleepMerge was written for. `source_id` is the stable identity of the
  -- recorder (a HealthKit bundle id, or the provider id); `source_name` is what
  -- the client is shown: "Ring", "Tim's Apple Watch", "WHOOP".
  provider text not null,
  source_id text not null,
  source_name text not null,

  -- Which KIND of device, so two readings that are really one measurement seen
  -- twice — Oura's own app writes its nights into Apple Health — cannot come
  -- back looking like corroboration.
  family text not null,

  -- Staged sleep, or time in bed. See the header for why this one is checked.
  basis text not null check (basis in ('asleep', 'in-bed')),

  -- When Repple stored it. A fact about our write and not about the member, so
  -- unlike everything above it may have a default.
  recorded_at timestamptz not null default now(),

  -- One answer per night. See the header: this is not a log.
  primary key (user_id, night)
);

-- The only read there is: this member's recent nights, newest first. The
-- primary key already indexes (user_id, night) ascending, which serves an
-- ORDER BY night DESC scan equally well — so there is no second index here, and
-- 145-an-index-twice-and-fifteen-policies-that-asked-per-row.sql is the reason
-- that is stated rather than left for somebody to add one.

comment on table public.device_sleep_nights is
  'Sleep measured by a client''s own connected devices, one row per night, kept so readiness survives a failed read or a new handset. Private to the client — a coach reads device sleep through the sharing switch, never here; see 153.';

alter table public.device_sleep_nights enable row level security;

drop policy if exists device_sleep_nights_own on public.device_sleep_nights;
create policy device_sleep_nights_own on public.device_sleep_nights for all
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.device_sleep_nights to authenticated;
revoke all on public.device_sleep_nights from anon;
