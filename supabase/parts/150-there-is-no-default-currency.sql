-- ═══════════════════════════════════════════════════════════════════════════
-- There is no default currency, and seven columns disagreed.
--
-- This product is white-label. `src/lib/gymRecord.ts` says so at the top of
-- `money()`, whose currency parameter is now REQUIRED rather than defaulted;
-- `scripts/check-currency.mjs` fails the build on `?? 'AED'` anywhere in the
-- app; `src/lib/memberRecord.ts` states as its rule 3 that "there is no default
-- currency in this file" and carries a `(currency not recorded)` branch for a
-- row that never said.
--
-- Every one of those mechanisms was dead against the schema underneath them:
--
--     gym_invoices.currency         not null default 'AED'
--     gym_pass_types.currency       not null default 'AED'
--     gym_passes.currency           not null default 'AED'
--     gym_payments.currency         not null default 'AED'
--     membership_plans.currency     not null default 'AED'
--     payroll_settlements.currency  not null default 'AED'
--     trainer_packages.currency     not null default 'usd'
--
-- A column that cannot be null cannot reach the branch written for null. So
-- `memberRecord.test.ts` asserts a case production can never produce, and a
-- London gym filing a fifty-pound membership would have had "AED 50.00" read
-- back to it with complete confidence — by code specifically written not to do
-- that.
--
-- Note the last line. Six columns invent dirhams and one invents lower-case US
-- dollars, in the same schema, for the same product. That is the tell: neither
-- is a decision, both are a column definition somebody wrote while thinking
-- about something else, and the two of them cannot both be the default.
--
--
-- ── Why the defaults go and NOT NULL stays ─────────────────────────────────
--
-- Two ways to fix this, and they say different things.
--
-- Making the columns NULLABLE would let a write record an amount without
-- saying what money it is, and leave the reader to render that honestly. That
-- is right for `tenants.currency`, where "this gym has not chosen yet" is a
-- true and common state — 35 of 54 live tenants are in it.
--
-- It is wrong here. These are not settings; they are FILED MONEY. A payment, an
-- invoice, a pass, a wage settlement. An amount with no currency is not a
-- record with a gap in it, it is a figure nobody can act on, and storing one
-- moves the problem to whoever reads it later with less context than the person
-- who wrote it had.
--
-- So NOT NULL stays and the DEFAULT goes: the database now refuses a write that
-- does not name the currency, instead of quietly answering for it. That matches
-- what the app already does — the console disables the payment and plan forms
-- with a stated reason when `tenants.currency` is null, and `issue_coach_invoice`
-- refuses outright — so this makes the storage layer enforce the rule the
-- product already follows, rather than contradicting it.
--
--
-- ── Safe to do now, and only now ───────────────────────────────────────────
--
-- All seven tables are EMPTY. Measured immediately before applying, in one
-- statement:
--
--     gym_invoices 0 · gym_pass_types 0 · gym_passes 0 · gym_payments 0
--     membership_plans 0 · payroll_settlements 0 · trainer_packages 0
--
-- So there is no row whose currency was decided by a default and would now be
-- indistinguishable from one somebody chose. Dropping a default does not touch
-- stored rows in any case — but if these tables held data, the honest change
-- would be larger than this file, because every existing 'AED' would be a value
-- of unknown provenance and no migration can tell which gym meant it.
--
-- After the first real row lands, this fix costs a backfill nobody can do
-- correctly. That is the whole reason it is being done tonight.
-- ═══════════════════════════════════════════════════════════════════════════

alter table gym_invoices         alter column currency drop default;
alter table gym_pass_types       alter column currency drop default;
alter table gym_passes           alter column currency drop default;
alter table gym_payments         alter column currency drop default;
alter table membership_plans     alter column currency drop default;
alter table payroll_settlements  alter column currency drop default;
alter table trainer_packages     alter column currency drop default;

-- The columns keep NOT NULL deliberately; see above. A write that omits the
-- currency now fails with 23502 rather than filing dirhams nobody chose.
