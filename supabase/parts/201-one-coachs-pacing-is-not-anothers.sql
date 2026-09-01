-- ═════════════════════════════════════════════════════════════════════════
-- One coach's pacing is not another's.
--
-- ── What was measured ───────────────────────────────────────────────────
--
-- `MIN_COOLDOWN_DAYS = 7` and `MAX_COOLDOWN_DAYS = 28` in
-- src/lib/interventions.ts, and `DISMISS_FLOOR_DAYS = 30` in src/lib/nudge.ts,
-- are module constants. Every coach on this platform gets the same three
-- numbers, and there is no set of three that is right for all of them.
--
-- A coach whose clients come to a room every Tuesday knows within a week that
-- somebody has stopped, and a seven-day floor makes the Quiet Clients screen
-- slow enough to be useless to them. A coach with an online-only book, where a
-- client can be entirely fine and entirely invisible for a fortnight, finds the
-- same seven days nagging. Those are the same complaint about the same number
-- from opposite ends, and neither coach can do anything about it.
--
-- ── One column, and why it is a FLOOR ───────────────────────────────────
--
-- The obvious shape is three settings, one per constant. It is the wrong shape.
-- The per-client pacing is the part of this feature that works — paced off a
-- client's own rhythm, a fortnightly client is not chased mid-gap and a daily
-- one is not left for a month — and a coach who replaced it with a flat number
-- would be throwing that away.
--
-- What a coach is actually asking for is "never inside N days". That is a
-- FLOOR, and a floor composes with the pacing rather than deleting it:
-- `cooldownFloor` in src/lib/interventions.ts raises the bottom of the clamp
-- and leaves the per-client derivation intact above it. One number, one column.
--
-- ── The bounds, and why they refuse rather than clamp ───────────────────
--
-- A stored 0 would prompt a coach about the same person every morning, which is
-- the behaviour the whole nudge module is written to prevent; a stored 100000
-- would silence somebody for three centuries. Both are refused HERE by the
-- CHECK and again in the app by `cooldownFloor`, which falls back to the
-- module's own number rather than clamping — clamping invents a figure the
-- coach never chose and then paces their whole book off it.
--
-- NULL means "use the app's own pacing", and is not zero. Same reasoning as
-- `class_rate` on this table (part 129): a coach who cleared the box has asked
-- for the default back and a coach who typed a number has asked for theirs, and
-- those are different requests.
--
-- ── What this does NOT change ───────────────────────────────────────────
--
-- Nothing already stored. `client_nudges.muted_days` is written at the moment a
-- coach acts and read back from the ROW rather than recomputed — src/lib/
-- nudge.ts explains why at length — so changing this setting does not
-- retroactively expire or extend a mute a coach was already promised. That
-- property is what makes this setting safe to tune, and it was already there.
--
-- Idempotent; safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════

alter table public.coach_prefs
  add column if not exists nudge_cooldown_days integer;

alter table public.coach_prefs drop constraint if exists coach_prefs_nudge_cooldown_sane;
alter table public.coach_prefs add constraint coach_prefs_nudge_cooldown_sane
  check (nudge_cooldown_days is null or (nudge_cooldown_days >= 1 and nudge_cooldown_days <= 365));

comment on column public.coach_prefs.nudge_cooldown_days is
  'Shortest gap, in days, this coach will accept between two approaches to the same client. A FLOOR under the per-client pacing in src/lib/interventions.ts, never a replacement for it. NULL means use the app''s own floor, and is not zero.';

-- No policy change. `coach_prefs_self` (part 129) is `for all using (user_id =
-- auth.uid()) with check (user_id = auth.uid())` and already covers every
-- column on this table, present and future. A second policy naming this column
-- would be one more row for the planner to evaluate and would grant nothing.
