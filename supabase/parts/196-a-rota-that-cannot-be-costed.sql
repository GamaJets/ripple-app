-- ── What the floor costs to staff ───────────────────────────────────────────
--
-- `gym_shifts` (part 43) records who is rostered and for how long, and nothing
-- about what that hour is worth. So neither surface can answer the question an
-- owner asks before they add a Saturday: what does it cost to have somebody
-- there.
--
-- The figures that exist today are all one-to-one figures. `payroll30For` in
-- src/lib/gymTrainers.ts multiplies DELIVERED sessions by `tenants.session_fee`
-- — a per-session price for PT. Floor cover is not sessions: a trainer on the
-- desk from six until ten delivers nothing and is owed four hours. There is no
-- column anywhere in this schema for the hour they were owed for.
--
-- ── Why a rate per shift and not a rate per trainer ────────────────────────
--
-- Both are true and this is the one that can be filed. A trainer's standard
-- rate is a fact about the person and belongs on a person; what a SHIFT was
-- worth is a fact about that Saturday, and it is the one that must survive a
-- rate change. A gym that raises everybody 8% in March must not have February's
-- rota silently re-priced at the new rate — the rota is what was worked and
-- what was owed, and a figure that moves when a setting moves is not a record.
--
-- This is the same reasoning `sessions.rate_cents` already follows: a
-- snapshotted rate on the row, so the ledger cannot be rewritten by a later
-- edit. A per-trainer standing rate is roadmap D2 and belongs on `trainers`;
-- when it lands it will be what the console PREFILLS this column from, not what
-- replaces it.
--
-- ── The currency ───────────────────────────────────────────────────────────
--
-- Nullable, with no default, and read together with the amount or not at all.
--
-- Part 150 removed the default from all seven money columns in this schema and
-- says why at length: this product is white-label, six of those columns invented
-- dirhams and the seventh invented lower-case US dollars, and a London gym
-- filing a fifty-pound wage would have been shown "AED 50.00" by code written
-- specifically not to do that. Nothing here re-introduces a default.
--
-- It is NULLABLE rather than NOT NULL — the opposite of part 150's decision for
-- filed money — because the two columns arrive together and both are optional.
-- A rota is useful without any costing at all, and every row already in this
-- table has neither. A NOT NULL currency would mean either a default (refused,
-- see above) or a backfill of a value nobody stated (worse). The pairing is
-- enforced below instead, which is the thing that actually matters: an amount
-- with no currency is not an amount.

alter table public.gym_shifts
  add column if not exists rate_cents integer;
alter table public.gym_shifts
  add column if not exists currency text;

do $$
begin
  -- Non-negative. A negative shift rate is always a typo and it would subtract
  -- from the week's cost, which is the direction nobody checks.
  if not exists (select 1 from pg_constraint where conname = 'gym_shifts_rate_nonneg') then
    alter table public.gym_shifts
      add constraint gym_shifts_rate_nonneg check (rate_cents is null or rate_cents >= 0);
  end if;

  -- Both, or neither. This is the constraint that carries the whole point of
  -- the file: a rate with no currency is a number a reader supplies a currency
  -- for out of their own head, and a currency with no rate is a setting
  -- pretending to be a cost.
  if not exists (select 1 from pg_constraint where conname = 'gym_shifts_priced_or_not') then
    alter table public.gym_shifts
      add constraint gym_shifts_priced_or_not
      check ((rate_cents is null) = (currency is null));
  end if;
end $$;

comment on column public.gym_shifts.rate_cents is
  'What this shift was worth, in minor units, for its WHOLE span — not per hour. A shift is a block of committed cover and the gym agrees a figure for the block; deriving one from an hourly rate and a span would re-price a shift every time somebody edits its end time.';
comment on column public.gym_shifts.currency is
  'The currency of rate_cents. No default: this product is white-label — see part 150. Null exactly when rate_cents is null, enforced by gym_shifts_priced_or_not.';
