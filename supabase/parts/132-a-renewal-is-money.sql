-- ── A coach could not be told what they had earned ─────────────────────────
--
-- Stripe Connect has worked for months. A client buys a package, the charge
-- lands on the coach's Express account, and `client_purchases` records it. A
-- client SUBSCRIBES to a package (part 97) and the charge repeats every month
-- — and nothing anywhere in this database records a single one of those
-- charges as an amount of money.
--
-- The webhook's `invoice.*` branch handles a paid renewal by re-reading the
-- subscription from Stripe and writing its STATUS. That is the right thing to
-- do with a status and it is not a ledger: after a year of a client paying AED
-- 600 a month, this database holds one row saying "active, AED 600 / month"
-- and no record that twelve payments happened. So the payments screen could
-- only ever print a standing PRICE and say, honestly and uselessly, that
-- renewals could not be added up. The one question a working coach asks about
-- the app taking their money — how much have I earned — had no answer in here
-- to give.
--
-- Two things are missing and both are in this part.
--
-- ── 1. A sale with no currency ─────────────────────────────────────────────
--
-- `client_purchases` records `amount_cents` and has never recorded what those
-- cents ARE. The unit of a past sale lives in the `trainer_packages` row it was
-- bought from, and a package deleted after the sale takes the unit with it —
-- leaving an amount that can never be denominated again, in a white-label
-- product where a London gym and a Dubai gym run the same code. The screen
-- already counts those and reports them as missing from the total rather than
-- summing them as dollars, which is the correct handling of a hole and not a
-- reason to keep digging one.
--
-- The Checkout Session states its own currency — `sess.currency`, which is what
-- Stripe actually charged in, not what a package row says today — so from now
-- on the webhook writes it onto the purchase and the unit stops depending on a
-- row the coach is free to delete.
--
-- Existing rows are backfilled FROM THEIR PACKAGE, and only where the package
-- is still there. The rest stay NULL. There is no fallback and there must never
-- be one: a currency this migration invented would be indistinguishable, on
-- screen, from one Stripe confirmed, and it would be wrong for every gym
-- outside whichever country the guess came from. NULL means "we cannot say",
-- the screen says so, and Stripe still holds the truth.
--
-- ── 2. A renewal is money and has to be written down as money ──────────────
--
-- `client_subscription_payments` is a ledger: one row per paid Stripe invoice
-- on a client's coaching subscription. It is what makes "earned this month"
-- answerable at all.
--
-- Why one row per INVOICE, keyed on the Stripe invoice id:
--
--   · A subscription is a state; an invoice is an event that moved money. The
--     first is overwritten every time Stripe says something new, the second
--     must never be. Adding an `amount_paid_total` to `client_subscriptions`
--     would be a running total nothing could audit, that a replayed webhook
--     could double, and that could not answer "how much in August".
--
--   · The invoice id is the idempotency key. Stripe sends both `invoice.paid`
--     and `invoice.payment_succeeded` for the same invoice, and retries either
--     of them; all of that upserts onto one row instead of counting a month's
--     rent two or three times. The replay ledger in part 97 is the belt — this
--     is the braces, and it is the one that holds when a future event type is
--     added and forgotten.
--
-- Why it is a separate table from `client_purchases` rather than more rows in
-- it: `client_purchases` carries `sessions_total` / `sessions_used`, and
-- `redeem_pack_session` (part 123) draws credits down from any row it finds
-- there. A renewal filed in that table would be a purchase with no credits that
-- every pack query would have to learn to skip — and the day one of them forgot
-- would be the day a client's booking silently spent a credit that does not
-- exist. Money that grants nothing is a different thing and gets its own table.
--
-- Why there is no `status` column: only PAID invoices are written here. A
-- failed renewal is a fact about the subscription — `past_due` on
-- `client_subscriptions`, which is where the client and the coach already read
-- it — and a failed payment in a table of payments is exactly the row somebody
-- eventually sums by accident.
--
-- ── What this still cannot say, and no column here will fix ────────────────
--
-- Everything below is GROSS: what the client was charged. Stripe's processing
-- fee, the platform's application fee, whether the money has cleared, and when
-- it lands in the coach's bank are all facts that live at Stripe and that no
-- webhook in this repo has ever been told. There is deliberately no
-- `net_cents`, no `fee_cents` and no `paid_out_at` — a column that exists is a
-- column a screen will one day print, and every one of those three would be
-- printed as a payout figure that this product invented. The screen says the
-- figure is gross and points at the Stripe dashboard for the rest.

-- ── 1. the unit of a sale ──────────────────────────────────────────────────
alter table public.client_purchases add column if not exists currency text;

-- Either case. Stripe states a currency in lower case ('aed') and that is what
-- the webhook writes verbatim; `trainer_packages.currency` holds the gym's own
-- in upper case, and that is what the backfill below copies. Both are the same
-- currency and the app upper-cases before it prints or pots either of them, so
-- normalising here would only add a way for the two writers to disagree with
-- the constraint.
alter table public.client_purchases drop constraint if exists client_purchases_currency_is_iso;
alter table public.client_purchases add constraint client_purchases_currency_is_iso
  check (currency is null or currency ~ '^[A-Za-z]{3}$');

-- Only where the package survives. A sale whose package is gone keeps a NULL
-- currency forever, and that is the honest state — see the note above.
update public.client_purchases cp
   set currency = tp.currency
  from public.trainer_packages tp
 where tp.id = cp.package_id
   and cp.currency is null
   and tp.currency is not null;

comment on column public.client_purchases.currency is
  'ISO 4217 as Stripe stated it on the Checkout Session (lower case), or as copied from the package for rows sold before this column existed (upper case). NULL means the unit is unrecoverable — the package it was sold from is gone. Never guess one: render a dash and leave the amount out of every total.';

-- ── 2. the renewal ledger ──────────────────────────────────────────────────
create table if not exists public.client_subscription_payments (
  id uuid primary key default gen_random_uuid(),
  -- Who paid and who was paid. Nullable and `on delete set null`, exactly like
  -- `client_purchases`: a deleted account must not delete the record that money
  -- changed hands. A row whose trainer_id is null is unreadable by anybody
  -- except the service role, which is the correct outcome — it is still
  -- evidence, it just no longer belongs to a coach's screen.
  client_id  uuid references profiles(id) on delete set null,
  trainer_id uuid references profiles(id) on delete set null,
  -- The subscription this renewed, as Stripe's id and NOT as a foreign key to
  -- `client_subscriptions`. Webhooks are not ordered: the money event can
  -- arrive before the row that mirrors the subscription exists, and a foreign
  -- key would refuse the write and lose the payment to preserve a join. The
  -- join is a convenience; the payment is the record.
  stripe_subscription_id text,
  -- The idempotency key. Two event types and any number of retries describe the
  -- same invoice, and all of them land on this one row.
  stripe_invoice_id text not null unique,
  -- What Stripe actually collected, in minor units, as `amount_paid` on the
  -- invoice. NULL when Stripe stated nothing — which must render as a dash and
  -- be counted out of the total, never as zero. A real zero (a fully discounted
  -- renewal) is a real zero and is stored as one.
  amount_cents integer,
  -- The currency of that amount, from the invoice itself. NULL only if Stripe
  -- somehow stated none; an amount with no unit joins no total.
  currency text,
  -- Stripe's own word for why this invoice existed: 'subscription_create' for
  -- the first payment, 'subscription_cycle' for a renewal, 'subscription_update'
  -- for a mid-period change. Stored raw and untranslated. It is here so that a
  -- later reader can tell the first payment from the ones after it without
  -- having to infer it from dates — and so that if the checkout branch is ever
  -- changed to record the first payment too, the double count is visible in the
  -- data rather than hidden in it.
  billing_reason text,
  -- When the money moved, per Stripe, not when this row was written. Every
  -- "this month" figure filters on this: a webhook retried three days late must
  -- not move a payment into a different month.
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.client_subscription_payments drop constraint if exists client_subscription_payments_currency_is_iso;
alter table public.client_subscription_payments add constraint client_subscription_payments_currency_is_iso
  check (currency is null or currency ~ '^[A-Za-z]{3}$');

-- Nothing negative. A refund is not a payment with a minus in front of it — it
-- is a different Stripe object with its own fees and its own timing, and until
-- one is recorded properly a negative here would quietly reduce a total that
-- nothing else in the app knows how to explain.
alter table public.client_subscription_payments drop constraint if exists client_subscription_payments_amount_sane;
alter table public.client_subscription_payments add constraint client_subscription_payments_amount_sane
  check (amount_cents is null or amount_cents >= 0);

-- The coach's screen reads `trainer_id = me, newest first`; the client's own
-- receipts read the same shape from the other side.
create index if not exists idx_client_sub_pay_trainer on public.client_subscription_payments (trainer_id, paid_at desc);
create index if not exists idx_client_sub_pay_client  on public.client_subscription_payments (client_id, paid_at desc);
create index if not exists idx_client_sub_pay_sub     on public.client_subscription_payments (stripe_subscription_id);

alter table public.client_subscription_payments enable row level security;

-- The same shape as `client_subs_read` on part 97 and `purch_read` on part 21,
-- deliberately identical: the client who paid, the coach who was paid, and the
-- owner OF THAT COACH'S GYM. The owner branch goes through the trainer's tenant
-- rather than testing `role = 'owner'`, because the role test lets any owner
-- read every payment on the platform — one white-label customer reading
-- another's revenue, client by client. Part 97 records that mistake being
-- caught; this is not the place to reintroduce it.
drop policy if exists client_sub_pay_read on public.client_subscription_payments;
create policy client_sub_pay_read on public.client_subscription_payments for select using (
  client_id = (select auth.uid())
  or trainer_id = (select auth.uid())
  or exists (
    select 1 from trainers tr
     where tr.id = client_subscription_payments.trainer_id
       and is_owner_of(tr.tenant_id)));

-- No insert, update or delete policy, on purpose. RLS denies what no policy
-- permits, so this table is read-only to every signed-in user and writable only
-- by the service role the stripe-webhook runs as. Whether a payment happened is
-- Stripe's to state and nobody else's — least of all the two parties to it.

-- And the grants, without which none of the above does anything: RLS narrows a
-- GRANT, it does not confer one, so a policy on a table `authenticated` cannot
-- select from is inert in the direction that looks fine in review and returns
-- nothing at runtime.
--
-- All three API roles are revoked first and then granted back exactly what they
-- need, rather than left to Supabase's stock default privileges — which hand
-- `anon` AND `authenticated` the full select/insert/update/delete set on every
-- table created in this project (part 119 found that on 80 of 89 tables). This
-- was confirmed here, on this table, immediately after creating it: both roles
-- came out holding INSERT, UPDATE and DELETE that nothing in this file asked
-- for.
--
-- `revoke ... from public` alone does NOT clear that. `anon` and
-- `authenticated` are grantees in their own right and hold those privileges
-- directly, so revoking the PUBLIC pseudo-role leaves both of them standing —
-- which is the shape of the hole that opened in this project once already.
-- Both are therefore named.
--
-- The writes would be refused by RLS anyway, there being no insert, update or
-- delete policy above. That is not a reason to leave the grant: it makes the
-- table one forgotten `for all` policy away from a client being able to write
-- their own coach a payment. TRUNCATE goes with them, because RLS does not
-- apply to TRUNCATE at all.
revoke all on public.client_subscription_payments from anon, authenticated, public;
grant select on public.client_subscription_payments to authenticated;
grant all    on public.client_subscription_payments to service_role;

comment on table public.client_subscription_payments is
  'One row per PAID Stripe invoice on a client''s coaching subscription — the ledger that makes "earned this month" answerable. Written only by the stripe-webhook under the service role; read-only to everyone else. Every amount is GROSS: Stripe''s fee, the platform fee and payout state are not held here and must never be implied.';
comment on column public.client_subscription_payments.stripe_invoice_id is
  'Stripe''s invoice id, and the idempotency key. invoice.paid and invoice.payment_succeeded both describe it, and both upsert onto this one row rather than counting the month twice.';
comment on column public.client_subscription_payments.paid_at is
  'When Stripe says the invoice was paid. Every period total filters on this and never on created_at, so a webhook retried days later still lands in the month the money moved.';
comment on column public.client_subscription_payments.amount_cents is
  'Minor units, from the invoice''s amount_paid. GROSS — no fee of any kind is deducted, because none is known here. NULL means Stripe stated no amount: render a dash, count it out of the total, never zero.';
