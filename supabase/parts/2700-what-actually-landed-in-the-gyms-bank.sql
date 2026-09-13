-- ─────────────────────────────────────────────────────────────────────────
-- What actually landed in the gym's bank.
--
-- `gym_month_closes` (supabase/parts/182) records what the gym's OWN RECORDS
-- say it took: `taken_cents` is the sum of `gym_payments` in the month, filed
-- and frozen. That is the right figure to file and it is only half of a close.
-- The other half is the bank statement, and this platform had nowhere at all to
-- put it.
--
-- The consequence is not that a number is missing. It is that a DISAGREEMENT
-- has nowhere to live. Every gym on this platform has months where the register
-- and the statement differ, for reasons that are all ordinary:
--
--   · A card acquirer settles Friday's takings on Tuesday, so the last three
--     days of a month are banked in the next one.
--   · The acquirer nets its fee off the settlement, so the bank receives less
--     than the register recorded and neither figure is wrong.
--   · Saturday's cash sat in the safe for a fortnight.
--   · A chargeback reversed in a later month against a payment in this one.
--   · Somebody at the desk recorded a payment twice, and the bank — which is
--     the only party here that was actually present — recorded it once.
--
-- Before this, the owner's only way to record "the register says 42,000 and the
-- statement says 40,850" was to not record it. They checked, they found the
-- difference, they satisfied themselves about it, and the work evaporated: next
-- month the same question, the same reconciliation, no memory of the last one,
-- and no way for an accountant reading the close to know anybody had ever
-- looked. `gym_reconcile_marks` (supabase/parts/2510-ish) made exactly this
-- argument about per-row exceptions — "an exception report that never shrinks
-- is one an owner learns to scroll past" — and this is the same argument one
-- level up, about the month as a whole.
--
-- ── One row per CURRENCY, and that is the shape of the table ──────────────
--
-- Not one row per month. Repple is white-label and there is no default
-- currency anywhere in it; a gym taking euros at the door and pounds on the
-- card machine has TWO bank accounts and TWO statements, and a single
-- `landed_cents` on the month would have to be a sum across them — which is not
-- an amount of anything and would need a rate this product does not hold.
--
-- So the currency is part of the key. One statement, one account, one line.
-- `src/lib/gymBanked.ts` compares each line only against the register's
-- takings IN THAT SAME CURRENCY and refuses across them; a currency banked but
-- never taken, and a currency taken but never banked, are each reported as
-- themselves rather than being netted into a variance.
--
-- ── Why this is NOT locked by the month close ─────────────────────────────
--
-- Part 182's trigger refuses a write into a closed month, and it is attached to
-- `gym_payments`, `gym_invoices` and (part 700) `gym_costs`. It is deliberately
-- NOT attached here, and the reason is the whole point of the table: the bank
-- statement ARRIVES AFTER THE MONTH IS CLOSED. A gym closes August in the first
-- week of September and the August statement lands somewhere around the 5th.
-- A lock here would mean the only months an owner could reconcile are the ones
-- they have not filed, which is precisely backwards — and an owner who then
-- reopened a filed month just to type a bank figure would be lifting the lock
-- on the payments register to record something that is not a payment.
--
-- Recording what the bank received changes no figure the close filed. It cannot:
-- nothing in this table is read by `snapshotOf`, nothing is summed into
-- `taken_cents`, and the doctrine in src/lib/coachSettlements.ts holds — the
-- snapshot is the record and a disagreement is REPORTED, never reconciled away.
-- This is a second recorded fact beside the first, which is the only shape a
-- correction is allowed to take here.
--
-- ── What this is not ──────────────────────────────────────────────────────
--
-- It is not a bank feed. Nothing in this product talks to a bank, and this row
-- is a figure a person read off a statement and typed. `gym_banked_months.note`
-- and the screen above it both say so; a column called `landed_cents` that an
-- accountant took for a machine-verified figure would be worse than no column.
--
-- It is not a correction of the register. An owner who finds a payment recorded
-- twice fixes it in `gym_payments`, reopening the month if it is filed. This
-- table records what the bank said, and nothing else.
--
-- Additive and idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.gym_banked_months (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- 'YYYY-MM', the same key `monthKeyOf()` in src/lib/monthEnd.ts produces and
  -- the same one `gym_month_closes` is keyed on, so the two can be read
  -- together without a date conversion that could land in a neighbouring month
  -- in a gym eleven hours away.
  month_key text not null check (month_key ~ '^\d{4}-(0[1-9]|1[0-2])$'),

  -- NOT NULL and ISO-checked, unlike every currency column on
  -- `gym_month_closes`. Those are nullable because the FIGURE they label may be
  -- absent or unstateable and a close with holes in it is still a close. This
  -- one is not a label on a derived figure — it is half the identity of the
  -- row. A bank line in no currency is not a reconciliation of anything, and
  -- there is no default to fall back on: supabase/parts/150 removed the
  -- currency defaults from this schema on exactly that argument.
  currency text not null check (currency ~ '^[A-Z]{3}$'),

  -- What the statement says reached the account, in MINOR units of `currency`
  -- above, exactly as every other money column in this schema holds it.
  --
  -- SIGNED, and bigint rather than integer. Signed because a month can net
  -- negative at the bank — a quiet January against a run of refunds and a
  -- chargeback — and refusing that would make the owner round it to nought,
  -- which is a figure rather than a refusal. bigint because this is a
  -- whole-month total in minor units and a three-decimal currency multiplies
  -- the digit count by ten: a busy gym in Kuwait passes `integer`'s ceiling.
  landed_cents bigint not null,

  -- Which statement this came off, in the owner's own words — "Barclays ····4471,
  -- statement 08/2026". Free text on purpose: this product holds no bank
  -- details and must not start looking like it does.
  statement_ref text,

  -- Why the two figures differ, where the owner knows. This is the column the
  -- whole part is for: next month's reconciliation can read last month's answer
  -- instead of asking the same question again.
  note text,

  recorded_by uuid references public.profiles(id) on delete set null,
  recorded_at timestamptz not null default now(),
  -- Stamped by the trigger below on every UPDATE, so "when was this last
  -- touched" is answerable without a second table. Null until first edited.
  updated_at timestamptz
);

-- One live line per gym, per month, per currency. Changing the figure UPDATEs;
-- it does not accumulate a stack of contradictory statements that a screen
-- would then have to pick between.
--
-- Plain rather than partial, unlike `gym_month_closes_live_uq`. A close is a
-- statement somebody MADE and its history is the record; a bank line is a
-- transcription of an external document, and a typo corrected is not a change
-- of mind worth keeping. `updated_at` carries the one fact that matters.
create unique index if not exists gym_banked_months_uq
  on public.gym_banked_months (tenant_id, month_key, currency);

create index if not exists idx_gym_banked_months_tenant
  on public.gym_banked_months (tenant_id, month_key desc);

-- A `note` or a `statement_ref` of nothing but spaces is a field somebody
-- tabbed through, and it renders as an answer. Both are optional; neither may
-- be present and empty.
alter table public.gym_banked_months drop constraint if exists gym_banked_months_text_not_blank;
alter table public.gym_banked_months add constraint gym_banked_months_text_not_blank
  check (
    (note is null or btrim(note) <> '')
    and (statement_ref is null or btrim(statement_ref) <> '')
  );

comment on table public.gym_banked_months is
  'What the owner says actually reached the bank for one month, in one currency, read off a statement and typed. One row per currency because two currencies are two accounts and two statements, and a sum across them is not an amount. Deliberately NOT locked by the month close (part 182): the statement arrives after the month is filed. It corrects nothing — gym_month_closes.taken_cents stands — it records the other side so a difference has somewhere to live.';

comment on column public.gym_banked_months.landed_cents is
  'Minor units of this row''s own currency. Signed: a month can net negative at the bank against refunds and a chargeback, and refusing that would make an owner round it to nought.';
comment on column public.gym_banked_months.note is
  'Why the bank and the register differ, in the owner''s words. The reason this table exists: next month''s reconciliation reads last month''s answer instead of asking again.';
comment on column public.gym_banked_months.statement_ref is
  'Which statement this was read off, as the owner describes it. Free text: this product holds no bank details and must not look as though it does.';

alter table public.gym_banked_months enable row level security;

drop policy if exists gym_banked_months_owner on public.gym_banked_months;
create policy gym_banked_months_owner on public.gym_banked_months
  for all using (is_owner_of(tenant_id)) with check (is_owner_of(tenant_id));

-- Postgres grants EXECUTE on a new function, and the table defaults Supabase
-- ships grant on a new table, to roles nobody chose. Revoked first, then the
-- one grant this needs, by name — see supabase/parts/141 and the check:grants
-- gate for the four hours a helper spent answering strangers.
revoke all on public.gym_banked_months from anon, authenticated, public;
grant select, insert, update, delete on public.gym_banked_months to authenticated;
grant all on public.gym_banked_months to service_role;

-- DELETE **is** granted here, and it is granted for one specific reason that
-- does not apply to `gym_month_closes` (where it is deliberately withheld).
--
-- The currency is half the key, so an owner who typed a figure against EUR when
-- they meant GBP cannot fix it with an UPDATE — the row they need is a
-- different row. Without a delete, that mistake is permanent, and what it
-- leaves behind is a phantom EUR reconciliation line against a gym that has
-- never banked a euro, sitting on every future close. A wrong line on a
-- reconciliation is worse than a removed one: the removed one is absent and
-- says so, the wrong one is read.
--
-- A close is different in kind. It is a statement somebody made about a month
-- and the way to withdraw it is a reopen with a reason, which leaves the
-- statement and the withdrawal both readable.

/**
 * Stamp `updated_at`, and refuse to let a row change what it is ABOUT.
 *
 * The stamp is the small half. The large half is the three columns this
 * forbids moving: `tenant_id`, `month_key` and `currency` are the identity of
 * the reconciliation, and an UPDATE that changed any of them would silently
 * re-file a figure read off August's euro statement as though it were
 * September's pound one — past the unique index, which only sees the row it
 * lands on, and with no trace that it was ever anywhere else.
 *
 * `recorded_at` is held for the same reason: it is when the owner first
 * answered this question, and an edit is not a new answer to a new question.
 */
create or replace function public.guard_gym_banked_month()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.tenant_id is distinct from old.tenant_id
     or new.month_key is distinct from old.month_key
     or new.currency is distinct from old.currency then
    raise exception
      'A banked-month line cannot be moved to another gym, month or currency. Delete this line and record the right one.'
      using errcode = '42501';
  end if;
  new.recorded_at := old.recorded_at;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists guard_gym_banked_month_t on public.gym_banked_months;
create trigger guard_gym_banked_month_t
  before update on public.gym_banked_months
  for each row execute function public.guard_gym_banked_month();

-- Trigger functions are reachable by nobody; see 51-advisor-tidy.sql. Revoked
-- from `anon` BY NAME, because Supabase's ALTER DEFAULT PRIVILEGES grants
-- EXECUTE to anon separately from PUBLIC and revoking PUBLIC does not touch it
-- (part 141).
revoke execute on function public.guard_gym_banked_month() from public, anon, authenticated;
