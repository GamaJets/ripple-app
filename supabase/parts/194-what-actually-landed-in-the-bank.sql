-- ═══════════════════════════════════════════════════════════════════════════
-- "Taken through Stripe" is gross, and it is the figure coaches argue with.
--
-- Every takings number in this app is what a client was CHARGED. Stripe's
-- processing fee, the platform's application fee and whether the money has
-- cleared into the coach's bank are facts that live at Stripe, and no webhook
-- in this repo has ever been told any of them. `STRIPE_AUTHORITY_NOTE` in
-- src/lib/coachLedger.ts says so, and `payoutFacts` in src/lib/coachStatement.ts
-- spends a paragraph saying there is no payout timetable because there is no
-- data behind one.
--
-- That was true and it was expensive. The gap between "AED 4,800 taken" and
-- "AED 4,281 in my account" is the gap a coach fills with a suspicion about the
-- platform, and there was nothing anywhere in the product that could answer it.
--
-- ── One event, and it needs no new Stripe permission ─────────────────────
--
-- `payout.paid` and `payout.failed` fire on the account the money is leaving.
-- For a coach that is their CONNECTED account under both charge models — a
-- destination-charge coach still has an Express account that pays out to their
-- bank — so both arrive at the Connect webhook destination the product already
-- has, with `event.account` set. Nothing about the platform's own arrangement
-- with Stripe changes.
--
-- ── What a payout IS, and the one thing it is not ────────────────────────
--
-- It is a transfer of a BALANCE to a bank account, and a balance is the residue
-- of many charges minus many fees minus any refunds. It is NOT the net of a
-- particular sale, and no row here can be traced back to one: a payout of
-- AED 4,281 does not correspond to the AED 4,800 pack sold on Tuesday, and the
-- app must never draw a line between them. What it answers is a different and
-- more useful question — how much money has actually reached the coach — and
-- `PAYOUT_IS_NOT_A_SALE` in src/lib/coachPayouts.ts is that sentence on the
-- screen.
--
-- ── Why the platform's own payouts are refused ───────────────────────────
--
-- Repple has a Stripe balance too, and it pays out. Those events arrive on the
-- PLATFORM destination with no `event.account`, and recording one would put the
-- platform's own banking on a coach's money screen. The webhook branch writes
-- nothing at all unless the event carried a connected account.
--
-- ── Why a coach can only ever read ───────────────────────────────────────
--
-- These rows are Stripe's word, mirrored. A coach who could write one could
-- state that money had reached their bank when it had not, which is the exact
-- shape of a claim this product refuses everywhere else. INSERT, UPDATE and
-- DELETE are revoked outright; the stripe-webhook writes as the service role,
-- which RLS does not apply to.
--
-- auth.uid() throughout, never current_user.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.coach_payouts (
  -- Stripe's own payout id IS the primary key. A surrogate would need a unique
  -- index on this column anyway, and the id is what makes the webhook's upsert
  -- idempotent under Stripe's at-least-once delivery.
  id            text        primary key,
  -- Who it belongs to, resolved from the connected account. NULLABLE, because
  -- an account this database cannot resolve to a coach is a payout that still
  -- happened — dropping it would lose money from the record to protect a join.
  -- Such a row is readable by nobody, which is the honest outcome.
  coach_id      uuid        references public.trainers(id) on delete set null,
  stripe_account_id text    not null,
  -- Minor units, matching every other money column in this app.
  amount_cents  bigint      not null,
  -- Stripe's own, lower case as Stripe sends it. Compared case-insensitively
  -- everywhere it is read, exactly as part 132 does for client_purchases.
  currency      text        not null check (currency ~ '^[A-Za-z]{3}$'),
  -- Stripe's word, verbatim: 'paid', 'failed', 'pending', 'in_transit',
  -- 'canceled'. NOT a union this app invented — a status Stripe adds later must
  -- land here unchanged rather than be coerced into the nearest one we know,
  -- and `payoutStateLabel` in src/lib/coachPayouts.ts resolves an unknown one
  -- to "not stated" rather than to "paid".
  status        text        not null,
  -- The day Stripe expects it to reach the bank. A DATE, because that is what
  -- a bank works in and what the coach is waiting for.
  arrival_on    date,
  -- Why a failed payout failed, in Stripe's words. The single most useful
  -- string on this table: a payout that bounced because the bank details are
  -- wrong is a coach who is not being paid and does not know it.
  failure_message text,
  -- When Stripe says it happened. Webhooks are retried and are NOT ordered, so
  -- the write is filtered on this rather than on arrival order — the same guard
  -- every other mirrored table in this schema uses.
  stripe_event_at timestamptz,
  created_at    timestamptz not null default now()
);

comment on table public.coach_payouts is
  'Payouts Stripe made to a coach''s bank, mirrored from payout.* webhooks. A payout is a BALANCE reaching a bank — the residue of many charges minus fees minus refunds — and it can NEVER be traced back to a particular sale. Read-only to the coach; written only by the stripe-webhook as the service role.';
comment on column public.coach_payouts.status is
  'Stripe''s own word, verbatim and not coerced. A status this app does not recognise reads as "not stated" rather than as "paid".';
comment on column public.coach_payouts.arrival_on is
  'The day Stripe expects the money at the bank. A date, because that is what a bank works in.';
comment on column public.coach_payouts.failure_message is
  'Why a failed payout failed, in Stripe''s words. A payout that bounced on wrong bank details is a coach who is not being paid and does not know it.';

create index if not exists coach_payouts_coach_idx
  on public.coach_payouts (coach_id, arrival_on desc, id desc)
  where coach_id is not null;

alter table public.coach_payouts enable row level security;

drop policy if exists coach_payouts_owner_read on public.coach_payouts;
create policy coach_payouts_owner_read on public.coach_payouts
  for select
  to authenticated
  using (coach_id = (select auth.uid()));

-- Named and dropped rather than merely never written, so a policy added by
-- somebody who wanted to "correct" a payout cannot survive a rebuild. A coach
-- who could write one could state that money had reached their bank when it had
-- not, which is the exact claim this product refuses everywhere else.
drop policy if exists coach_payouts_owner_insert on public.coach_payouts;
drop policy if exists coach_payouts_owner_update on public.coach_payouts;
drop policy if exists coach_payouts_owner_delete on public.coach_payouts;
drop policy if exists coach_payouts_owner_of_gym_read on public.coach_payouts;

grant select on public.coach_payouts to authenticated;
revoke insert, update, delete on public.coach_payouts from authenticated;
revoke all on public.coach_payouts from anon;

-- ── DEPLOYMENT: what this part cannot do for itself ──────────────────────
--
-- The CONNECT webhook destination — the one whose signing secret is
-- STRIPE_WEBHOOK_SECRET_CONNECT — must be subscribed to `payout.paid` and
-- `payout.failed` in addition to everything it already listens for. Until it
-- is, the branch in supabase/functions/stripe-webhook is correct and never
-- runs, this table stays empty, and every screen that reads it says "nothing
-- recorded" rather than "nothing was paid out" — which is why those two
-- sentences are kept apart in src/lib/coachPayouts.ts.
