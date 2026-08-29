-- ─────────────────────────────────────────────────────────────────────────
-- A step goal and a sleep goal, per client.
--
-- The daily checklist offered "10,000 steps" and "Sleep 7h+" to every account
-- on the platform for as long as it existed. Both were literals in a five-
-- element array in src/ui/habits.tsx. Nobody had chosen either number, no
-- screen could change them, and nothing in the product recorded what any
-- individual client was aiming for.
--
-- Rebuilding the checklist from the client's own targets (TF-31) took those two
-- lines out, because there was no target to put in their place: no column, no
-- setting, no screen. It could not even prompt for one — "set a step goal"
-- pointing at a screen that does not exist is its own small lie. These are the
-- columns that make the prompt honest.
--
-- ── Why here and not in goal_targets ───────────────────────────────────────
--
-- `goal_targets` (part 59) holds things you REACH: a weight by a date, with a
-- baseline, a percentage and a finish. These are things you DO, every day, with
-- no end state — 10,000 steps is not 40% done on Tuesday. Same word, different
-- shape, and giving them a target_date and an achieved_at would invite every
-- screen that reads goals to compute progress toward a habit.
--
-- They sit beside `meals_per_day`, which is the same kind of thing: a standing
-- daily preference that belongs to the client.
--
-- ── Both nullable, with no default ─────────────────────────────────────────
--
-- NULL means "they have not said", and the checklist renders no row for a NULL
-- rather than a row built on a number nobody chose. Defaulting either to a
-- plausible figure would recreate the exact bug this replaces, with the added
-- problem that it would then look like the client's own answer.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.clients
  add column if not exists step_goal int;

alter table public.clients
  add column if not exists sleep_goal_hours numeric(3,1);

-- Bounds, not defaults. They exist to catch a fat-fingered entry or a unit
-- mix-up (a client typing minutes into the sleep field), and they are wide
-- enough not to argue with anybody's real target.
alter table public.clients drop constraint if exists clients_step_goal_check;
alter table public.clients add constraint clients_step_goal_check
  check (step_goal is null or (step_goal >= 500 and step_goal <= 100000));

alter table public.clients drop constraint if exists clients_sleep_goal_hours_check;
alter table public.clients add constraint clients_sleep_goal_hours_check
  check (sleep_goal_hours is null or (sleep_goal_hours >= 3 and sleep_goal_hours <= 14));

comment on column public.clients.step_goal is
  'Daily step target the client set. NULL means they have not set one — never a default.';
comment on column public.clients.sleep_goal_hours is
  'Nightly sleep target in hours. NULL means they have not set one — never a default.';
