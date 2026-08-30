-- ─────────────────────────────────────────────────────────────────────────
-- A daily water goal, per client.
--
-- `const waterGoal = 8;` — one line in src/ui/habits.tsx, and every client on
-- the platform was told to drink eight glasses of water a day. Nobody had
-- chosen the figure, no screen could change it, and it was not decoration: the
-- daily checklist stated it as a target ("Drink 8 glasses of water"), the
-- Recovery hero drew an arc against it, the home screen counted "3 of 8", and
-- readinessScore divided by it — so a client who drank four glasses was scored
-- as half-hydrated against a number invented by a developer.
--
-- Part 60 took the same line out of steps and sleep. The comment left behind on
-- the water constant said a per-client goal, when there was one, would replace
-- that line and nothing else. This is that column.
--
-- ── Why here, beside step_goal and sleep_goal_hours ────────────────────────
--
-- Same shape and the same reason: a standing daily preference belonging to the
-- client, with no end state to reach. `goal_targets` (part 59) is for things
-- you finish — a weight by a date, with a baseline and a percentage. Eight
-- glasses of water is not 62% done on a Tuesday afternoon.
--
-- ── Nullable, with no default ──────────────────────────────────────────────
--
-- NULL means "they have not said". A DEFAULT 8 would put the exact bug this
-- replaces back into the database, and make it worse than it was: in the app it
-- was at least visibly a constant, whereas a defaulted column reads to every
-- screen — and to the coach looking at their client — as the client's own
-- answer. Nothing here may invent a figure, so a NULL renders as a prompt to
-- set one and scores as untracked, never as zero glasses and never as eight.
--
-- Bounds, not a default. Wide enough not to argue with anybody's real target —
-- a large person in a hot country genuinely drinks a dozen-plus glasses — and
-- tight enough to catch a fat-fingered 80 or a client typing millilitres into a
-- field asking for glasses.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.clients
  add column if not exists water_goal_glasses int;

alter table public.clients drop constraint if exists clients_water_goal_glasses_check;
alter table public.clients add constraint clients_water_goal_glasses_check
  check (water_goal_glasses is null or (water_goal_glasses >= 1 and water_goal_glasses <= 30));

comment on column public.clients.water_goal_glasses is
  'Daily water target in glasses, set by the client. NULL means they have not set one — never a default.';
