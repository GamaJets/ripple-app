-- ═══════════════════════════════════════════════════════════════════════════
-- The line that put dirhams back on every run.
--
-- ── THE DEFECT ────────────────────────────────────────────────────────────
--
-- `99-tenant-currency.sql` ended with one statement:
--
--     update public.tenants set currency = 'AED' where currency is null;
--
-- setup.sql is a one-shot bundle you paste and Run, and every part in it is
-- built to be idempotent. That statement is idempotent in the arithmetic sense
-- — running it twice leaves the same rows — and is nothing of the kind in the
-- sense that matters, because the set it matches is different every time. It
-- re-fires against every tenant created since the last paste. A gym that
-- signed up on Tuesday and had not yet chosen a currency was going to be told
-- it charges in dirhams by an operator applying an unrelated migration on
-- Thursday.
--
-- The part it lives in is the part that ARGUES AGAINST THIS, at length, four
-- paragraphs above the line: "this is deliberately NULLABLE, and null means
-- 'this gym has not told us' rather than a guess … A default that silently
-- applies LOOKS right. 'AED 600' on a London gym's screen reads as a
-- considered figure, not as a missing setting."
--
-- Three other parts state the same rule as their whole subject:
--
--   · 150 removed seven column defaults ('AED' six times, 'usd' once) so the
--     database refuses a filed amount that does not name its money.
--   · 940 gave a coach with no gym somewhere to name a currency rather than
--     inventing one for them.
--   · 941 made an invoice's currency follow the same order, ending in
--     `raise exception 'no currency has been set…'` rather than a fallback.
--
-- `scripts/check-currency.mjs` fails the build on `?? 'AED'` anywhere in the
-- app. This line is that expression, in SQL, running with more authority than
-- any of them.
--
-- ── WHAT IT WOULD DO TO A REAL PERSON ────────────────────────────────────
--
-- A gym in Manchester signs up, works through setup, and has not reached the
-- currency setting yet. Every screen correctly shows a dash and asks them to
-- choose — that behaviour is already built, and the console disables the
-- payment and plan forms with a stated reason while the currency is null. An
-- operator applies a migration. The dash becomes AED. Nothing asked, nothing
-- logged, no screen changed to say so. The owner then prices a £45 session and
-- the app files it, and reads it back, as 45 dirhams — about a tenth of the
-- money — with complete confidence, because a value that is present is
-- indistinguishable from a value somebody chose.
--
-- ── MEASURED LIVE BEFORE CHANGING ANYTHING ───────────────────────────────
--
-- Counted on 3 Sep 2026, read-only:
--
--     54 tenants.  19 with currency = 'AED'.  35 with currency null.
--     0 with any other currency.
--     gym_invoices 0 · gym_payments 0 · membership_plans 0 · gym_pass_types 0
--     gym_passes 0 · payroll_settlements 0 · trainer_packages 0
--     trainers.currency: 8 rows, all null.
--
-- Two things follow from those numbers and they point in different directions,
-- which is why this part does one and not the other.
--
-- THE 35 NULLS ARE THE URGENT HALF. They are the ones the next paste would
-- have stamped. Every one of them was created after the last full run of
-- setup.sql — the oldest is 31 Aug 2026 and every AED row predates it — so the
-- boundary between the two groups is a date, not a decision. Removing the line
-- is what protects them, and it is done: 99-tenant-currency.sql no longer
-- carries it.
--
-- THE 19 AED ROWS ARE NOT TOUCHED HERE, AND THAT IS DELIBERATE.
-- The evidence that they are stamped rather than chosen is strong: no tenant
-- anywhere holds any currency other than AED, so no owner has ever exercised a
-- choice through part 164's setter; the split falls exactly on a creation
-- date; and part 99's own justification for the backfill — "the whole
-- operating record around them is denominated in it" — is measurably false
-- now, because every money table in the database is empty and there is no
-- operating record at all.
--
-- Strong is not the same as certain, and nulling a gym's currency is a change
-- somebody SEES: the console disables the payment and plan forms while it is
-- null, and `issue_coach_invoice` refuses outright. A part that quietly did
-- that to nineteen tenants would be committing the same sin in the opposite
-- direction — deciding on somebody's behalf, in a migration, without asking.
-- So this part reports and does not rewrite. The statement, if the decision is
-- to make it, is one line and is left commented out at the foot of this file.
--
-- ── WHAT THIS PART ACTUALLY DOES ─────────────────────────────────────────
--
-- Nothing to any row. It is the standing assertion that the rule holds, so
-- that the next time somebody adds a convenience default it fails on the paste
-- instead of two months later in front of a customer. Three checks, each of
-- which raises rather than repairing, because the repair for each is a
-- decision and this file is not entitled to make it.
--
-- Idempotent and safe to re-run: it reads the catalogue, raises or does not,
-- and re-states one comment.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═════════════════════════════════════════════════════════════════════════
-- 1 · No default on the column
-- ═════════════════════════════════════════════════════════════════════════
--
-- The obvious way to reintroduce this bug, and the one part 150 had to undo
-- across seven other columns. A `default 'AED'` here would apply to every
-- tenant created afterwards and would never be visible in a diff of the data.

do $$
declare
  v_default text;
begin
  select column_default into v_default
    from information_schema.columns
   where table_schema = 'public' and table_name = 'tenants' and column_name = 'currency';

  if v_default is not null then
    raise exception
      'tenants.currency has acquired a column default (%). There is no default currency in this product — see parts 99, 150, 940, 941. Drop it: alter table public.tenants alter column currency drop default;',
      v_default;
  end if;
end $$;


-- ═════════════════════════════════════════════════════════════════════════
-- 2 · The column is still nullable
-- ═════════════════════════════════════════════════════════════════════════
--
-- NOT NULL here would be the same invention wearing a stricter hat: it cannot
-- be added without a backfill, and the backfill is the thing this file exists
-- to have removed. Part 150 is explicit that nullable is right for THIS column
-- and wrong for filed money, and the two must not be confused for each other.

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tenants'
       and column_name = 'currency' and is_nullable = 'NO'
  ) then
    raise exception
      'tenants.currency has been made NOT NULL. Null is a real state here — it means the gym has not chosen — and NOT NULL cannot be added without inventing a currency for every gym that has not. See part 150.';
  end if;
end $$;


-- ═════════════════════════════════════════════════════════════════════════
-- 3 · The check constraint still admits null
-- ═════════════════════════════════════════════════════════════════════════
--
-- `tenants_currency_is_iso` is written `currency is null or currency ~ …`.
-- Dropping the null arm would turn every unchosen gym into a row that cannot
-- be updated, which surfaces as an unrelated failure somewhere else entirely.
-- Asserted by testing the constraint's own expression rather than by matching
-- its text, so a rewrite that keeps the behaviour passes.

do $$
declare
  v_src text;
begin
  select pg_get_constraintdef(c.oid) into v_src
    from pg_constraint c
   where c.conrelid = 'public.tenants'::regclass
     and c.conname = 'tenants_currency_is_iso';

  if v_src is null then
    raise exception
      'tenants_currency_is_iso is missing. Part 99 creates it; without it tenants.currency will accept anything at all.';
  end if;

  if v_src !~* 'is null' then
    raise exception
      'tenants_currency_is_iso no longer admits null (%). Null is how a gym says it has not chosen. See parts 99 and 150.',
      v_src;
  end if;
end $$;


-- ═════════════════════════════════════════════════════════════════════════
-- 4 · Say it on the column, where the next person looks
-- ═════════════════════════════════════════════════════════════════════════
--
-- Re-stated rather than left to part 99, and extended with the one sentence
-- that was missing: not merely what null means, but that nothing may write
-- over it.

comment on column public.tenants.currency is
  'ISO 4217, uppercase. NULL means the gym has not set one — render a dash and ask, never assume. '
  'No default, no backfill, and no migration may fill this in: a currency nobody chose is '
  'indistinguishable from one somebody did. Set only by the gym, through set_my_tenant_currency() '
  '(part 164) or the owner console. See parts 99, 150, 940, 941, 1121.';


-- ═════════════════════════════════════════════════════════════════════════
-- 5 · The nineteen rows, and the decision that is not this file's to make
-- ═════════════════════════════════════════════════════════════════════════
--
-- Deliberately commented out. See the header for the evidence and for why it
-- is reported rather than run.
--
-- If the decision is that those nineteen were stamped by the retired backfill
-- and never chosen, this is the whole of it — and it is safe TODAY, while
-- every money table is empty, and stops being safe the moment one is not,
-- because after that a gym's filed amounts have three letters on them that
-- this would remove the meaning of:
--
--     update public.tenants set currency = null where currency = 'AED';
--
-- If the decision is that some of them are real, the narrower form names them:
--
--     update public.tenants set currency = null
--      where currency = 'AED' and id in ( … );
--
-- Either way it is run once, by hand, by somebody who has decided — not by a
-- bundle that gets pasted again next week.
