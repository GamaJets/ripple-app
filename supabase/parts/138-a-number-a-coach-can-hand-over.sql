-- ─────────────────────────────────────────────────────────────────────────
-- A number a coach can hand over.
--
-- ── What was missing ─────────────────────────────────────────────────────
--
-- Stripe Connect takes the money (part 20, src/lib/connect.ts) and produces no
-- document. A `client_purchases` row is a ledger line inside this app; it is
-- not something a self-employed trainer can give to the person who paid them,
-- and it does not exist at all for the half of a coach's book that pays in
-- cash, by bank transfer, or through a gym. So a working trainer had no way to
-- answer "can you send me something for that?" and no record of what they had
-- already sent to whom.
--
-- This is that record. One row per document the coach issued, numbered in the
-- coach's own sequence, in one stated currency, saying who it was for and what
-- it was for.
--
-- ── What this is NOT, and why the schema says so out loud ────────────────
--
-- An invoice is a legal-ish artefact and the temptation is to build the whole
-- of one. This deliberately does not:
--
--   · NO TAX. There is no tax rate, no tax amount, no VAT/GST registration
--     number and no gross/net split anywhere in this table. Tax treatment
--     depends on the coach's country, their registration status, where the
--     client is, and what was sold — none of which Repple knows or asks. A
--     column called `vat_cents` that the app defaulted to zero would put a
--     statement about somebody's tax affairs on a document with their name on
--     it, and it would be wrong for most of them. The amount stored is the
--     amount charged, flat, and the document says in plain words that no tax
--     has been calculated or included.
--
--   · NO CLAIM THAT MONEY MOVED. `kind` is the COACH'S OWN statement — either
--     'received' (they say they have been paid) or 'requested' (they are
--     asking). Repple does not verify either. This is not a Stripe receipt and
--     the document says so; where Stripe did take the money, Stripe's own
--     receipt is the artefact that proves it.
--
--   · NO SEQUENCE WE CANNOT GUARANTEE. Many tax regimes require a gapless
--     sequence across everything a business issues. This one is gapless within
--     THIS APP and per coach — a unique (coach_id, seq) and an allocation
--     under an advisory lock, so two phones issuing at once cannot collide and
--     cannot skip. It knows nothing about the invoices the same coach wrote in
--     a spreadsheet last year, so the document states that the number is
--     Repple's own and covers only what was issued here.
--
-- ── Immutable, except for being voided once ──────────────────────────────
--
-- A document that has been handed to somebody cannot be edited afterwards: the
-- copy in their inbox does not change, so an edit here would make the coach's
-- ledger disagree with the artefact that is out in the world. There is no
-- UPDATE and no DELETE grant, and no policy for either. The one change the
-- table permits is a void — `voided_at` and a reason, set once, through
-- void_coach_invoice() — and the number is never reused, because a missing
-- number in a sequence is a question and a reused one is a lie.
--
-- ── Who can read it ──────────────────────────────────────────────────────
--
-- The issuing coach, and nobody else. Not another coach, not a gym owner (a
-- self-employed trainer's own billing is not gym money — the same principle
-- part 106 restored for `invoices`), and not the client: the client is HANDED
-- the document by the coach, through the share sheet, which is the act that
-- decides they should have it. A read of the coach's ledger would also hand
-- them the numbers of every other document in it.
--
-- auth.uid() throughout, never current_user: under PostgREST every signed-in
-- request runs as the shared `authenticated` role.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.coach_invoices (
  id            uuid        primary key default gen_random_uuid(),
  coach_id      uuid        not null references public.trainers(id) on delete cascade,
  -- Per coach, from 1, allocated by issue_coach_invoice() below. NOT a global
  -- sequence: a coach's first document is their #1 whenever they join, and a
  -- database-wide counter would tell every one of them how many documents
  -- every other coach on the platform had issued.
  seq           integer     not null check (seq > 0),
  -- The client's account, where they have one. Nullable on purpose: a coach
  -- bills people who have never installed this app, and `bill_to` below is
  -- what actually gets printed. ON DELETE SET NULL rather than CASCADE — a
  -- client closing their account does not erase the coach's record of what
  -- they charged, which is the coach's own business record.
  client_id     uuid        references public.clients(id) on delete set null,
  -- The name printed on the document, snapshotted at issue. Deliberately a
  -- copy and not a join: a person who changes their name later has not changed
  -- the name on a document already in somebody's inbox, and a ledger that
  -- re-renders under the new one no longer matches the artefact.
  bill_to       text        not null check (btrim(bill_to) <> '' and length(bill_to) <= 200),
  description   text        not null check (btrim(description) <> '' and length(description) <= 500),
  -- Minor units, matching client_purchases.amount_cents and
  -- trainer_packages.price_cents, so nothing ever has to be converted between
  -- this table and the money the app already knows about. bigint for the same
  -- reason coach_code_spend uses it: a minor-unit amount in a currency with a
  -- large denomination passes 2^31 sooner than anyone expects.
  amount_cents  bigint      not null check (amount_cents > 0 and amount_cents < 100000000000),
  -- NOT NULL, and there is no default. tenants.currency is nullable on purpose
  -- (part 99) and null there means "this gym has not told us" — so an invoice
  -- simply cannot be issued until somebody states the currency. An invoice
  -- with the wrong three letters on it is worse than no invoice: it reads as a
  -- considered figure and it is a different amount of money.
  currency      text        not null check (currency = upper(btrim(currency)) and length(currency) between 3 and 4),
  -- The coach's own statement about the money, and nothing more. See the
  -- header: Repple does not verify either value.
  kind          text        not null check (kind in ('received', 'requested')),
  -- Passed by the app from the DEVICE's local date, not defaulted to
  -- current_date, which is UTC: a coach in Auckland issuing at 10am would
  -- otherwise date their document yesterday. The function refuses anything
  -- more than a day ahead of the server's own date, which is the widest
  -- timezone skew there is.
  issued_on     date        not null,
  note          text        check (note is null or length(note) <= 1000),
  voided_at     timestamptz,
  void_reason   text        check (void_reason is null or length(void_reason) <= 500),
  created_at    timestamptz not null default now(),
  -- Gapless per coach. The advisory lock in issue_coach_invoice() is what
  -- makes two simultaneous issues take two different numbers; this is the
  -- backstop that turns a race the lock somehow missed into a failed insert
  -- rather than two documents bearing the same number.
  constraint coach_invoices_seq_uniq unique (coach_id, seq),
  -- A void without a reason is a gap in the sequence nobody can explain later.
  constraint coach_invoices_void_chk check ((voided_at is null) = (void_reason is null))
);

comment on table public.coach_invoices is
  'Documents a coach issued to a client: a record of a charge they made, numbered per coach within this app. Not a tax invoice — no tax is calculated, included or stated anywhere. Not proof of payment: `kind` is the coach''s own claim, unverified. Insert and void only; never edited, never deleted, numbers never reused.';
comment on column public.coach_invoices.seq is
  'This coach''s own sequence, from 1. Gapless within Repple; it says nothing about documents the coach issued anywhere else.';
comment on column public.coach_invoices.kind is
  '''received'' or ''requested'' — what the COACH says about the money. Repple does not check it and it is not a Stripe receipt.';
comment on column public.coach_invoices.currency is
  'ISO 4217, uppercase, required. There is no default and no fallback — see tenants.currency in part 99.';
comment on column public.coach_invoices.bill_to is
  'The name as printed on the issued document, snapshotted. Not a join, so a later rename cannot make the ledger disagree with the copy the client holds.';

create index if not exists coach_invoices_coach_idx
  on public.coach_invoices (coach_id, issued_on desc, seq desc);
create index if not exists coach_invoices_client_idx
  on public.coach_invoices (client_id) where client_id is not null;

-- ── Immutable, except for the one-way void ────────────────────────────────
--
-- Modelled on part 135's coach_documents guard. There is no UPDATE grant and
-- no UPDATE policy, so nothing reaches this trigger except the SECURITY
-- DEFINER function below — which bypasses RLS but not triggers. That is the
-- point: the guard is what stops a future function, written by somebody who
-- has not read this header, from quietly editing an amount on a document
-- somebody is already holding.
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
     or new.note is distinct from old.note
     or new.created_at is distinct from old.created_at then
    raise exception 'an issued invoice cannot be edited — void it and issue another';
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

-- ── Row-level security ────────────────────────────────────────────────────

alter table public.coach_invoices enable row level security;

drop policy if exists coach_invoices_owner_read on public.coach_invoices;
create policy coach_invoices_owner_read on public.coach_invoices
  for select
  to authenticated
  using (coach_id = (select auth.uid()));

-- Named and dropped rather than merely never written, so that a policy added
-- by somebody who wanted an "edit" button cannot survive a rebuild of this
-- file. The two functions below are the whole write surface.
drop policy if exists coach_invoices_owner_insert on public.coach_invoices;
drop policy if exists coach_invoices_owner_update on public.coach_invoices;
drop policy if exists coach_invoices_owner_delete on public.coach_invoices;
drop policy if exists coach_invoices_client_read on public.coach_invoices;
drop policy if exists coach_invoices_owner_of_gym_read on public.coach_invoices;

-- RLS narrows a GRANT; it does not create one. SELECT is granted and then
-- narrowed to the coach's own rows; everything else is revoked outright so
-- that adding a policy later is not by itself enough to open a write.
grant select on public.coach_invoices to authenticated;
revoke insert, update, delete on public.coach_invoices from authenticated;
revoke all on public.coach_invoices from anon;

-- ── Issuing ───────────────────────────────────────────────────────────────

/**
 * Issue one invoice and return it, number included.
 *
 * The number is allocated here rather than by a Postgres sequence because the
 * sequence has to be PER COACH and gapless. A shared sequence would leak the
 * platform's volume onto every coach's paperwork, and `nextval` gaps on every
 * rolled-back transaction — which for a document sequence is exactly the thing
 * that has to be explainable later.
 *
 * pg_advisory_xact_lock on the coach's own id serialises concurrent issues by
 * the same coach (two devices, or a double tap) without touching any other
 * coach's writes; the unique constraint is the backstop if it is ever removed.
 *
 * p_currency may be omitted, and is then resolved exactly the way
 * set_code_spend() resolves it in part 98: the coach's own packages when they
 * unanimously agree on one, else the gym's `tenants.currency`. It does NOT
 * fall back to a literal. Where nothing states a currency the issue is REFUSED
 * and the coach is asked, because tenants.currency is nullable on purpose and
 * null means "nobody has told us".
 *
 * Scoped by coach_id = auth.uid() inside the function because SECURITY DEFINER
 * bypasses the read policy above: without it any signed-in account could issue
 * documents in another coach's name and sequence.
 */
create or replace function public.issue_coach_invoice(
  p_bill_to      text,
  p_description  text,
  p_amount_cents bigint,
  p_issued_on    date,
  p_kind         text,
  p_client_id    uuid default null,
  p_currency     text default null,
  p_note         text default null
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
  -- A day's grace AHEAD of the server's own date, which is UTC. The app passes
  -- the DEVICE's local date, and the widest real timezone offset is under 15
  -- hours — so a legitimate local "today" is never more than one day past the
  -- server's. Anything beyond that is a typed date, and a document dated next
  -- month is not a record of something that happened.
  --
  -- One side only. This said "on each side", which reads as a symmetric window;
  -- there is no lower bound here and none anywhere else, so an invoice may be
  -- backdated without limit. That is deliberate — a coach writing up last
  -- quarter's work is an ordinary thing and a floor would refuse it — but the
  -- sentence claimed a guard that does not exist, which is worse than saying
  -- nothing about the past at all.
  if p_issued_on > current_date + 1 then
    raise exception 'an invoice cannot be dated in the future';
  end if;

  -- A client id, if given, must be one of this coach's own. Otherwise a coach
  -- could attach their document to a stranger's account row.
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

  -- Serialise this coach's own issues. Two phones tapping Issue at the same
  -- moment take two different numbers rather than colliding on the unique
  -- index and losing one of the documents.
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 138));

  select coalesce(max(i.seq), 0) + 1 into n
  from public.coach_invoices i
  where i.coach_id = uid;

  insert into public.coach_invoices
    (coach_id, seq, client_id, bill_to, description, amount_cents, currency, kind, issued_on, note)
  values
    (uid, n, p_client_id, btrim(p_bill_to), btrim(p_description), p_amount_cents, ccy, p_kind,
     p_issued_on, nullif(btrim(coalesce(p_note, '')), ''))
  returning * into out_row;

  return out_row;
end $$;

/**
 * Void one, once, with a reason.
 *
 * The row stays and the number stays spent. A deleted invoice leaves a hole in
 * a sequence that the coach will one day have to explain; a voided one
 * explains itself.
 */
create or replace function public.void_coach_invoice(p_id uuid, p_reason text)
returns public.coach_invoices
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  out_row public.coach_invoices;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'say why it is being voided — a cancelled number with no reason is a question nobody can answer later';
  end if;

  update public.coach_invoices i
     set voided_at = now(), void_reason = btrim(p_reason)
   where i.id = p_id and i.coach_id = uid and i.voided_at is null
  returning * into out_row;

  -- Zero rows updated is not success. PostgREST reports no error for a WHERE
  -- that matched nothing, so the distinction between "voided" and "that is not
  -- yours, or it was already voided" has to be made here.
  if out_row.id is null then
    raise exception 'no invoice of yours to void with that id';
  end if;

  return out_row;
end $$;

revoke all on function public.issue_coach_invoice(text, text, bigint, date, text, uuid, text, text) from public, anon;
revoke all on function public.void_coach_invoice(uuid, text) from public, anon;
grant execute on function public.issue_coach_invoice(text, text, bigint, date, text, uuid, text, text) to authenticated;
grant execute on function public.void_coach_invoice(uuid, text) to authenticated;
