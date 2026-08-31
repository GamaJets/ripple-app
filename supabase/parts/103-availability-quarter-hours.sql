-- ── Weekly availability starts on the quarter hour too ─────────────────────
--
-- Part of the same correction as the calendar's own time picker, which stopped
-- offering whole hours only once it turned out an 8:30 start had to be booked
-- as 8 or 9 and the record was wrong either way. The WEEKLY template was left
-- behind: `trainer_availability` holds an hour and nothing finer, so a coach
-- who offers 6:45 every Tuesday could not say so, and the sheet in front of
-- them offered 6am–8pm in whole hours — someone's assumption about when
-- training happens, which the 5am lifter and the 10:30pm shift worker do not
-- share.
--
-- DEFAULT 0, and that is what makes this safe to apply under a running app:
-- every existing row means exactly what it meant, on the hour, and an older
-- build that never sends the column keeps inserting on the hour. Nobody's
-- schedule moves.
alter table public.trainer_availability
  add column if not exists minute smallint not null default 0
    check (minute in (0, 15, 30, 45));

comment on column public.trainer_availability.minute is
  'Minutes past the hour a weekly slot starts: 0, 15, 30 or 45. Default 0 so rows written before quarter hours existed still mean what they meant.';

-- The client dedupes a new slot against the ones it holds, and that check
-- moved from (dow, hour) to (dow, hour, minute) when minutes arrived. Said
-- here as well, because a check that only exists in the app is a check that
-- two of the coach's devices can race past — and a duplicated weekly slot
-- generates the same open session twice, which is then two things a client can
-- book for one hour of one person's day.
create unique index if not exists trainer_availability_once
  on public.trainer_availability (trainer_id, dow, hour, minute);
