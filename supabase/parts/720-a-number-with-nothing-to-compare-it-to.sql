-- ═══════════════════════════════════════════════════════════════════════════
-- A number with nothing to compare it to.
--
-- src/lib/wearables/types.ts states the rule on the field itself, and states it
-- as a rule rather than as advice:
--
--     "It is deliberately NOT comparable between people. HRV is a personal
--      baseline — 40 ms is excellent for one member and a red flag for another
--      — so every screen that prints it prints it as a trend against that
--      member's own history, never against a population norm this app does not
--      have."
--
-- One screen printed it. app/(client)/devices.tsx rendered `62 ms HRV` off
-- whatever the last sync returned, held it in React state, and kept nothing. So
-- there was no history for it to be a trend against, and there could not have
-- been: the reading was gone on the next launch, and gone for good on a second
-- handset. A member looking at 62 cannot tell whether that is their good night
-- or their worst week, which is the entire content of the measurement.
--
-- 154-a-night-a-watch-measured-outlives-the-read.sql is the same argument about
-- sleep and it ends with the same table. This is that table for HRV, written to
-- the same shape ON PURPOSE: a second, differently-reasoned way of keeping a
-- nightly device reading is how two screens come to disagree about what "last
-- night" means.
--
--
-- ── What a row here is, and what it is not ────────────────────────────────
--
-- One row is one night, for one member, as ONE NAMED DEVICE reported it.
--
--   · Never an average of two devices. A WHOOP and an Oura on the same night
--     measure different things at different times and neither recorded the
--     mean. The row carries `provider` and `source_name` because a figure whose
--     source has been dropped cannot be checked by the person it is about.
--   · Only nights that were MEASURED. A night no device recorded and a night we
--     failed to read are two different absences, and neither is a row here.
--   · No default, anywhere. `hrv_ms`, `provider` and `source_name` are NOT NULL
--     with NO DEFAULT, so a write that does not say what was measured or who
--     measured it fails with 23502 rather than filing a night nobody had.
--     150-there-is-no-default-currency.sql removed seven invented defaults for
--     this reason and this part does not add an eighth.
--
--
-- ── Milliseconds, and only milliseconds ──────────────────────────────────
--
-- The column is named for its unit because the two vendors that publish this
-- publish it in different ones and neither says so in the field name: WHOOP's
-- recovery score carries `hrv_rmssd_milli` in SECONDS (0.0621 for 62 ms) and
-- Oura's `average_hrv` is already milliseconds. The conversion belongs in the
-- edge function next to the field it reads; by the time a figure reaches this
-- table it is RMSSD in milliseconds, and the CHECK is what stops a seconds
-- reading being filed as though it were one.
--
-- The bounds are the range in which the number can be a nightly RMSSD at all.
-- Zero is refused because zero is not a measurement of a heart. 400 ms is well
-- above any adult reading and is a typo catch, not a claim about physiology.
-- A 0.0621 arriving unconverted lands below the floor and is refused, loudly,
-- rather than becoming a baseline of nothing.
--
--
-- ── Why (user_id, night) is the key ───────────────────────────────────────
--
-- There is exactly one answer per night — the one the app chose from however
-- many devices answered — and a second row for the same night would be a second
-- answer to a question that has one. The key also makes the write an UPSERT,
-- which is what lets a provider REVISE a night: WHOOP re-scores once its
-- processing catches up, and pinning the first figure Repple ever saw would
-- leave the app quietly disagreeing with the vendor's own screen for ever.
--
--
-- ── Owner-scoped, and only owner-scoped ──────────────────────────────────
--
-- No coach policy, for the reason 154 gives about device sleep: a coach who is
-- entitled to see a member's device readings sees them through the per-client
-- sharing switch (src/lib/wearables/sleepAccess.ts). A blanket read here would
-- route around that switch by the back door, from a second table.
--
-- RLS selects ROWS. It does not confer a grant, and a policy with no matching
-- GRANT is inert — the failure mode is 42501 on every read with the policy
-- looking perfectly correct in the dashboard. So the grant is explicit.
--
-- The REVOKE is not decoration and is not inherited from 154. This project's
-- default privileges in `public` grant anon=arwdm on every table `create table`
-- makes, and `anon` is the key compiled into the shipped app. Supabase grants to
-- `anon` and to `authenticated` SEPARATELY, so nothing said to `public` or to
-- `authenticated` covers it.
--
--
-- ── NOT APPLIED ──────────────────────────────────────────────────────────
--
-- This part has not been run against any database. It is in the bundle
-- (`npm run db:build`) and nowhere else; nothing has been executed and no
-- exploit run of the kind 154 records has been done against it, because there
-- is no table yet to run one against. src/ui/deviceHrv.ts reads this table
-- through a status — a missing relation comes back as 42P01, which it reports
-- as a failed read rather than as a member with no history — so the app ahead
-- of the migration shows the night's figure with no trend beside it and says
-- why, which is the same thing it shows on somebody's first night.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.device_hrv_nights (
  -- Cascade: a deleted account's readings are nobody's record. Matches
  -- device_sleep_nights, sleep_logs, habit_logs and measurements.
  user_id uuid not null references public.profiles(id) on delete cascade,

  -- The local calendar night, as `nightKey()` computes it — attributed by when
  -- the sleep it was measured across ENDED, which is the convention every
  -- vendor uses for "last night" and the one a member means when they look at
  -- today's row. A date, not a timestamp: the app has already decided which day
  -- this is, in the member's own timezone, and re-deriving it here from an
  -- instant would move nights across the date line for everybody west of
  -- Greenwich.
  night date not null,

  -- RMSSD in MILLISECONDS. See the header for why the unit is in the name and
  -- why the floor matters more than the ceiling.
  hrv_ms numeric(5,1) not null check (hrv_ms > 0 and hrv_ms <= 400),

  -- Who said so. Both NOT NULL: `provider` is the Repple registry id
  -- ('whoop', 'oura'), `source_name` is what the member is shown.
  provider text not null,
  source_name text not null,

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

comment on table public.device_hrv_nights is
  'Nightly heart-rate variability (RMSSD, milliseconds) measured by a member''s own connected devices, one row per night, kept so the figure can be shown as a trend against their own baseline rather than as a bare number. Private to the member — a coach reads device readings through the sharing switch, never here; see 154.';

alter table public.device_hrv_nights enable row level security;

drop policy if exists device_hrv_nights_own on public.device_hrv_nights;
create policy device_hrv_nights_own on public.device_hrv_nights for all
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.device_hrv_nights to authenticated;
revoke all on public.device_hrv_nights from anon;
