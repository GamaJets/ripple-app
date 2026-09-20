-- What a member ACTUALLY lifted at, as opposed to what they were told to.
--
-- ── The gap ───────────────────────────────────────────────────────────────
--
-- Tempo is prescribed end to end already. src/lib/setIntensity.ts reads it,
-- names its phases and spells it out in words; the coach's builder writes it;
-- the member's plan rows, the set table and the guided runner all draw it.
-- None of that is in question.
--
-- What has never existed is the other half. `workouts` carries `sets`, and
-- beside them `bw` (part 162) and `timed` (part 204) say something about each
-- set — whether it was bodyweight, whether it was held. Nothing says what
-- tempo it was performed at. So a coach can ask for a four-second eccentric
-- and the log cannot tell them whether they got one, which makes the
-- prescription unfalsifiable: the one number a tempo block exists to change is
-- the number nobody records.
--
-- ── Why a column and not a field on the set ───────────────────────────────
--
-- `sets` is `[[reps, kg], …]` and is read positionally in a dozen places. A
-- third element would be read as a weight by anything that did not expect it,
-- and the two existing flags already chose the other answer: a parallel array,
-- index-aligned to `sets`, absent where nobody said. `tempos` is that, for the
-- same reason, and a reader that has never heard of it is unchanged.
--
-- ── The shape, and the ambiguity it inherits ──────────────────────────────
--
-- Each entry is the notation as the member gave it, in the order this app
-- already stores a prescribed one: eccentric · pause at the bottom ·
-- concentric · pause at the top, with `X` allowed in the concentric slot for
-- "as fast as you can". src/lib/setIntensity.ts's header records at length
-- that those four digits are read in two different orders in the wild, which
-- is why `tempoMeaning` exists to say it in words rather than trusting the
-- reader. Storing the SAME order the app already prescribes in is the only
-- choice that keeps a logged tempo comparable with the one that was asked for.
--
-- Null is not 0-0-0-0. A set nobody recorded a tempo for carries nothing here,
-- and no screen may read the absence as a tempo of zero or as a tempo met.
alter table workouts add column if not exists tempos jsonb;

comment on column workouts.tempos is
  'Per-set tempo as performed, index-aligned to sets, absent where unrecorded. '
  'Order matches a prescribed tempo: eccentric, bottom pause, concentric, top '
  'pause, X allowed in the concentric slot. Null is not a tempo of zero.';
