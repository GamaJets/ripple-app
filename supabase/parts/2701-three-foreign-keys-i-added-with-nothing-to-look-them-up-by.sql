-- ── Covering indexes for the three "who did it" columns added today ────────
--
-- Parts 2641, 2642 and 2700 each added a `… _by uuid references profiles(id)
-- on delete set null` column: who recorded a tax period, who wrote an invoice
-- off, who typed a bank figure. Every one of them arrived WITHOUT an index.
--
-- That is not a read problem — nothing filters on those columns, and nothing
-- should: they are stamps read as part of a row you already found. It is a
-- DELETE problem, and it is this product's own shape that makes it one.
--
-- `on delete set null` obliges Postgres to find every child row referencing a
-- profile before that profile can go. With no index it does that by sequential
-- scan, once per child table, inside the deleting transaction. Repple deletes
-- profiles for real — `action_account_deletion()` is a shipped feature a member
-- can ask for — so these three scans would sit on the path of somebody
-- exercising a data right, growing with the table, for columns nobody reads.
--
-- The `get_advisors` performance pass named all three within minutes of the
-- parts being applied. Ninety-five such findings already exist in this schema
-- and this does not attempt them; it declines to add three more.
--
-- Partial, because the interesting rows are the ones that reference anything:
-- a tax period nobody stamped, an invoice never written off and a bank line
-- with no author are all NULL here, and a NULL cannot be the child of a delete.
-- The index is the size of the answers, not the size of the table.
create index if not exists idx_gym_tax_registrations_created_by
  on public.gym_tax_registrations (created_by)
  where created_by is not null;

create index if not exists idx_gym_invoices_dropped_by
  on public.gym_invoices (dropped_by)
  where dropped_by is not null;

create index if not exists idx_gym_banked_months_recorded_by
  on public.gym_banked_months (recorded_by)
  where recorded_by is not null;
