-- ═══════════════════════════════════════════════════════════════════════════
-- A session snapshotted the rate and not the money it was in.
--
-- ── The hole ──────────────────────────────────────────────────────────────
--
-- Part 33 added `sessions.rate_cents` and stated its whole purpose in the
-- comment above it:
--
--     "The rate at the moment of delivery. Snapshotted so that changing a
--      trainer's fee next month does not silently rewrite what last month
--      cost."
--
-- It snapshotted half the fact. `rate_cents` is an integer of minor units and
-- nothing on the row says minor units OF WHAT. Every reader therefore supplies
-- the unit from somewhere else, and the only somewhere else any of them has is
-- `tenants.currency` — the gym's currency TODAY.
--
-- This product lets a gym change that column, from /settings and from the
-- owner's phone. The moment it does, every session delivered before the change
-- is relabelled: /sessions, /payroll and /coach/earnings all print last year's
-- figures with this year's currency, and `recordSettlement` stamps today's code
-- onto a permanent `payroll_settlements` row an accountant reads back as fact.
-- The snapshot was built to stop exactly this and the currency change walks
-- straight through it.
--
-- ── It is the only priced thing in this schema that does not carry one ─────
--
-- Both neighbours have the column AND enforce the pairing:
--
--   · `gym_shifts` (part 196) — `rate_cents` and `currency`, with
--     `gym_shifts_priced_or_not check ((rate_cents is null) = (currency is
--     null))`. Its own comment: "an amount with no currency is not an amount".
--   · `gym_trainer_pay` (part 183) — `gym_trainer_pay_amount_has_currency
--     check (currency is not null or (session_rate_cents is null and
--     class_rate_cents is null))`.
--
-- And `payroll_settlements` (part 36) has had `currency` NOT NULL since part
-- 150. The session that the settlement is COMPUTED FROM is the one row on the
-- path with no unit on it.
--
-- ── Why `rate_currency` and not `currency` ────────────────────────────────
--
-- `gym_shifts.currency` is unambiguous because a shift has exactly one money
-- column. `sessions` is a shared table — the gym's payroll rate, a coach's own
-- client work, packs, slots and outcomes all live on it — and a bare `currency`
-- there reads as "the currency of this session", which is a thing nobody has
-- defined. `rate_currency` pairs by name with the column it is the unit of,
-- which is the whole point of the file.
--
-- ── The rows already there: left as they are, deliberately ────────────────
--
-- Every existing session with a rate has no currency, and this part backfills
-- NONE of them.
--
-- The tempting backfill is `tenants.currency`, and it is precisely the fiction
-- the column exists to prevent. A gym that has never changed its currency would
-- get the right answer; a gym that HAS changed it — the only gym for which any
-- of this matters — would have its entire PT history stamped, permanently and
-- invisibly, with the code it moved TO. A backfill cannot tell those two gyms
-- apart, and the one it is wrong about is the one that needed it. Part 196
-- refused a backfill "of a value nobody stated" for the same reason.
--
-- So a pre-part row keeps `rate_cents` with `rate_currency` null, and that is
-- an honest record of what was filed: a figure whose unit was never written
-- down. The application reads a null here as UNKNOWN, never as the gym's
-- current currency, and says so on screen rather than labelling it.
--
-- ── Why the pairing is one-directional today ──────────────────────────────
--
-- `gym_shifts` can afford `(rate_cents is null) = (currency is null)` because
-- every row in it predates both columns. This table cannot: rows with a rate
-- and no currency already exist, so the symmetric check would fail to be added
-- at all — and were it added NOT VALID, it would still be enforced on UPDATE,
-- which would make `recordSettlement`'s `settlement_id` stamp fail on every
-- legacy session and stop a coach being paid.
--
-- What is enforced here instead:
--
--   1. `rate_currency` is ISO-shaped when present. Same rule as
--      `trainers_currency_is_iso` (part 940).
--   2. A currency never appears WITHOUT a rate. That direction has no legacy
--      rows and no writer that produces it, so it can be a hard check today: a
--      currency with no amount beside it is a setting pretending to be money.
--   3. The trigger below fills the unit at the moment a rate is written, so
--      that the missing half stops accumulating from now on WITHOUT every
--      writer having to be changed first.
--
-- The symmetric check becomes addable once no un-united rate remains. It is not
-- added here on a promise.

alter table public.sessions add column if not exists rate_currency text;

alter table public.sessions drop constraint if exists sessions_rate_currency_is_iso;
alter table public.sessions add constraint sessions_rate_currency_is_iso
  check (rate_currency is null or rate_currency ~ '^[A-Z]{3}$');

alter table public.sessions drop constraint if exists sessions_rate_currency_needs_rate;
alter table public.sessions add constraint sessions_rate_currency_needs_rate
  check (rate_currency is null or rate_cents is not null);

comment on column public.sessions.rate_cents is
  'What this session was worth at the moment of delivery, in minor units. Snapshotted so a later fee change cannot rewrite what last month cost. Read it with rate_currency or not at all — the integer alone names no money.';
comment on column public.sessions.rate_currency is
  'The currency rate_cents is denominated in, as it stood when the rate was snapshotted. No default: this product is white-label — see part 150. NULL means the unit was never recorded (every row written before this part), and must be read as unknown, NEVER as the gym''s currency today.';

-- ── the unit, recorded at the same instant as the figure ──────────────────
--
-- Three screens snapshot a rate — app/(trainer)/sessions.tsx,
-- app/(trainer)/calendar.tsx and app/(trainer)/log-session.tsx — all through
-- `rateCentsToSnapshot` in src/lib/rateSnapshot.ts, which already RESOLVES the
-- currency (`snapshotCurrency`: the gym's, else the coach's own when there is
-- provably no gym) in order to ask `minorFromWhole` how many places it has, and
-- then discards it. The number reached the database and the unit it was
-- computed in did not.
--
-- This trigger records the same answer the application already computed, by the
-- same precedence, at the same moment — `tenants.currency` for the gym on the
-- session, otherwise `trainers.currency` for the coach, exactly as
-- `snapshotCurrency` does. It is NOT a guess about the past: it fires only when
-- a rate is being written NOW, and what it writes is the unit that write was
-- denominated in.
--
-- It never overrides. A caller that names the currency wins, always, because
-- the caller is the one that did the arithmetic.
--
-- It never touches a row whose rate is not moving. Stamping `settlement_id`,
-- marking an outcome, cancelling a slot — none of them re-derive the unit, so a
-- session delivered under one currency keeps it after the gym changes to
-- another. That is the entire point of a snapshot.
create or replace function public.sessions_fill_rate_currency() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  resolved text;
begin
  -- Only when a rate is arriving or changing, and only when nobody said what it
  -- is in. `is distinct from` rather than `<>` so a NULL on either side counts
  -- as a change.
  if new.rate_cents is null then
    return new;
  end if;
  if new.rate_currency is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.rate_cents is not distinct from old.rate_cents then
    return new;
  end if;

  select t.currency into resolved
    from public.tenants t
   where t.id = new.tenant_id;

  -- The coach's own column applies IF AND ONLY IF there is no gym currency —
  -- the precedence rule in src/lib/currencySource.ts, stated once more here so
  -- the two cannot drift.
  if resolved is null then
    select tr.currency into resolved
      from public.trainers tr
     where tr.id = new.trainer_id;
  end if;

  -- Still nothing? Then nothing is what is recorded. There is no default
  -- currency in this product and there is none here: an unknown unit stays
  -- unknown, and the row is honest about it.
  new.rate_currency := resolved;
  return new;
end $$;

drop trigger if exists trg_sessions_fill_rate_currency on public.sessions;
create trigger trg_sessions_fill_rate_currency
  before insert or update of rate_cents, rate_currency on public.sessions
  for each row execute function public.sessions_fill_rate_currency();

comment on function public.sessions_fill_rate_currency() is
  'Records the currency a snapshotted session rate was denominated in, at the moment the rate is written, when the writer did not name one. Mirrors snapshotCurrency() in src/lib/rateSnapshot.ts. Never overrides a stated currency and never re-derives one for a row whose rate is not moving.';
