-- ═══════════════════════════════════════════════════════════════════════════
-- The reconciliation asked the same question every month and had nowhere to
-- keep the answer.
--
-- /accounting renders three exception tables — invoices marked paid with no
-- payment behind them, payments banked with no invoice in front of them, and
-- money banked against nobody. The page's own header calls each row "a question
-- with a name on it". It is right, and until now that is all it was: there is
-- no match, no accept, no dismiss and no note, and nothing persists. Every
-- exception the owner walked through in August is on the screen again in
-- September, identical, forever.
--
-- The consequence is not that the list is annoying. It is that the list stops
-- being read. An exception report that never shrinks is one an owner learns to
-- scroll past, and the month it contains something real is the month nobody
-- looks — which is the entire failure mode this product spends its design
-- budget avoiding on every other screen.
--
-- ── What an answer actually is, and why there are only two of them ────────
--
-- There are three things an owner can truthfully say about an exception:
--
--   1. "This payment settles that invoice." That is a FACT and it belongs in
--      the ledger, not in a notes table — it is `gym_payments.invoice_id`,
--      added in supabase/parts/180. A matched row stops being an exception
--      because it stops being unmatched, and no state here is involved.
--
--   2. "I know why this is here and it is fine." Cash banked in a lump at the
--      desk, a partner paying under their own name, a part payment. Nothing is
--      wrong and nothing can be linked. This is `accepted`.
--
--   3. "This is wrong and I am dealing with it elsewhere." A duplicate to be
--      corrected, an invoice raised in error. This is `flagged`, and it stays
--      on the list on purpose — it is not an answer, it is a bookmark, and a
--      state that hides a row somebody called wrong would be the worst outcome
--      this table could produce.
--
-- There is deliberately no `dismissed`. "Dismiss" and "accept" would be two
-- words for one action with different implications about whether anybody looked,
-- and the difference would be invisible a month later.
--
-- ── Why the note is on the row rather than on the month ───────────────────
--
-- Because the row is what recurs. An invoice raised in June is still an
-- exception in July, August and September, and an answer written against
-- "June" would have to be found again each time. Keyed on the subject, the
-- answer follows the row for as long as the row keeps appearing.
--
-- ── What this deliberately cannot do ──────────────────────────────────────
--
-- An accepted exception is accepted by whoever pressed the button, and that is
-- all this records. It is not an approval, not a sign-off and not evidence that
-- anybody senior agreed — the console has one role above trainer and it is
-- "owner". The accountant reading the close needs to know that, so the screen
-- says who and when beside every accepted row rather than simply removing it.
--
-- Additive and idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.gym_reconcile_marks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- Which register the row lives in. Not a foreign key to either table, and
  -- that is on purpose: one column cannot reference two tables, and splitting
  -- this into `invoice_id` plus `payment_id` would make "exactly one of these
  -- is set" a constraint somebody has to remember rather than a shape.
  subject_kind text not null check (subject_kind in ('invoice', 'payment')),
  subject_id uuid not null,

  state text not null check (state in ('accepted', 'flagged')),

  -- Required on `accepted`, and the constraint below enforces it. An exception
  -- silently taken off a reconciliation with no reason recorded is exactly the
  -- row an auditor asks about, and "somebody clicked Accept" is not an answer
  -- to that question.
  note text,

  marked_by uuid references public.profiles(id) on delete set null,
  marked_at timestamptz not null default now()
);

-- One live answer per row. Changing your mind UPDATEs; it does not accumulate
-- a stack of contradictory marks that a screen would then have to pick between.
create unique index if not exists gym_reconcile_marks_subject_uq
  on public.gym_reconcile_marks (tenant_id, subject_kind, subject_id);

create index if not exists idx_gym_reconcile_marks_tenant
  on public.gym_reconcile_marks (tenant_id, marked_at desc);

alter table public.gym_reconcile_marks drop constraint if exists gym_reconcile_marks_accepted_has_why;
alter table public.gym_reconcile_marks add constraint gym_reconcile_marks_accepted_has_why
  check (state <> 'accepted' or (note is not null and btrim(note) <> ''));

comment on table public.gym_reconcile_marks is
  'The owner''s answer to one reconciliation exception, so /accounting stops asking it every month. `accepted` means explained and requires the explanation; `flagged` means wrong and being dealt with, and deliberately does NOT hide the row. A genuine match is not recorded here at all — it is gym_payments.invoice_id.';

alter table public.gym_reconcile_marks enable row level security;

-- The same shape as `gym_payments_owner`: the gym's own owner, for everything.
-- A trainer has no business reading what an owner said about the gym's books.
drop policy if exists gym_reconcile_marks_owner on public.gym_reconcile_marks;
create policy gym_reconcile_marks_owner on public.gym_reconcile_marks
  for all using (is_owner_of(tenant_id)) with check (is_owner_of(tenant_id));

-- Supabase hands `anon` and `authenticated` the full DML set on every table
-- created in this project by default — part 119 found that on 80 of 89 tables,
-- and part 132 confirmed it again on a table created minutes earlier. RLS
-- narrows a GRANT; it does not confer one, and it does not apply to TRUNCATE at
-- all. So both roles are named and revoked rather than left to `revoke ... from
-- public`, which does not touch a grantee holding a privilege in its own right.
revoke all on public.gym_reconcile_marks from anon, authenticated, public;
grant select, insert, update, delete on public.gym_reconcile_marks to authenticated;
grant all on public.gym_reconcile_marks to service_role;
