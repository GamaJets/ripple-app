-- ═══════════════════════════════════════════════════════════════════════════
-- Cash, a bank transfer, and the front desk.
--
-- Money in was read from two tables and only two: `client_purchases` and
-- `client_subscription_payments`, both written by the stripe-webhook. So every
-- figure on the Money screen and every section of the statement covered card
-- payments taken through Repple, and nothing else.
--
-- For most self-employed coaches card is the MINORITY of income. The screen was
-- not slightly short; it understated the business by a large fraction, said so
-- honestly in four separate places, and a coach who reads a figure a third of
-- what they know they earned stops opening the screen. Every one of those four
-- caveats was about a hole that could simply be filled.
--
-- ── THE LINE THIS TABLE MUST NOT CROSS ───────────────────────────────────
--
-- This is a coach recording WHAT A CLIENT PAID THEM. It is not, and must never
-- become, a coach recording THEIR OWN PAY.
--
-- The next person to read this will assume the rule behind the read-only
-- earnings screen on the gym side applies here, because it is the same word
-- about the same person. It does not. That rule is about A GYM PAYING AN
-- EMPLOYED TRAINER: a payroll figure the trainer must not be able to author,
-- because the party that owes it is the gym, and a self-authored figure there
-- is a self-authored invoice to an employer. `settle_trainer_sessions` and
-- everything around it stay exactly as they are.
--
-- A row here is the opposite direction. The money has already moved, from a
-- client to this coach, outside this app entirely; a self-employed person is
-- writing down a payment they have already been handed. Nobody owes anything
-- as a result, no payroll run reads this table, no gym is invoiced by it, and
-- nobody but the coach who wrote it can read it.
--
-- Three things keep it there:
--
--   · `coach_id` is `auth.uid()` in the INSERT policy, so a row can only ever
--     be about the person writing it.
--   · `client_id`, where given, must be one of that coach's own clients. A
--     coach cannot attach a payment to a stranger's account.
--   · A CHECK refuses `client_id = coach_id` outright. "I paid me" is the shape
--     a payroll claim would have to take, and it is refused in the database as
--     well as on screen (`receiptBlockers` in src/lib/coachReceipts.ts).
--
-- ── Why there is no client read policy ───────────────────────────────────
--
-- Deliberately none, and this is not an oversight to be corrected later. A
-- receipt is the coach's own ledger line: no number was allocated, no document
-- was produced, and nothing left the phone. The artefact for telling somebody
-- "I have your money" already exists and is `coach_invoices` with
-- `kind = 'received'` — numbered, printable, and carrying on its own face the
-- statement that it is the coach's claim rather than a verified fact. Giving a
-- client a read of this table instead would hand them an unnumbered assertion
-- with no document behind it, and would make a private bookkeeping note into a
-- claim about them that they cannot get a copy of.
--
-- ── Why DELETE is granted here and refused on coach_invoices ─────────────
--
-- Part 138 refuses to let an invoice be deleted or edited, and the reason is
-- that somebody else is holding a copy of it: a hole in a sequence is a
-- question the coach has to answer later, and a reused number is worse. None of
-- that is true here. There is no sequence, no document, and no second copy — a
-- receipt exists solely to make the coach's own Money screen true, and a
-- mistyped line in a private ledger should be removable by the person who
-- typed it. UPDATE is refused anyway: correcting a payment is deleting the
-- wrong line and writing the right one, which leaves no half-edited row whose
-- amount and whose date came from two different intentions.
--
-- auth.uid() throughout, never current_user: under PostgREST every signed-in
-- request runs as the shared `authenticated` role.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.coach_receipts (
  id          uuid        primary key default gen_random_uuid(),
  coach_id    uuid        not null references public.trainers(id) on delete cascade,
  -- The client's account where they have one. Nullable on purpose and null is
  -- the ORDINARY case here: the people who pay a coach in cash are mostly the
  -- ones who were never given an account. ON DELETE SET NULL, because somebody
  -- closing their account does not erase the coach's record of being paid.
  client_id   uuid        references public.clients(id) on delete set null,
  -- The name the coach typed, snapshotted rather than joined — the same
  -- argument part 138 makes about `bill_to`. A person who changes their name
  -- later has not changed who handed over this money.
  paid_by     text        not null check (btrim(paid_by) <> '' and length(paid_by) <= 200),
  -- Minor units, matching client_purchases.amount_cents, coach_invoices and
  -- trainer_packages, so nothing between this table and the rest of the app's
  -- money ever has to be converted. bigint for the same reason they are: a
  -- minor-unit amount in a large-denomination currency passes 2^31 sooner than
  -- anyone expects.
  amount_cents bigint     not null check (amount_cents > 0 and amount_cents < 100000000000),
  -- NOT NULL and no default. tenants.currency is nullable on purpose (part 99)
  -- and null there means "this gym has not told us", so a payment simply cannot
  -- be recorded until somebody states the currency. A figure with the wrong
  -- three letters on it is a different amount of money.
  currency    text        not null check (currency = upper(btrim(currency)) and length(currency) between 3 and 4),
  -- How the money arrived. Deliberately no plain 'card': a card payment taken
  -- through Repple is already in `client_purchases` and recording it here would
  -- count it twice, while one taken on a terminal or at a front desk did not
  -- come through this app at all and is 'card_at_gym'. The value names WHERE
  -- the card was taken so the two cannot be confused.
  method      text        not null check (method in ('cash', 'transfer', 'card_at_gym', 'other')),
  -- A DATE, not a timestamp. Cash was handed over on a day, in the place both
  -- people were standing; storing an instant would put a Monday payment on
  -- Sunday for every coach west of Greenwich, which is the trap `splitByDay` in
  -- src/lib/coachStatement.ts exists to document.
  received_on date        not null,
  note        text        check (note is null or length(note) <= 500),
  created_at  timestamptz not null default now(),
  -- The payroll guard, in the database as well as on the screen. A coach is not
  -- their own client and cannot pay themselves; a row saying so is the shape a
  -- claim about what a gym owes them would have to take.
  constraint coach_receipts_not_self check (client_id is null or client_id <> coach_id)
);

comment on table public.coach_receipts is
  'Payments a coach says they received OUTSIDE this app — cash, bank transfer, a card taken at a gym. The coach''s own record, readable by nobody else, never reconciled against a bank. NOT a payroll claim: a gym paying an employed trainer is a different thing and stays read-only to the trainer.';
comment on column public.coach_receipts.method is
  'cash | transfer | card_at_gym | other. There is no plain ''card'': a card taken through Repple is already in client_purchases and recording it here would count it twice.';
comment on column public.coach_receipts.received_on is
  'The day the coach says the money arrived, not the day the row was written. A coach catching up on three weeks of cash must not have all of it land in one month.';
comment on column public.coach_receipts.currency is
  'ISO 4217, uppercase, required. There is no default and no fallback — see tenants.currency in part 99.';

-- The read is always "mine, newest first", and the statement reads a date
-- range of it. `id` is in the index because every paged read in this app orders
-- on a total order — two payments recorded on the same day would otherwise tie
-- and a page boundary could drop or repeat one.
create index if not exists coach_receipts_coach_idx
  on public.coach_receipts (coach_id, received_on desc, id desc);

-- ── Row-level security ───────────────────────────────────────────────────

alter table public.coach_receipts enable row level security;

drop policy if exists coach_receipts_owner_read on public.coach_receipts;
create policy coach_receipts_owner_read on public.coach_receipts
  for select
  to authenticated
  using (coach_id = (select auth.uid()));

drop policy if exists coach_receipts_owner_insert on public.coach_receipts;
create policy coach_receipts_owner_insert on public.coach_receipts
  for insert
  to authenticated
  with check (
    coach_id = (select auth.uid())
    -- A stated client must be one of this coach's own. Without this a coach
    -- could attach a payment to any account id they could guess, and although
    -- nobody else can read the row, the FK would tie a stranger's account to a
    -- financial record they never agreed to.
    and (
      client_id is null
      or exists (select 1 from public.clients c
                  where c.id = coach_receipts.client_id and c.trainer_id = (select auth.uid()))
    )
  );

drop policy if exists coach_receipts_owner_delete on public.coach_receipts;
create policy coach_receipts_owner_delete on public.coach_receipts
  for delete
  to authenticated
  using (coach_id = (select auth.uid()));

-- Named and dropped rather than merely never written, so a policy added by
-- somebody who wanted an "edit" button cannot survive a rebuild of this file.
-- Correcting a payment is deleting the wrong line and writing the right one;
-- an UPDATE would leave a row whose amount and whose date came from two
-- different intentions, and nothing on it would say so.
drop policy if exists coach_receipts_owner_update on public.coach_receipts;
drop policy if exists coach_receipts_client_read on public.coach_receipts;
drop policy if exists coach_receipts_owner_of_gym_read on public.coach_receipts;

-- RLS narrows a GRANT; it does not create one.
grant select, insert, delete on public.coach_receipts to authenticated;
revoke update on public.coach_receipts from authenticated;
revoke all on public.coach_receipts from anon;
