-- ═══════════════════════════════════════════════════════════════════════════
-- Money the gym decided not to collect, and nothing recording why.
--
-- ── The defect ─────────────────────────────────────────────────────────────
--
-- `gym_invoices.status` has allowed 'void' and 'written_off' since part 29, and
-- `owedOf` in src/lib/monthEnd.ts folds both into a bucket it calls `dropped`,
-- under a comment that gets it exactly right:
--
--     "Money the gym has decided it will not collect is not money it is owed,
--      and it is not money it took either"
--
-- So the amount leaves the receivables, leaves the takings, appears in a figure
-- on the close as `droppedCents`, and the table carries NOTHING saying who
-- decided that, when, or on what grounds. The only column that could hold it is
-- `note`, which is the invoice's own description of what was billed — an owner
-- who typed the reason there would be overwriting what the bill was for.
--
-- Every other decision of this size in this schema is already a recorded fact:
--
--   · `payroll_settlements.reversed_at` / `reversed_by` / `reverse_reason`
--     (part 183), under a CHECK that refuses a reversal with no reason on it,
--     and the column comment states the principle — "The row is NEVER deleted —
--     a settlement that was recorded and then withdrawn is two facts, and
--     deleting it leaves neither";
--   · `payroll_adjustments.note`, `not null check (btrim(note) <> '')`,
--     because "an adjustment with no reason on it is the line a coach queries
--     and nobody can answer";
--   · `gym_month_closes` refuses a reopen with no reason (part 182);
--   · `gym_reconcile_marks` refuses an accepted exception with no reason
--     (part 181), on the argument that "an exception silently taken off a
--     reconciliation with nothing recorded is exactly the row somebody asks
--     about later".
--
-- A bad debt is the same shape and a larger number. This part gives it the same
-- three columns, named for the bucket the close already calls it.
--
-- ── Why this is a SECOND FACT and not an erasure ───────────────────────────
--
-- The house rule: a money amount that is written off, reversed or corrected is
-- a second recorded fact, never an erasure. Part 183 is the established shape
-- and this follows it, with one deliberate difference in the CHECK — see §2.
--
-- ── Why there is no `not null` on the forward direction ────────────────────
--
-- The obvious constraint is "every void or written-off invoice carries a
-- reason". It is not written, because every gym running Repple today has such
-- invoices with no reason on them — the column did not exist — and an
-- `ALTER TABLE ADD CONSTRAINT` validates the rows that are already there. That
-- statement would fail on the first gym it was applied to, and a schema part
-- that cannot be applied protects nothing.
--
-- So the constraint runs the other way: a reason may not exist without a
-- decision behind it, and a decision may not exist without a reason. Rows
-- dropped before today carry neither, the screen reports them as
-- "no reason recorded" rather than inventing one, and the writer in
-- src/lib/invoiceWriteOff.ts is what makes new ones impossible.
--
-- ── Applying this ──────────────────────────────────────────────────────────
--
-- Additive. Three nullable columns, one CHECK that no existing row can fail,
-- one partial index. No backfill — there is nothing to backfill FROM.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.gym_invoices
  add column if not exists dropped_at timestamptz;
alter table public.gym_invoices
  add column if not exists dropped_by uuid references public.profiles(id) on delete set null;
alter table public.gym_invoices
  add column if not exists drop_reason text;

-- Part 183's CHECK, in the same words: a decision with no reason on it is the
-- line somebody queries and nobody can answer.
alter table public.gym_invoices drop constraint if exists gym_invoices_drop_has_why;
alter table public.gym_invoices add constraint gym_invoices_drop_has_why
  check (dropped_at is null or (drop_reason is not null and btrim(drop_reason) <> ''));

-- And the mirror: a reason cannot stand on an invoice nobody dropped.
alter table public.gym_invoices drop constraint if exists gym_invoices_why_has_drop;
alter table public.gym_invoices add constraint gym_invoices_why_has_drop
  check (drop_reason is null or dropped_at is not null);

-- ── §2. what this deliberately does NOT constrain ───────────────────────────
--
-- There is no CHECK tying `dropped_at` to `status in ('void','written_off')`,
-- and that is the one place this differs from part 183's shape on purpose.
--
-- An invoice that was written off and is later reopened — the member turns up
-- and pays, the write-off was a mistake, the debt is sold on — moves its status
-- back to 'open' or 'paid'. If the drop columns had to be cleared for that to
-- be legal, reopening would ERASE the record that the gym once decided not to
-- collect this money and why. That is precisely the erasure the house rule
-- forbids and precisely what `reversed_at` exists to prevent on the payroll
-- side.
--
-- So the three columns stay where they are and become history: "written off on
-- 12 September because the member emigrated; reopened and paid on 4 October" is
-- two facts about one invoice, both true, both on the row. The screen renders
-- them as a sequence rather than as a contradiction, and
-- src/lib/invoiceWriteOff.ts holds the rule that decides which sentence to
-- print.
--
-- The forward direction — every dropped invoice has a reason — is held by the
-- writer, not by the database, for the applicability reason in the header. It
-- is the weaker half of the pair and it is the half that costs nothing when it
-- is missing: an invoice with no reason recorded is REPORTED as one.

comment on column public.gym_invoices.dropped_at is
  'When the gym decided not to collect this. Set alongside a void or written-off status and NEVER cleared: an invoice that is written off and later reopened is two facts, and clearing this would leave neither. A row with this null and a dropped status was dropped before supabase/parts/2642 existed, and the screen says so rather than inventing a reason.';
comment on column public.gym_invoices.drop_reason is
  'Why the gym decided not to collect it, in the gym''s own words. Required by CHECK whenever dropped_at is set. This is NOT gym_invoices.note — that says what was billed, and an owner typing the reason there would overwrite it.';
comment on column public.gym_invoices.dropped_by is
  'The account that made the decision. NULL where that account has since been deleted — the decision stays, because a filed month must not lose its explanation when a person leaves.';

-- The read is "which invoices did this gym decide not to collect, and when",
-- newest decision first, which is what an accountant asks a year of the
-- register. Partial, because the overwhelming majority of invoices are not
-- dropped and have no business in it.
create index if not exists idx_gym_invoices_dropped
  on public.gym_invoices (tenant_id, dropped_at desc)
  where dropped_at is not null;

-- ── §3. the closed-month lock already covers this ───────────────────────────
--
-- Part 182 put `trg_gym_invoices_closed_month` on `insert or update of
-- issued_on, amount_cents, status`, so writing an invoice off inside a month
-- that has been signed off is ALREADY refused — the status is one of the three
-- columns it watches, and this writer always moves the status. It is stated
-- here rather than left to be rediscovered, and the trigger is deliberately not
-- widened to name the new columns: doing so would refuse an owner correcting a
-- typed reason on a closed month's invoice, which changes no figure anybody
-- filed and is exactly the kind of repair that should stay possible.
