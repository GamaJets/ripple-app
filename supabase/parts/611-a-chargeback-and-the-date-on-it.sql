-- ═══════════════════════════════════════════════════════════════════════════
-- A chargeback, and the date nobody was told about.
--
-- app/(trainer)/payments.tsx tells a coach on a STANDARD account, out loud,
-- that "a dispute is theirs to answer". That sentence is true and it was, until
-- this part, the whole of what this app did about a dispute: it told a coach
-- that answering one was their job while giving them no way to know one
-- existed.
--
-- ── Why this is not just another silence ─────────────────────────────────
--
-- Every other thing the notification sweeps have found — a quiet client, a
-- block that ran out, an expiring certificate — costs something by degrees. A
-- chargeback costs everything on a fixed day. Stripe gives the merchant a
-- window to submit evidence (`evidence_details.due_by`), and when that instant
-- passes the case is decided on whatever was submitted. Nothing is the
-- commonest submission and it loses by default: the money is taken back out of
-- the coach's balance and, on a direct charge, a dispute fee with it.
--
-- So the DEADLINE is the content of this feature. Not the amount, not the
-- reason code, not the client's name: the date. It is in the title of the
-- notification, at the top of the row on the Payments screen, and it is the one
-- field a screen may never render as "—" while quietly showing the rest.
--
-- ── What this part adds ──────────────────────────────────────────────────
--
--   client_disputes         one row per Stripe dispute, mirrored by the
--                           webhook from charge.dispute.created / .updated /
--                           .closed.
--   client_dispute_notify   the coach is told when one opens and when it is
--                           decided, and told the date both times.
--
-- ── Why a table and not a column on the sale ─────────────────────────────
--
-- A dispute is not a property of a purchase. It has its own identity at Stripe,
-- its own status machine, its own deadline, and — the part that settles it — it
-- can exist with NO row in either money table to hang off. A client can charge
-- back a payment whose `checkout.session.completed` was never delivered (which
-- is precisely the failure mode the stripe-webhook header describes at length),
-- and a design that could only record a dispute against a sale it already knew
-- about would lose exactly the disputes that matter most. `purchase_id` and
-- `renewal_id` are therefore both nullable: the dispute is recorded either way,
-- and an unattached one is a louder signal rather than a dropped one.
--
-- ── What is NOT recorded here, and will not be ───────────────────────────
--
-- EVIDENCE. Stripe's evidence object holds receipts, customer communications,
-- service documentation and a shipping address; mirroring any of that would put
-- a client's correspondence into this database with no policy written for it,
-- and it is submitted in the coach's own Stripe dashboard, which is the only
-- place it can be submitted from on a direct charge. This app records that a
-- case exists and when it closes.
--
-- A NET FIGURE. There is no `fee_cents` and no `net_cents`, exactly as part 132
-- refused them: Stripe's dispute fee is not on this event, and a column that
-- exists is a column a screen will one day print as a fact.
--
-- Idempotent; safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.client_disputes (
  id uuid primary key default gen_random_uuid(),

  -- The idempotency key. Stripe sends `created`, any number of `updated`s and
  -- one `closed` for the same case, and every one of them lands on this row.
  stripe_dispute_id text not null unique,

  -- What was disputed, as Stripe names it. Both are kept because the two
  -- lookups below need different ones: the charge is what a person sees in the
  -- Stripe dashboard, the PaymentIntent is what `client_purchases` now carries
  -- (part 610).
  stripe_charge_id text,
  stripe_payment_intent text,

  -- Which ledger it happened on. Null is the platform — a destination charge,
  -- where Repple is the merchant of record and the dispute is Repple's to
  -- answer. Non-null is the coach's own connected account, where it is theirs.
  -- The distinction changes who has to do something, so it is stored rather
  -- than inferred from whatever the coach's account type says today.
  stripe_account_id text,

  -- Who is affected. Both nullable and both `on delete set null`, exactly like
  -- the two money tables: a deleted account must not delete the record that a
  -- chargeback happened.
  trainer_id uuid references public.profiles(id) on delete set null,
  client_id  uuid references public.profiles(id) on delete set null,

  -- What it was for, when this database can tell. Nullable on purpose — see the
  -- header: a dispute against a payment this app never recorded is still a
  -- dispute, and refusing to write it would lose the worst case of all.
  purchase_id uuid references public.client_purchases(id) on delete set null,
  renewal_id  uuid references public.client_subscription_payments(id) on delete set null,

  -- Gross, in minor units, as Stripe states it on the dispute. Null when Stripe
  -- somehow states none, and null stays null: an amount with no unit joins no
  -- total, and there is no default currency in this product (part 150).
  amount_cents bigint,
  currency text,

  -- Stripe's own reason code — 'fraudulent', 'product_not_received',
  -- 'subscription_canceled' and the rest. Stored raw and untranslated, because
  -- the list is Stripe's and grows, and a word this app did not recognise
  -- rendered as "Other" is worse than the word itself.
  reason text,

  -- Stripe's own status: needs_response, under_review, won, lost,
  -- warning_needs_response, warning_under_review, warning_closed. Not
  -- constrained to a list, for the same reason `reason` is not: Stripe adds
  -- values, and a check constraint that refuses one would make the webhook
  -- answer Stripe with a 500 forever on a case the coach most needs to see.
  status text not null,

  -- ── THE FIELD THIS TABLE EXISTS FOR ────────────────────────────────────
  --
  -- `evidence_details.due_by` from Stripe, as an instant. Nullable, and the
  -- null is a real state rather than an omission: an inquiry or an already
  -- closed case carries no deadline, and a screen that printed today's date
  -- into that gap would send a coach running at nothing. Where it is null the
  -- app says the deadline is in their Stripe dashboard and does not invent one.
  evidence_due_by timestamptz,

  -- When Stripe says the case opened, and when it closed. `closed_at` null
  -- means live, which is what every "do I have to do something" read filters on.
  opened_at timestamptz,
  closed_at timestamptz,

  -- Webhooks are not ordered. A stale `updated` delivered after the `closed`
  -- would otherwise reopen a case the coach has already been told the result
  -- of, and they would go and prepare evidence for it.
  stripe_event_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The coach's own read: their live cases, soonest deadline first, which is the
-- order a person acts in.
create index if not exists idx_client_disputes_trainer
  on public.client_disputes (trainer_id, evidence_due_by);
-- How the webhook finds an existing row when it holds a charge rather than the
-- dispute id.
create index if not exists idx_client_disputes_charge
  on public.client_disputes (stripe_charge_id) where stripe_charge_id is not null;

alter table public.client_disputes enable row level security;

-- The same shape as `client_sub_pay_read` on part 132, deliberately identical:
-- the coach whose money it is, and the owner OF THAT COACH'S GYM. The owner
-- branch goes through the trainer's tenant rather than testing `role = 'owner'`
-- — the role test lets any owner read every dispute on the platform, one
-- white-label customer reading another's chargebacks.
--
-- The CLIENT is deliberately not on this policy. They raised the dispute with
-- their own bank and their bank tells them what happens to it; showing somebody
-- a merchant-side case file with a reason code and an evidence deadline on it
-- is a different act entirely, and it is not one this app has been asked to do.
drop policy if exists client_disputes_read on public.client_disputes;
-- The coach and nobody else, which is what every neighbouring table already
-- says: coach_payouts, coach_invoices and coach_receipts are all
-- `coach_id = auth.uid()` with no second arm.
--
-- An earlier draft of this part also admitted the owner of the coach's gym.
-- Under direct charges the disputed money is the COACH's, taken on the coach's
-- own Stripe account, and the row names the client who disputed as well. So
-- that arm would have told a gym owner which of a coach's clients had gone to
-- their bank, about a payment that never touched the gym — and it would have
-- been the only coach-money table in the schema to do it.
--
-- If a gym ever needs this it is a deliberate widening with an argument
-- attached, not a default nobody chose.
create policy client_disputes_read on public.client_disputes for select using (
  trainer_id = (select auth.uid()));

-- No insert, update or delete policy, on purpose. RLS denies what no policy
-- permits, so this table is read-only to every signed-in user and writable only
-- by the service role the stripe-webhook runs as. Whether a bank reversed a
-- payment is Stripe's to state and nobody else's — least of all either party to
-- it.
--
-- Both API roles are revoked outright first rather than left to Supabase's
-- stock default privileges, which hand `anon` AND `authenticated` the full
-- select/insert/update/delete set on every new table (part 119 found that on 80
-- of 89 tables). `revoke ... from public` alone does not clear it: both are
-- grantees in their own right.
revoke all on public.client_disputes from anon;
revoke all on public.client_disputes from authenticated;
grant select on public.client_disputes to authenticated;

comment on table public.client_disputes is
  'One row per Stripe dispute on a coach''s charge, mirrored by supabase/functions/stripe-webhook from charge.dispute.created / .updated / .closed. Read-only to every signed-in user. evidence_due_by is the field this table exists for.';
comment on column public.client_disputes.evidence_due_by is
  'When Stripe stops accepting evidence on this case. NULL means Stripe stated none — an inquiry, or a case already closed — and must render as "the date is in your Stripe dashboard", NEVER as a date this app chose.';


-- ═════════════════════════════════════════════════════════════════════════
-- The coach is told, and told the date
-- ═════════════════════════════════════════════════════════════════════════
--
-- A trigger and not a scheduled pass, on part 202's test: this is a WRITE
-- happening — the webhook inserting or closing a case — rather than the absence
-- of one, and a chargeback a coach hears about tomorrow morning has spent a
-- night of a window that is often seven days long.
--
-- Two crossings, and only two. The INSERT, which is the case opening; and the
-- update that first sets `closed_at`, which is the result. Every `updated` in
-- between moves a status Stripe owns and says nothing a coach can act on, and a
-- notification per status change would wake a phone for a case the coach has
-- already submitted evidence on.
--
-- ── What the body may say ────────────────────────────────────────────────
--
-- NO FIGURE AND NO CURRENCY, which is part 163's rule and part 202's, held here
-- for the same reason: `minorMoney` in src/lib/coachMoney.ts is the one
-- formatter for money in this codebase, it knows how many decimal places a
-- currency has, and it is not reachable from plpgsql. A second formatter is the
-- copy that drifts. The amount is on the Payments screen, priced by the code
-- that knows how.
--
-- NO CLIENT NAME. `client_id` is frequently null here — a dispute can arrive
-- against a payment this app never recorded — and a sentence that sometimes
-- names a person and sometimes does not reads as though the app has lost track
-- of who it was. The sale is on the Payments screen with the name on it.
--
-- THE DATE, first, in the title. `to_char(... 'DD Mon YYYY')` is the same
-- format part 202 and part 471 already use for a date in a notification body,
-- so a coach reads one shape of date across their whole inbox.

create or replace function public.client_dispute_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_opened boolean;
  v_due    text;
  v_title  text;
  v_body   text;
begin
  -- `notifications.user_id` is `not null references profiles(id)`, so a dispute
  -- on an account whose coach has deleted theirs has nobody to tell. Guarded
  -- rather than left to throw: this fires inside the webhook's transaction, and
  -- an exception here answers Stripe with a 500 on an event that would then be
  -- retried forever.
  if new.trainer_id is null then
    return null;
  end if;

  if TG_OP = 'INSERT' then
    -- A case can arrive here ALREADY CLOSED. That is not hypothetical: it is
    -- what happens the first time a connected destination is subscribed to
    -- `charge.dispute.closed` without `charge.dispute.created`, and what
    -- happens when the two are delivered out of order. Telling a coach "evidence
    -- due by the 14th" about a case Stripe has already decided would send them
    -- to prepare a submission nothing will accept, so the result is what they
    -- are told instead.
    v_opened := new.closed_at is null;
  elsif new.closed_at is not null and old.closed_at is null then
    v_opened := false;
  else
    -- A status moving between two live states. Nothing here for a person to do
    -- that they were not already told to do.
    return null;
  end if;

  v_due := case
    when new.evidence_due_by is null then null
    else to_char(new.evidence_due_by at time zone 'UTC', 'DD Mon YYYY')
  end;

  if v_opened then
    -- The date is in the TITLE, which is the line that renders on a lock screen
    -- and the line a coach reads in a list of eleven rows. Everything else
    -- about a chargeback can wait until they open it; the date cannot.
    v_title := case
      when v_due is null then 'A chargeback — the deadline is in your Stripe dashboard'
      else 'A chargeback — evidence due by ' || v_due
    end;
    v_body := 'A client has disputed a payment with their bank, and their card issuer has taken the money back while it is decided.'
      || case
           when v_due is null then ' Stripe has not stated a date on this one; your Stripe dashboard has it, and it is the only place evidence can be submitted.'
           else ' Stripe stops accepting evidence on ' || v_due || ', and after that the case is decided on whatever was submitted by then.'
         end
      || ' Sending nothing loses it by default, so send something even if it is thin: session records, your messages with them, the agreement they signed.'
      || ' Payments & Packages has the sale and the amount; the evidence itself goes in through your Stripe dashboard.';
  else
    v_title := case
      when new.status = 'won' then 'A chargeback was decided in your favour'
      when new.status = 'lost' then 'A chargeback went against you'
      else 'A chargeback has been closed'
    end;
    v_body := case
      when new.status = 'won' then 'The bank found for you and the money stays with you. Nothing further is needed on this one.'
      when new.status = 'lost' then 'The bank found for the client. The money has gone back to them and it is not coming back — a lost dispute cannot be appealed through Stripe, and on your own charges the dispute fee comes out of your balance too.'
      else 'The case is closed at Stripe with the status ' || coalesce(new.status, 'unknown') || '. Your Stripe dashboard has what that means for this one.'
    end
      || ' Payments & Packages still shows the sale, marked, so the money you can see there is the money that actually stood.';
  end if;

  insert into public.notifications (user_id, title, body, icon, route)
  values (new.trainer_id, left(v_title, 200), left(v_body, 500), 'grid', '/(trainer)/payments');

  return null;
end $fn$;

comment on function public.client_dispute_notify() is
  'Tells the COACH when a chargeback opens and when it is decided, and puts Stripe''s evidence deadline in the TITLE both times. Carries no amount and no currency — coachMoney.ts is the one money formatter in this codebase and it is not reachable from here.';

drop trigger if exists client_disputes_notify_open on public.client_disputes;
create trigger client_disputes_notify_open
  after insert on public.client_disputes
  for each row execute function public.client_dispute_notify();

drop trigger if exists client_disputes_notify_closed on public.client_disputes;
create trigger client_disputes_notify_closed
  after update of closed_at on public.client_disputes
  for each row execute function public.client_dispute_notify();

-- Revoked from public, anon AND authenticated. Postgres checks EXECUTE when a
-- trigger is CREATED and not when it fires (parts 51, 141, 158, 202), so a
-- trigger function needs no grant to anybody; Postgres grants EXECUTE to PUBLIC
-- on every new function and `anon` resolves through that grant, so both are
-- named.
revoke all on function public.client_dispute_notify() from public;
revoke all on function public.client_dispute_notify() from anon;
revoke all on function public.client_dispute_notify() from authenticated;
