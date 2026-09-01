-- ── Which sets were the person's own bodyweight ─────────────────────────────
--
-- One column, `workouts.bw`, aligned to `workouts.sets` exactly as `feel` is.
--
-- ── What was wrong ─────────────────────────────────────────────────────────
--
-- A set is `[reps, kg]`. Both logging screens in the client app told the member
-- in their own words that "the kg box can stay empty for a bodyweight set", and
-- an empty box stored a zero. Then everything downstream discarded it:
-- `personalRecords` opened `if (!weight || !reps) continue`, every tonnage is
-- reps × weight, and an estimated 1RM off a zero load is zero.
--
-- So pull-ups, dips, push-ups, chin-ups, pistol squats — the whole of
-- calisthenics — set no record, never appeared on the Records board, and added
-- nothing to the tonnage on Trends or History. A member who trains on rings and
-- a bar logged for months and read their own training back as an empty log. The
-- rows were here the entire time. Nothing could see them.
--
-- ── Why a column and not a stored zero ─────────────────────────────────────
--
-- Because a zero already means two different things and cannot be made to mean
-- a third. It is either "I hung off a bar and pulled" or "the load box was left
-- empty and nobody said why" — and the app's own live session runner refuses a
-- mistyped load rather than coercing it, with the comment that "a mistyped load
-- silently becoming 0 records a bodyweight set in the middle of a session".
-- That is this ambiguity, already written down in the code that ships.
--
-- `bw` is testimony instead of inference: the person said this set was their
-- own body. And once that is said, the number beside it stops meaning the load
-- and starts meaning what was ADDED to the body — 0 for a plain pull-up, 20 for
-- one with a belt, which is the second half of the same report. There was no
-- way to record the belt either.
--
-- ── Why jsonb, and why nullable ────────────────────────────────────────────
--
-- jsonb because `sets` and `feel` are jsonb and this is the third array in the
-- same alignment; a bool[] would be the only Postgres-typed array among them
-- and the app writes all three through one mapper.
--
-- NULL is the honest state for every row written before today. It does not mean
-- "none of these sets were bodyweight" — it means nobody was ever asked. The
-- app reads a missing flag as not-bodyweight, which is exactly the answer it
-- gave before this column existed, so no historical row changes meaning. A
-- DEFAULT of any kind would assert something about sets nobody described.
--
-- ── What the app does NOT store here ───────────────────────────────────────
--
-- What the person weighed. That belongs to `scans` and to the profile's manual
-- weight, both of which are dated, and a bodyweight set is priced from the
-- reading on or before the day it was done (src/lib/bodyweightSets.ts). Copying
-- a weight onto the workout row would freeze a number that is the very thing
-- the member is trying to move, and a set logged before any weigh-in would have
-- to invent one. Where there is no reading, the set has no known load and is
-- reported as a set left out of the total — never as zero, never as 70 kg.
--
-- Additive only. No existing column, constraint or policy is altered.

alter table workouts add column if not exists bw jsonb;

comment on column workouts.bw is
  'Per-set bodyweight flags, aligned to sets: bw[i] true means set i was the '
  'person''s own bodyweight, and sets[i][1] is then the ADDED load rather than '
  'the total. NULL = nobody was asked; it is not a claim that no set was '
  'bodyweight. The person''s weight itself is never copied here — see scans.';
