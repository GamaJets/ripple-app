-- ═══════════════════════════════════════════════════════════════════════════
-- A member paid the gym by card online and no row appeared in `gym_payments`.
--
-- `supabase/functions/stripe-webhook` fulfils a paid `gym_orders` row by
-- writing the ENTITLEMENT — a `memberships` term or a `gym_passes` row — and
-- then closing the order. It never wrote the MONEY. Every writer of
-- `gym_payments` in the product was a hand entry at the desk
-- (`src/lib/gymRecord.ts`) or a spreadsheet import (`src/lib/gymImports.ts`),
-- and `grep "from('gym_payments')" supabase/functions/` returned nothing at all.
--
-- `/money`, `/revenue`, `/accounting` and `/close` all count `gym_payments` and
-- nothing else. So a gym selling memberships online had the money in its Stripe
-- balance, the member had their membership, and the screen /accounting tells the
-- accountant to reconcile against the bank was short by every online sale ever
-- made. Not an exception an owner can explain away: a discrepancy equal to all
-- online takings, every month, growing.
--
-- The webhook now writes the payment. This part is the column that makes that
-- write SAFE TO RETRY, which for a payment matters more than making it at all.
--
-- ── Why a column and not the amount ────────────────────────────────────────
--
-- A Stripe webhook is retried, and it is retried precisely when the handler
-- failed part way through. "Have I already recorded this?" cannot be answered
-- by looking for a payment of the same amount on the same day: two members on
-- the same plan pay the same money in the same minute, and a ledger that
-- deduplicates on the amount would silently drop the second one. It has to be
-- answered by IDENTITY, and the identity of an online sale is the order.
--
-- This is the same shape part 281 gave `memberships.gym_order_id` and
-- `gym_passes.gym_order_id`, for the same reason and deliberately not a new
-- idea: one order produces at most one entitlement and at most one payment, the
-- unique index says so, and a webhook that is delivered twice finds the row the
-- first delivery wrote instead of writing a second.
--
-- PARTIAL, because every payment taken at the desk and every imported row has
-- NULL here and NULLs do not collide. The index only ever constrains rows the
-- webhook wrote.
--
-- ── The link is worth having on its own ────────────────────────────────────
--
-- `gym_payments.membership_id` is written too, so an online membership sale
-- arrives already attributed and /accounting's 45-day amount-and-member guess
-- is not asked about it. And `gym_order_id` makes the reverse question
-- answerable for the first time: an order marked `paid` with no payment row
-- pointing at it is money Stripe took that this ledger does not have, which is
-- exactly the exception the reconciliation screen should be raising rather than
-- the one nobody could see.
--
-- ── What this does NOT change ──────────────────────────────────────────────
--
-- `gym_orders` is read by the member's own purchase history and by nothing that
-- adds money up, so nothing is double counted by this row existing. The pass
-- figure on /close comes from `gym_passes.paid_cents` and is reported beside
-- the takings rather than inside them, exactly as a desk-sold pass already was.
--
-- The closed-month trigger from part 182 still applies to this table and is
-- deliberately not exempted: a webhook is not a reason to write into a month an
-- owner has signed off. What changes is that the refusal is now VISIBLE — the
-- order stands as paid with no payment beside it, which the reconciliation
-- screen lists.
--
-- Additive and idempotent. Nothing here alters an existing row.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.gym_payments
  add column if not exists gym_order_id uuid references public.gym_orders(id) on delete set null;

-- `on delete set null` and not restrict: an order is the record of a Stripe
-- charge and outlives nothing, but if one were ever removed the MONEY still
-- arrived and the ledger row has to survive it. Compare `reverses_payment_id`
-- in part 180, which is `restrict` because a correction without its original is
-- not a fact at all.

create unique index if not exists uq_gym_payments_gym_order
  on public.gym_payments (gym_order_id)
  where gym_order_id is not null;

comment on column public.gym_payments.gym_order_id is
  'The gym_orders row whose Stripe payment this is, or NULL for money taken at the desk or imported from a spreadsheet. Unique: it is what stops a retried webhook recording one payment twice. Written only by supabase/functions/stripe-webhook.';

-- The reconciliation question this column exists to make askable: which paid
-- orders have no money against them. Small and partial, because the answer is
-- read per gym and per month from the order side.
create index if not exists idx_gym_payments_order_lookup
  on public.gym_payments (tenant_id, gym_order_id)
  where gym_order_id is not null;
