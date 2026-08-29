-- ─────────────────────────────────────────────────────────────────────────
-- What a client is working toward.
--
-- TF-28: "the only goal you can set is a target weight." Two problems, and the
-- second is the larger one.
--
-- ── It was one metric ──────────────────────────────────────────────────────
--
-- Weight is the goal the app could offer, not the goal most people have. A
-- client recomposing wants a body-fat number; somebody who has just come off a
-- long illness wants muscle back; plenty of goals are not a number at all
-- ("get through a session without my knee complaining"). Three of the four
-- kinds here are measured against a series the app already records — scans and
-- check-ins give weight, body fat and skeletal muscle — and the fourth is not
-- measured at all, deliberately.
--
-- ── It was never leaving the phone ─────────────────────────────────────────
--
-- The target lived in AsyncStorage under 'repple.goalTarget' and was written
-- nowhere else. So:
--   · a coach could not see what their client was aiming at, in an app whose
--     entire premise is that a coach is watching;
--   · a new phone, or a reinstall, silently reset it to nothing;
--   · the console had nothing to show on a client's page.
-- That is why this is a table and not another column on `clients`.
--
-- ── target_value is nullable on purpose ────────────────────────────────────
--
-- A 'custom' goal has no number, and giving it one — 0, or 1 for "done" —
-- would let every screen that computes progress compute a percentage of a
-- sentence. The check constraint below makes the two shapes mutually
-- exclusive so no code has to guess which kind it is holding.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.goal_targets (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients(id) on delete cascade,
  kind         text not null check (kind in ('weight','bodyfat','muscle','custom')),
  -- In the metric's own unit: kg for weight and muscle, percent for bodyfat.
  -- Always null for 'custom'.
  target_value numeric(6,2),
  -- The client's own words. Always null for the measured kinds, whose name is
  -- the metric — storing "Target weight" would be the app talking to itself.
  title        text,
  target_date  date,
  -- Set when they say they have got there. For a measured goal that is a claim
  -- the series can be checked against; for a custom one it is the only signal
  -- there will ever be, which is the whole reason it is a column and not a
  -- computed value.
  achieved_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- A measured goal is a number; a custom goal is a sentence. Never both,
  -- never neither.
  constraint goal_targets_shape check (
    (kind = 'custom'  and target_value is null and title is not null and btrim(title) <> '')
    or
    (kind <> 'custom' and target_value is not null and title is null)
  )
);

-- One live target per measured metric. A client aiming at two different weights
-- at once is a bug in whatever wrote the second row, not a state to render.
-- Custom goals are excluded: having several at a time is the normal case.
create unique index if not exists idx_goal_targets_one_per_metric
  on public.goal_targets (client_id, kind)
  where kind <> 'custom';

create index if not exists idx_goal_targets_client
  on public.goal_targets (client_id);

alter table public.goal_targets enable row level security;

-- The client owns their goals outright.
drop policy if exists goal_targets_own on public.goal_targets;
create policy goal_targets_own on public.goal_targets for all
  using (client_id = auth.uid()) with check (client_id = auth.uid());

-- Their coach can READ them, on the same terms as workouts, measurements and
-- check-ins (02-domain-schema.sql). Read only: a goal is the client's own
-- statement of what they want, and a coach silently editing it would make the
-- screen the client is looking at stop being theirs. A coach who disagrees has
-- the messaging thread.
drop policy if exists goal_targets_coach_read on public.goal_targets;
create policy goal_targets_coach_read on public.goal_targets for select
  using (public.is_my_client(client_id));

-- Trigger functions in this schema are not callable; see 51-advisor-tidy.sql.
-- Nothing here adds one, but the grant sweep in 40-function-grants.sql should
-- be re-run after any migration that does.
