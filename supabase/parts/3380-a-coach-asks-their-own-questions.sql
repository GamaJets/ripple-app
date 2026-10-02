-- ═══════════════════════════════════════════════════════════════════════════
-- The questions a coach actually wants to ask every week.
--
-- ── What the check-in is today ───────────────────────────────────────────
--
-- Six fields, fixed since part 02: a weight, four 1-5 self-ratings (energy,
-- sleep, mood, adherence) and a free-text note. They are good defaults and
-- they are the same six for a powerlifter, a post-natal client and somebody
-- training for a marathon.
--
-- A coach whose clients are online runs their whole week on this form. The
-- things they need to ask are specific — "how did the knee feel on squats",
-- "waist measurement", "how many days did you hit your steps" — and the answer
-- today is to ask in the note field and read it back as prose, which cannot be
-- compared week to week because it is not a value.
--
-- ── The shape, and what is deliberately NOT done ─────────────────────────
--
-- The six stay. They are not replaced, not made optional, and not migrated
-- into this table. Every one of them already has history behind it, four
-- screens read them by name, and src/lib/coachCheckins.ts is built on their
-- being there. A coach's own questions are ADDED to the form, under the six.
--
-- That is the whole design decision and it is worth being explicit about why:
-- a configurable form that replaces the fixed one is a form whose history
-- stops being comparable the first time somebody edits it, and a coach who
-- deletes "mood" in week three has thrown away a column that two other screens
-- draw. Additive keeps every existing claim true.
--
-- ── A question is never deleted, only retired ────────────────────────────
--
-- `retired_at` rather than a DELETE, because an answer outlives the asking. A
-- client answered "how did the knee feel" eleven times; the twelfth week the
-- coach stops asking, and those eleven answers still have to say what they
-- were answers TO. Deleting the question would either cascade the answers away
-- or leave them pointing at nothing, and both of those lose a client's own
-- words about their own body.
--
-- ── Three kinds, and no more ─────────────────────────────────────────────
--
--   rating  1-5, the same scale the four fixed ones use, so a coach's
--           question reads beside them without a second scale to learn.
--   number  a figure with a unit the coach names — a waist in centimetres, a
--           step count. Stored as numeric and never interpreted here.
--   text    a sentence. Capped, like the note.
--
-- No multiple choice, no yes/no, no scale of ten. Each of those is a real
-- feature with its own rendering and its own comparison rules, and shipping
-- three kinds that work is better than six that half do.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.coach_checkin_questions (
  id          uuid        primary key default gen_random_uuid(),
  coach_id    uuid        not null default auth.uid() references public.profiles(id) on delete cascade,
  prompt      text        not null check (char_length(btrim(prompt)) between 1 and 120),
  kind        text        not null check (kind in ('rating', 'number', 'text')),
  -- What the figure is in, for a 'number'. The coach's own word, drawn beside
  -- the box and stored with the answer's question rather than with the answer:
  -- changing "cm" to "inches" next week would otherwise silently restate every
  -- answer already given.
  unit        text        check (unit is null or char_length(btrim(unit)) between 1 and 12),
  position    int         not null default 0,
  created_at  timestamptz not null default now(),
  -- Stopped being asked, and still the question eleven answers belong to.
  retired_at  timestamptz
);

comment on table public.coach_checkin_questions is
  'Questions a coach adds to their clients'' weekly check-in, under the six fixed fields rather than instead of them. Retired, never deleted: an answer outlives the asking, and a deleted question either takes its answers with it or leaves them pointing at nothing. See part 3380 and src/lib/checkinQuestions.ts.';

create index if not exists coach_checkin_questions_live_idx
  on public.coach_checkin_questions (coach_id, position, created_at)
  where retired_at is null;

alter table public.coach_checkin_questions enable row level security;

-- The coach owns theirs outright.
drop policy if exists coach_checkin_questions_own on public.coach_checkin_questions;
create policy coach_checkin_questions_own on public.coach_checkin_questions
  for all to authenticated
  using (coach_id = (select auth.uid()))
  with check (coach_id = (select auth.uid()));

-- Their clients read them, because they have to answer them. Live ones and
-- retired ones both: a client reading back their own history needs the
-- question a two-month-old answer was given to.
drop policy if exists coach_checkin_questions_client_read on public.coach_checkin_questions;
create policy coach_checkin_questions_client_read on public.coach_checkin_questions
  for select to authenticated
  using (exists (
    select 1 from public.clients cl
     where cl.id = (select auth.uid()) and cl.trainer_id = coach_checkin_questions.coach_id
  ));

revoke all on public.coach_checkin_questions from anon, authenticated, public;
grant select, insert, update, delete on public.coach_checkin_questions to authenticated;
grant all on public.coach_checkin_questions to service_role;

-- ── the answers ──────────────────────────────────────────────────────────
--
-- One row per question per check-in. The three value columns are nullable and
-- exactly one is used, by kind — a check constraint rather than a convention,
-- because a row carrying both a rating and a sentence is a row two screens
-- would read differently.
create table if not exists public.check_in_answers (
  id          uuid        primary key default gen_random_uuid(),
  check_in_id uuid        not null references public.check_ins(id) on delete cascade,
  question_id uuid        not null references public.coach_checkin_questions(id) on delete restrict,
  rating      int         check (rating is null or rating between 1 and 5),
  number      numeric(10,2),
  answer_text text        check (answer_text is null or char_length(answer_text) <= 1000),
  created_at  timestamptz not null default now(),
  -- One answer per question per check-in. A second submission replaces rather
  -- than stacking, through the app's own upsert.
  unique (check_in_id, question_id),
  -- Exactly one value, and a row with none is a question somebody skipped and
  -- is not written at all.
  constraint check_in_answers_one_value_chk check (
    (rating is not null)::int + (number is not null)::int + (answer_text is not null)::int = 1
  )
);

comment on table public.check_in_answers is
  'What a client answered to one of their coach''s own check-in questions. Exactly one value column is set, by the question''s kind. `on delete restrict` on the question is deliberate: a question with answers cannot be deleted, only retired.';

create index if not exists check_in_answers_checkin_idx on public.check_in_answers (check_in_id);

alter table public.check_in_answers enable row level security;

-- The client owns the answers on their own check-in.
drop policy if exists check_in_answers_own on public.check_in_answers;
create policy check_in_answers_own on public.check_in_answers
  for all to authenticated
  using (exists (
    select 1 from public.check_ins ci
     where ci.id = check_in_answers.check_in_id and ci.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.check_ins ci
     where ci.id = check_in_answers.check_in_id and ci.user_id = (select auth.uid())
  ));

-- Their coach reads them, on exactly the same predicate that admits them to
-- the check-in itself. An answer is as visible as the form it is part of and
-- stops being visible at the same moment.
drop policy if exists check_in_answers_coach_read on public.check_in_answers;
create policy check_in_answers_coach_read on public.check_in_answers
  for select to authenticated
  using (exists (
    select 1 from public.check_ins ci
     where ci.id = check_in_answers.check_in_id and public.is_my_client(ci.user_id)
  ));

revoke all on public.check_in_answers from anon, authenticated, public;
grant select, insert, update, delete on public.check_in_answers to authenticated;
grant all on public.check_in_answers to service_role;
