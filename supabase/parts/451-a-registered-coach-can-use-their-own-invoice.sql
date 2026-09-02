-- ═══════════════════════════════════════════════════════════════════════════
-- A VAT-registered coach could not use Repple's invoice.
--
-- ── What part 138 refused, and what it over-refused ──────────────────────
--
-- Part 138 built a numbered document a coach can hand over, and put one
-- sentence on every copy of it: no tax has been calculated, added or withheld,
-- there is no tax registration number on it, and it is not a tax invoice. The
-- concepts were ABSENT rather than zeroed, on purpose. That refusal was right
-- and it stays right: this app does not know the coach's country, their
-- registration status, where their client is, or what the thing sold attracts,
-- so any tax figure it produced would be invented under somebody's name on a
-- document they hand to a customer.
--
-- But it refused one thing too many. A rate and a registration number that the
-- COACH TYPES are not calculations. They are stated facts about the issuer,
-- exactly as `bill_to` is a stated fact about the recipient and `description`
-- is a stated fact about what was sold — every one of them typed by the same
-- person, printed verbatim, and never checked by this app against anything.
-- Refusing to print them meant a registered coach had to keep a second
-- invoicing system, which made the whole money side of Repple a duplicate of
-- their real books.
--
-- ── WHAT THIS PART DOES NOT ADD ──────────────────────────────────────────
--
-- No tax AMOUNT. No net figure. No gross/net split. No "subtotal". Not as
-- columns, not as defaults, not as zeros — the concepts stay absent, and the
-- document still says in words that Repple has calculated nothing. The only
-- money column on an invoice is still `amount_cents`, and it is still the flat
-- amount charged.
--
-- The line is exactly where `INVOICE_TAX` in src/lib/coachInvoice.ts has always
-- drawn it: this app may print what a person stated and may not work anything
-- out from it. A coach who states "20%" beside "GBP 480.00" has said two true
-- things; an app that prints "VAT: GBP 80.00" underneath has made a claim about
-- their tax affairs, and it would be wrong for a coach on a margin scheme, a
-- flat-rate scheme, a reverse charge, or a mixed-rate invoice.
--
-- ── Snapshotted, like everything else on the document ────────────────────
--
-- Both columns live on the INVOICE, not on the trainer. Part 138's argument
-- about `bill_to` applies unchanged: a coach who deregisters next year has not
-- changed what a document they issued this year said, and a joined column would
-- silently rewrite every invoice they had already handed out. The screen offers
-- the values from their last invoice that carried them, so nobody types a
-- registration number twice, and what is STORED is what was on the page.
--
-- ── The guard is replaced, not extended ──────────────────────────────────
--
-- Part 188 lists every immutable column by name and raises if any of them
-- moves. Two new document-bearing columns that were not on that list would be
-- editable after issue — a tax rate that can change under somebody who has
-- already read the document is the worst version of this, because it is the
-- field a tax authority would look at. `create or replace` on the same
-- signature, so the trigger created in part 138 keeps pointing at it.
-- ─────────────────────────────────────────────────────────────────────────

-- The rate the coach typed, as a percentage. NUMERIC and not an integer: a 12.5
-- per cent rate is real, and rounding somebody's stated rate to a whole number
-- would print a figure they did not type. NULL means they stated nothing, which
-- is the ordinary case and is a different document — see `INVOICE_TAX` against
-- `INVOICE_TAX_STATED` in src/lib/coachInvoice.ts.
--
-- Zero is ALLOWED and is not the same as null. A zero-rated supply is a real
-- thing that a registered business states on purpose, and collapsing it into
-- "nothing stated" would take a deliberate statement off the document.
alter table public.coach_invoices add column if not exists tax_rate_pct numeric(6,3);
alter table public.coach_invoices add column if not exists tax_registration text;

alter table public.coach_invoices drop constraint if exists coach_invoices_tax_rate_range;
alter table public.coach_invoices add constraint coach_invoices_tax_rate_range
  check (tax_rate_pct is null or (tax_rate_pct >= 0 and tax_rate_pct <= 100));

alter table public.coach_invoices drop constraint if exists coach_invoices_tax_reg_len;
alter table public.coach_invoices add constraint coach_invoices_tax_reg_len
  check (tax_registration is null or (btrim(tax_registration) <> '' and length(tax_registration) <= 60));

comment on column public.coach_invoices.tax_rate_pct is
  'A tax rate the COACH typed, as a percentage, printed verbatim. Repple calculates nothing from it: there is no tax amount column and no net/gross split anywhere on an invoice. NULL means the coach stated no rate; 0 means they stated a zero rate, and the two are different documents.';
comment on column public.coach_invoices.tax_registration is
  'A tax registration number the COACH typed, printed verbatim. Never checked against any register, and never inferred from a country or a currency.';

-- ── The guard, widened by exactly two columns ─────────────────────────────
--
-- Verbatim from part 188 plus the two new lines. Replaced rather than extended
-- in place because it lists every immutable column by name and there is no
-- other way to add one.
create or replace function public.coach_invoices_immutable_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.id is distinct from old.id
     or new.coach_id is distinct from old.coach_id
     or new.seq is distinct from old.seq
     or new.client_id is distinct from old.client_id
     or new.bill_to is distinct from old.bill_to
     or new.description is distinct from old.description
     or new.amount_cents is distinct from old.amount_cents
     or new.currency is distinct from old.currency
     or new.kind is distinct from old.kind
     or new.issued_on is distinct from old.issued_on
     -- On the list because it is on the DOCUMENT. A due date that could move
     -- after issue is a term changed under somebody who has already read it.
     or new.due_on is distinct from old.due_on
     -- On the list for the same reason and more sharply. A tax rate or a
     -- registration number that could move after issue is the field a tax
     -- authority reads, changed under a document somebody is already holding.
     or new.tax_rate_pct is distinct from old.tax_rate_pct
     or new.tax_registration is distinct from old.tax_registration
     or new.note is distinct from old.note
     or new.created_at is distinct from old.created_at then
    raise exception 'an issued invoice cannot be edited — void it and issue another';
  end if;

  -- The chase columns are the only two an update may move, and they may only
  -- move forward. `+ 1` rather than `>=` so nothing can jump the count to a
  -- number no sequence of taps produced, and nothing can reset it to zero.
  if new.reminder_count is distinct from old.reminder_count
     and new.reminder_count is distinct from old.reminder_count + 1 then
    raise exception 'a reminder count moves up by one at a time';
  end if;
  if new.reminder_count = old.reminder_count
     and new.reminded_at is distinct from old.reminded_at then
    raise exception 'the last-chased time only changes when a chase is recorded';
  end if;

  -- One way only. Un-voiding would put a number back into circulation that the
  -- coach has already told somebody was cancelled.
  if old.voided_at is not null then
    raise exception 'that invoice is already voided';
  end if;
  return new;
end $$;

revoke all on function public.coach_invoices_immutable_guard() from public, anon, authenticated;

-- ── Issuing, now with what the coach stated about tax ─────────────────────
--
-- The old nine-argument signature is DROPPED rather than left beside the new
-- one, for the reason part 188 gives: `create or replace` with a different
-- argument list creates an OVERLOAD, and PostgREST resolving
-- `issue_coach_invoice` against two candidates with compatible defaults is an
-- ambiguity that surfaces as a 300 at the moment a coach taps Issue.
drop function if exists public.issue_coach_invoice(text, text, bigint, date, text, uuid, text, text, date);

create or replace function public.issue_coach_invoice(
  p_bill_to          text,
  p_description      text,
  p_amount_cents     bigint,
  p_issued_on        date,
  p_kind             text,
  p_client_id        uuid default null,
  p_currency         text default null,
  p_note             text default null,
  p_due_on           date default null,
  p_tax_rate_pct     numeric default null,
  p_tax_registration text default null
)
returns public.coach_invoices
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  ccy text;
  n   integer;
  reg text;
  out_row public.coach_invoices;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  if not exists (select 1 from public.trainers t where t.id = uid) then
    raise exception 'no trainer profile for this account';
  end if;

  if p_bill_to is null or btrim(p_bill_to) = '' then
    raise exception 'an invoice has to say who it is for';
  end if;
  if p_description is null or btrim(p_description) = '' then
    raise exception 'an invoice has to say what it is for';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'an invoice for nothing is not an invoice';
  end if;
  if p_amount_cents >= 100000000000 then
    raise exception 'that amount is too large';
  end if;
  if p_kind is null or p_kind not in ('received', 'requested') then
    raise exception 'say whether this records money received or money requested';
  end if;
  if p_issued_on is null then
    raise exception 'an invoice has to carry the date it was issued';
  end if;
  if p_issued_on > current_date + 1 then
    raise exception 'an invoice cannot be dated in the future';
  end if;

  -- Refused, not corrected. A document that says it fell due before it was
  -- written is not one anybody can act on, and silently swapping the two dates
  -- would print terms the coach did not type. There is deliberately no upper
  -- bound: a coach settling annually with a corporate client is ordinary.
  if p_due_on is not null and p_due_on < p_issued_on then
    raise exception 'an invoice cannot fall due before it is issued';
  end if;

  -- Refused rather than clamped, for the reason every money refusal in this
  -- product is refused rather than corrected: clamping 120 to 100 prints a rate
  -- the coach did not type onto a document about their tax affairs.
  if p_tax_rate_pct is not null and (p_tax_rate_pct < 0 or p_tax_rate_pct > 100) then
    raise exception 'a tax rate is a percentage between 0 and 100';
  end if;
  reg := nullif(btrim(coalesce(p_tax_registration, '')), '');
  if reg is not null and length(reg) > 60 then
    raise exception 'that tax registration number is longer than any this can print';
  end if;

  if p_client_id is not null and not exists (
    select 1 from public.clients c where c.id = p_client_id and c.trainer_id = uid
  ) then
    raise exception 'that client is not one of yours';
  end if;

  ccy := nullif(btrim(upper(coalesce(p_currency, ''))), '');
  if ccy is null then
    select case when count(distinct upper(k.currency)) = 1 then max(upper(k.currency)) end
      into ccy
    from public.trainer_packages k
    where k.trainer_id = uid and k.currency is not null and btrim(k.currency) <> '';
  end if;
  if ccy is null then
    select upper(btrim(t.currency)) into ccy
    from public.trainers tr
    join public.tenants t on t.id = tr.tenant_id
    where tr.id = uid and t.currency is not null and btrim(t.currency) <> '';
  end if;
  if ccy is null then
    raise exception 'no currency has been set, so there is nothing to price this in';
  end if;
  if ccy !~ '^[A-Z]{3,4}$' then
    raise exception 'currency must be a three-letter code';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(uid::text, 138));

  select coalesce(max(i.seq), 0) + 1 into n
  from public.coach_invoices i
  where i.coach_id = uid;

  insert into public.coach_invoices
    (coach_id, seq, client_id, bill_to, description, amount_cents, currency, kind, issued_on, due_on, note,
     tax_rate_pct, tax_registration)
  values
    (uid, n, p_client_id, btrim(p_bill_to), btrim(p_description), p_amount_cents, ccy, p_kind,
     p_issued_on, p_due_on, nullif(btrim(coalesce(p_note, '')), ''),
     p_tax_rate_pct, reg)
  returning * into out_row;

  return out_row;
end $$;

revoke all on function public.issue_coach_invoice(text, text, bigint, date, text, uuid, text, text, date, numeric, text) from public, anon;
grant execute on function public.issue_coach_invoice(text, text, bigint, date, text, uuid, text, text, date, numeric, text) to authenticated;
