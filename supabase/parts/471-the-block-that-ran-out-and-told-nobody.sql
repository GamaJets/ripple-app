-- ─────────────────────────────────────────────────────────────────────────
-- The block that ran out and told nobody.
--
-- ── What was silent, and how that was established ────────────────────────
--
-- `src/lib/programStart.ts` defines the `'after'` phase and its own comment
-- says what it is for: "the block's last week has passed. Not an error and not
-- 'finished' … It is a prompt to write the next block."
--
-- It is computed ON DEMAND, when a screen asks. Nothing computes it when
-- nobody is looking. Grep `SERVER_WRITTEN` in src/lib/notifyInbox.ts and there
-- is no row for it; grep `assigned_programs` in supabase/parts and there is no
-- trigger on the table and no scheduled pass over it.
--
-- And nothing breaks visibly on either side. `src/lib/clientBlock.ts` keeps a
-- client on the block's LAST week rather than emptying their Train tab — which
-- is the right call, because an empty Train tab is a worse failure than a
-- repeated week — so the client goes on repeating week eight indefinitely and
-- the coach finds out when the client mentions it.
--
-- The block end date is not an inference. It is a column the coach typed
-- (`assigned_programs.starts_on`, part 205) plus the number of weeks they
-- wrote. Both are certain, which makes this the cheapest true notification in
-- the product.
--
-- ── Why a scheduled pass and not a trigger ───────────────────────────────
--
-- Nothing writes a row when a block ends. That is the whole shape of it: the
-- event is the ABSENCE of a write, the same reason part 202 made its overdue
-- and credential passes scheduled rather than triggered. There is no INSERT or
-- UPDATE to hang a trigger on — the last thing that happened to the row was the
-- coach assigning it, eight weeks ago.
--
-- ── Why no bookkeeping table, unlike part 202's overdue pass ─────────────
--
-- Because the condition is true on exactly ONE day.
--
-- `blockPosition` calls it 'after' when `floor(offset / 7) + 1 > weeks`, which
-- is `offset >= weeks * 7`. So the FIRST day of 'after' is
-- `starts_on + weeks * 7`, and this pass tests `current_date` for equality with
-- that day rather than for being past it. A daily run therefore sends exactly
-- one message per block, and `coach_overdue_notices`'s whole reason for
-- existing — a condition that stays true for weeks — does not arise.
--
-- The cost of that choice, stated rather than hidden: a day the cron does not
-- run is a block nobody is told about. That is the right trade against a second
-- state table, and it is the same trade part 202's credential pass makes on the
-- day of expiry. The coach's own screens still say 'after' the moment they
-- look, because `blockPosition` computes it and always did.
--
-- ── The week count, and the one place it could drift ────────────────────
--
-- `weekCount()` in src/lib/programBlock.ts is `programWeeks(p).length`, and
-- `programWeeks` is: no `weeks` array, or an empty one, means ONE week — the
-- week that `days` describes. Otherwise it is `weeks.length`.
--
-- Written out in SQL below as exactly that, and named here so the two can be
-- read against each other. This is a copy of a rule that lives in TypeScript
-- and copies drift, which is why it is the smallest possible one: a single
-- CASE over `jsonb_array_length`, with no notion of what a week contains. The
-- alternative — a `weeks` column on the table — would be a second opinion about
-- a programme that the builder would have to remember to keep in step, which is
-- worse.
--
-- ── The guards ───────────────────────────────────────────────────────────
--
-- This runs as a scheduled job and not inside anybody's transaction, so a
-- failure here costs the message and nothing else. The recipient is still
-- guarded, because `notifications.user_id` is `not null references
-- profiles(id)`:
--
--   `assigned_programs.coach_id`  NULLABLE (on delete set null) — GUARDED. A
--                                 programme whose coach deleted their account
--                                 has nobody to tell.
--   `assigned_programs.client_id`  the primary key, `not null`. Used only as a
--                                 NAME, and a missing profile falls back to
--                                 "A client" rather than to an empty string.
--   `starts_on`                    NULL on every assignment made before part
--                                 205 and on every one where the coach did not
--                                 choose a date. Those are `'no-date'`, not
--                                 `'after'`, and the WHERE clause excludes them
--                                 — a block with no start date has no end date
--                                 and this pass must not invent one.
--
-- ── What this must not say ───────────────────────────────────────────────
--
-- NOT "they finished it" and NOT "they completed the block". Nothing in this
-- database knows whether the client did any of it — that is what
-- `src/lib/planVsActual.ts` is for, and it refuses to say a session was
-- completed even with the log in front of it. The message states the fact that
-- is certain: the last week of the block they were given has passed, and they
-- are still being shown it.
--
-- NOT a week number for the week they are on now. `clientWeek` holds them on
-- the last week, so "they are on week 9 of 8" is a sentence the app should
-- never produce.
--
-- ── And why the client is not told ──────────────────────────────────────
--
-- Part 160's test: the recipient must be able to act AND have no other way to
-- learn. A client fails the first half completely — they cannot write
-- themselves a block, and a notification saying "your programme ran out" with
-- nothing they can do about it is an anxious message about somebody else's
-- work. When the coach writes the next block the client's Train tab changes,
-- which is the notification that means something.
--
-- Idempotent; safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.run_block_ended_notices()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_sent integer := 0;
  r      record;
begin
  for r in
    select
      a.client_id,
      a.coach_id,
      a.starts_on,
      -- `weekCount` in src/lib/programBlock.ts, written out. No `weeks` array,
      -- or an empty one, is ONE week: the week that `days` describes.
      case
        when jsonb_typeof(a.program -> 'weeks') = 'array'
         and jsonb_array_length(a.program -> 'weeks') > 0
        then jsonb_array_length(a.program -> 'weeks')
        else 1
      end as weeks
      from public.assigned_programs a
     where a.coach_id is not null
       and a.starts_on is not null
  loop
    -- The first day of `'after'`. `blockPosition` says 'after' when
    -- `floor(offset / 7) + 1 > weeks`, which is `offset >= weeks * 7`, so the
    -- boundary day is exactly this one. Equality and not `<=`: the condition
    -- being true for one day is what makes a bookkeeping table unnecessary.
    if current_date <> (r.starts_on + (r.weeks * 7)) then
      continue;
    end if;

    insert into public.notifications (user_id, title, body, icon, route)
    values (
      r.coach_id,
      'A block has run out',
      -- The name is theirs to give: the coach can already read it through
      -- `profiles_trainer_r_clients`, so this states nothing the recipient
      -- could not already see. A blank or missing name falls back to
      -- "A client", never to an empty string that would render a sentence
      -- starting with a space.
      left(
        coalesce(
          (select nullif(btrim(coalesce(p.full_name, '')), '') from public.profiles p where p.id = r.client_id),
          'A client'
        )
        || ' has reached the end of the ' || r.weeks || '-week block you gave them, which started on '
        || to_char(r.starts_on, 'DD Mon YYYY') || '.'
        || ' Nothing here says whether they did it — their Train tab is simply still showing them the last week,'
        || ' and it will go on showing it until you write the next one.',
        500),
      'dumbbell',
      '/(trainer)/builder'
    );
    v_sent := v_sent + 1;
  end loop;

  return jsonb_build_object('sent', v_sent);
end $fn$;

revoke all on function public.run_block_ended_notices() from public, anon, authenticated;

comment on function public.run_block_ended_notices() is
  'Nightly. Tells a COACH on the day a client''s assigned block reaches the end of its last week — starts_on plus weeks*7, the same boundary blockPosition() in src/lib/programStart.ts calls the first day of the ''after'' phase. Says nothing about whether the client did any of it. One message per block, because the condition is true on exactly one day.';

-- ── The schedule ─────────────────────────────────────────────────────────
create extension if not exists pg_cron;

-- Unschedule first so re-running this file does not accumulate duplicate jobs
-- each firing the same pass, exactly as parts 48, 135 and 202 do.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'block-ended-notices') then
    perform cron.unschedule('block-ended-notices');
  end if;
end $$;

-- 07:26 UTC, seven minutes after part 202's second pass and on the same morning
-- reasoning: this wakes a phone, and a coach whose notification arrives at
-- 03:17 is a coach who turns notifications off. Off the top of the hour, and
-- clear of the two passes already scheduled, so none of the three contend.
select cron.schedule(
  'block-ended-notices',
  '26 7 * * *',
  $cron$ select public.run_block_ended_notices(); $cron$
);
