-- ─────────────────────────────────────────────────────────────────────────
-- What kind of day a client INTENDS a date to be.
--
-- TF-20: "I want to plan ahead on the calendar." Everything the calendar could
-- show was retrospective — sessions a coach had opened, workouts already
-- logged. A client who knows on Sunday that Thursday is a write-off and Friday
-- is legs had nowhere to put either, so the plan they were actually following
-- existed only in their head, and their coach — whose whole job is to watch it
-- — could not see it at all.
--
-- ── The vocabulary is the one the app already had ──────────────────────────
--
-- `day_type` is not a new set of words. The three buttons on the Nutrition
-- screen (`DAY_TYPES` in app/(client)/nutrition.tsx) have been training / off /
-- rest since macro cycling shipped, each with a definition written for a tester
-- who asked what they meant, and that file says in its own comment that the
-- wording was chosen to survive exactly this change. 'off' is stored rather
-- than the prettier 'standard' for the same reason: two spellings of one day
-- type is how a day planned on the calendar stops matching the day the meal
-- plan is built for.
--
-- 'deload' is the one addition, and it is not a new concept either — the app
-- has `deloadCheck` (src/lib/training.ts), a 'deload' action on every lift
-- (src/lib/progression.ts) and a screen that tells clients when a deload week
-- is due (app/(client)/restday.tsx). Only the planning half was missing.
--
-- Refeed days and travel days were asked for and are deliberately NOT types.
-- Nothing in the product can act on either — the macro engine cycles on
-- training and rest alone — and a day type that changes nothing anywhere is a
-- sticker that looks like a setting. They go in `note` until there is something
-- for them to do, which is what the picker tells the client.
--
-- ── This table holds intentions, and nothing else ──────────────────────────
--
-- There is no `completed`, no `done` and no `actual_type`, and there must not
-- be. What happened on a day is in `workouts`, which is the client's own record
-- of what they did; a second column here saying whether the plan was kept would
-- be a claim nobody measured. A planned rest day that passes with an empty log
-- looks identical to a rest day that was taken, to a session that was never
-- logged, and to a day spent in bed with flu — see planOutcome in
-- src/lib/dayPlan.ts, which is where that distinction is kept honest.
--
-- Nor does the row take a position on the client's PROGRAM. A client marking a
-- rest day on a Tuesday their plan schedules as Push is a disagreement worth
-- surfacing to both of them, not something to be silently resolved in either
-- direction, so nothing here edits `assigned_programs` and nothing there edits
-- this.
--
-- Additive only. Nothing below alters an existing table, and every statement is
-- guarded so the file is safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.planned_days (
  -- `clients.id` IS the auth user id (01-schema.sql), which is what lets the
  -- policies below read `client_id = auth.uid()` directly, exactly as
  -- goal_targets does.
  client_id uuid not null references public.clients(id) on delete cascade,

  -- A calendar day, not an instant. `date` and never `timestamptz`: "Thursday
  -- is a travel day" is a statement about the client's own Thursday, and
  -- storing it with a time would make it start and end at different moments for
  -- a client and a coach in different zones. src/lib/localDate.ts is the two
  -- bugs this repo has already shipped by reading a bare date as UTC midnight.
  on_date date not null,

  -- The vocabulary, closed. A build that does not know a value must not guess
  -- at it, so the app filters unknown types out rather than defaulting them
  -- (isPlannedDayType, src/lib/dayPlan.ts) — and this constraint is what stops
  -- an unknown one being written in the first place.
  day_type text not null check (day_type in ('training','off','rest','deload')),

  -- The client's own words about the day, optional. This is where "flying to
  -- Berlin" and "refeed" live: it carries no behaviour anywhere in the app, and
  -- it is bounded because it is rendered on one line under a date. Empty string
  -- is not a note — the app sends NULL — so the check refuses a blank that
  -- would render as an empty second line.
  note text check (note is null or (btrim(note) <> '' and length(note) <= 140)),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One row per client per date. A client cannot intend Thursday to be two
  -- different kinds of day, and a second row would mean the calendar's answer
  -- depended on read order. It also makes re-marking a day an upsert rather
  -- than a delete-then-insert, which is one round trip and cannot half-fail.
  primary key (client_id, on_date)
);

-- The client's app reads their whole set on launch and the coach reads one
-- client's; the primary key already serves both, so there is no second index
-- to keep in step.

comment on table public.planned_days is
  'What kind of day a client intends a date to be. An intention, never a record — what happened is in workouts.';
comment on column public.planned_days.day_type is
  'The app''s own day-type vocabulary: training / off (Standard) / rest / deload. Matches DAY_TYPES in app/(client)/nutrition.tsx.';
comment on column public.planned_days.note is
  'The client''s own words. Where a travel or refeed day goes while the app has no behaviour for either. NULL means none.';

alter table public.planned_days enable row level security;

-- The client owns their plans outright — reading, marking, changing their mind
-- and unmarking. Same shape as goal_targets: what a person intends to do is
-- theirs to state.
drop policy if exists planned_days_own on public.planned_days;
create policy planned_days_own on public.planned_days for all
  using (client_id = auth.uid()) with check (client_id = auth.uid());

-- Their coach can READ them, on the same terms as workouts, measurements and
-- check-ins (`is_my_client`, 02-domain-schema.sql). That predicate rather than
-- a second hand-written EXISTS is deliberate and is the established idiom here:
-- two spellings of "my client" that drift apart is how somebody ends up able to
-- write a row they cannot then read.
--
-- Read only, and that is the point of the feature. A coach who could edit these
-- would be answering a question only the client can answer — the calendar would
-- stop showing the client what THEY planned and start showing them what they
-- have been assigned, which is what `assigned_programs` is already for. A coach
-- who disagrees with a planned rest day has the messaging thread; the app
-- surfaces the disagreement to both of them rather than settling it.
drop policy if exists planned_days_coach_read on public.planned_days;
create policy planned_days_coach_read on public.planned_days for select
  using (public.is_my_client(client_id));

-- ── updated_at ──────────────────────────────────────────────────────────────
--
-- Stamped here rather than trusted from the client, for the reason spelled out
-- in 58-coach-checklist.sql: "when did they last change their plan" is a thing
-- a coach's screen will eventually want, and a value the writer supplies is a
-- value the writer can get wrong. It matters more here than there, because an
-- upsert on a changed mark is otherwise indistinguishable from the original.
create or replace function public.touch_planned_day()
returns trigger language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists touch_planned_day_t on public.planned_days;
create trigger touch_planned_day_t
  before update on public.planned_days
  for each row execute function public.touch_planned_day();

-- Trigger functions are reachable by nobody; see 51-advisor-tidy.sql.
revoke execute on function public.touch_planned_day() from public, anon, authenticated;
