-- ═══════════════════════════════════════════════════════════════════════════
-- The one figure in this app that is a PREDICTION, and the column that checks it.
--
-- ── What is being predicted, and why anything is ─────────────────────────
--
-- A discount code on a ONE-OFF package. Repple's cut on a one-off is
-- `application_fee_amount`: an absolute number of minor units, which Stripe
-- requires as an INPUT to `checkout.sessions.create` — the same call in which
-- Stripe itself works out what the discount comes to. `amount_total` is an
-- OUTPUT of that call. So the fee cannot be derived from what Stripe charged;
-- it can only be derived from a total connect-checkout worked out before
-- asking.
--
-- Everything reasonable was done to make that arithmetic exact rather than
-- approximate. `oneOffDiscount` in src/lib/packagePromo.ts applies a code only
-- where the discount is a whole number of minor units with no rounding
-- anywhere in it — an amount-off coupon in the package's own currency, or a
-- percentage that divides the price exactly — and refuses every other shape by
-- name, because Stripe documents no rounding rule for a percentage discount
-- anywhere in its reference and a rule learned by observation is a rule that
-- can change in a release note nobody here reads.
--
-- ── Exact arithmetic is not proof about somebody else's system ───────────
--
-- It is proof about ours. Stripe could apply a tax rate this integration did
-- not ask for, honour a coupon restriction differently from how its own docs
-- read, or change a behaviour that was never written down in the first place.
-- Every one of those shows up the same way: `amount_total` is not the figure
-- the fee was taken from, and the coach is short by roughly the platform
-- percentage of the difference — on EVERY sale of that package, for as long as
-- the code runs, with nothing anywhere saying so. A figure nobody reconciles is
-- not a check.
--
-- So connect-checkout stamps the total it expects onto the session's metadata,
-- the stripe-webhook compares it with what Stripe reports on
-- `checkout.session.completed`, and the difference lands here.
--
-- ── Why a RECORDED DISCREPANCY and not a hard failure ────────────────────
--
-- This was the decision worth writing down. By the time that event arrives the
-- client's card has been charged and Stripe has already taken the application
-- fee. There is nothing left to refuse. Refusing to write the row would leave a
-- client who has paid with no pack, no credits and no record that they paid —
-- and the webhook would 500, so Stripe would retry it forever and it would fail
-- forever. The wrong figure is a shortfall somebody can be repaid; the missing
-- row is a customer who was charged and got nothing.
--
-- So the sale is written, the difference is written on it, the webhook logs it
-- loudly, and app/(trainer)/payments.tsx shows the coach the sales it is on.
--
-- ── NULL is not nought ───────────────────────────────────────────────────
--
--   NULL  no prediction was involved. Every sale with no discount code on it,
--         and every sale made before this column existed. The fee came off the
--         list price, which is the figure Stripe charges, and there is nothing
--         to compare.
--   0     a prediction WAS made and it was right. This is the value that makes
--         the column worth having: it is the difference between "checked and
--         correct" and "never checked".
--   other Stripe charged this many minor units more (positive) or fewer
--         (negative) than the fee was worked out from.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.client_purchases
  add column if not exists fee_variance_cents bigint;

comment on column public.client_purchases.fee_variance_cents is
  'Stripe''s `amount_total` MINUS the total connect-checkout predicted when it derived this sale''s application fee, in minor units. NULL means no prediction was involved — no discount code, or a sale made before this column existed. 0 means a prediction was made and Stripe agreed with it. Anything else means Repple''s cut on this sale was worked out from the wrong figure, and the coach is short by roughly the platform percentage of it. Written only by the stripe-webhook, from Stripe''s own numbers.';

-- No constraint, and that is deliberate. A CHECK that refused a non-zero value
-- would turn the one row that has to be recorded into the one row that cannot
-- be — the money has already moved by the time this is written, and a failed
-- write here loses the sale rather than the discrepancy.

-- No index either. It is read as part of the sale it is on, and the coach's
-- screen already holds every one of their purchases to add them up.
