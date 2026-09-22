-- ═══════════════════════════════════════════════════════════════════════════
-- The invoice somebody actually paid, and the one nobody could chase.
--
-- Two holes in the same table, both of them the same shape: a fact that came
-- into existence AFTER the document was issued, with nowhere to be written.
--
-- ── 1. A REQUESTED INVOICE CAN NEVER BE SETTLED ───────────────────────────
--
-- `kind` is 'received' or 'requested', it is fixed at issue, and part 188 put
-- it on the immutable list for a reason that is right: it is printed on the
-- document, and a claim about somebody's payment that changes under a copy they
-- are already holding is not a claim, it is an edit.
--
-- The consequence was never intended. A coach issues invoice 0041 for GBP 480,
-- the client pays it three weeks later, and there is nothing the coach can do
-- about it. `invoiceAge()` has exactly two doors out of the ageing list: void
-- it, or issue a DIFFERENT invoice marked 'received' — which spends a second
-- number on one charge and leaves the first one on every chase list for ever.
-- So 0041 sits at "61+ days overdue", is counted in the outstanding figure, is
-- named on the Money screen, and is picked up by part 613's nightly pass, which
-- tells the coach four times over two months to chase money they have. The only
-- other way out is to VOID it, which stamps THIS INVOICE HAS BEEN VOIDED across
-- a document the client paid in full.
--
-- ── The settlement is a NEW FACT, and that is the whole design ────────────
--
-- Nothing here rewrites `kind`, and the immutable guard below still refuses to.
-- Part 138's rule survives untouched: a document once issued says what it said.
-- What is added is three columns that were not on the document when it was
-- issued and that record something that happened afterwards — exactly the shape
-- `reminded_at` and `reminder_count` already have, and for exactly the same
-- reason those two were allowed to move.
--
--   settled_on    the DAY the coach says the money arrived
--   settled_at    when they recorded it
--   settle_note   how it arrived, in their own words, or null
--
-- They move ONCE and only away from null. There is no un-settle, for part 138's
-- reason for having no un-void: a coach who has told this app the money came in
-- and then tells it the money did not is describing a chargeback or a bounced
-- transfer, which is a different event with a different date, and collapsing
-- the two into a toggle loses the one thing an accountant needs, which is when.
--
-- The document reprints with the settlement on it, as the coach's own statement
-- and labelled as one. That is not an edit of what it said: it said the money
-- was being requested, and it still does. It now also says the issuer states it
-- was paid on a date. Both are true, both are the issuer's word, and a client
-- re-sent the document after paying should not receive one still demanding
-- money.
--
-- ── 2. AN INVOICE ISSUED BEFORE PART 188 CANNOT BE CHASED ────────────────
--
-- `due_on` arrived in part 188 and is immutable, correctly: it is printed on
-- the document as the day the issuer expects to be paid, and a term that could
-- move after issue is a term changed under somebody who has read it.
--
-- Every invoice issued before that part has `due_on` null, and so does every
-- one issued since by a coach who left the box alone — which is most of them,
-- because the box is optional on purpose. `invoiceAge()` reports those as
-- 'undated', `ageingBook()` puts them on a list of their own, and they are in
-- NO outstanding figure and on NO chase list. The screen tells the coach so, in
-- a sentence ending "and cannot be added afterwards". Which is true of a due
-- date, and left a coach with a year of back catalogue they could see, could
-- not total, and could not chase.
--
-- ── chase_from is not a due date and never appears on the document ────────
--
--   chase_from    the day the COACH decided to start chasing this one
--
-- It is written after the fact, by the person doing the chasing, about their
-- own working list. It is NOT printed on the invoice, is not sent to the
-- client, and `invoiceAge()` words it differently from a due date every single
-- time it appears — "you set" rather than "you stated", because the client
-- never agreed to it and in most cases has never seen a date at all.
--
-- That distinction is the whole licence for this column. A settable `due_on`
-- would be a term rewritten under a document; a settable working note is the
-- coach annotating their own ledger, which is what `reminded_at` already is.
--
-- Unlike the settlement it may move more than once: a coach who decides to give
-- somebody another fortnight is not correcting a record of an event, they are
-- changing their own plan, and freezing that would be this app deciding when
-- somebody chases their own customer. It may also be cleared back to null,
-- which puts the invoice back on the undated list where it started.
--
-- ── Why every one of these is a function and not a grant ──────────────────
--
-- `coach_invoices` grants SELECT and nothing else, and part 138's header says
-- why: RLS narrows a grant rather than creating one, so an UPDATE grant on this
-- table is an UPDATE grant on the row, and the immutable trigger would be the
-- only thing between an issued amount and anybody who wanted to edit it. The
-- trigger is a backstop, not the fence.
--
-- Idempotent; safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── The columns ───────────────────────────────────────────────────────────

alter table public.coach_invoices add column if not exists settled_on date;
alter table public.coach_invoices add column if not exists settled_at timestamptz;
alter table public.coach_invoices add column if not exists settle_note text;
alter table public.coach_invoices add column if not exists chase_from date;

-- A settlement is one event and its three columns describe it together. Half a
-- settlement — a day with no record of when it was written down — is a row no
-- screen can word honestly, so the pair moves together or not at all.
alter table public.coach_invoices drop constraint if exists coach_invoices_settled_chk;
alter table public.coach_invoices add constraint coach_invoices_settled_chk
  check ((settled_on is null) = (settled_at is null));

-- A note about a settlement that did not happen is a note about nothing.
alter table public.coach_invoices drop constraint if exists coach_invoices_settle_note_chk;
alter table public.coach_invoices add constraint coach_invoices_settle_note_chk
  check (settle_note is null or (settled_on is not null and btrim(settle_note) <> '' and length(settle_note) <= 300));

-- Money cannot arrive for a charge that did not exist yet. Refused rather than
-- clamped, like every other date in this table.
alter table public.coach_invoices drop constraint if exists coach_invoices_settled_after_issue;
alter table public.coach_invoices add constraint coach_invoices_settled_after_issue
  check (settled_on is null or settled_on >= issued_on);

-- The same rule for the working note. A day to start chasing that falls before
-- the invoice existed is a typo, and it would sort to the top of an ageing list
-- as the most urgent thing the coach owns.
alter table public.coach_invoices drop constraint if exists coach_invoices_chase_after_issue;
alter table public.coach_invoices add constraint coach_invoices_chase_after_issue
  check (chase_from is null or chase_from >= issued_on);

-- Voiding and settling are alternatives, not a sequence. A document that says
-- both that it was cancelled and that it was paid describes two different
-- outcomes of one charge and tells a reader nothing.
alter table public.coach_invoices drop constraint if exists coach_invoices_not_both_chk;
alter table public.coach_invoices add constraint coach_invoices_not_both_chk
  check (voided_at is null or settled_on is null);

comment on column public.coach_invoices.settled_on is
  'The DAY the coach says the money for this invoice arrived. Their own word, exactly as `kind` is, and checked against nothing. Written once by settle_coach_invoice() and never moved: reversing a settlement is a chargeback or a bounced transfer, which is a different event on a different date.';
comment on column public.coach_invoices.settled_at is
  'When the coach recorded the settlement, as distinct from the day they say the money arrived. Both are needed: a quarter of payments written up in one evening must not all be dated that evening.';
comment on column public.coach_invoices.settle_note is
  'How the coach says it arrived, in their own words. Optional, printed verbatim on the reprinted document, and never parsed for anything.';
comment on column public.coach_invoices.chase_from is
  'The day the COACH decided to start chasing this one. NOT a due date: it is never printed on the document, was never shown to the client, and exists so that an invoice issued with no due date — which is every invoice issued before part 188 — can be on a chase list at all. May be moved or cleared, because it is the coach''s own plan and not a term anybody agreed to.';

-- The ageing lists read through due_on OR chase_from now, so the partial index
-- part 188 built on due_on alone misses exactly the rows this part exists to
-- put on a list. A second partial index rather than a wider one: the two
-- columns are never queried together and a composite would be scanned for
-- neither.
create index if not exists coach_invoices_chase_from_idx
  on public.coach_invoices (coach_id, chase_from)
  where chase_from is not null and voided_at is null and settled_on is null;

-- And the settled ones drop off every ageing query, so the index part 188 built
-- for them should stop carrying rows nobody will ask for again.
drop index if exists coach_invoices_due_idx;
create index if not exists coach_invoices_due_idx
  on public.coach_invoices (coach_id, due_on)
  where due_on is not null and voided_at is null and settled_on is null;

-- ── The guard, restated with four more columns ────────────────────────────
--
-- Verbatim from part 451 plus the rules for the new four. Replaced rather than
-- extended in place because it lists every immutable column by name and there
-- is no other way to add one — which is also the reason a new column is
-- DANGEROUS here: one added without a line in this function is a column
-- anything reaching this table may rewrite silently.
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
     -- STILL immutable, and this part does not weaken it. A settlement is a new
     -- fact recorded beside `kind`, never a rewrite of it: the document said
     -- the money was being requested and it still says so, and it now also says
     -- the issuer states it arrived. Flipping this to 'received' would edit a
     -- sentence on a copy somebody is already holding.
     or new.kind is distinct from old.kind
     or new.issued_on is distinct from old.issued_on
     -- On the list because it is on the DOCUMENT. A due date that could move
     -- after issue is a term changed under somebody who has already read it.
     -- `chase_from` below is the settable one precisely because it is NOT here.
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

  -- A settlement is written once and never unwritten. There is no un-settle for
  -- the same reason there is no un-void: money that came in and then went back
  -- out is a refund or a chargeback, which happened on its own day and belongs
  -- in its own record, and a column that could flip back would lose that day.
  if old.settled_on is not null
     and (new.settled_on is distinct from old.settled_on
          or new.settled_at is distinct from old.settled_at
          or new.settle_note is distinct from old.settle_note) then
    raise exception 'that invoice is already recorded as settled';
  end if;
  -- And it cannot be settled after it has been withdrawn.
  if old.voided_at is not null and new.settled_on is not null then
    raise exception 'a voided invoice cannot be settled';
  end if;

  -- One way only. Un-voiding would put a number back into circulation that the
  -- coach has already told somebody was cancelled.
  if old.voided_at is not null then
    raise exception 'that invoice is already voided';
  end if;
  return new;
end $$;

revoke all on function public.coach_invoices_immutable_guard() from public, anon, authenticated;

drop trigger if exists coach_invoices_immutable on public.coach_invoices;
create trigger coach_invoices_immutable
  before update on public.coach_invoices
  for each row execute function public.coach_invoices_immutable_guard();

-- ── Recording that it was paid ────────────────────────────────────────────

/**
 * Record that this invoice was settled, on a day the coach names.
 *
 * Scoped by `coach_id = auth.uid()` inside the function because SECURITY
 * DEFINER bypasses the read policy: without it any signed-in account could
 * mark a stranger's invoice paid.
 *
 * Raises rather than updating nothing, for part 138's reason: PostgREST reports
 * no error for a WHERE that matched nothing, so a settlement the coach believes
 * was recorded and was not is an invoice that stays on every chase list while
 * the screen says it came off one.
 *
 * `p_settled_on` comes from the DEVICE's local date, like `p_issued_on` does,
 * and is refused more than a day ahead of the server's — the widest timezone
 * skew there is. A coach cannot record money as having arrived tomorrow.
 */
create or replace function public.settle_coach_invoice(
  p_id         uuid,
  p_settled_on date,
  p_note       text default null
)
returns public.coach_invoices
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  inv public.coach_invoices;
  nte text;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  if p_id is null then
    raise exception 'no invoice given';
  end if;
  if p_settled_on is null then
    raise exception 'say which day the money arrived';
  end if;
  if p_settled_on > current_date + 1 then
    raise exception 'money cannot have arrived on a day that has not happened';
  end if;

  nte := nullif(btrim(coalesce(p_note, '')), '');
  if nte is not null and length(nte) > 300 then
    raise exception 'that note is longer than the document can print';
  end if;

  select * into inv from public.coach_invoices i
   where i.id = p_id and i.coach_id = uid
     for update;

  if inv.id is null then
    raise exception 'that invoice is not one of yours';
  end if;
  if inv.voided_at is not null then
    raise exception 'that invoice is voided, so there is nothing to settle';
  end if;
  if inv.settled_on is not null then
    raise exception 'that invoice is already recorded as settled';
  end if;
  -- A 'received' invoice already says the money came in. Settling it would
  -- record the same event twice, on two dates, on one document.
  if inv.kind = 'received' then
    raise exception 'that invoice already states the money was received';
  end if;
  if p_settled_on < inv.issued_on then
    raise exception 'money cannot have arrived before the invoice was written';
  end if;

  update public.coach_invoices i
     set settled_on  = p_settled_on,
         settled_at  = now(),
         settle_note = nte,
         -- The working note goes with it. An invoice that has been paid is on
         -- nobody's chase list and a date saying when to start chasing it is a
         -- reminder to ask for money that has arrived.
         chase_from  = null
   where i.id = p_id and i.coach_id = uid and i.settled_on is null
   returning * into inv;

  if inv.id is null then
    raise exception 'that invoice was not settled — nothing was changed';
  end if;
  return inv;
end $$;

revoke all on function public.settle_coach_invoice(uuid, date, text) from public, anon;
grant execute on function public.settle_coach_invoice(uuid, date, text) to authenticated;

comment on function public.settle_coach_invoice(uuid, date, text) is
  'Record that a requested invoice was paid, on a day the coach names. Writes settled_on/settled_at/settle_note once and never moves them, and does NOT touch `kind`, which stays exactly what the issued document said. Raises rather than reporting success over zero rows.';

-- ── Deciding when to start chasing one that has no due date ───────────────

/**
 * Set, move, or clear the day the coach means to start chasing this invoice.
 *
 * `p_from` null clears it, which is a real request and not a no-op: it puts the
 * invoice back on the undated list, which is where it was before anybody made a
 * plan for it.
 *
 * This does NOT write `due_on` and cannot. `due_on` is on the document and on
 * the immutable list above; this column is the coach's own working note and
 * appears on no artefact anybody else ever sees.
 *
 * There is deliberately no rule that `chase_from` be in the past, or the
 * future, or near anything. A coach filing a year of back catalogue may set
 * every one of them to today; a coach who has agreed to wait until March sets
 * March. Both are plans about their own book.
 */
create or replace function public.set_coach_invoice_chase_from(p_id uuid, p_from date)
returns public.coach_invoices
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  inv public.coach_invoices;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  if p_id is null then
    raise exception 'no invoice given';
  end if;

  select * into inv from public.coach_invoices i
   where i.id = p_id and i.coach_id = uid
     for update;

  if inv.id is null then
    raise exception 'that invoice is not one of yours';
  end if;
  if inv.voided_at is not null then
    raise exception 'that invoice is voided, so there is nothing to chase';
  end if;
  if inv.settled_on is not null then
    raise exception 'that invoice is settled, so there is nothing to chase';
  end if;
  if inv.kind = 'received' then
    raise exception 'that invoice states the money was received, so there is nothing to chase';
  end if;
  -- The one refusal that is about the DOCUMENT rather than about the state: an
  -- invoice that carries a due date is already on a chase list, dated by the
  -- term the client was actually shown, and a second private date beside it
  -- would give one invoice two answers to "when is this late".
  if inv.due_on is not null then
    raise exception 'that invoice already carries a due date, which is the date it is chased against';
  end if;
  if p_from is not null and p_from < inv.issued_on then
    raise exception 'a date to start chasing from cannot fall before the invoice was written';
  end if;

  update public.coach_invoices i
     set chase_from = p_from
   where i.id = p_id and i.coach_id = uid
   returning * into inv;

  if inv.id is null then
    raise exception 'that invoice was not changed';
  end if;
  return inv;
end $$;

revoke all on function public.set_coach_invoice_chase_from(uuid, date) from public, anon;
grant execute on function public.set_coach_invoice_chase_from(uuid, date) to authenticated;

comment on function public.set_coach_invoice_chase_from(uuid, date) is
  'Set or clear the coach''s own working note of when to start chasing an invoice that carries no due date. Never writes due_on, which is on the document and immutable. Refuses an invoice that already has a due date, so no invoice ever has two answers to when it is late.';
