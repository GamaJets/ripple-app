-- ═══════════════════════════════════════════════════════════════════════════
-- A month-end close that named one currency over four figures
-- ═══════════════════════════════════════════════════════════════════════════
-- NOT APPLIED. Written by the month-close repair lane; apply, rebuild
-- supabase/setup.sql with `npm run db:build`, and then run the advisors.
-- APPLIED. Verified after: the four columns exist as nullable text, all four
-- ISO-3 checks are on the table, and `authenticated` holds both SELECT and
-- INSERT on them — the part-191 failure mode, asserted rather than reasoned
-- about, because this table's grants are table-level and a column added later
-- would NOT be covered if they were column-level.
--
--
--
-- ── WHY THIS IS A FOUR-LINE CHANGE TODAY AND WOULD NOT BE LATER ───────────
--
-- Read live on this project on 6 September 2026, before writing a word of it:
--
--     select count(*) as rows, count(currency) as with_currency
--       from public.gym_month_closes;
--     -- rows: 0, with_currency: 0
--
-- No gym has ever closed a month. So there is NOTHING to backfill and nothing
-- to guess: not one stored row exists whose single `currency` code somebody
-- would later have to decide the meaning of, figure by figure, from a close
-- taken months earlier by an owner who is not available to ask.
--
-- That is the whole reason this is being done now rather than when it starts
-- to hurt. The first gym to close a month writes four figures and one code,
-- permanently; the second month reads back through that row for its drift
-- lines; the accountant's copy leaves the building in the handoff CSV. From
-- the first close onwards, splitting the column stops being an ALTER and
-- starts being an archaeology exercise with a customer's books as the dig.
--
--
-- ── WHAT IS WRONG ─────────────────────────────────────────────────────────
--
-- `gym_month_closes` (supabase/parts/182) stores FOUR money figures and ONE
-- currency, and its own comment says so in as many words:
--
--     -- What all four are denominated in, or NULL because the gym had not
--     -- said and the screen was showing dashes.
--
-- They are not all denominated in it. studio-web/app/close/page.tsx fills that
-- column from `currencyOf(rec, gymCcy)`, which is PAYMENTS-FIRST: what the
-- month's `gym_payments` rows agree on, falling back to the invoices and then
-- to `tenants.currency`. It is a true statement about `taken_cents` and about
-- nothing else beside it:
--
--   · `invoiced_cents` and `outstanding_cents` come off `gym_invoices`, which
--     carries `currency` PER ROW. A gym billing an overseas member in EUR has
--     invoices that never agreed with its card takings in the first place;
--   · `payroll_cents` comes off `sessions.rate_cents` — snapshotted with their
--     own `rate_currency` since supabase/parts/1010 — and off
--     `tenants.session_fee`, which is denominated in `tenants.currency`.
--     Neither of those is what the card machine took that month.
--
-- So a gym whose August takings happened to be all AED filed its GBP invoices,
-- its GBP arrears and its GBP payroll as dirhams. The KPI row on that very
-- screen was repaired for exactly this and now prices those three figures with
-- the invoices' own agreed code and with the payroll run's own. The STORED row
-- was not. One screen, one month, two answers — and the one that leaves the
-- building is the stored one.
--
--
-- ── WHAT IT DOES TO A REAL PERSON ────────────────────────────────────────
--
-- An owner in London runs a gym that also sells a handful of memberships to a
-- Dubai corporate client, invoiced in AED, paid by transfer. In August the
-- card terminal takes only AED — a quiet month, one visiting group — so
-- `currencyOf` answers AED and the close is filed:
--
--     taken 4,200 · billed 39,000 · still owed 15,500 · payroll 18,000 — AED
--
-- Three of those four are pounds. The owner hands the CSV to their accountant,
-- who reconciles 18,000 dirhams of payroll against 18,000 pounds leaving the
-- business account and cannot make the month balance. Nothing on the sheet is
-- marked as assumed, because nothing about it was: a single column had a
-- single value and every reader took it at its word.
--
-- In September the owner opens the close screen again. `driftSince` reads the
-- stored row back, prints every figure in the stored code, and reports the
-- month as unchanged — because it is comparing the same numbers. The label was
-- never part of the comparison.
--
--
-- ── THE DECISION: RECORD THE TRUTH, DO NOT REFUSE THE CLOSE ──────────────
--
-- The other way to fix this is to block a gym from closing a month whose
-- figures are in more than one currency. That is refused here, deliberately.
-- An owner must always be able to close their month — supabase/parts/182 and
-- src/lib/gymClose.ts already argue at length that a gym with one unmarkable
-- session from a trainer who left in March cannot be locked out of March
-- forever — and a gym that bills in more than one currency is a legitimate
-- gym, not an error state. It is the RECORD that has to be able to say what it
-- means, not the owner who has to be prevented from having a real business.
--
-- So: one currency column per figure. Four figures, four codes, each of them
-- the code the tile above it was priced with when somebody pressed Close.
--
--
-- ── WHY `currency` IS KEPT AND NOT DROPPED ───────────────────────────────
--
-- Nothing in supabase/parts has ever dropped a column — grep for DROP COLUMN
-- and there is not one — and part 83 and part 2300 are the shape this schema
-- uses instead: a superseded thing is narrowed and SAID, in the object's own
-- comment, rather than removed. A column that has ever been written is a
-- column something might still read, and here that is not hypothetical: a
-- console tab left open on the previous bundle can still insert a row with
-- `currency` set and the four new columns null, for as long as that tab lives.
--
-- So `currency` stays, its comment is rewritten to say what it now means —
-- the legacy single code, payments-first, NULL on everything written since
-- this part — and src/lib/gymClose.ts reads it as a fallback for `taken` ALONE
-- and for no other figure. Falling back for the other three would reinstate
-- the defect for exactly the rows that carry it.
--
--
-- ── WHAT THIS DOES NOT DO ────────────────────────────────────────────────
--
-- It does not backfill: there is nothing to backfill (0 rows), and there never
-- will be a row this part could have guessed at.
--
-- It does not make any column NOT NULL. Every figure on a close is nullable
-- because every figure is nullable on screen, and a currency is nullable for
-- the same reason one level along: a set of rows that names no single money
-- has no code, and storing one to satisfy a constraint is the precise lie the
-- close screen exists to refuse.
--
-- It does not add a grant. `gym_month_closes` holds TABLE-level select/insert/
-- update for `authenticated` (part 182, line 131 — confirmed against
-- information_schema.table_privileges on this project, not assumed), and a
-- table-level privilege covers columns added afterwards. This is the failure
-- mode `check:grants` exists for — part 191 added `trainers.trial_started_at`
-- to a table whose grants are COLUMN-level, and PostgREST refused every read
-- of it with a 403 for as long as the column existed — so it was checked
-- rather than reasoned about.
--
-- It does not touch RLS. `gym_month_closes_owner` is a row policy and says
-- nothing about columns.
--
-- Idempotent; safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═════════════════════════════════════════════════════════════════════════
-- 1 · One currency per figure
-- ═════════════════════════════════════════════════════════════════════════

alter table public.gym_month_closes
  add column if not exists taken_currency       text,
  add column if not exists invoiced_currency    text,
  add column if not exists outstanding_currency text,
  add column if not exists payroll_currency     text;

-- The same ISO-3 shape the existing `currency` check has carried since part
-- 182, four times over rather than once loosely: a close is the document an
-- owner reconciles against a bank statement, and a code that is not a code is
-- how a figure comes to be read as an amount of something it is not.
alter table public.gym_month_closes drop constraint if exists gym_month_closes_taken_ccy_is_iso;
alter table public.gym_month_closes add constraint gym_month_closes_taken_ccy_is_iso
  check (taken_currency is null or taken_currency ~ '^[A-Z]{3}$');

alter table public.gym_month_closes drop constraint if exists gym_month_closes_invoiced_ccy_is_iso;
alter table public.gym_month_closes add constraint gym_month_closes_invoiced_ccy_is_iso
  check (invoiced_currency is null or invoiced_currency ~ '^[A-Z]{3}$');

alter table public.gym_month_closes drop constraint if exists gym_month_closes_outstanding_ccy_is_iso;
alter table public.gym_month_closes add constraint gym_month_closes_outstanding_ccy_is_iso
  check (outstanding_currency is null or outstanding_currency ~ '^[A-Z]{3}$');

alter table public.gym_month_closes drop constraint if exists gym_month_closes_payroll_ccy_is_iso;
alter table public.gym_month_closes add constraint gym_month_closes_payroll_ccy_is_iso
  check (payroll_currency is null or payroll_currency ~ '^[A-Z]{3}$');


-- ═════════════════════════════════════════════════════════════════════════
-- 2 · What each column means, said in the database
-- ═════════════════════════════════════════════════════════════════════════
--
-- Where a reader of this table will be: they have the row and they do not have
-- studio-web. NULL in any of these is "the rows behind this figure named no
-- single money", which is a dash on screen — never a licence to reach for the
-- gym's code.

comment on column public.gym_month_closes.taken_currency is
  'What taken_cents is denominated in: the one currency the month''s gym_payments rows agreed on. NULL when they did not agree, or when there was nothing to ask — the figure is then unlabelled on purpose and must not be priced with the gym''s currency.';

comment on column public.gym_month_closes.invoiced_currency is
  'What invoiced_cents is denominated in: the one currency the month''s gym_invoices rows agreed on. NULL when they did not. This is NOT taken_currency — an overseas member invoiced in another money is an ordinary gym, and before supabase/parts/2540 those invoices were filed in whatever the card terminal happened to take.';

comment on column public.gym_month_closes.outstanding_currency is
  'What outstanding_cents is denominated in: the currency the invoices behind the arrears agreed on. Separate from invoiced_currency because they are two figures over two sets of rows — the arrears reach back past this month — and a screen that ever prices them apart must be able to record that.';

comment on column public.gym_month_closes.payroll_currency is
  'What payroll_cents is denominated in: the one currency the payable sessions were priced in, from sessions.rate_currency (supabase/parts/1010) — never tenants.currency, which is what the gym charges in TODAY over rates snapshotted whenever they were snapshotted. NULL where the rates predate part 1010 and genuinely record no unit. Where the month spans more than one currency there is no total at all: payroll_cents is NULL too, because a sum across currencies is not an amount of anything, and the reason is written into blockers_at_close.';

comment on column public.gym_month_closes.currency is
  'SUPERSEDED by the four per-figure currency columns (supabase/parts/2540), and NULL on everything written since. It was one code beside four figures, filled payments-first, so it was true of taken_cents alone and mislabelled the other three. Kept rather than dropped because a client on an older bundle can still write it: readers may use it as a fallback for taken_currency and MUST NOT use it for the invoiced, outstanding or payroll figures — that substitution is the defect it is superseded for. No row on this platform has ever carried a value here.';

comment on table public.gym_month_closes is
  'One row per act of closing a month, with the figures as they stood at the time and one currency PER FIGURE — they are four different questions over four different sets of rows and money is never added across currencies here. A reopen sets reopened_at and a reason rather than deleting the row, so a month that was closed and then moved is visible as exactly that. The live close for a month is the row with reopened_at null; the partial unique index guarantees there is at most one.';


-- ═════════════════════════════════════════════════════════════════════════
-- 3 · What to check after applying
-- ═════════════════════════════════════════════════════════════════════════
--
--   · the four columns exist and are nullable text:
--
--       select column_name, data_type, is_nullable
--         from information_schema.columns
--        where table_schema = 'public' and table_name = 'gym_month_closes'
--          and column_name like '%_currency';
--
--     expected: four rows, text, YES.
--
--   · `authenticated` can actually read them — the part-191 failure mode.
--     Column-level grants do not extend to a column added later; this table's
--     are table-level, and this is the assertion that says so rather than
--     assuming it:
--
--       select has_column_privilege('authenticated',
--                'public.gym_month_closes', 'payroll_currency', 'SELECT'),
--              has_column_privilege('authenticated',
--                'public.gym_month_closes', 'payroll_currency', 'INSERT');
--
--     expected: true, true. (Same for the other three.)
--
--   · the ISO check bites:
--
--       -- as an owner, against a month that may be closed:
--       -- inserting taken_currency = 'pounds' must raise 23514.
--
--   · nothing was invented for a row that already existed:
--
--       select count(*) from public.gym_month_closes where currency is not null;
--
--     expected: 0 — and if it is ever not 0, that row was written by a client
--     on a bundle older than supabase/parts/2540 and its `currency` speaks for
--     taken_cents only.
--
--   · `select * from public.get_advisors('security')` is clean, and
--     `get_advisors('performance')` has gained nothing.
