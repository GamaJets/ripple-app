-- ═══════════════════════════════════════════════════════════════════════════
-- A client's card failed, and this database kept no record that it ever had.
--
-- ── The defect ─────────────────────────────────────────────────────────────
--
-- Part 132 added `client_subscription_payments` and closed the larger hole: a
-- year of a client paying AED 600 a month used to leave one row saying "active,
-- AED 600 / month" and no evidence that twelve payments had happened. That
-- table is one row per PAID invoice, written by the `INVOICE_PAID` branch of
-- supabase/functions/stripe-webhook, and `fetchMySubscriptionPayments` in
-- src/lib/subscriptions.ts reads it for the coach's Payments screen.
--
-- PAID. Only paid. `invoice.payment_failed` is already subscribed to and
-- already delivered — it is in `HANDLED` and in `INVOICE_ACTIONABLE` in that
-- function — and everything it does today is re-read the subscription and move
-- `client_subscriptions.status` to `past_due`. One column, last-writer-wins,
-- carrying no date and no count.
--
-- So the whole of what this product can say about a failed renewal is a status
-- word on a row that is about something else, and these four facts are held
-- nowhere at all:
--
--   · WHEN the card failed. A coach opening the screen on the 14th cannot tell
--     a decline from this morning from one from the 2nd.
--   · HOW MANY TIMES. Stripe's Smart Retries attempt a failed invoice up to
--     four times over roughly two to three weeks. `attempt_count` arrives on
--     every one of those events and is discarded on every one of them.
--   · WHETHER IT EVER RECOVERED, and this is the one that is lost for good.
--     A card that fails on the 2nd and succeeds on the 5th writes a
--     `client_subscription_payments` row and moves `status` back to `active`,
--     and the failure is then unreachable from anything in this database.
--     A client who has failed first-attempt every month for six months and paid
--     every time is invisible, and they are the client most likely to churn.
--   · WHAT IT WAS FOR. `amount_due` on the failed invoice is what the coach did
--     not get paid this month.
--
-- The costs of the third one are the ones worth naming, because it is the fact
-- this table exists to keep: a coach cannot know a payment is being retried, so
-- they chase a client who is not avoiding them; the platform cannot tell a
-- payment problem from a cancellation when a subscription is finally cancelled
-- for non-payment; and nobody can answer "how much of my revenue is failing
-- first time", which is the number that decides whether card updates are worth
-- asking for.
--
-- ── A FAILURE IS A RECORD. IT IS NOT A DUNNING SYSTEM. ────────────────────
--
-- Stated first, because getting it wrong is the failure here that reaches a
-- client's phone.
--
-- Nothing in this part sends anything to anybody. No email, no push, no SMS, no
-- `notifications` row, no trigger. Stripe is already dunning this invoice —
-- retries and, if the coach's account is configured for them, Stripe's own
-- emails — and a second party mailing the same person about the same declined
-- card is the shape of harm part 2100 records on the coach side, where a
-- nightly pass went on asking about an invoice somebody had already settled.
--
-- A row here says STRIPE TOLD US AN ATTEMPT ON THIS INVOICE FAILED, on this
-- day, and that is the whole of the claim. What anybody does about it is a
-- screen's decision and a person's, and neither is in this file.
--
-- This table therefore carries no trigger, and `client_subscriptions` is not
-- widened to notice it. That is the same argument part 2820 makes for keeping
-- `gym_invoice_chases` off `gym_invoices`, which has a notifying trigger on it:
-- a separate table carries no trigger, is named in no `update of` clause, and
-- cannot acquire one by accident.
--
-- ── Why a row per ATTEMPT, and not a count on the subscription ────────────
--
-- The cheap answer is two columns on `client_subscriptions` —
-- `last_failed_at`, `failed_count` — moved by the webhook. It is the shape part
-- 188 chose for invoice reminders on the coach side and it is wrong here for
-- the same reason it is right there.
--
-- That pair can say "three times, most recently on Tuesday". It cannot say when
-- the first two were, what each was for, or whether the one in March recovered,
-- and every question above is one of those. Worse, it is lossy in the direction
-- that hides a pattern: the client who fails first-attempt every month and pays
-- on the retry has a `failed_count` that either resets (and says nothing) or
-- climbs forever (and says nothing). Six rows say it plainly.
--
-- It also cannot be corrected. A count nudged by a webhook replay is wrong with
-- nothing on it saying so; a row is a fact with a key, and a duplicate is
-- refused rather than added. Part 700 makes the same argument for correcting a
-- cost by writing a second row rather than by editing the first.
--
-- ── `stripe_event_id` is the idempotency key, and not the invoice ─────────
--
-- Part 132 keys on `stripe_invoice_id unique`, which is exactly right for what
-- it holds: an invoice is paid once, and `invoice.paid` and
-- `invoice.payment_succeeded` both describe that one payment.
--
-- An invoice can FAIL four times. Keying failures on the invoice would keep one
-- of the four and lose the pattern this table exists for, so the key is the
-- event:
--
--   · Stripe redelivers a webhook it did not get a 2xx for using THE SAME
--     `event.id`, so every retry of one delivery lands on one row.
--   · Each distinct attempt is a distinct `invoice.payment_failed` event with
--     its own id, so four attempts are four rows.
--
-- `(stripe_invoice_id, attempt_count)` was the other candidate and is refused:
-- `attempt_count` is nullable here — see its comment — and a unique index over
-- a NULL column does not collide, so the one case where the data is weakest is
-- exactly the case where the guard would stop working.
--
-- ── What a NULL means on every column here ────────────────────────────────
--
-- Stated on the columns themselves, because "no value" and "zero" and "we did
-- not ask" are three different facts and this table exists to keep failures
-- distinguishable from each other. In particular `next_attempt_at` is NOT
-- evidence that Stripe has given up: see its comment. A screen that read it
-- that way would tell a coach a subscription was finished while Stripe was
-- still collecting.
--
-- ── Applying this ─────────────────────────────────────────────────────────
--
-- Additive, and INERT until the webhook is changed. One new table, its
-- indexes, its policies, its grants. No existing table is altered, no trigger
-- is touched, no function is created, and nothing is backfilled: Stripe's event
-- history is the only record of the failures that have already happened, and a
-- row invented from a subscription's current `past_due` would be this database
-- asserting a date nobody observed.
--
-- The writer is one new branch in the `event.type.startsWith('invoice.')`
-- handler of supabase/functions/stripe-webhook — inside the Connect arm, beside
-- the existing `INVOICE_PAID` block, gated on `event.type ===
-- 'invoice.payment_failed'`. That change is NOT in this part and has not been
-- made. Until it is, this table is correct and empty, and an empty table here
-- means "nothing has been written yet", never "no card has failed".
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. the record of a failed attempt ───────────────────────────────────────

create table if not exists public.client_subscription_failures (
  id uuid primary key default gen_random_uuid(),

  -- Who was charged and who was to be paid. Nullable and `on delete set null`,
  -- exactly as part 132 has it: a deleted account must not delete the record
  -- that a payment was attempted. A row whose trainer_id is null is unreadable
  -- by anybody but the service role, which is the correct outcome — it is still
  -- evidence, it simply no longer belongs on a coach's screen.
  client_id  uuid references profiles(id) on delete set null,
  trainer_id uuid references profiles(id) on delete set null,

  -- The subscription this was a renewal of, as Stripe's id and NOT as a foreign
  -- key to `client_subscriptions`. Part 132's reasoning exactly: webhooks are
  -- not ordered, the failure can arrive before the row that mirrors the
  -- subscription exists, and a foreign key would refuse the write and lose the
  -- fact to preserve a join.
  stripe_subscription_id text,

  -- The invoice the attempt was against. NOT unique here, unlike part 132 —
  -- one invoice can fail four times and all four rows are the point. See the
  -- header.
  stripe_invoice_id text not null,

  -- THE IDEMPOTENCY KEY. Stripe redelivers an unacknowledged webhook under the
  -- same event id, so every retry of one delivery lands on this one row, and
  -- each distinct attempt carries its own id and gets its own row.
  stripe_event_id text not null unique,

  -- Which attempt this was, as Stripe counted them on the invoice.
  attempt_count integer check (attempt_count is null or attempt_count >= 0),

  -- What the attempt was FOR, in minor units — `amount_due` on the invoice,
  -- which is what the coach did not get paid. GROSS, like every other money
  -- figure written by this webhook: no fee of any kind is known here.
  amount_cents integer check (amount_cents is null or amount_cents >= 0),

  -- The currency of that amount, from the invoice. Never defaulted: Repple is
  -- white-labelled and there is no fallback that is not wrong for half the
  -- coaches running it.
  currency text,

  -- Stripe's own word for why the invoice existed — 'subscription_cycle' for a
  -- renewal, 'subscription_create' for a first payment. Raw and untranslated,
  -- so that a first payment that never succeeded can be told from a renewal
  -- that stopped succeeding without inferring it from dates.
  billing_reason text,

  -- When Stripe says the attempt failed. Taken from the EVENT's own `created`,
  -- because a Stripe invoice carries no failure timestamp of its own — there is
  -- no `status_transitions.failed_at` to read — and the event's creation is the
  -- moment Stripe states the attempt was decided. Never `now()`: a webhook
  -- retried three days later must not move a decline into a different week.
  failed_at timestamptz,

  -- When Stripe says it will try again, from the invoice's
  -- `next_payment_attempt`.
  next_attempt_at timestamptz,

  -- WHICH LEDGER this was charged on (part 310's column, same meaning). Null is
  -- the platform, which is what `accountForObject` in the webhook already reads
  -- a null as.
  stripe_account_id text,

  -- When the ROW was written, which is a fact about this database and not about
  -- the card.
  created_at timestamptz not null default now()
);

comment on table public.client_subscription_failures is
  'One row per FAILED attempt on a client''s coaching-subscription invoice, as Stripe reported it. The other half of client_subscription_payments, which holds only paid ones. NOTHING HERE SENDS ANYTHING: Stripe is already retrying and, where the coach has them on, already emailing; a row is a record that an attempt failed and nothing in this repository messages anybody on the strength of one. Written only by the stripe-webhook under the service role. An empty table means nothing has been written yet, never that no card has failed.';
comment on column public.client_subscription_failures.client_id is
  'Whose card failed. NULL where that account has since been deleted, or where Stripe''s metadata named nobody and the subscription had not been mirrored — the attempt still happened and the row still stands.';
comment on column public.client_subscription_failures.trainer_id is
  'The coach who was to be paid. NULL on the same two grounds as client_id; a row with a null here is readable by the service role alone, which is correct — it is evidence that belongs on nobody''s screen.';
comment on column public.client_subscription_failures.stripe_invoice_id is
  'The invoice the attempt was against. Deliberately NOT unique: one invoice can be attempted four times under Stripe''s retries and all four rows are the record this table exists to keep.';
comment on column public.client_subscription_failures.stripe_event_id is
  'Stripe''s event id, and the idempotency key. A redelivered webhook carries the same id and lands on this one row; a separate attempt is a separate event and gets its own. Chosen over (invoice, attempt_count) because attempt_count is nullable and a unique index over a NULL does not collide.';
comment on column public.client_subscription_failures.attempt_count is
  'Which attempt this was, per Stripe''s attempt_count on the invoice. NULL means Stripe stated none on that event — NOT that this was the first. A first attempt is 1.';
comment on column public.client_subscription_failures.amount_cents is
  'Minor units of `currency` — the invoice''s amount_due, which is what went uncollected. GROSS: no processing fee and no platform fee are known here. NULL means Stripe stated no amount, which is not zero and must render as a dash and be counted out of any total. A true zero is a zero.';
comment on column public.client_subscription_failures.currency is
  'The invoice''s own currency. NULL only if Stripe stated none, in which case the amount joins no total — there is no default, because this product is white-labelled and every default is wrong for somebody.';
comment on column public.client_subscription_failures.billing_reason is
  'Stripe''s raw word for why the invoice existed (subscription_cycle, subscription_create, …). NULL where Stripe stated none. Never translated here.';
comment on column public.client_subscription_failures.failed_at is
  'When Stripe says the attempt was decided, from the event''s own created time — a Stripe invoice carries no failure timestamp, so there is nothing else to read. NULL means the writer could not determine it, which is not "today": a row with a null here belongs to no week and must be counted out of any period figure rather than swept into the current one.';
comment on column public.client_subscription_failures.next_attempt_at is
  'When Stripe says it will try again, from the invoice''s next_payment_attempt. NULL IS NOT PROOF STRIPE HAS GIVEN UP. It means no next attempt was stated on this event, which is how a final failure looks AND how an invoice being settled another way looks, and the two are indistinguishable from here. Whether dunning is exhausted is answered by the subscription''s own status, never by this column.';
comment on column public.client_subscription_failures.stripe_account_id is
  'The connected account this invoice was charged on, or NULL for the platform (part 310). A fact about THIS invoice and not about the coach''s current charge model — a coach who has since moved to direct charges still has older invoices on the platform.';
comment on column public.client_subscription_failures.created_at is
  'When this row was written. A fact about the filing, not about the card — failed_at is the attempt.';

-- The coach's screen reads "my failures, newest first"; the client's own side
-- reads the same shape from the other end. `id` gives each a total order, so a
-- page of rows tied on the same second cannot drop or repeat one.
create index if not exists idx_client_sub_fail_trainer
  on public.client_subscription_failures (trainer_id, failed_at desc, id desc);
create index if not exists idx_client_sub_fail_client
  on public.client_subscription_failures (client_id, failed_at desc, id desc);

-- And the per-invoice history: "what happened to this invoice", which is how a
-- screen puts three attempts beside one renewal and how anybody answers whether
-- it ever recovered.
create index if not exists idx_client_sub_fail_invoice
  on public.client_subscription_failures (stripe_invoice_id, attempt_count desc, id desc);
create index if not exists idx_client_sub_fail_sub
  on public.client_subscription_failures (stripe_subscription_id);

-- ── 2. who may read and write it ────────────────────────────────────────────
--
-- The same three parties as part 132, deliberately identical: the client whose
-- card it was, the coach who was not paid, and the owner OF THAT COACH'S GYM.
--
-- The client is included on purpose and it is worth saying why, because a
-- failure reads as more private than a payment. It is their own card and their
-- own subscription; they can already read every renewal they have paid through
-- `client_sub_pay_read`, and a client who can see eleven payments and not the
-- declined twelfth has been shown a version of their own history with the part
-- that affects them removed.
--
-- The owner branch goes through the trainer's tenant rather than testing
-- `role = 'owner'`. The role test lets any owner read every failure on the
-- platform — one white-label customer reading another's dunning, client by
-- client. Part 97 records that mistake being caught and this is not the place
-- to reintroduce it.
alter table public.client_subscription_failures enable row level security;

drop policy if exists client_sub_fail_read on public.client_subscription_failures;
create policy client_sub_fail_read on public.client_subscription_failures for select using (
  client_id = (select auth.uid())
  or trainer_id = (select auth.uid())
  or exists (
    select 1 from trainers tr
     where tr.id = client_subscription_failures.trainer_id
       and is_owner_of(tr.tenant_id)));

-- No insert, update or delete policy, and the three are named and dropped
-- rather than merely never written, so that one added by somebody wanting an
-- "acknowledge" button cannot survive a rebuild of this file. Whether a payment
-- failed is Stripe's to state and nobody else's — least of all the two parties
-- to it, one of whom would be marking their own card as not having been
-- declined. RLS denies what no policy permits, so this table is read-only to
-- every signed-in user and writable only by the service role the webhook runs
-- as.
drop policy if exists client_sub_fail_insert on public.client_subscription_failures;
drop policy if exists client_sub_fail_update on public.client_subscription_failures;
drop policy if exists client_sub_fail_delete on public.client_subscription_failures;

-- And the grants, without which none of the above does anything: RLS narrows a
-- GRANT, it does not confer one.
--
-- Revoked first and then granted back exactly what is needed, rather than left
-- to Supabase's stock default privileges — which hand `anon` AND `authenticated`
-- the full select/insert/update/delete set on every table created in this
-- project (part 119 found that on 80 of 89 tables, and part 132 confirmed it
-- again on its own table immediately after creating it). `revoke ... from
-- public` alone does NOT clear that: `anon` and `authenticated` are grantees in
-- their own right and hold those privileges directly, so both are named.
-- TRUNCATE goes with them, because RLS does not apply to TRUNCATE at all.
revoke all on public.client_subscription_failures from anon, authenticated, public;
grant select on public.client_subscription_failures to authenticated;
grant all    on public.client_subscription_failures to service_role;

-- ── 3. what this part deliberately does NOT do ──────────────────────────────
--
--   · It writes nothing. The webhook branch that would fill it is described in
--     the header and is not in this part; supabase/functions/stripe-webhook is
--     unchanged by it. The table is correct and empty until that lands.
--   · It adds no trigger and no function, so there is nothing here for
--     check:definer or check:grants to have an opinion about, and nothing that
--     can acquire a notification by somebody widening an `update of` list.
--   · It touches `client_subscriptions` in no way. That row's `status` is still
--     the only thing that says whether a subscription is currently collecting,
--     it is still written by the existing `INVOICE_ACTIONABLE` branch, and a
--     row here must never be read as changing it — a failed attempt on the 2nd
--     says nothing about whether the 5th succeeded.
--   · It does not backfill. Stripe's event history is the only record of the
--     failures that have already happened, and a row invented from a
--     subscription sitting at `past_due` today would assert a date that nobody
--     observed.
--   · It records no reason code. `last_payment_error` on the invoice's
--     PaymentIntent is a second network call away and is about a card, which is
--     the client's and not the coach's to be shown. The four facts in the
--     header are what this table is for.
