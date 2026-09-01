-- ═══════════════════════════════════════════════════════════════════════════
-- /close could declare a month closed and nothing anywhere remembered it.
--
-- The screen has no `closed_at`, no lock, no sign-off and no write of any kind.
-- `buildClose` recomputes the verdict from live rows on every load, so:
--
--   · A month closed on Monday is open again on Tuesday if anybody records a
--     late payment, and there is nothing on screen to say it ever was closed.
--   · /accounting re-reports the same month with different numbers, and the
--     figure the owner handed their accountant last week is unrecoverable —
--     not disputed, GONE, because it was never a stored thing.
--   · "Have we closed August?" has no answer in this database. The only
--     evidence is whatever the owner remembers.
--
-- Two things fix that and they are different things, so both are here.
--
-- ── 1. A close is a row, and it carries the figures ───────────────────────
--
-- Not a boolean. The point of closing a month is that the numbers stop moving,
-- so the numbers are SNAPSHOTTED onto the close — taken, invoiced, still owed,
-- payroll — exactly as `payroll_settlements` snapshots what was handed over
-- rather than recomputing it from today's session fee. A close that stored only
-- a date would tell you the month was signed off and not what was signed off,
-- which is the half that matters when somebody asks in March.
--
-- Every figure is nullable and the currency is nullable, because every one of
-- them is nullable ON SCREEN. A month whose invoice read failed, or a gym that
-- has not set a currency, produces a close with holes in it — and a close that
-- turned those into zeros to satisfy a NOT NULL would be storing the exact lie
-- the whole screen is built to refuse. `blockers_at_close` records what was in
-- the way if it was closed anyway, so a close over a known problem is a close
-- that says so.
--
-- ── 2. A closed month refuses to move ─────────────────────────────────────
--
-- A stored close that any later write can invalidate is a note, not a close. So
-- the trigger below refuses to write a payment or an invoice INTO a month this
-- gym has closed, and names the month and the way out in the error.
--
-- This is a real restriction and it will be hit, which is the point. The three
-- ways it fires are all things that should stop and ask:
--
--   · Saturday's cash entered a fortnight late, into a filed month.
--   · An import of last year's spreadsheet run after this year was closed.
--   · A refund dated back into a closed month rather than recorded today —
--     which is the mistake supabase/parts/180's whole argument is about.
--
-- Reopening is a deliberate act with a reason attached, recorded beside the
-- close it lifted. That is the difference between a month that reopened and a
-- month that quietly never closed.
--
-- Only `gym_payments` and `gym_invoices` are locked, and only those two. They
-- are the registers the close's headline figures come from and the ones a bulk
-- import writes. Sessions are deliberately NOT locked: a coach marking an
-- outcome late is fixing the record rather than moving money, the payroll
-- figure for a closed month is already snapshotted above, and a lock there
-- would leave a session permanently unmarkable and therefore permanently
-- unpayable.
--
-- Additive and idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.gym_month_closes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- 'YYYY-MM', the same key monthKeyOf() in src/lib/monthEnd.ts produces, so a
  -- close can be looked up from the month picker without a date conversion that
  -- could land in a neighbouring month in a gym eleven hours away.
  month_key text not null check (month_key ~ '^\d{4}-(0[1-9]|1[0-2])$'),

  closed_at timestamptz not null default now(),
  closed_by uuid references public.profiles(id) on delete set null,
  note text,

  -- The figures as they stood. Nullable throughout, because each of them is
  -- nullable on screen and a zero here would be a fabricated fact in a record
  -- somebody files against.
  taken_cents integer,
  invoiced_cents integer,
  outstanding_cents integer,
  payroll_cents integer,
  -- What all four are denominated in, or NULL because the gym had not said and
  -- the screen was showing dashes. A close labelled with a currency nobody
  -- chose is the exact failure supabase/parts/150 removed the defaults for.
  currency text,
  -- Sessions still without an outcome when this was closed. Not merged into
  -- payroll_cents: a payroll figure with unmarked sessions behind it is a floor
  -- rather than a total, and this is the number that says so.
  unmarked_sessions integer,
  -- What the screen was refusing about, verbatim, if it was closed anyway. A
  -- close over a stated blocker is a decision somebody made and it has to be
  -- readable as one.
  blockers_at_close text,

  reopened_at timestamptz,
  reopened_by uuid references public.profiles(id) on delete set null,
  reopen_reason text
);

alter table public.gym_month_closes drop constraint if exists gym_month_closes_reopen_has_why;
alter table public.gym_month_closes add constraint gym_month_closes_reopen_has_why
  check (reopened_at is null or (reopen_reason is not null and btrim(reopen_reason) <> ''));

alter table public.gym_month_closes drop constraint if exists gym_month_closes_currency_is_iso;
alter table public.gym_month_closes add constraint gym_month_closes_currency_is_iso
  check (currency is null or currency ~ '^[A-Z]{3}$');

-- At most ONE live close per gym per month, and every superseded one kept.
-- Partial rather than plain: a month closed, reopened and closed again is three
-- rows and a true history, and a plain unique index would have forced the
-- reopen to destroy the record of the first close — which is the one thing an
-- auditor would want to see.
create unique index if not exists gym_month_closes_live_uq
  on public.gym_month_closes (tenant_id, month_key)
  where reopened_at is null;

create index if not exists idx_gym_month_closes_tenant
  on public.gym_month_closes (tenant_id, month_key desc, closed_at desc);

comment on table public.gym_month_closes is
  'One row per act of closing a month, with the figures as they stood at the time. A reopen sets reopened_at and a reason rather than deleting the row, so a month that was closed and then moved is visible as exactly that. The live close for a month is the row with reopened_at null; the partial unique index guarantees there is at most one.';

alter table public.gym_month_closes enable row level security;

drop policy if exists gym_month_closes_owner on public.gym_month_closes;
create policy gym_month_closes_owner on public.gym_month_closes
  for all using (is_owner_of(tenant_id)) with check (is_owner_of(tenant_id));

revoke all on public.gym_month_closes from anon, authenticated, public;
grant select, insert, update on public.gym_month_closes to authenticated;
grant all on public.gym_month_closes to service_role;

-- DELETE is deliberately not granted. A close is a statement somebody made
-- about a month, and the way to withdraw it is a reopen with a reason — which
-- leaves the statement and the withdrawal both readable. Deleting it would
-- leave neither.

-- ── the lock ────────────────────────────────────────────────────────────────

/**
 * Refuse a write whose date falls inside a month this gym has closed.
 *
 * The date column is named in the trigger's argument rather than hardcoded,
 * because this guards two tables that carry it under two names — `taken_at` on
 * a payment, `issued_on` on an invoice — and two near-identical trigger
 * functions is how one of them eventually stops matching the other.
 *
 * `to_char(..., 'YYYY-MM')` is evaluated in the DATABASE's timezone, which for
 * this project is UTC. That is a real limitation and it is stated rather than
 * papered over: a payment taken at 1am on the 1st of September in a UTC+4 gym
 * is an August row to this trigger. The window is a few hours a month, the
 * error names the month it thinks the row is in, and the alternative — a
 * per-tenant timezone column that nothing in this product sets — would be a
 * second wrong answer with more machinery behind it.
 *
 * SECURITY DEFINER so that the lookup sees closes regardless of who is writing;
 * an import running as the owner and a payment recorded by the desk must both
 * be refused by the same rule.
 *
 * DELETE is deliberately not guarded, and the reason is that the only deleter
 * in the product is the import undo added in supabase/parts/167 — which exists
 * to take back a bulk write the owner has just made and would be useless if a
 * close could strand it. A close protects the record against a month quietly
 * GROWING after it was signed off; an undo of a run whose receipt is on screen
 * is the owner correcting themselves, deliberately, with the run in front of
 * them. Guarding it would also mean writing this function twice — once over NEW
 * and once over OLD — which is the divergence the argv above avoids.
 */
create or replace function public.gym_refuse_write_into_closed_month()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  d timestamptz;
  k text;
begin
  execute format('select ($1).%I::timestamptz', tg_argv[0]) into d using new;
  if d is null then return new; end if;
  k := to_char(d, 'YYYY-MM');
  if exists (
    select 1 from public.gym_month_closes c
     where c.tenant_id = new.tenant_id
       and c.month_key = k
       and c.reopened_at is null
  ) then
    raise exception
      'Nothing can be written into % — this gym has closed that month. Reopen it on the Close screen, with a reason, and then record this again.', k
      using errcode = 'P0001';
  end if;
  return new;
end $$;

revoke all on function public.gym_refuse_write_into_closed_month() from public, anon, authenticated;

drop trigger if exists trg_gym_payments_closed_month on public.gym_payments;
create trigger trg_gym_payments_closed_month
  before insert or update of taken_at, amount_cents on public.gym_payments
  for each row execute function public.gym_refuse_write_into_closed_month('taken_at');

drop trigger if exists trg_gym_invoices_closed_month on public.gym_invoices;
create trigger trg_gym_invoices_closed_month
  before insert or update of issued_on, amount_cents, status on public.gym_invoices
  for each row execute function public.gym_refuse_write_into_closed_month('issued_on');
