-- ═══════════════════════════════════════════════════════════════════════════
-- A payroll run recorded one figure, and it was two different kinds of money.
--
-- `payroll_adjustments` has had four kinds since part 183 — bonus, deduction,
-- reimbursement, advance — and `ADJUSTMENT_LABEL` in src/lib/gymPay.ts says
-- plainly why they are four words and not two signs:
--
--     A reimbursement is the gym paying back money the coach spent; a bonus is
--     pay. Both add, and a payslip that called one the other would be wrong in
--     a way that matters to whoever files it — one is taxable and one is not.
--
-- The run then settled all of it as a single `amount_cents`, so the distinction
-- the schema went to the trouble of recording was thrown away at exactly the
-- moment it mattered. Whoever files the payroll has one number and no way to
-- get back to the two, because the adjustments are stamped with the settlement
-- and the settlement says nothing about them.
--
-- ── Why a column here rather than a join back ──────────────────────────────
--
-- The adjustments are still there and still stamped, so in principle the split
-- is recomputable. In principle is not good enough for a payment record: this
-- table exists at all because part 36 chose to SNAPSHOT what was handed over
-- rather than recompute it from today's rates, and the same argument applies
-- unchanged. A rate, a kind or an amount edited afterwards must not silently
-- restate what somebody was paid last March.
--
-- ── NULL is not zero, and the difference is the whole column ───────────────
--
-- NULL means the run did not say — which is every settlement recorded before
-- this part, and there is no way to find out now. 0 means the run DID say, and
-- none of it was a reimbursement. A screen that read NULL as 0 would report
-- every historical run as wholly taxable pay, which is a claim about somebody's
-- tax that nothing in this database supports.
--
-- Not constrained against `amount_cents`. A run whose deductions exceed its
-- session pay can leave the reimbursement larger than the total, and refusing
-- that would refuse a real run. `amount_cents >= 0` already stops the case that
-- actually matters, which is a settlement recorded as a negative payment.
--
-- Additive and idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.payroll_settlements
  add column if not exists reimbursement_cents integer;

alter table public.payroll_settlements drop constraint if exists payroll_settlements_reimbursement_positive;
alter table public.payroll_settlements add constraint payroll_settlements_reimbursement_positive
  check (reimbursement_cents is null or reimbursement_cents >= 0);

comment on column public.payroll_settlements.reimbursement_cents is
  'How much of amount_cents was money the coach spent and got back, rather than pay. NULL means the run did not say, which is every settlement recorded before this column existed; 0 means it said, and none of it was. The rest of amount_cents is taxable pay. Snapshotted for the same reason amount_cents is: an adjustment edited later must not restate what somebody was paid.';
