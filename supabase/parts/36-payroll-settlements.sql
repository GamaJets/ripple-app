-- ─────────────────────────────────────────────────────────────────────────
-- Recording that payroll was actually paid.
--
-- gymSessions.ts already computes what a gym owes and refuses to answer while
-- any session is unmarked. What nothing recorded was that the money went out.
-- Without it a gym can only ask "what do we owe for this period", never "have
-- we paid it" — and the second question is the one that gets asked twice on a
-- Friday afternoon by two different people.
--
-- THE DESIGN PROBLEM this solves is double payment.
--
-- A settlement cannot simply store a date range and an amount, because a
-- session can be marked AFTER its period is settled — a trainer catching up on
-- last week's outcomes. If settlement were range-based, that late session would
-- either be silently unpaid forever (it falls inside a settled range) or paid
-- twice (the range is settled again). Both are real money going wrong quietly.
--
-- So settlement is per SESSION, not per period. Each settled session carries
-- the id of the run that paid it:
--
--   · a session with settlement_id has been paid, and is excluded from what is
--     owed, permanently
--   · a session marked late has no settlement_id, so it simply appears in the
--     next run — late, but paid exactly once
--
-- The amount is snapshotted on the settlement row as well, so a later change to
-- the gym's session fee cannot rewrite what was actually handed over. That is
-- the same reasoning as rate_cents on the session itself: history is what
-- happened, not what today's prices imply.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.payroll_settlements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  trainer_id uuid not null references public.profiles(id) on delete cascade,

  -- The window the run covered, for reporting. NOT the definition of what was
  -- paid — that is the set of sessions pointing at this row.
  period_from date not null,
  period_to date not null,

  -- What was handed over, snapshotted. Never recomputed.
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'AED',
  sessions_count integer not null check (sessions_count >= 0),

  method text not null default 'transfer'
    check (method in ('transfer', 'cash', 'payroll', 'other')),
  note text,

  settled_at timestamptz not null default now(),
  settled_by uuid references auth.users(id) on delete set null,

  created_at timestamptz not null default now()
);

create index if not exists idx_settlements_tenant
  on public.payroll_settlements(tenant_id, settled_at desc);
create index if not exists idx_settlements_trainer
  on public.payroll_settlements(trainer_id, settled_at desc);

-- The link that makes double payment impossible.
alter table public.sessions
  add column if not exists settlement_id uuid
  references public.payroll_settlements(id) on delete set null;

-- Partial index: the query that matters is "what is still unpaid", and the
-- settled rows grow without bound while the unsettled set stays small.
create index if not exists idx_sessions_unsettled
  on public.sessions(tenant_id, trainer_id)
  where settlement_id is null;

-- ── access ─────────────────────────────────────────────────────────────────
alter table public.payroll_settlements enable row level security;

-- The owner of the gym runs payroll and sees all of it.
drop policy if exists settlements_owner on public.payroll_settlements;
create policy settlements_owner on public.payroll_settlements for all
  using (is_owner_of(tenant_id))
  with check (is_owner_of(tenant_id));

-- A trainer may read their own settlements — what they were paid, and when.
-- Read only: being paid is not something you record about yourself.
drop policy if exists settlements_trainer_read on public.payroll_settlements;
create policy settlements_trainer_read on public.payroll_settlements for select
  using (trainer_id = auth.uid());
