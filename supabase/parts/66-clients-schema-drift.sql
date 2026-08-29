-- ─────────────────────────────────────────────────────────────────────────
-- Five columns production has that this repo never declared.
--
-- `clients` is defined in 01-schema.sql with twelve columns, and part 05 adds
-- `avoid`. Production carries five more that no file here creates:
--
--     injuries              text[]
--     focus_areas           text[]
--     manual_weight_kg      numeric
--     manual_body_fat_pct   numeric
--     manual_at             timestamptz
--
-- src/ui/clientData.tsx selects and updates every one of them. They were added
-- to the live database by hand at some point and the migration was never
-- written down, which is the same drift that hid `clients.mode` until part 57.
--
-- ── Why this is not merely untidy ──────────────────────────────────────────
--
-- PostgREST rejects the WHOLE statement for one unknown column. So on any
-- database built from this repo — a new environment, a staging copy, a local
-- stack — the profile write in clientData.tsx fails entirely, and it fails
-- silently in a debounced effect: the client's name, goal, diet, allergens,
-- injuries, focus areas AND their manually entered weight are all lost
-- together, having looked saved. That is the identical failure mode as the
-- 'solo' coaching mode, arrived at from the other end — a constraint refusing
-- a value there, a column not existing here.
--
-- Production is fine and always has been; the columns are there. This closes
-- the gap so the next environment does not inherit a broken profile save.
--
-- ── Types match production exactly ─────────────────────────────────────────
--
-- Read back with format_type() rather than guessed. The two numerics carry no
-- precision or scale, which is what production has — NOT the numeric(5,1) that
-- `scans.weight_kg` uses. Tightening them here would be a schema change
-- disguised as a transcription, and an unconstrained numeric already holds
-- everything the app puts in it.
-- ─────────────────────────────────────────────────────────────────────────

-- What the client tells us about themselves, alongside what a scan measures.
alter table public.clients add column if not exists injuries    text[];
alter table public.clients add column if not exists focus_areas text[];

-- A weight and body fat the client typed, for people without an InBody. Read
-- in preference to the newest scan only while `manual_at` is more recent than
-- it — see the `manualIsCurrent` logic in src/ui/clientData.tsx. That is why
-- the timestamp is a column and not a derived value: without it there is no way
-- to tell a fresh manual entry from one left over from six months ago.
alter table public.clients add column if not exists manual_weight_kg    numeric;
alter table public.clients add column if not exists manual_body_fat_pct numeric;
alter table public.clients add column if not exists manual_at           timestamptz;

comment on column public.clients.manual_at is
  'When the manual weight/body-fat were entered. The app prefers them over the newest scan only while this is more recent than that scan.';
