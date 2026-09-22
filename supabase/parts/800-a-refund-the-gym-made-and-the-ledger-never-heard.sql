-- ═══════════════════════════════════════════════════════════════════════════
-- A gym refunded an online sale from its own Stripe dashboard and the ledger
-- went on counting the money.
--
-- supabase/parts/480 closed one half of this. An online membership or pass sale
-- now writes `gym_payments`, so /money, /revenue, /accounting and /close count
-- the money a member paid by card. This part closes the other half, which is
-- the same defect pointed the other way.
--
-- `supabase/functions/stripe-webhook` handles `charge.refunded` by resolving
-- the charge against exactly two tables — `client_subscription_payments` by
-- `stripe_invoice_id`, and `client_purchases` by payment intent then by
-- checkout session. A gym online sale is in NEITHER. It lives in `gym_orders`
-- and `gym_payments`, keyed by `gym_order_id`, and nothing in the refund path
-- has ever looked there.
--
-- So a gym owner who presses Refund in their own Stripe dashboard — which is
-- the ordinary way a refund happens, because under direct charges the gym is
-- the merchant of record and has the full dashboard — produced exactly three
-- things: a `charge.refunded` event, a line in the edge-function log reading
-- "REFUND WITH NO SALE TO MIRROR IT ON", and a `gym_payments` row still holding
-- the whole original amount. The gym's ledger, its month-end close and its
-- revenue screen all keep counting money that has gone back, and the only
-- person who could have known is whoever tails the logs.
--
-- ── The refund is a ROW, and part 180 already decided that ────────────────
--
-- Nothing here adds a `refunded_cents` column to `gym_payments`, and that is
-- the whole design rather than an omission. supabase/parts/180 settled how this
-- table records money going back: a NEGATIVE row carrying
-- `reverses_payment_id`, because there are eleven places in this console that
-- add `gym_payments.amount_cents` up and a flag would have to be understood by
-- all eleven, today and in every query written after today. A reversal that is
-- a row nets correctly in every one of them with no change at all.
--
-- The client-side tables are different and stay different: `client_purchases`
-- and `client_subscription_payments` carry `refunded_cents`, assigned from
-- Stripe's running total, and part 192's CHECK bounds it. Two tables, two
-- shapes, and each is right for the queries over it. What this part adds is the
-- two columns that let the webhook write part 180's shape SAFELY.
--
-- ── 1. `gym_payments.stripe_refund_id` — so a retry cannot halve the month ─
--
-- A Stripe webhook is retried, and it is retried precisely when the handler
-- failed part way through. A refund mirrored twice takes the money off the
-- gym's takings a second time, and unlike a doubled SALE — which an owner
-- notices, because it is money they did not get — a doubled REFUND makes the
-- month look worse in a way nobody goes looking for.
--
-- "Have I already mirrored this?" cannot be answered from the amount. Two
-- members on the same plan are refunded the same money on the same afternoon,
-- and a partial refund of 2000 followed by a second partial refund of 2000 on
-- the SAME charge is two legitimate rows that are identical in every column
-- this table has. It has to be answered by IDENTITY, and the identity of a
-- refund is Stripe's refund id.
--
-- This is deliberately the same shape as `gym_payments.gym_order_id` in part
-- 480 and `memberships.gym_order_id` in part 281: one Stripe object, at most
-- one row, a partial UNIQUE index saying so, and a webhook that is delivered
-- twice finding the row the first delivery wrote instead of writing a second.
--
-- PARTIAL, because every payment taken at the desk, every imported row and
-- every hand-entered correction has NULL here, and NULLs do not collide. The
-- index only ever constrains rows the webhook wrote.
--
-- NOT keyed on the charge, and not on `charge.amount_refunded`. A charge can be
-- refunded in instalments and each instalment is its own reversal with its own
-- date; keying on the charge would record the first one and silently drop every
-- later one, which is the same class of bug as keying on the amount.
--
-- ── 2. Stripe's running total, on the order, so the gap is VISIBLE ────────
--
-- `gym_orders.refunded_cents` is Stripe's `amount_refunded` — the RUNNING TOTAL
-- across every refund on the charge — written by plain assignment and never by
-- addition. That makes it idempotent by construction and correct in the one
-- case an addition is not: two deliveries racing, each adding its own figure to
-- a total it read a moment earlier.
--
-- It is NOT the ledger, it is not summed by any money screen, and it must never
-- become either. It exists so that ONE question has an answer: is what Stripe
-- sent back the same as what the payment record has taken off? Both halves are
-- stored, so the exception is DERIVED rather than declared —
--
--     gym_orders.refunded_cents  >  Σ|reversals against this order's payment|
--
-- — and a derived exception CLEARS ITSELF the moment somebody records the
-- missing correction by hand. A stored "this went wrong" flag would not. That
-- matters more here than it looks: the ways a mirror can fail (below) are all
-- ways where the only fix is a person, and Stripe will not redeliver the event
-- once it has been accepted, so nothing would ever come back to clear a flag.
--
-- `refunded_currency` is stored beside it and is NOT assumed to be the order's.
-- It is what Stripe says it sent back. A refund whose currency disagrees with
-- the payment it is reversing is refused rather than mirrored — see the module
-- header in src/lib/gymRefundMirror.ts — and this column is how the screen can
-- say what the disagreement was instead of rendering a figure in a money nobody
-- chose. supabase/parts/150 removed the defaults from this schema for exactly
-- this reason and no column added here reintroduces one.
--
-- `refund_note` is the REASON a mirror did not happen, in the webhook's own
-- words. It is not the exception — the arithmetic above is — it is what the
-- exception says when it is drawn, so an owner reads "the month was closed"
-- rather than being left to work out which of four things went wrong.
--
-- ── The closed month, which is the case this is really for ────────────────
--
-- supabase/parts/182 refuses any write into a month a gym has closed, and that
-- trigger applies to `gym_payments` and is deliberately not exempted for the
-- webhook — a webhook is not a reason to write into a month an owner has signed
-- off. A refund is dated when it was MADE (part 180 argues this at length: a
-- refund handed back in September belongs in September, not backdated into an
-- August somebody has filed), so a refund made inside a month that has already
-- been closed is refused.
--
-- That refusal is FINAL, not transient: every retry is refused identically
-- until a person reopens the month. Answering Stripe with a 500 would spend the
-- retry budget on a write that cannot land and then abandon the delivery with
-- nothing recorded anywhere. So the webhook accepts the event and writes the
-- three columns below, and the reconciliation screen lists the sale with the
-- reason on it.
--
-- This is the only place in the product where that gap is visible at all. On
-- the sale side, part 480's failure showed up as a paid order with no payment
-- row against it. Here the payment row EXISTS and looks perfectly correct — it
-- is simply too big — so without these columns there is nothing on any screen
-- that is even slightly wrong-looking.
--
-- `gym_orders` is not locked by part 182's trigger (only `gym_payments` and
-- `gym_invoices` are), so these three writes always land. That is deliberate
-- and it is what makes the exception survivable: the record of what Stripe did
-- is written even when the ledger refuses the consequence.
--
-- Additive and idempotent. Nothing here alters an existing row.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── the identity that makes a retry safe ────────────────────────────────────

alter table public.gym_payments
  add column if not exists stripe_refund_id text;

create unique index if not exists uq_gym_payments_stripe_refund
  on public.gym_payments (stripe_refund_id)
  where stripe_refund_id is not null;

-- A Stripe refund id may only ever appear on a reversal. Not NOT VALID, unlike
-- part 180's `gym_payments_correction_shape`: that one had to be deferred
-- because gyms already held bare negative rows entered before there was any
-- other way to record a refund, whereas this column is new and every existing
-- row satisfies this trivially with NULL. Nothing is being asserted about the
-- past here, so nothing has to be excused.
alter table public.gym_payments drop constraint if exists gym_payments_stripe_refund_is_a_reversal;
alter table public.gym_payments add constraint gym_payments_stripe_refund_is_a_reversal
  check (stripe_refund_id is null or kind = 'refund');

comment on column public.gym_payments.stripe_refund_id is
  'The Stripe refund (re_...) this reversal mirrors, or NULL for a correction somebody made at the desk. Unique: it is what stops a retried charge.refunded taking the money off this gym''s takings twice. Keyed on the refund and not on the charge because a charge can be refunded in instalments and each instalment is its own dated reversal. Written only by supabase/functions/stripe-webhook.';

-- The reversals against one payment, which is the sum the reconciliation
-- compares Stripe's running total to. part 180 already indexed
-- `reverses_payment_id`; this is the covering half so the sum does not have to
-- go to the heap for every order on the screen.
create index if not exists idx_gym_payments_reversal_amounts
  on public.gym_payments (reverses_payment_id, amount_cents)
  where reverses_payment_id is not null;

-- ── what Stripe says it sent back ───────────────────────────────────────────

alter table public.gym_orders
  add column if not exists refunded_cents integer;

alter table public.gym_orders drop constraint if exists gym_orders_refunded_not_negative;
alter table public.gym_orders add constraint gym_orders_refunded_not_negative
  check (refunded_cents is null or refunded_cents >= 0);

-- NULL and 0 are different facts and the column keeps them apart. NULL is
-- "Stripe has never mentioned a refund on this charge"; 0 is "it did, and the
-- running total came back as nothing", which is what a refund reversed or
-- failed looks like. A screen that read the first as the second would be
-- claiming a fact about every order ever taken.

alter table public.gym_orders
  add column if not exists refunded_currency text;

alter table public.gym_orders drop constraint if exists gym_orders_refunded_currency_is_iso;
alter table public.gym_orders add constraint gym_orders_refunded_currency_is_iso
  check (refunded_currency is null or refunded_currency ~ '^[A-Z]{3}$');

alter table public.gym_orders
  add column if not exists refunded_at timestamptz;

-- Stripe's own instant for the event, not now(). A delivery retried three days
-- late must not move a refund into a different month, and this is the column an
-- owner reads to find out when the money actually went back — which is very
-- often not the day they are looking at the screen.

alter table public.gym_orders
  add column if not exists refund_note text;

comment on column public.gym_orders.refunded_cents is
  'Stripe''s amount_refunded on this order''s charge — the RUNNING TOTAL across every refund, in minor units, assigned rather than added so a redelivery cannot inflate it. Not a ledger figure and never summed by a money screen: gym_payments holds the money. This is one half of the comparison that makes an unmirrored refund visible, the other half being the sum of reversals against this order''s payment row.';
comment on column public.gym_orders.refunded_currency is
  'What Stripe says the refund was denominated in, upper case. Stored rather than assumed to be gym_orders.currency: a refund in a currency that disagrees with the payment it reverses is refused by the webhook rather than netted, and this is how the screen can say so instead of drawing a figure in a money nobody chose.';
comment on column public.gym_orders.refunded_at is
  'When STRIPE says the money went back, from the event''s own timestamp rather than from now(). A delivery retried on Tuesday must not date Saturday''s refund on Tuesday.';
comment on column public.gym_orders.refund_note is
  'Why a refund Stripe made was not mirrored into gym_payments, in the webhook''s own words — most often that the month it falls in has been closed. Not the exception itself: that is derived from refunded_cents against the reversals, so it clears itself the moment somebody records the correction by hand. This is what the exception SAYS when it is drawn.';

create index if not exists idx_gym_orders_refunded
  on public.gym_orders (tenant_id, refunded_at desc)
  where refunded_cents is not null;
