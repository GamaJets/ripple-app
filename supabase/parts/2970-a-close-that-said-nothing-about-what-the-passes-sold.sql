-- ═══════════════════════════════════════════════════════════════════════════
-- A month-end close that said nothing about what the passes sold
-- ═══════════════════════════════════════════════════════════════════════════
-- NOT APPLIED. Written by the owner month-close lane; apply, rebuild
-- supabase/setup.sql with `npm run db:build`, and then run the advisors.
--
--
-- ── WHAT IS WRONG ─────────────────────────────────────────────────────────
--
-- `gym_month_closes` (supabase/parts/182, currencies split per figure in
-- supabase/parts/2540) stores four money figures: taken, invoiced,
-- outstanding, payroll. The close screen shows FIVE. `buildClose` in
-- src/lib/monthEnd.ts reads five parts of a month and the fifth is `passes` —
-- what the desk sold over the counter — and not one column here records it.
--
-- So the four figures stop moving the moment a month is filed, and the fifth
-- goes on moving forever. A pass voided in September changes what August sold
-- and there is nothing to notice it against: `driftSince` compares the stored
-- row with today's rows figure by figure, and a figure that was never stored
-- cannot drift. The owner who handed their accountant an August close in
-- September has a document that is silent about a real part of August's
-- takings, and no later way to recover what the number was on the day.
--
--
-- ── WHY PASS SALES ARE NOT ALREADY INSIDE `taken_cents` ───────────────────
--
-- Because they are a different register, and `buildClose` holds them apart on
-- purpose — its own comment says so:
--
--     The payments table and the passes table are two independent records
--     with no link column between them: a desk that sold a pass for cash may
--     or may not also have recorded a payment for it, and neither adding them
--     (double counting) nor ignoring one (silently dropping income) can be
--     justified from the rows.
--
-- That argument is exactly why the close has to carry pass sales SEPARATELY
-- rather than folded in. A column that added them would file a number that is
-- true of neither table.
--
--
-- ── WHY `pass_cents` MUST BE ABLE TO BE NULL WHILE `passes_sold` IS NOT ───
--
-- This is the whole reason there are four columns rather than two.
--
-- `passRevenueCents` in src/lib/gymPasses.ts sums the priced passes and has no
-- opinion about money — it cannot have one, because it is also the function
-- that reports whether the rows agreed on a currency at all. A gym that sold
-- four passes in AED and one in GBP therefore produces a `cents` that is a
-- real addition of two different moneys, and `ClosePasses.cents` keeps it
-- deliberately, with a comment telling every caller to WITHHOLD it.
--
-- A close is a record of what was true at close. Two currencies cannot be
-- added, so there is no figure to file, and:
--
--   · 0 would be a claim that the gym sold nothing that month. It is false,
--     and it is false in the direction an accountant cannot detect — a zero
--     reconciles against an absence and nobody goes looking;
--   · the gym's own `tenants.currency` beside the raw sum would be the exact
--     substitution supabase/parts/2540 was written to stop, one table along.
--
-- So `pass_cents` goes in NULL, which says the figure exists and is not one
-- number — and `passes_sold` beside it, which is a COUNT and not money, goes
-- in with the real count. The record then says "five passes were sold and
-- there is no single amount for them", which is the true sentence. Without the
-- count the null would read as "no passes", which is the false one.
--
-- `passes_priced` is the third of that set: it says what fraction of the month
-- `pass_cents` is a sum OVER. Four priced out of five sold is a figure with a
-- known hole in it; four out of four is a total.
--
--
-- ── WHY `pass_currency` MAY BE NULL OVER A NON-NULL `pass_cents` ──────────
--
-- Deliberately allowed, and it is not the mixed-currency case. A priced pass
-- that states no currency at all is its own answer: where EVERY priced pass
-- states none, the rows are one unknown unit rather than two known ones, and
-- that is a real sum whose label was never recorded. It is the same
-- distinction `payroll_currency` already draws for rates snapshotted before
-- supabase/parts/1010 — recorded in one unit nobody wrote down, which is not
-- the same fact as a sum across two units.
--
-- There is therefore NO constraint here saying "a figure must carry a code".
-- Adding one would force a writer to invent a currency to satisfy it, which is
-- the failure this whole table's currency handling exists to refuse.
--
--
-- ── WHAT THIS DOES NOT DO ────────────────────────────────────────────────
--
-- It does not backfill, and there is nothing it honestly could. These are new
-- columns; NULL on a row written before this part means "this close did not
-- record the passes", which is precisely what happened. Deriving a figure
-- today from today's `gym_passes` rows would file a September answer under an
-- August close and destroy the one property a snapshot has.
--
-- It does not make anything NOT NULL. Every figure on a close is nullable
-- because every figure is nullable on screen.
--
-- It does not add a grant. `gym_month_closes` holds TABLE-level select/insert/
-- update for `authenticated` (supabase/parts/182), and a table-level privilege
-- covers columns added afterwards — the part-191 failure mode only bites where
-- the grants are column-level. `npm run check:grants` reports this table is
-- not one of the two that grant column by column, and the check queries in §3
-- assert it on the live database rather than leaving it reasoned about.
--
-- It does not touch RLS. `gym_month_closes_owner` is a row policy and says
-- nothing about columns.
--
-- Idempotent; safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═════════════════════════════════════════════════════════════════════════
-- 1 · The fifth figure, and the two counts that let it be absent honestly
-- ═════════════════════════════════════════════════════════════════════════

alter table public.gym_month_closes
  add column if not exists pass_cents    integer,
  add column if not exists pass_currency text,
  add column if not exists passes_sold   integer,
  add column if not exists passes_priced integer;

-- The same ISO-3 shape every other currency column on this table carries. A
-- close is the document an owner reconciles against a bank statement, and a
-- code that is not a code is how a figure comes to be read as an amount of
-- something it is not.
alter table public.gym_month_closes drop constraint if exists gym_month_closes_pass_ccy_is_iso;
alter table public.gym_month_closes add constraint gym_month_closes_pass_ccy_is_iso
  check (pass_currency is null or pass_currency ~ '^[A-Z]{3}$');

-- Counts, not money. NULL is allowed and means the passes were not read at
-- all; a negative count is not a fact about any month.
alter table public.gym_month_closes drop constraint if exists gym_month_closes_passes_counted;
alter table public.gym_month_closes add constraint gym_month_closes_passes_counted
  check (
    (passes_sold is null or passes_sold >= 0)
    and (passes_priced is null or passes_priced >= 0)
    and (passes_priced is null or passes_sold is null or passes_priced <= passes_sold)
  );

-- Money with no count behind it is not a figure anybody can read. `pass_cents`
-- is a sum over the PRICED passes, so a stored amount with `passes_priced`
-- null or zero describes a total over no rows — which is how a stray write
-- would look, and the only shape of this set that cannot be true.
--
-- The reverse is deliberately NOT constrained: priced passes with a null
-- `pass_cents` is the mixed-currency month this part exists for.
alter table public.gym_month_closes drop constraint if exists gym_month_closes_pass_sum_has_rows;
alter table public.gym_month_closes add constraint gym_month_closes_pass_sum_has_rows
  check (pass_cents is null or (passes_priced is not null and passes_priced > 0));


-- ═════════════════════════════════════════════════════════════════════════
-- 2 · What each column means, said in the database
-- ═════════════════════════════════════════════════════════════════════════
--
-- Where a reader of this table will be: they have the row and they do not have
-- studio-web. Every one of these comments exists to stop the same reading —
-- that a NULL here is a zero.

comment on column public.gym_month_closes.pass_cents is
  'What the month''s priced passes came to, in minor units, as it stood at the close. NULL is NEVER zero. It means there is no single amount: either the passes could not be read when the month was filed, or the priced passes spanned more than one currency and a sum across currencies is not an amount of anything. passes_sold beside it still carries the count, so a withheld figure never reads as "nothing was sold". Separate from taken_cents on purpose: gym_passes and gym_payments are two independent registers with no link column, so adding them double-counts and dropping one loses income.';

comment on column public.gym_month_closes.pass_currency is
  'What pass_cents is denominated in: the one currency the month''s priced gym_passes rows agreed on. NULL whenever pass_cents is null, so the pair can never disagree — and ALSO null over a real figure whose rows stated no code at all, which is one unknown unit rather than two known ones (the same distinction payroll_currency draws for rates predating supabase/parts/1010). Never tenants.currency: that substitution is the defect supabase/parts/2540 removed one column along.';

comment on column public.gym_month_closes.passes_sold is
  'How many passes were issued in the month, as it stood at the close. A COUNT and not money, which is why it survives a month whose figure is withheld — it is the field that makes a null pass_cents read as "there is no single amount" rather than as "no passes were sold". NULL only where the passes could not be read at all.';

comment on column public.gym_month_closes.passes_priced is
  'How many of passes_sold carried a recorded price, as it stood at the close. This is what pass_cents is a sum OVER: four priced out of five sold is a figure with a known hole in it, four out of four is a total, and without this column the two are indistinguishable. NULL only where the passes could not be read at all.';

comment on table public.gym_month_closes is
  'One row per act of closing a month, with the figures as they stood at the time and one currency PER FIGURE — they are different questions over different sets of rows and money is never added across currencies here. Pass sales are recorded separately from taken_cents (supabase/parts/2970) because gym_passes and gym_payments are independent registers with no link between them. A reopen sets reopened_at and a reason rather than deleting the row, so a month that was closed and then moved is visible as exactly that. The live close for a month is the row with reopened_at null; the partial unique index guarantees there is at most one.';


-- ═════════════════════════════════════════════════════════════════════════
-- 3 · What to check after applying
-- ═════════════════════════════════════════════════════════════════════════
--
--   · the four columns exist and are nullable:
--
--       select column_name, data_type, is_nullable
--         from information_schema.columns
--        where table_schema = 'public' and table_name = 'gym_month_closes'
--          and column_name in ('pass_cents','pass_currency','passes_sold','passes_priced');
--
--     expected: four rows — integer/text/integer/integer, all YES.
--
--   · `authenticated` can actually read and write them. The part-191 failure
--     mode, asserted rather than reasoned about, because a column-level grant
--     does not extend to a column added later:
--
--       select has_column_privilege('authenticated',
--                'public.gym_month_closes', 'pass_cents', 'SELECT'),
--              has_column_privilege('authenticated',
--                'public.gym_month_closes', 'pass_cents', 'INSERT');
--
--     expected: true, true. (Same for the other three.)
--
--   · the checks bite, as an owner against a month that may be closed:
--
--       pass_currency = 'pounds'                     must raise 23514
--       passes_sold = -1                             must raise 23514
--       passes_priced = 3 with passes_sold = 2       must raise 23514
--       pass_cents = 8600 with passes_priced = 0     must raise 23514
--
--   · and the shape this part is FOR is accepted, because it is the true one:
--
--       pass_cents null, pass_currency null, passes_sold 5, passes_priced 4
--         -- a month sold in two currencies. Must insert cleanly.
--       pass_cents 8600, pass_currency null, passes_priced 4
--         -- priced passes that stated no code. Must insert cleanly.
--
--   · `select * from public.get_advisors('security')` is clean, and
--     `get_advisors('performance')` has gained nothing — no index is added
--     here and none is wanted: these columns are read back with the row.
