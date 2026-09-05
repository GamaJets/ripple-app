-- ─────────────────────────────────────────────────────────────────────────
-- Two tables that took whichever webhook arrived last.
--
-- ═══ APPLIED ═══════════════════════════════════════════════════════════
--
-- Not run against production. Adds two nullable columns and restores one
-- unique index. `subscriptions` and `invoices` are both empty in production
-- and no payment webhook has ever been delivered — 24h of edge logs show only
-- wearable-day, wearable-oauth and instagram-publish — so there is no data to
-- migrate and nothing here can lose a row.
--
-- ── The invariant this restores ───────────────────────────────────────────
--
-- supabase/functions/stripe-webhook/index.ts states it beside `eventAt`:
--
--     Webhooks are retried and are NOT ordered, so every write below that can
--     be superseded is stamped with this and filtered on it, rather than
--     trusting arrival order.
--
-- `client_subscriptions` and `client_disputes` honour it. These two never did:
-- neither carried an ordering token, so both were plain last-writer-wins, and
-- Stripe's retries are the writer that arrives last.
--
-- ── What that costs, in the order it happens ──────────────────────────────
--
-- `subscriptions` is the coach's own Repple plan. A card fails — status
-- past_due, event created T1. Some other write in that same delivery errors,
-- the handler answers 500, Stripe schedules a retry with backoff. The coach
-- pays; an `active` event created T2 is delivered and succeeds. Then the T1
-- retry lands.
--
-- The replay ledger cannot stop it, and should not: `stripe_webhook_events` is
-- written only after the handler has SUCCEEDED, precisely so that a failed
-- delivery's retry — the one chance to record money that already moved — is
-- not discarded as a duplicate. So the stale event is handled in full, the
-- coach goes back to past_due, and nothing further is coming to correct it.
-- studio-web/lib/platform.ts renders that as the owner's platform book,
-- src/lib/billing.ts as the coach's own billing screen, and owner-metrics
-- counts `status = 'active'` for the live subscriber figure.
--
-- `invoices` is worse, because nothing gates which invoice events reach it.
-- `INVOICE_ACTIONABLE` gates the Connect branch only; the platform branch
-- writes on every `invoice.*` — `created` (a draft), `finalized`, `updated`,
-- `voided`, `payment_failed`, `paid` — keyed on the invoice id alone. A
-- retried `payment_failed`, or the original `created` draft, landing after
-- `paid` regresses `status`. `fetchFailedInvoices` in src/lib/billing.ts then
-- lists a paid invoice under the owner's failed-payments callout, and
-- owner-metrics, which filters `(r.status ?? 'paid') === 'paid'` for revenue30,
-- drops that same invoice out of the month's revenue. The platform chases
-- money it has been paid while reporting it was never paid.
--
-- ── The columns ──────────────────────────────────────────────────────────
--
-- Nullable, and the writer handles null as a third case. A row written before
-- this part cannot be ranked against an event, and freezing it out of every
-- future update would be a worse failure than the one being fixed, so the
-- webhook does an `is('stripe_event_at', null)` update alongside the
-- `lte(...)` one — exactly as `writeConnectSub` has always done for
-- `client_subscriptions`. No default and no backfill: `now()` would be a
-- position in Stripe's `event.created` sequence invented by this migration,
-- and null already means "unranked" to the only code that reads it.
--
-- Type matches `client_subscriptions.stripe_event_at` — timestamptz, live.
--
-- ── The unique index, which is a divergence and not a new idea ───────────
--
-- setup.sql has declared `stripe_subscription_id text unique` on
-- `subscriptions` since part 20. The live table does not have it: its only
-- index is `subscriptions_pkey` on `trainer_id`. So a fresh database built
-- from setup.sql and production have different shapes, and the shape a
-- reviewer reads is not the shape that runs.
--
-- The right shape is the declared one, and the shape of the ROW stays as it
-- is — `trainer_id` remains the primary key. That is not inertia:
--
--   · One coach has one Repple plan at a time. That is the actual arrangement,
--     and every reader is written to it — `fetchMySubscription` uses
--     `maybeSingle()`, owner-metrics takes a head count, platform.ts pages one
--     row per coach. A history table keyed on the subscription id would break
--     all three and answer a question nobody is asking.
--
--   · The failure the reviewer attributes to this key — an event for an old
--     subscription id overwriting the row that describes the current one — is
--     an ORDERING failure, not a key failure. The coach cancels sub_A, then
--     subscribes as sub_B; a late retry of sub_A's `deleted` has an earlier
--     `event.created` than sub_B's `created`, so the new `stripe_event_at`
--     guard is what refuses it. Re-keying the table would not have.
--
--   · The unique is still worth having, for the thing ordering cannot catch:
--     it stops ONE Stripe subscription being filed against TWO coaches. The
--     only path there is an event whose `trainer_id` metadata disagrees with
--     `billing_customers`, which would otherwise silently double-count a
--     single plan in the platform's MRR. Under this index it raises instead,
--     the handler 500s and Stripe retries — loud and recoverable, where the
--     double count is silent and permanent.
--
-- Written as a unique INDEX rather than a constraint so it is idempotent
-- (`add constraint` has no `if not exists`). Same name the constraint would
-- take, so a database that already has the constraint from setup.sql skips it
-- rather than growing a second copy. Nulls are distinct in a btree unique
-- index, which is what the declared `unique` means too: a row whose plan has
-- not been mirrored yet carries null and does not collide.
--
-- No grants are needed. Both tables carry table-level ACLs
-- (`anon=arwdm/postgres, authenticated=arwdm/postgres, ...`), not
-- column-level ones, so a new column inherits them; and both are RLS-enabled
-- with SELECT-only policies, which these columns do not touch. Nothing here
-- creates a function, so there is no PUBLIC execute grant to revoke.
-- ─────────────────────────────────────────────────────────────────────────

-- The coach's own Repple plan.
alter table public.subscriptions
  add column if not exists stripe_event_at timestamptz;

comment on column public.subscriptions.stripe_event_at is
  'Stripe''s event.created for the event that last wrote this row. The ordering token stripe-webhook filters on — webhook deliveries are retried and unordered. Null means written before part 2340 and therefore unranked.';

-- The platform's invoices — a coach paying Repple.
alter table public.invoices
  add column if not exists stripe_event_at timestamptz;

comment on column public.invoices.stripe_event_at is
  'Stripe''s event.created for the event that last wrote this row. Without it a retried invoice.payment_failed lands after invoice.paid and regresses status, which puts a paid invoice back into the owner''s failed-payments callout and out of revenue30.';

-- Declared in setup.sql since part 20, absent from the live table. See the
-- header: the row stays keyed on trainer_id; this only stops one Stripe
-- subscription being filed against two coaches.
create unique index if not exists subscriptions_stripe_subscription_id_key
  on public.subscriptions (stripe_subscription_id);
