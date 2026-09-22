-- ─────────────────────────────────────────────────────────────────────────
-- A cost with nothing to compare it against.
--
-- supabase/parts/700 records what a gym spent. Nothing anywhere records what it
-- MEANT to spend, so /costs can tell an owner that utilities came to 4,180 last
-- month and cannot tell them that the figure is forty per cent over what they
-- planned — which is the only form of that sentence anybody acts on. A number
-- with no comparison is a number you read and forget; the gym finds out in
-- March, from the accountant, about a year it can no longer change.
--
-- ── WHAT A BUDGET IS, AND WHAT AN ACTUAL IS ──────────────────────────────
--
-- They are not the same kind of fact and this table exists to keep them apart.
--
--   A BUDGET is a number somebody TYPED. It is an intention. Nothing checked
--   it, nothing produced it, and it is worth exactly what the thinking behind
--   it was worth.
--
--   An ACTUAL is a number the REGISTER produced — the sum of `gym_costs` rows
--   somebody entered off supplier invoices, in a month, in a category.
--
-- A variance is the difference between them, and it is only a fact when BOTH
-- sides are facts. src/lib/costBudgets.ts holds the four cases where it refuses
-- to state one at all, and each of them is a screen that would otherwise print
-- a confident number about nothing:
--
--   · No budget for that category. "4,180 spent, 0 budgeted, infinitely over"
--     is what a default of zero produces, so there is no default and no zero
--     row — the absence of a budget is the absence of a line.
--   · Nothing recorded in the category this month. A gym that has not yet
--     entered its electricity bill has not spent nothing on power. An actual of
--     zero over a month whose invoices are still in a drawer is the single
--     easiest way to tell an owner they are comfortably under budget on the day
--     they are not.
--   · The month's costs did not come back whole. A truncated or refused read is
--     a smaller actual, and a smaller actual is an under-spend.
--   · The two sides are in different currencies. A GBP budget against a EUR
--     insurance bill is two amounts of money, this product holds no rate, and
--     `sumTaken` has never added two currencies anywhere in this codebase.
--
-- ── Why it is effective-dated and not one row per month ──────────────────
--
-- A budget stored against a month key would have to be retyped twelve times a
-- year for every category, which is supabase/parts/2730's problem back again on
-- the other side of the book — and the failure mode is worse, because a month
-- nobody retyped it for shows as "no budget" rather than as an obvious blank.
--
-- So a row states an amount PER MONTH from `starts_on` onwards, and a revision
-- is a NEW row with a later `starts_on`. That is also the honest shape for the
-- question an owner asks in November: the rent budget was 2,400 until the lease
-- was renegotiated in June and 2,650 after, and a single mutable row would have
-- silently rewritten every month before June to match the number typed after
-- it. `ends_on` closes a budget the gym stopped keeping.
--
-- ── UPDATE is granted for TWO COLUMNS ONLY ───────────────────────────────
--
-- `ends_on` and `note`, enforced by the trigger at the foot of this part.
--
-- The amount, the category, the currency and the start date are what the budget
-- SAID, and a variance somebody acted on in July was computed against them.
-- Editing them in November does not correct a number, it rewrites what the gym
-- had planned — silently, after the fact, in the direction that makes the past
-- look better. Superseding is the way to change a budget and it leaves both
-- figures readable. Deleting is the way to remove one typed by mistake, and it
-- removes a plan rather than a record of money.
--
-- ── Deliberately NOT here ────────────────────────────────────────────────
--
-- No budget for INCOME, no budget for payroll and no whole-gym total.
--
-- Income would need a target against `gym_payments`, which is a different
-- question with different failure modes and no business being decided in the
-- same table. Payroll is settled in `payroll_settlements` and is already
-- /accounting's "Money out" — a budget line for it here would be compared
-- against `gym_costs`, which by part 700's own rule contains none of it, so
-- every month would read as a hundred per cent under. And a whole-gym total
-- would be a sum across categories that can be in different currencies, which
-- is the one addition src/lib/gymCosts.ts refuses under a heading in capitals.
--
-- And no variance stored anywhere. It is derived, every time, from the two
-- sides and the read status — because a stored variance is a figure that stops
-- agreeing with the ledger the moment a cost is entered or removed.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.gym_cost_budgets (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null references public.tenants(id) on delete cascade,
  -- Who planned it. `on delete set null` on part 700's reasoning: the plan
  -- outlives the manager who typed it, and a budget that vanished when somebody
  -- left would take the comparison off every month they were there for.
  created_by  uuid        references public.profiles(id) on delete set null,
  -- The SAME closed set as `gym_costs.category`, repeated for the reason part
  -- 2730 gives: there is no lookup table to point at, and the drift shows up as
  -- a budget that matches no costs rather than as a mis-filed one.
  category    text        not null check (category in (
                            'rent', 'utilities', 'staff', 'maintenance',
                            'equipment', 'insurance', 'licensing', 'marketing',
                            'software', 'stock', 'professional', 'finance',
                            'other')),
  -- What the gym plans to spend in this category in a month, in minor units.
  --
  -- `>= 0` and not `> 0`. A budget of NOTHING is a real and deliberate
  -- intention — "we are spending nothing on marketing this year" — and it is
  -- the one a gym most wants to be told it has broken. What it is not is a
  -- denominator: src/lib/costBudgets.ts states the over-spend in money and
  -- withholds the PERCENTAGE against a zero budget, because a proportion of
  -- nothing is not a number and "∞% over" is not a figure anybody can act on.
  --
  -- bigint with the ceiling in the CHECK, matching `gym_costs.amount_cents`, so
  -- a budget and the costs it is compared against can never be refused by
  -- different limits.
  amount_cents bigint     not null check (amount_cents >= 0 and amount_cents < 100000000000),
  -- NOT NULL and no default, exactly as on `gym_costs`. `tenants.currency` is
  -- nullable on purpose (part 99) and a plan with no currency on it cannot be
  -- compared with anything. Where this differs from the currency a cost was
  -- recorded in, the two are NOT converted and NOT subtracted — the screen
  -- names both and states no variance.
  currency    text        not null check (currency = upper(btrim(currency)) and length(currency) between 3 and 4),
  -- The first month this figure applies to, as a DATE — part 700's argument,
  -- unchanged: a DATE cast to timestamptz and formatted back in the same
  -- session round-trips exactly, and an instant near midnight does not. The
  -- app compares its first seven characters against a month key and never
  -- parses it.
  starts_on   date        not null,
  -- The last month it applies to, or NULL while it still does.
  ends_on     date        check (ends_on is null or ends_on >= starts_on),
  note        text        check (note is null or length(note) <= 500),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.gym_cost_budgets is
  'What a gym PLANS to spend per month, per cost category, from a given month onwards. A number somebody typed — never produced, never checked, and never the same kind of fact as the gym_costs total it is compared against. A revision is a new row with a later starts_on, so what was planned in March stays readable after the figure changes in June. No variance is stored anywhere: it is derived from the two sides and the read status every time, because a stored one stops agreeing with the ledger the moment a cost is entered.';
comment on column public.gym_cost_budgets.amount_cents is
  'Minor units, per month. Zero is allowed and is a real intention — "nothing on marketing this year" — but it is never a denominator: the over-spend against a zero budget is stated in money and the percentage is withheld.';
comment on column public.gym_cost_budgets.currency is
  'ISO 4217, uppercase, required, never defaulted. Where it differs from the currency the costs in that category were recorded in, no variance is shown at all — this product holds no exchange rate and two currencies are never subtracted.';
comment on column public.gym_cost_budgets.starts_on is
  'The first month this figure applies to. A budget is effective-dated rather than stored per month so it is not retyped twelve times a year — and so that changing it in June does not silently rewrite what the gym had planned in March.';

-- At most one budget per category can begin on any one day. Without this, two
-- rows with the same `starts_on` are a tie with no total order, and "which
-- budget applies to August" would answer differently depending on the order the
-- rows happened to come back in.
create unique index if not exists gym_cost_budgets_one_per_start
  on public.gym_cost_budgets (tenant_id, category, starts_on);

-- The read is "this gym's budgets, newest plan first".
create index if not exists gym_cost_budgets_tenant_idx
  on public.gym_cost_budgets (tenant_id, starts_on desc, id desc);

-- ── Row-level security ───────────────────────────────────────────────────
--
-- The owner, and nobody else — part 700's reasoning, which applies with more
-- force rather than less. A budget names what the gym intends to pay its
-- cleaner and its reception staff NEXT month, which is a personnel disclosure
-- the gym has not made even to the people it is about.
alter table public.gym_cost_budgets enable row level security;

drop policy if exists gym_cost_budgets_owner_read on public.gym_cost_budgets;
create policy gym_cost_budgets_owner_read on public.gym_cost_budgets
  for select
  to authenticated
  using (is_owner_of(tenant_id));

drop policy if exists gym_cost_budgets_owner_insert on public.gym_cost_budgets;
create policy gym_cost_budgets_owner_insert on public.gym_cost_budgets
  for insert
  to authenticated
  with check (is_owner_of(tenant_id));

-- Granted for `ends_on` and `note` and for nothing else; the trigger below is
-- what makes that true. See the head of this part: the amount, the category,
-- the currency and the start are what the plan SAID, and an edit to them is a
-- rewrite of a figure somebody already acted on.
drop policy if exists gym_cost_budgets_owner_update on public.gym_cost_budgets;
create policy gym_cost_budgets_owner_update on public.gym_cost_budgets
  for update
  to authenticated
  using (is_owner_of(tenant_id))
  with check (is_owner_of(tenant_id));

drop policy if exists gym_cost_budgets_owner_delete on public.gym_cost_budgets;
create policy gym_cost_budgets_owner_delete on public.gym_cost_budgets
  for delete
  to authenticated
  using (is_owner_of(tenant_id));

-- Named and dropped rather than merely never written, so a policy added by
-- somebody who wanted staff to see the budget cannot survive a rebuild.
drop policy if exists gym_cost_budgets_trainer_read on public.gym_cost_budgets;
drop policy if exists gym_cost_budgets_member_read on public.gym_cost_budgets;

-- RLS narrows a GRANT; it does not create one.
grant select, insert, update, delete on public.gym_cost_budgets to authenticated;
revoke all on public.gym_cost_budgets from anon;

-- ── What an UPDATE may actually change ───────────────────────────────────
--
-- Two columns. Everything else is the plan as it was stated, and part 2700's
-- `guard_gym_banked_month` makes the same argument for the identity of a
-- reconciliation line: a row that can be moved is a row whose past is not a
-- record of anything.
--
-- The refusal is a 42501 with a sentence in it rather than a silent no-op,
-- because a screen that sends an ignored UPDATE and checks only `error` would
-- tell an owner their budget had changed while the old figure is still the one
-- every variance is computed against.
create or replace function public.guard_gym_cost_budget()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.tenant_id is distinct from old.tenant_id then
    raise exception
      'A budget cannot be moved to another gym. Delete it and set one on the gym it belongs to.'
      using errcode = '42501';
  end if;
  if new.category is distinct from old.category
     or new.amount_cents is distinct from old.amount_cents
     or new.currency is distinct from old.currency
     or new.starts_on is distinct from old.starts_on then
    raise exception
      'What a budget says cannot be edited, only superseded. Set a new budget for this category starting from the month the figure changes — that keeps what you planned before it readable. Delete this one only if it was typed by mistake.'
      using errcode = '42501';
  end if;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists guard_gym_cost_budget_t on public.gym_cost_budgets;
create trigger guard_gym_cost_budget_t
  before update on public.gym_cost_budgets
  for each row execute function public.guard_gym_cost_budget();

-- Trigger functions are reachable by nobody; see 51-advisor-tidy.sql. Revoked
-- from `anon` BY NAME, because Supabase's ALTER DEFAULT PRIVILEGES grants
-- EXECUTE to anon separately from PUBLIC and revoking PUBLIC does not touch it
-- (part 141).
revoke execute on function public.guard_gym_cost_budget() from public, anon, authenticated;

-- The covering index for `created_by`, for the reason part 2730 gives at the
-- same line: an `on delete set null` foreign key with no index makes account
-- deletion scan this table.
create index if not exists idx_gym_cost_budgets_created_by
  on public.gym_cost_budgets (created_by) where created_by is not null;

-- ── Deliberately NOT written here ────────────────────────────────────────
--
-- No `gym_events` kind, and the reason is part 2730's: a budget is not money,
-- and `gym_events_kind_check` is one CHECK holding the whole list, so two parts
-- filed in the same wave that both restate it silently drop each other's kinds.
--
-- And no closed-month lock. `gym_refuse_write_into_closed_month` is attached to
-- every table that holds MONEY, because a payment typed into a filed month
-- changes a figure somebody has already submitted. A budget changes no filed
-- figure: the close stores what the gym TOOK and what it PAID, and what it had
-- planned to pay is not in it. An owner writing down October's budget in
-- November, after October was closed, is doing ordinary bookkeeping and must
-- not be refused for it.
