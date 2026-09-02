-- ═══════════════════════════════════════════════════════════════════════════
-- Rent, insurance, the accountant, and everything else a coach pays for.
--
-- ── What was missing ─────────────────────────────────────────────────────
--
-- The outgoing half of the Money screen had exactly two sources: the coach's
-- own Repple plan, and the ad spend they typed against a join code. Its empty
-- state said so in as many words — "Your Repple plan and any ad spend you
-- record show up here" — and that was the whole of it.
--
-- For a self-employed coach the largest single line of the year is usually the
-- gym rent or the chair fee, and it was nowhere. Nor was insurance, nor
-- professional indemnity, nor CPD, nor equipment, nor kit, nor travel between
-- clients, nor the accountant who prepares the return this app's own statement
-- is meant to be handed to. So the statement was one-sided by construction:
-- every penny in, no penny out, given to somebody whose job is to work out the
-- difference.
--
-- ── THE LINE THIS TABLE MUST NOT CROSS ───────────────────────────────────
--
-- Nothing subtracts this from anything.
--
-- `NO_NET_NOTE` in src/lib/coachLedger.ts is a standing rule of this product
-- and this table is the single biggest temptation to break it: the moment
-- money in and money out are both in the database, somebody computes a profit
-- and puts it in a hero. That figure would be wrong for four independent
-- reasons — the takings are gross of Stripe's fee and the platform's, the cash
-- half of the income depends on what the coach happened to write down, the
-- costs half depends on the same, and the two sides can be in different
-- currencies that this app has no rate to convert between. A net figure over
-- those is not a smaller truth, it is a number about nothing, and it would be
-- read as what the coach earned.
--
-- So `coachLedger.ts` keeps two ledgers with no arithmetic between them,
-- `coachCosts.ts` produces a `Taken` for the outgoing side exactly as
-- `coachReceipts.ts` does for the incoming one, and neither this table nor
-- anything reading it produces a profit, a margin or a balance.
--
-- ── What a row claims ────────────────────────────────────────────────────
--
-- One thing: that this coach says they paid this amount, in this currency, for
-- this, on this day. It is the coach's own word — nothing here has been checked
-- against a bank, a card, a receipt or an invoice, and no supplier is named as
-- having been paid. It is a bookkeeping note, and it is visible to nobody but
-- the coach who wrote it.
--
-- Deliberately NOT a claim about tax. There is no deductibility flag, no VAT
-- column and no category that implies either, for the same reason part 138
-- refuses a tax line on an invoice: what is allowable turns on the coach's
-- country, their trade and their accountant's judgement, and a "deductible"
-- tick in this app would be tax advice printed under somebody's name. The
-- categories below are the words a person uses to sort their own spending, and
-- nothing reads them as anything else.
--
-- ── Modelled on part 190 throughout ──────────────────────────────────────
--
-- Same shape, same rules, same reasoning: minor units and a required currency,
-- a DATE rather than an instant, INSERT and DELETE for the owner and no UPDATE,
-- and no read policy for anybody else. Where the two differ it is stated below.
--
-- auth.uid() throughout, never current_user: under PostgREST every signed-in
-- request runs as the shared `authenticated` role.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.coach_costs (
  id          uuid        primary key default gen_random_uuid(),
  coach_id    uuid        not null references public.trainers(id) on delete cascade,
  -- What it was for, in the coach's own words. Required: an amount with no
  -- description is a line nobody can reconcile against anything later, and the
  -- one reader of this table is a person trying to remember what they spent
  -- money on eleven months ago.
  description text        not null check (btrim(description) <> '' and length(description) <= 200),
  -- A closed set, for the reason `coach_receipts.method` is one: the category
  -- is the field a coach might later total or filter by, and forty spellings of
  -- "insurance" is a column nobody can group. 'other' is the escape hatch and
  -- the description carries the detail.
  --
  -- NO 'advertising' and no 'platform'. Ad spend is already recorded against a
  -- join code (part 98) and the coach's own Repple plan is already read from
  -- their billing, so both are on the Going Out side already — a second row for
  -- either would count the same money twice, exactly as a `coach_receipts` row
  -- for a Stripe sale would on the way in.
  category    text        not null check (category in (
                            'rent', 'insurance', 'education', 'equipment',
                            'kit', 'travel', 'professional', 'other')),
  -- Minor units, matching coach_receipts, client_purchases, coach_invoices and
  -- trainer_packages, so nothing between this table and the rest of the app's
  -- money ever has to be converted. bigint for the same reason they are.
  amount_cents bigint     not null check (amount_cents > 0 and amount_cents < 100000000000),
  -- NOT NULL and no default, exactly as in part 190. tenants.currency is
  -- nullable on purpose (part 99) and null there means "this gym has not told
  -- us", so a cost simply cannot be recorded until somebody states a currency.
  -- A figure with the wrong three letters on it is a different amount of money.
  --
  -- This side can legitimately differ from the income side: a coach who is paid
  -- in dirhams may pay a UK insurer in sterling. Nothing anywhere adds the two,
  -- and `sumTaken` keeps every currency in its own pot.
  currency    text        not null check (currency = upper(btrim(currency)) and length(currency) between 3 and 4),
  -- A DATE, not a timestamp, for the reason part 190 gives: rent was paid on a
  -- day, and storing an instant puts a Monday payment on Sunday for every coach
  -- west of Greenwich.
  paid_on     date        not null,
  note        text        check (note is null or length(note) <= 500),
  created_at  timestamptz not null default now()
);

comment on table public.coach_costs is
  'What a coach says their own business cost them — rent or a chair fee, insurance, CPD, equipment, kit, travel, an accountant. The coach''s own record, readable by nobody else, never reconciled against a bank. NOT a tax record: there is no deductibility flag and no tax column, because what is allowable is the coach''s accountant''s judgement and not this app''s. Nothing anywhere subtracts this from what the coach was paid.';
comment on column public.coach_costs.category is
  'rent | insurance | education | equipment | kit | travel | professional | other. Deliberately no ''advertising'' and no ''platform'': ad spend is already recorded against a join code and the Repple plan is already read from billing, so a row here for either would count the same money twice.';
comment on column public.coach_costs.paid_on is
  'The day the coach says the money went out, not the day the row was written. A quarter of receipts written up in one evening must not all land in that evening''s month.';
comment on column public.coach_costs.currency is
  'ISO 4217, uppercase, required. There is no default and no fallback — see tenants.currency in part 99. It may differ from the currency the coach is PAID in, and the two are never added.';

-- The read is always "mine, newest first", and the statement reads a date range
-- of it. `id` is in the index because every paged read in this app orders on a
-- total order — two costs recorded on the same day would otherwise tie and a
-- page boundary could drop or repeat one.
create index if not exists coach_costs_coach_idx
  on public.coach_costs (coach_id, paid_on desc, id desc);

-- ── Row-level security ───────────────────────────────────────────────────

alter table public.coach_costs enable row level security;

drop policy if exists coach_costs_owner_read on public.coach_costs;
create policy coach_costs_owner_read on public.coach_costs
  for select
  to authenticated
  using (coach_id = (select auth.uid()));

drop policy if exists coach_costs_owner_insert on public.coach_costs;
create policy coach_costs_owner_insert on public.coach_costs
  for insert
  to authenticated
  with check (coach_id = (select auth.uid()));

drop policy if exists coach_costs_owner_delete on public.coach_costs;
create policy coach_costs_owner_delete on public.coach_costs
  for delete
  to authenticated
  using (coach_id = (select auth.uid()));

-- Named and dropped rather than merely never written, so a policy added by
-- somebody who wanted an "edit" button cannot survive a rebuild of this file.
-- Correcting a cost is deleting the wrong line and writing the right one; an
-- UPDATE would leave a row whose amount and whose date came from two different
-- intentions, and nothing on it would say so.
--
-- And no gym-owner read. A self-employed coach's own outgoings are not their
-- gym's business, and a table an owner could read would make one — the same
-- reasoning part 190 gives for refusing a client read of `coach_receipts`.
drop policy if exists coach_costs_owner_update on public.coach_costs;
drop policy if exists coach_costs_owner_of_gym_read on public.coach_costs;
drop policy if exists coach_costs_client_read on public.coach_costs;

-- RLS narrows a GRANT; it does not create one.
grant select, insert, delete on public.coach_costs to authenticated;
revoke update on public.coach_costs from authenticated;
revoke all on public.coach_costs from anon;
