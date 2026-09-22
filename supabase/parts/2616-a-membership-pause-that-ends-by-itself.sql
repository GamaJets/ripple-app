-- ── A membership pause that ends by itself, and gives the days back ─────────
--
-- `memberships.status` has included `'frozen'` since part 29 and
-- `setMembershipStatus` has been able to set it for just as long. What has
-- never existed is DATES on it, and without them a freeze is three problems
-- rather than a feature:
--
--   · Somebody has to remember to lift it. Nobody does. A member comes back
--     from four weeks away and the status still says frozen.
--   · The member loses the time they paid for. A month frozen for two weeks
--     is a month that ran for two weeks, with the end date exactly where it
--     was — which is a cancellation with extra steps.
--   · Nothing can be arranged in advance. "I am away from the 12th" has to be
--     actioned ON the 12th, by a person, at a desk.
--
-- Two nullable columns, and null means what it always means here: nobody has
-- said. A membership with no dates is not one that was never paused and not
-- one that is paused for ever — src/lib/membershipFreeze.ts keeps 'none' and
-- 'unreadable' apart precisely because the difference is somebody's access to
-- a building.
--
-- ── why the end date is NOT recomputed here ─────────────────────────────────
--
-- `thawedEndsOn` in that module moves the end date by the frozen days, and it
-- is deliberately not a trigger on this table. A trigger would rewrite
-- `ends_on` the moment an owner typed a date, and then rewrite it again if
-- they corrected the range — each time from the ALREADY-MOVED value, so a
-- corrected pause would compound instead of replace. The end date is a fact
-- somebody sold; it moves when the owner accepts the new one, on the screen,
-- once.
--
-- ── the status is still the status ──────────────────────────────────────────
--
-- Nothing here sets `status = 'frozen'`. The door reads the status, and a
-- membership whose pause has started but whose status still says active is a
-- member who can still get in — which is the owner's call to make on the day,
-- not a thing a date column should do to somebody silently at midnight. The
-- app shows both and says when they disagree.

alter table public.memberships add column if not exists frozen_from date;
alter table public.memberships add column if not exists frozen_to date;

comment on column public.memberships.frozen_from is
  'First day of a pause, inclusive. NULL means no pause is recorded — which is not the same as a pause that could not be read.';
comment on column public.memberships.frozen_to is
  'Last day of a pause, inclusive: a pause from the 12th to the 12th is one day the member could not train.';

-- A backwards range is not a pause, it is a typo, and guessing which end was
-- meant is how somebody loses a month. Refused at the write so a value that got
-- past a screen is still refused. Both-null and both-set are the only shapes
-- allowed: half a range is a pause with no end, and nothing in the app can say
-- when that lifts.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'memberships_freeze_range_check') then
    alter table public.memberships add constraint memberships_freeze_range_check
      check (
        (frozen_from is null and frozen_to is null)
        or (frozen_from is not null and frozen_to is not null and frozen_to >= frozen_from)
      );
  end if;
end $$;
