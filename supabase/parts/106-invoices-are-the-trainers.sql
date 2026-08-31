-- ── An invoice belongs to the trainer it bills, and to nobody else ─────────
--
-- `invoices` is the Stripe ledger for a TRAINER paying Repple (part 20). It is
-- not gym money, and it carries no tenant column at all.
--
-- The policy read:
--
--   trainer_id = auth.uid()
--   or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'owner')
--
-- The second arm has no tenant test — because there is nothing on the row to
-- scope it to. So ANY account with role='owner' could read EVERY invoice in the
-- project: every gym's coaches, what they pay Repple, and what failed. A
-- cross-tenant read, and it survived because the subscription console it was
-- written for was deleted while the policy stayed behind.
--
-- The owner app's own Trainers screen states the principle this breaks: a
-- trainer's plan and MRR are "what a trainer pays Repple, which is not a number
-- a gym owner has any business seeing on their own dashboard".
--
-- A gym's own receivables are `gym_invoices` (part 29) — a different table,
-- with a tenant on it.
drop policy if exists inv_read on public.invoices;
create policy inv_read on public.invoices
  for select using (trainer_id = (select auth.uid()));
