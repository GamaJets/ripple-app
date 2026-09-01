-- ── Cancelling a class, and the thing a weekly class is ─────────────────────
--
-- Two columns on `gym_classes`, for two defects that share a table and a cause:
-- the schema has no way to say a class is a member of anything, and no way to
-- say a class did not happen.
--
-- ── 1 · `status` — cancelling is not deleting ───────────────────────────────
--
-- `deleteClass` in src/lib/gymSchedule.ts is a hard DELETE behind a confirm(),
-- and it is the only way /timetable can take a class off the board. There is no
-- status column, so "Remove" is the only verb the screen has.
--
-- `class_bookings.class_id` is `on delete cascade`. So cancelling a snowed-off
-- Tuesday destroys, permanently and silently:
--
--   · every booking against it — the twelve people who wanted that hour, which
--     is the evidence that the slot is worth putting back on;
--   · every `attended_at` on those bookings — the attendance record, which is
--     what fill rate, show rate, the retention signal and class pay are all
--     computed from;
--   · the waiting list, which part B4 of the roadmap exists to surface.
--
-- And it improves the numbers. A class that ran at 3 of 20 and was then deleted
-- leaves a month whose fill rate is the average of the classes that went well.
-- The gym's own record of a bad Tuesday is the first thing destroyed by the
-- action an owner takes about a bad Tuesday.
--
-- So a cancelled class is KEPT, marked, and left in the record with its
-- bookings intact. `deleteClass` stays for the other case — a class typed in
-- wrong five minutes ago, which never happened and has nothing attached — and
-- the console now offers the two as different verbs with different words.
--
-- 'scheduled' is the default, so every one of the rows already in this table is
-- exactly what it was before this file ran.
--
-- ── 2 · `series_id` — "the Tuesday 6am Spin" is a thing ─────────────────────
--
-- `createSeries` materialises one row per week and hands back a count. That is
-- the right storage decision and the comment on `weeklyOccurrences` argues it
-- well: a gym moves one week, re-rooms another and drops the week of a public
-- holiday, and a recurrence rule cannot carry any of that without growing an
-- exceptions table that is these rows under another name.
--
-- What was missing is the other half: the rows knew nothing about each other.
-- "The Tuesday 6am Spin" could not be re-priced, re-staffed, moved or cancelled
-- as a thing — only one row at a time, by hand, for as many weeks as were
-- created. A gym that put twelve weeks up and then lost its Tuesday coach had
-- twelve edits to make and no list of which twelve rows they were.
--
-- Nullable, and null is a real answer: a one-off class belongs to no series and
-- must not be given a private series of one, because the console offers "this
-- class" and "this and every later one in the series" as different buttons and
-- a series of one makes those two verbs indistinguishable.
--
-- Additive only. Nothing here alters a policy, and both columns are covered by
-- the existing `gym_classes_owner_rw` / `gym_classes_write` policies because
-- those choose ROWS; a new column on a row somebody may already update needs no
-- new grant. (Part 151 is the file to re-read before assuming otherwise — the
-- table-wide UPDATE grant `authenticated` holds is what makes that so.)

alter table public.gym_classes
  add column if not exists status text not null default 'scheduled';

-- Added as a separate statement rather than inline, so re-running this file on
-- a database that already has the column does not fail on a duplicate
-- constraint — `add column if not exists` skips its inline check, but a bare
-- `add constraint` would not.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'gym_classes_status_check'
  ) then
    alter table public.gym_classes
      add constraint gym_classes_status_check
      check (status in ('scheduled', 'cancelled'));
  end if;
end $$;

-- When, and why. Both nullable and both meaningless on a scheduled class.
--
-- The reason is free text and it is the point of the whole feature: "instructor
-- off sick" and "nobody booked it" are the two answers an owner wants back in
-- three months, and a cancelled class with no reason is the record saying the
-- class was cancelled by nobody for nothing.
alter table public.gym_classes
  add column if not exists cancelled_at timestamptz;
alter table public.gym_classes
  add column if not exists cancel_reason text;

alter table public.gym_classes
  add column if not exists series_id uuid;

-- The two reads this enables. Both are narrow on purpose: `series_id` is only
-- ever looked up within one gym, and the timetable is already indexed on
-- (tenant_id, starts_at) by part 30.
create index if not exists idx_gym_classes_series
  on public.gym_classes(series_id, starts_at)
  where series_id is not null;

comment on column public.gym_classes.status is
  'scheduled | cancelled. A cancelled class is KEPT with its bookings and its attendance — class_bookings cascades on delete, so deleting one destroys the evidence that the slot was wanted and quietly improves the month''s fill rate.';
comment on column public.gym_classes.series_id is
  'The weekly series this occurrence belongs to, or null for a one-off. Null is a real answer and is not backfilled: a series of one makes "this class" and "this and every later one" the same button.';
