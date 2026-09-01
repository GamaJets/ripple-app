-- ═══════════════════════════════════════════════════════════════════════════
-- "Who owes me money" was the most common unanswered question in this app.
--
-- src/lib/coachInvoice.ts said so in its own type: `InvoiceKind` is
-- 'received' | 'requested' and the header explained that there was no third
-- value because 'overdue' "would require a due date this app does not collect
-- and a clock it does not run".
--
-- Half of that was a real refusal and half of it was a missing column.
--
-- ── What this app must still never do ─────────────────────────────────────
--
-- Invent a payment term. Thirty days is a convention in one trade in one
-- country; a personal trainer in Dubai settling weekly in cash has no such
-- term and never agreed to one. A default of any number of days would print a
-- deadline on a document under somebody's name that they did not choose.
--
-- Calculate interest, a statutory late fee, or anything else that turns
-- lateness into money. Those turn on jurisdiction, on registration status and
-- on what the parties actually agreed, none of which this app knows — the same
-- argument part 138 makes about tax, and it holds here unchanged.
--
-- Claim a client has failed to pay. Nothing tells this app when a bank
-- transfer lands or when cash changes hands. An invoice is outstanding here
-- because the COACH has not said otherwise, and `AGEING_IS_YOUR_OWN_RECORD` in
-- src/lib/coachInvoice.ts says exactly that on the screen.
--
-- ── What it may do, because the coach did it ──────────────────────────────
--
-- A due date the coach TYPES is not this app inventing a term: it is the coach
-- recording one they already have with that client. Collecting it is not
-- inventing it. And once it is collected, "past the date you typed" is
-- arithmetic against the device's own clock rather than a judgement.
--
-- So this part adds three columns and one function:
--
--   due_on          the date the coach typed, or null because they did not
--   reminded_at     when they last chased it
--   reminder_count  how many times they have
--
--   remind_coach_invoice(p_id)  records one chase and returns the row
--
-- ── Why due_on is immutable and reminder_count is not ─────────────────────
--
-- `due_on` is PRINTED ON THE DOCUMENT. Part 138's whole design is that an
-- issued invoice cannot be edited once somebody is holding a copy of it, and a
-- due date that could be moved afterwards would let a coach change the terms of
-- a document already in a client's inbox — which is worse than editing an
-- amount, because nobody re-reads a date they have already noted. It joins the
-- list in the immutable guard.
--
-- `reminded_at` and `reminder_count` are NOT on the document. They are the
-- coach's own record of an act they performed, they change after issue by
-- definition, and they are the two fields the guard has to let through. It lets
-- them through NARROWLY: the count may only ever go up by exactly one, so a
-- future writer cannot reset a coach's chasing history to zero.
--
-- ── Why chasing is a function and not an UPDATE grant ─────────────────────
--
-- `coach_invoices` grants SELECT and nothing else, and part 138 says why: a
-- write grant on this table is a write grant on a financial document. Adding
-- one for two harmless columns would open UPDATE on the row, and RLS narrows a
-- grant rather than creating one — the guard would then be the only thing
-- standing between an issued amount and anybody who wanted to edit it. So the
-- grant stays revoked and the chase goes through a SECURITY DEFINER function
-- that touches exactly two columns.
--
-- auth.uid() throughout, never current_user: under PostgREST every signed-in
-- request runs as the shared `authenticated` role.
-- ─────────────────────────────────────────────────────────────────────────

-- ── The three columns ─────────────────────────────────────────────────────

alter table public.coach_invoices add column if not exists due_on date;
alter table public.coach_invoices add column if not exists reminded_at timestamptz;
alter table public.coach_invoices add column if not exists reminder_count integer not null default 0;

-- Nullable, with NO default. Null is not "not due" and it is not thirty days:
-- it is the coach not having stated one, and `invoiceAge()` reports it as its
-- own state rather than folding it in with the invoices that are inside their
-- terms. Every invoice issued before this part carries null, and every one of
-- them must read as "nobody said when", not as "comfortably within terms".
alter table public.coach_invoices drop constraint if exists coach_invoices_due_after_issue;
alter table public.coach_invoices add constraint coach_invoices_due_after_issue
  check (due_on is null or due_on >= issued_on);

alter table public.coach_invoices drop constraint if exists coach_invoices_reminders_nonneg;
alter table public.coach_invoices add constraint coach_invoices_reminders_nonneg
  check (reminder_count >= 0 and (reminder_count = 0) = (reminded_at is null));

comment on column public.coach_invoices.due_on is
  'The day the ISSUER said they expect to be paid by, typed by them. Nullable and undefaulted: null means they did not state one, never thirty days and never "not due". No interest and no late fee is calculated anywhere from it.';
comment on column public.coach_invoices.reminded_at is
  'When the coach last chased this one. Not printed on the document — it is their own record of an act they performed.';
comment on column public.coach_invoices.reminder_count is
  'How many times the coach has chased. Only ever increases, one at a time, through remind_coach_invoice().';

-- The chasing list is read "oldest due first, still outstanding". Partial on
-- due_on because an invoice with no due date is on no ageing list at all, so
-- indexing the nulls would be indexing the rows this query never wants.
create index if not exists coach_invoices_due_idx
  on public.coach_invoices (coach_id, due_on)
  where due_on is not null and voided_at is null;

-- ── The guard, widened by exactly two columns ─────────────────────────────
--
-- Replaced rather than extended in place: part 138 lists every immutable column
-- by name, and a guard that omitted `due_on` would let the one new
-- document-bearing field through. `create or replace` on the same signature, so
-- the trigger created in 138 keeps pointing at it.
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

-- ── Issuing, now with the date on it ──────────────────────────────────────
--
-- The old eight-argument signature is DROPPED rather than left beside the new
-- one. `create or replace` with a different argument list creates an OVERLOAD,
-- and PostgREST resolving `issue_coach_invoice` against two candidates with
-- compatible defaults is an ambiguity that surfaces as a 300 at the moment a
-- coach taps Issue. Dropping first is what makes exactly one function exist.
drop function if exists public.issue_coach_invoice(text, text, bigint, date, text, uuid, text, text);

create or replace function public.issue_coach_invoice(
  p_bill_to      text,
  p_description  text,
  p_amount_cents bigint,
  p_issued_on    date,
  p_kind         text,
  p_client_id    uuid default null,
  p_currency     text default null,
  p_note         text default null,
  p_due_on       date default null
)
returns public.coach_invoices
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  ccy text;
  n   integer;
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
    (coach_id, seq, client_id, bill_to, description, amount_cents, currency, kind, issued_on, due_on, note)
  values
    (uid, n, p_client_id, btrim(p_bill_to), btrim(p_description), p_amount_cents, ccy, p_kind,
     p_issued_on, p_due_on, nullif(btrim(coalesce(p_note, '')), ''))
  returning * into out_row;

  return out_row;
end $$;

-- ── Chasing ──────────────────────────────────────────────────────────────
--
-- Records that the coach chased. It does NOT send anything: the notification to
-- the client is written by src/ui/coachInvoices.ts through notify_users(), the
-- same path the original issue notification takes, and the document itself
-- still leaves the phone through the share sheet because `coach_invoices` is
-- readable by the issuing coach alone.
--
-- Refuses a voided invoice and refuses one the coach stated was received. Both
-- would be a reminder about money that is not outstanding, sent to a person who
-- has already paid it — which is the single worst message this feature can
-- produce and the reason it is refused in the database as well as on screen.
--
-- There is no cooldown. How often a self-employed person chases their own
-- customer is their decision; what the app owes them is the COUNT, so they can
-- see they have already sent four. src/lib/nudge.ts's thirty-day floor is about
-- the app nagging a client on the coach's behalf and is a different thing.
create or replace function public.remind_coach_invoice(p_id uuid)
returns public.coach_invoices
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  out_row public.coach_invoices;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  update public.coach_invoices i
     set reminded_at = now(), reminder_count = i.reminder_count + 1
   where i.id = p_id
     and i.coach_id = uid
     and i.voided_at is null
     and i.kind = 'requested'
  returning * into out_row;

  -- Zero rows updated is not success. PostgREST reports no error for a WHERE
  -- that matched nothing, so the four reasons this can match nothing — not
  -- yours, no such id, voided, or already stated received — have to be turned
  -- into a message here rather than read as a chase that went out.
  if out_row.id is null then
    raise exception 'nothing of yours to chase with that id — it may be voided, or you may have stated it was already received';
  end if;

  return out_row;
end $$;

revoke all on function public.issue_coach_invoice(text, text, bigint, date, text, uuid, text, text, date) from public, anon;
revoke all on function public.remind_coach_invoice(uuid) from public, anon;
grant execute on function public.issue_coach_invoice(text, text, bigint, date, text, uuid, text, text, date) to authenticated;
grant execute on function public.remind_coach_invoice(uuid) to authenticated;
