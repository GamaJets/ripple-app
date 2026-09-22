-- ═══════════════════════════════════════════════════════════════════════════
-- Rent, power, the cleaner, the music licence — everything a gym pays for.
--
-- ── What was missing ─────────────────────────────────────────────────────
--
-- This database records every penny a gym takes and one kind of penny it
-- spends. `gym_payments` is money in, `gym_invoices` is money billed,
-- `payroll_settlements` is money handed to trainers for sessions they
-- delivered — and that is the whole of the outgoing side. /accounting's
-- "Money out" reads `payroll_settlements` and nothing else, and says so.
--
-- So a gym's rent is nowhere. Nor is its electricity, which for a building
-- full of treadmills is the second-largest line of the year. Nor water, waste,
-- the cleaner, the engineer who services the plate-loaded kit, the music
-- licence, the insurance, the accountant, the stock in the fridge, or the
-- receptionist — who is not a trainer, is not paid per session, and therefore
-- never appears in payroll at all.
--
-- The one place any of that existed was `app/(owner)/financials.tsx`: eight
-- numbers an owner types into a form, of which one is called "Total Expenses /
-- Mo", stored under the AsyncStorage key `repple.owner.financials`. One key, on
-- one phone. No row, no sync, no backup, no history, no currency of its own,
-- and a wipe of the app takes the lot. The screen says so three times because
-- it is true. That single typed figure was the only profit-and-loss this
-- product held, and every rule engine in src/lib/finReview.ts was scored
-- against it.
--
-- ── THE LINE THIS TABLE MUST NOT CROSS ───────────────────────────────────
--
-- Nothing subtracts this from anything.
--
-- `NO_NET_NOTE` in src/lib/coachLedger.ts is a standing rule of this product
-- and supabase/parts/450 refuses the same subtraction on the coach's side. A
-- gym is the bigger temptation, not the smaller one: /accounting already prints
-- a figure called "Cash recorded in Repple" — payments less payroll — under a
-- paragraph explaining at length that Repple has never seen rent, stock,
-- utilities, insurance, tax, equipment or the owner's drawings. The moment some
-- of that IS in the database, the obvious next edit is to fold it in and call
-- the answer profit.
--
-- It would be wrong for five independent reasons, any one of which is enough:
--
--   1. the takings are GROSS — the card processor's fee is not in this
--      database and no webhook in this repo writes it;
--   2. the takings are also only what somebody recorded at the desk, and
--      /accounting's whole reconciliation section exists because that half
--      does not always agree with the invoices;
--   3. this side is only what somebody has typed, and in the first month of
--      using it most of a gym's costs will simply be absent;
--   4. the two sides can be in different currencies — a UK gym insured through
--      a European broker is ordinary — and this app holds no rate;
--   5. payroll is in `payroll_settlements` and the rest is here, so any total
--      of "what went out" is a sum across two tables either of which can fail
--      to read on its own.
--
-- A number over those is not a smaller truth. It is a number about nothing, and
-- it would be filed as what the gym made. So `src/lib/gymCosts.ts` exports no
-- `net`, no `profit`, no `margin` and no `balance`, and neither this table nor
-- anything reading it produces one.
--
-- ── What a row claims ────────────────────────────────────────────────────
--
-- One thing: that somebody at this gym says it paid this amount, in this
-- currency, for this, on this day. It is their own word — nothing here has been
-- checked against a bank, a card, a receipt or a supplier's invoice, and Repple
-- holds no document behind any of it.
--
-- Deliberately NOT a claim about tax. There is no tax column, no deductibility
-- flag, no net/gross split and no category that implies one, for the reason
-- part 451 gives about an invoice and part 450 gives about a coach's costs:
-- what is allowable, and what tax may be reclaimed on it, is the accountant's
-- judgement about this trade in this country, and a tick in this app would be
-- tax advice printed under somebody's name. It is sharper here than on the
-- coach's side, because the evidence a tax authority wants is the supplier's
-- own VAT invoice and this product stores no supplier documents at all — a tax
-- figure typed here would be a number with nothing behind it, in a table an
-- accountant is being handed.
--
-- ── Modelled on part 450 throughout ──────────────────────────────────────
--
-- Same shape, same rules, same reasoning: minor units and a required currency,
-- a DATE rather than an instant, INSERT and DELETE for the owner and no UPDATE.
-- Where the two differ it is because a gym is not a coach, and each difference
-- is stated below.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.gym_costs (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null references public.tenants(id) on delete cascade,
  -- WHO wrote it down. `coach_costs` needed no such column: a coach's book has
  -- one author by construction. A gym has an owner, and part 290 allows an
  -- account to own more than one of them — so "who entered this" is a real
  -- question with a real answer, and the only trace of it otherwise would be
  -- the event log below. `on delete set null`, because an entry outlives the
  -- account that made it and a cost that vanished when a person left would take
  -- money out of a filed month.
  recorded_by uuid        references public.profiles(id) on delete set null,
  -- What it was for, in the gym's own words. Required: an amount with no
  -- description is a line nobody can reconcile against a bank statement later,
  -- and reconciling against a bank statement is the entire use of this table.
  description text        not null check (btrim(description) <> '' and length(description) <= 200),
  -- Who it was paid to. OPTIONAL, and it is the one field here that is new
  -- against part 450 rather than inherited. A coach recording "insurance" knows
  -- which insurer; a gym has thirty suppliers and the name is what turns a
  -- twelve-month list into something an accountant can group. Nothing validates
  -- it, nothing matches it against anything, and it is never required — a cash
  -- purchase from a shop nobody wrote down is still a real cost.
  supplier    text        check (supplier is null or (btrim(supplier) <> '' and length(supplier) <= 120)),
  -- A closed set, for the reason `coach_costs.category` is one: the category is
  -- the field somebody will later total or filter by, and forty spellings of
  -- "electric" is a column nobody can group. 'other' is the escape hatch and
  -- the description carries the detail.
  --
  -- These are a GYM's lines and not a coach's. There is no 'kit' and no
  -- 'travel' — a building does not commute — and there are seven a coach's list
  -- has no use for: utilities, maintenance, licensing, stock, marketing,
  -- finance and staff.
  --
  -- NO 'payroll' and no 'wages'. What the gym pays its trainers for sessions is
  -- already in `payroll_settlements`, is already /accounting's "Money out", and
  -- a row here for it would count the same money twice — exactly as an
  -- 'advertising' row would on the coach's side. 'staff' is deliberately NOT
  -- that: it is the receptionist, the cleaner, the manager and the employer's
  -- own taxes, none of whom is settled through Repple and none of whom appears
  -- anywhere in this database today. The category note on the screen says which
  -- is which, because nothing can detect that two rows are the same money.
  --
  -- NO 'refunds' either. Money handed back to a member is a reversing
  -- `gym_payments` row under part 180, which is what makes the takings figure
  -- correct; recording it a second time as a cost would take it off both sides.
  --
  -- 'software' DOES include this gym's own Repple bill, which is the opposite
  -- of the rule on the coach's side, and the reason is part 252: what a gym pays
  -- Repple is readable only by an account on the `platform_admins` allowlist. It
  -- is on no screen this owner can open, so a row for it here counts nothing
  -- twice — it is the only place that money can be recorded at all.
  category    text        not null check (category in (
                            'rent', 'utilities', 'staff', 'maintenance',
                            'equipment', 'insurance', 'licensing', 'marketing',
                            'software', 'stock', 'professional', 'finance',
                            'other')),
  -- Minor units, matching every other money column in this schema, so nothing
  -- between this table and the rest of the gym's money ever has to be
  -- converted.
  --
  -- bigint rather than the `integer` the older gym money columns use, and the
  -- ceiling is stated in the CHECK instead of by the column width. `integer`
  -- stops at 2,147,483,647 minor units, which is fine for a membership and is
  -- not fine for a year's rent in a currency with a large unit count: an annual
  -- rent of IDR 350,000,000 is 35,000,000,000 minor units and would be refused
  -- by the type with a 22003 the owner cannot act on.
  amount_cents bigint     not null check (amount_cents > 0 and amount_cents < 100000000000),
  -- NOT NULL and no default. `tenants.currency` is nullable on purpose (part 99)
  -- and part 150 removed the last database defaults, so a cost simply cannot be
  -- recorded until somebody has stated a currency. A figure with the wrong three
  -- letters on it is a different amount of money.
  --
  -- It may legitimately differ from what the gym CHARGES in, and the two are
  -- never added: `sumTaken` keeps every currency in its own pot and so does
  -- `costsByCategory` in src/lib/gymCosts.ts.
  currency    text        not null check (currency = upper(btrim(currency)) and length(currency) between 3 and 4),
  -- A DATE, not a timestamp, for the reason part 450 gives: rent was paid on a
  -- day, and storing an instant puts a Monday payment on Sunday for every gym
  -- west of Greenwich. It is also the column the closed-month lock reads, and a
  -- DATE is the one input to that lock with no timezone window at all — see the
  -- trigger below.
  paid_on     date        not null,
  note        text        check (note is null or length(note) <= 500),
  created_at  timestamptz not null default now()
);

comment on table public.gym_costs is
  'What a gym says its own operation cost it — rent, power, the cleaner, the engineer, the music licence, insurance, stock, the accountant. The gym''s own record, readable by its owner alone, never reconciled against a bank and never evidenced by a document this product holds. NOT a tax record: there is no tax column and no deductibility flag, because what is allowable is the gym''s accountant''s judgement and not this app''s. Nothing anywhere subtracts this from what the gym took.';
comment on column public.gym_costs.category is
  'rent | utilities | staff | maintenance | equipment | insurance | licensing | marketing | software | stock | professional | finance | other. Deliberately no ''payroll'' and no ''wages'': what the gym pays trainers for sessions is already in payroll_settlements and is already /accounting''s Money out, so a row here would count it twice. ''staff'' is the people who are NOT settled that way — reception, cleaning, a manager, employer taxes. ''software'' does include this gym''s Repple bill, which is on no screen a gym owner can open (part 252) and is therefore counted nowhere else.';
comment on column public.gym_costs.paid_on is
  'The day the money went out, not the day the row was written. A quarter of receipts written up in one evening must not all land in that evening''s month — and this is the column the closed-month lock reads.';
comment on column public.gym_costs.currency is
  'ISO 4217, uppercase, required. There is no default and no fallback — see tenants.currency in part 99. It may differ from the currency the gym charges in, and the two are never added.';
comment on column public.gym_costs.supplier is
  'Who it was paid to, as somebody typed it. Optional, never validated, never matched against anything. A twelve-month list of amounts with no payee on them is not something an accountant can group.';
comment on column public.gym_costs.recorded_by is
  'The account that entered this. NULL where that account has since been deleted — the cost stays, because a filed month must not lose money when a person leaves.';

-- The read is always "this gym, newest first", and both screens read a date
-- range of it. `id` is in the index because every paged read in this app orders
-- on a total order — two costs paid on the same day would otherwise tie, and a
-- page boundary could drop or repeat one.
create index if not exists gym_costs_tenant_idx
  on public.gym_costs (tenant_id, paid_on desc, id desc);

-- ── Row-level security ───────────────────────────────────────────────────
--
-- The owner, and nobody else in the building.
--
-- This is a wider gap than it looks and it is deliberate. A trainer can read
-- the timetable, the register, the equipment list and the door; the console
-- offers them five screens. What the gym pays in rent, what it pays the
-- cleaner, and what it settles with its accountant are none of those. A staff
-- read here would put every colleague's pay bracket — 'staff' rows, with a
-- description on them — in front of whoever is standing at the desk, and there
-- is no version of that which is not a personnel disclosure the gym did not
-- make. Part 450 refuses the coach's costs to the gym owner on the same
-- reasoning pointed the other way.
--
-- A member reads nothing here at all, and there is no policy admitting one.
alter table public.gym_costs enable row level security;

drop policy if exists gym_costs_owner_read on public.gym_costs;
create policy gym_costs_owner_read on public.gym_costs
  for select
  to authenticated
  using (is_owner_of(tenant_id));

drop policy if exists gym_costs_owner_insert on public.gym_costs;
create policy gym_costs_owner_insert on public.gym_costs
  for insert
  to authenticated
  with check (is_owner_of(tenant_id));

drop policy if exists gym_costs_owner_delete on public.gym_costs;
create policy gym_costs_owner_delete on public.gym_costs
  for delete
  to authenticated
  using (is_owner_of(tenant_id));

-- Named and dropped rather than merely never written, so a policy added by
-- somebody who wanted an "edit" button cannot survive a rebuild of this file.
-- Correcting a cost is deleting the wrong line and writing the right one; an
-- UPDATE would leave a row whose amount and whose date came from two different
-- intentions, and nothing on it would say so. The deletion is logged below, so
-- the correction is not invisible.
drop policy if exists gym_costs_owner_update on public.gym_costs;
drop policy if exists gym_costs_trainer_read on public.gym_costs;
drop policy if exists gym_costs_member_read on public.gym_costs;

-- RLS narrows a GRANT; it does not create one.
grant select, insert, delete on public.gym_costs to authenticated;
revoke update on public.gym_costs from authenticated;
revoke all on public.gym_costs from anon;

-- ── A cost cannot land in a month that has been closed ───────────────────
--
-- Part 182's argument, unchanged: a stored close that any later write can
-- invalidate is a note rather than a close. Part 481 made the same case for
-- payroll and used the same function, which is the precedent this follows.
--
-- It matters more here than for payroll, not less. /accounting hands an
-- accountant a month; once these costs are in that file, a rent payment typed
-- in November against a September that was signed off in October changes a
-- figure somebody has already filed — silently, and in the direction that
-- reduces what the month reported. The way out is the way out everywhere else:
-- reopen the month on /close, with a reason, and record it again.
--
-- `paid_on`, because that is the day the money went out and the column both
-- screens bucket by. It is also the one input this lock has ever been given
-- with no timezone window on it at all: part 182 notes honestly that a
-- `timestamptz` a few hours either side of midnight can be read into the
-- neighbouring month, and a DATE cast to `timestamptz` and formatted back in
-- the same session timezone round-trips exactly.
drop trigger if exists trg_gym_costs_closed_month on public.gym_costs;
create trigger trg_gym_costs_closed_month
  before insert or update of paid_on, amount_cents on public.gym_costs
  for each row execute function public.gym_refuse_write_into_closed_month('paid_on');

-- ── Who did what ─────────────────────────────────────────────────────────
--
-- Part 187's log, widened by two kinds. Its argument applies here without
-- change: an event written by a trigger cannot drift from the data and cannot
-- be forged by the account being audited.
--
-- The DELETION is the reason this is worth doing. There is no UPDATE on this
-- table, so correcting a cost means removing a line — and without a log the
-- only evidence that a September cost ever existed is that the September figure
-- used to be bigger. `payroll_settlements` gets the same treatment for the same
-- reason ('payroll-reversed'), and part 182 refuses to let a close be deleted
-- at all.
--
-- NO AMOUNT IN THE SUMMARY, and that is deliberate rather than an omission.
-- Every existing money event in part 187 writes `to_char(amount_cents / 100.0,
-- …)` into its sentence, which is a hundred times the real figure in a gym that
-- prices in yen and ten times it in one that prices in dinar — the same
-- unconditional division `money()` was fixed for in src/lib/gymRecord.ts, still
-- standing in the log. Adding a fourteenth site of it is not a trade worth
-- making for a line an owner can read the amount of by opening the row. What
-- the log is for is who, when and what for, and it says all three.
alter table public.gym_events drop constraint if exists gym_events_kind_check;
alter table public.gym_events add constraint gym_events_kind_check
  check (kind in (
    -- the five from part 105, unchanged
    'member-joined', 'trainer-joined', 'session-delivered',
    'session-missed', 'promo-redeemed',
    -- money
    'payment-recorded', 'payment-corrected', 'invoice-raised',
    'price-changed', 'plan-retired',
    -- the membership itself
    'membership-cancelled', 'membership-frozen',
    -- pay
    'payroll-settled', 'payroll-reversed',
    -- what the gym spends
    'cost-recorded', 'cost-deleted',
    -- the building
    'equipment-retired', 'equipment-out-of-service',
    -- the record
    'month-closed', 'month-reopened', 'record-exported'
  ));

create or replace function public.gym_event_cost()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
begin
  -- `subject_id` is who the event is ABOUT, and a cost is about nobody — no
  -- member, no trainer. NULL rather than the actor, which part 187 already
  -- carries separately and which is a different question.
  if tg_op = 'DELETE' then
    perform public.log_gym_event(
      old.tenant_id, 'cost-deleted', null,
      format('Cost removed: %s — %s, paid %s', old.category, old.description, old.paid_on));
    return old;
  end if;
  perform public.log_gym_event(
    new.tenant_id, 'cost-recorded', null,
    format('Cost recorded: %s — %s, paid %s', new.category, new.description, new.paid_on));
  return new;
end $fn$;

revoke all on function public.gym_event_cost() from public, anon, authenticated;

drop trigger if exists trg_gym_event_cost on public.gym_costs;
create trigger trg_gym_event_cost
  after insert or delete on public.gym_costs
  for each row execute function public.gym_event_cost();
