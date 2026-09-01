-- ═══════════════════════════════════════════════════════════════════════════
-- A mis-keyed payment was permanent, and an invoice had no writer at all.
--
-- Three things are missing from the gym's money record and all three are one
-- piece of work, because each of them is the same sentence: the console can
-- WRITE the fact but cannot write the correction, the link or the bill.
--
-- ── 1. There is no way to correct money ───────────────────────────────────
--
-- `gym_payments` has no refund, no void, no credit note and no edit anywhere
-- in the product. An owner who types 5000 instead of 500 has created a
-- permanent row that /money lists, /revenue totals, /accounting reconciles
-- against and /close carries into a month somebody files. There is no screen,
-- no function and no column that can say otherwise.
--
-- The fix is NOT a status column, and that is a decision rather than an
-- omission. supabase/parts/167 makes the argument in the other direction and
-- it holds here: "a voided payment still in the table is a row every future
-- SUM has to remember to exclude, and one that forgets restates the mistake."
-- There are eleven places in this console that add `gym_payments.amount_cents`
-- up. A `status <> 'void'` predicate has to be added to all eleven, correctly,
-- today and in every query written after today, and the one that forgets is
-- silently wrong in the direction of MORE money — which is the direction
-- nobody checks.
--
-- So a correction is a ROW, not a flag. `reverses_payment_id` points at what
-- is being undone and the amount is negative, so:
--
--   · every existing SUM nets to the right number with no change at all;
--   · the correction is dated when it was MADE, which is what a cash-basis
--     month wants — a refund handed over in September belongs in September,
--     not backdated into an August somebody has already filed;
--   · the original stays exactly as it was recorded, because it is what
--     happened, and the correction stays beside it saying so.
--
-- `amount_cents` was already `integer not null` with no non-negative check, so
-- a negative row is accepted today. The constraints below are what stop a
-- negative appearing anywhere it was not meant to.
--
-- ── 2. Nothing links a payment to the invoice it paid ─────────────────────
--
-- /accounting says it out loud, in copy the accountant reads: "Nothing in the
-- database links a payment to an invoice — there is no invoice id on a payment
-- row. So the match is made on member, exact amount, currency and a payment
-- within 45 days of the invoice date." That is a stated guess, and a stated
-- guess is honest, but it re-asks the same questions every month forever and
-- it cannot be answered — a part payment, one payment settling two invoices
-- and a partner paying under their own name all appear as exceptions and all
-- are fine.
--
-- `invoice_id` makes the match a FACT the owner can record once. The fuzzy rule
-- stays exactly as it is for everything nobody has matched by hand; a row that
-- carries an invoice_id simply stops being a question.
--
-- ── 3. Nothing writes an invoice ──────────────────────────────────────────
--
-- `gym_invoices` has existed since part 29 and has no writer anywhere in this
-- repository — two reads and nothing else. Four sections of two screens report
-- on it in copy that reads as a factual claim about the gym. The table needed
-- no new column for that; what it needed was a screen, and that is
-- studio-web/app/accounting. What it DOES need is here: a number a member can
-- be asked to quote, and the two columns above so an invoice can be joined to
-- the money that settled it.
--
-- The number is per gym and per year and it is assigned by the DATABASE, not
-- by the client. A client computing `max(number) + 1` from what it can read
-- produces duplicates the moment two invoices are raised in two tabs, and an
-- invoice number is the thing an accountant uses to tell two bills apart.
--
-- Additive and idempotent. Nothing here alters an existing row.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── the correction ──────────────────────────────────────────────────────────

alter table public.gym_payments
  add column if not exists reverses_payment_id uuid
    references public.gym_payments(id) on delete restrict;

-- `on delete restrict`, deliberately, and it is the only restrict in this
-- schema. Every other reference here goes null or cascades. A correction whose
-- original has been deleted is a negative amount in the ledger with nothing
-- explaining it, which is worse than either row alone — so the database refuses
-- to lose the original while the correction stands.

alter table public.gym_payments
  add column if not exists kind text not null default 'payment';

-- The default is 'payment' and that is not a guess: every row already in this
-- table is money somebody took at the desk. This is not the currency case —
-- there is no gym for which the answer differs, and no screen renders a
-- default here as though the owner had chosen it.
alter table public.gym_payments drop constraint if exists gym_payments_kind_known;
alter table public.gym_payments add constraint gym_payments_kind_known
  check (kind in ('payment', 'refund', 'correction'));

-- The two halves of a correction have to agree with each other, or the netting
-- above is arithmetic on rows that do not mean what they say.
--
--   · a plain payment reverses nothing and is not negative
--   · a refund or a correction reverses something and IS negative
--
-- Zero is allowed on the payment side and refused on the correction side, which
-- is not symmetry for its own sake. A zero payment is a real thing — a fully
-- discounted joining fee, recorded so the record shows the transaction happened
-- — and part 132 takes the same view of a fully discounted renewal. A zero
-- correction corrects nothing and is a form submitted with an empty box.
--
-- NOT VALID, and that is deliberate rather than lazy. This runs against
-- databases that already hold payments, and nothing has ever stopped somebody
-- entering a refund as a bare negative amount with no `reverses_payment_id` —
-- there was no other way to record one. Validating would fail the whole
-- migration on exactly the gyms that most need this part, and the fix for those
-- rows is a person deciding what each one was, not an ALTER TABLE guessing. New
-- and updated rows are checked from here on, which is the whole of what this
-- constraint is for.
alter table public.gym_payments drop constraint if exists gym_payments_correction_shape;
alter table public.gym_payments add constraint gym_payments_correction_shape
  check (
    (kind = 'payment'  and reverses_payment_id is null and amount_cents >= 0)
    or
    (kind in ('refund', 'correction') and reverses_payment_id is not null and amount_cents < 0)
  ) not valid;

create index if not exists idx_gym_payments_reverses
  on public.gym_payments (reverses_payment_id)
  where reverses_payment_id is not null;

comment on column public.gym_payments.reverses_payment_id is
  'The payment this row undoes, wholly or in part. NULL on an ordinary payment. A correction is a row rather than a flag so that every existing SUM nets to the right figure without learning a new predicate — see the header of supabase/parts/180.';
comment on column public.gym_payments.kind is
  'payment | refund | correction. A refund is money handed back; a correction is a mis-keyed row being undone. Both are negative and both name what they reverse. Kept apart because an accountant reads them differently and the ledger cannot tell them apart from the amount alone.';

-- ── the link the reconciliation could not record ────────────────────────────

alter table public.gym_payments
  add column if not exists invoice_id uuid
    references public.gym_invoices(id) on delete set null;

-- `set null` and not cascade: a payment survives its invoice being voided. The
-- money still arrived.

create index if not exists idx_gym_payments_invoice
  on public.gym_payments (invoice_id)
  where invoice_id is not null;

comment on column public.gym_payments.invoice_id is
  'The invoice this payment settles, where somebody has said so. NULL means unmatched, which is the ordinary case and is what /accounting''s 45-day heuristic is for — a hand-matched row simply stops being asked about.';

-- ── an invoice somebody can quote ───────────────────────────────────────────

alter table public.gym_invoices
  add column if not exists number integer;

-- Unique WITHIN a gym and within a year. Two gyms both having an invoice 41 is
-- correct and expected; one gym having two is the failure this index exists to
-- make impossible, and it has to be impossible rather than unlikely because the
-- number is what a member quotes on a bank transfer.
create unique index if not exists gym_invoices_number_uq
  on public.gym_invoices (tenant_id, (extract(year from issued_on)), number)
  where number is not null;

comment on column public.gym_invoices.number is
  'The invoice number this gym gave this bill, unique per gym per year and assigned by next_gym_invoice_number() rather than by any client. NULL on rows raised before this column existed — they were never numbered and inventing numbers for them now would put a sequence into the record that nobody ever quoted.';

/**
 * The next invoice number for a gym in a year.
 *
 * SECURITY DEFINER and it takes a LOCK, because the obvious client-side version
 * of this — read the highest number, add one, insert — is a race that produces
 * duplicates the first time an owner raises two invoices in two browser tabs,
 * and the unique index above would then reject the second one with 23505 after
 * the form had closed.
 *
 * `pg_advisory_xact_lock` over the gym and the year serialises exactly the
 * gyms raising an invoice at the same instant and nothing else. It is released
 * when the transaction ends, whether it commits or not.
 *
 * The caller must be the gym's owner. This function runs as its definer, which
 * means it can see every tenant's invoices, so the check is not a courtesy —
 * without it any signed-in account could read off how many bills any gym on the
 * platform has raised this year, one call at a time.
 */
create or replace function public.next_gym_invoice_number(p_tenant uuid, p_year integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if not is_owner_of(p_tenant) then
    raise exception 'not the owner of this gym' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('gym_invoice_number'), hashtext(p_tenant::text || ':' || p_year::text));
  select coalesce(max(number), 0) + 1 into n
    from public.gym_invoices
   where tenant_id = p_tenant
     and extract(year from issued_on) = p_year;
  return n;
end $$;

revoke all on function public.next_gym_invoice_number(uuid, integer) from public, anon;
grant execute on function public.next_gym_invoice_number(uuid, integer) to authenticated;

comment on function public.next_gym_invoice_number(uuid, integer) is
  'The next unused invoice number for one gym in one year, under an advisory lock so two tabs cannot both take it. Owner-only, checked inside the function because it runs as definer and can otherwise see every gym.';
