-- ═══════════════════════════════════════════════════════════════════════════
-- A month was signed off, and then a payroll run landed in it.
--
-- Part 182 gave this database a lock: `gym_refuse_write_into_closed_month`,
-- attached to `gym_payments` on `taken_at` and to `gym_invoices` on
-- `issued_on`. Its argument is that a stored close which any later write can
-- invalidate is a note rather than a close.
--
-- `payroll_settlements` was left out, and it is the one place money LEAVES the
-- building. /accounting's "Money out" for a filed month is read straight off
-- this table, so a run settled into August after August was closed changes the
-- figure an accountant has already been handed — silently, and in the one
-- direction that reduces the net cash a filed month reported.
--
-- /payroll made that easy rather than hard: the period picker offered six
-- months and never read `gym_month_closes` at all, so a closed month looked
-- exactly like an open one and the run wrote `period_from` straight through.
--
-- ── Why `period_from` and not `settled_at` ─────────────────────────────────
--
-- `settled_at` is when somebody pressed the button and is always now. Locking
-- on it would refuse nothing, because the current month is the one month nobody
-- has closed. `period_from` is what the run CLAIMS to be paying for, it is the
-- column /accounting buckets by, and it is the one that decides which month's
-- costs move. A run recorded on 2 September for August is August's cost, which
-- is exactly the case this refuses once August is closed.
--
-- The way out is the way out for a payment: reopen the month on /close, with a
-- reason, and settle again. The refusal names the month and says so.
--
-- ── What is still deliberately NOT locked ──────────────────────────────────
--
-- Sessions. Part 182 argues it and nothing here changes: a coach marking an
-- outcome late is fixing the record rather than moving money, and a lock there
-- would leave a session permanently unmarkable and therefore unpayable. It is
-- the SETTLEMENT that is money, and the settlement is what is guarded.
--
-- Also not `payroll_settlements.reversed_at`. Taking a run back is a correction
-- somebody is making deliberately, with the run in front of them, and part 182
-- makes the same exemption for the import undo. The trigger only fires on the
-- columns named below, so a reversal that touches neither is unaffected.
--
-- Additive and idempotent. The function itself is part 182's, unchanged.
-- ═══════════════════════════════════════════════════════════════════════════

drop trigger if exists trg_payroll_settlements_closed_month on public.payroll_settlements;
create trigger trg_payroll_settlements_closed_month
  before insert or update of period_from, amount_cents on public.payroll_settlements
  for each row execute function public.gym_refuse_write_into_closed_month('period_from');
