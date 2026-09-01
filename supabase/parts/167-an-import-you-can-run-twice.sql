-- ═══════════════════════════════════════════════════════════════════════════
-- The one screen that writes the money ledger irreversibly.
--
-- studio-web/app/import/page.tsx walks the ready rows and inserts them one at a
-- time. There is no dedupe key, no record of which run wrote which row, no
-- receipt and no undo. So:
--
--   · A run that half-lands is unrecoverable by inspection. The page's own copy
--     tells the operator to fix the failed lines and paste ONLY those back in,
--     "or the rest will be imported twice" — an instruction that depends on a
--     human transcribing line numbers correctly, once, under time pressure,
--     into a box that writes money.
--   · Re-pasting the same file is not idempotent. Nothing in `gym_payments`
--     says two identical rows are the same payment, so a second run doubles a
--     month's revenue, and the two copies are indistinguishable afterwards
--     because they genuinely are identical rows.
--   · There is no way back. Every other destructive thing in this product can
--     be undone (a redemption, a settlement, an attendance tick); two hundred
--     payments written by mistake can only be deleted by hand, from a table
--     with no marker saying which two hundred.
--
-- Three additions close all four, and none of them changes an existing row.
--
-- ── 1. A key that says "this is the same line of the same sheet" ──────────
--
-- `gym_payments.import_key` plus a UNIQUE index on (tenant_id, import_key).
-- The key is computed by the client from the CONTENT of the line — date,
-- amount, method, who it names, its note — plus an occurrence number that
-- distinguishes a sheet's genuinely repeated lines from a sheet pasted twice.
-- See `paymentImportKey` in src/lib/gymImports.ts, which is where the rule is
-- written down and tested.
--
-- The index is NOT partial. A unique index over a nullable column already
-- treats NULLs as distinct, so every payment recorded by hand — the desk, the
-- Members screen, a subscription — carries a null key and can never collide
-- with anything. Making it partial would have bought nothing and cost the
-- ability to name it as an ON CONFLICT target from PostgREST, which is the
-- whole mechanism: the import upserts with `ignoreDuplicates`, so a line that
-- is already in the ledger is SKIPPED by the database rather than by the
-- client's memory of what it did last time.
--
-- That is the important property. Dedupe that lives in the client is dedupe
-- that a page reload defeats.
--
-- ── 2. A receipt ─────────────────────────────────────────────────────────
--
-- `gym_import_runs` records what was attempted, what landed, what was skipped
-- as already present and what was refused. An owner asking "did last Tuesday's
-- import work?" currently has nowhere to look, and the answer matters most
-- exactly when the answer is "partly".
--
-- Counts are stored rather than derived. The written count can be recomputed
-- from `gym_payments.import_run_id`, but the SKIPPED and FAILED counts cannot
-- be recomputed from anything — the rows they describe are not there — and a
-- receipt that can only tell you about the successes is not a receipt.
--
-- ── 3. An undo ───────────────────────────────────────────────────────────
--
-- `gym_payments.import_run_id` makes "everything that run wrote" a set the
-- database can name, so undo is one DELETE with one predicate, and the run row
-- survives with `undone_at` set. Deliberately not a soft delete on the payments
-- themselves: a voided payment still in the table is a row every future SUM has
-- to remember to exclude, and one that forgets restates the mistake. The
-- receipt is the record that the import happened; the ledger goes back to what
-- it was.
--
-- Undo is bounded by policy to the gym's own owner, like every other write to
-- this table, and by the client to a run whose rows are still identifiable.
--
-- Additive and idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.gym_import_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- The three tabs the import screen offers. 'members' issues invitations and
  -- writes no membership, so its runs have nothing to undo — it is recorded
  -- anyway, because "did I already send this list?" is the same question.
  kind text not null check (kind in ('payments', 'plans', 'members')),
  started_at timestamptz not null default now(),
  -- Null while a run is in flight, and — more usefully — null forever on a run
  -- that was interrupted. A run with rows written and no finish is exactly the
  -- half-landed import this table exists to make visible.
  finished_at timestamptz,
  rows_offered integer not null default 0 check (rows_offered >= 0),
  rows_written integer not null default 0 check (rows_written >= 0),
  -- Lines the database recognised as already imported. Stored rather than
  -- derived: the rows are not there to count.
  rows_skipped integer not null default 0 check (rows_skipped >= 0),
  rows_failed integer not null default 0 check (rows_failed >= 0),
  undone_at timestamptz,
  note text,
  created_by uuid references public.profiles(id) on delete set null
);

create index if not exists idx_gym_import_runs_tenant
  on public.gym_import_runs (tenant_id, started_at desc);

comment on table public.gym_import_runs is
  'One row per press of an Import button. The receipt for a bulk write to the money ledger: what was offered, what landed, what the database recognised as already there, and what it refused. rows_skipped and rows_failed cannot be recomputed from anything else — the rows they count do not exist.';

alter table public.gym_import_runs enable row level security;

-- Same shape as `gym_payments_owner`: the gym's own owner, for everything. A
-- trainer has no business reading what a gym imported, and the import screen is
-- owner-only for the same reason.
drop policy if exists gym_import_runs_owner on public.gym_import_runs;
create policy gym_import_runs_owner on public.gym_import_runs
  for all using (is_owner_of(tenant_id)) with check (is_owner_of(tenant_id));

-- ── the two columns on the ledger ───────────────────────────────────────────

alter table public.gym_payments
  add column if not exists import_run_id uuid references public.gym_import_runs(id) on delete set null;

alter table public.gym_payments
  add column if not exists import_key text;

comment on column public.gym_payments.import_key is
  'Content fingerprint of the spreadsheet line this payment came from, from paymentImportKey() in src/lib/gymImports.ts. NULL for every payment recorded by hand, and NULLs do not collide, so the unique index below only ever constrains imported rows.';

comment on column public.gym_payments.import_run_id is
  'Which import run wrote this row. The predicate an undo deletes by.';

-- The whole dedupe, in one line. Named so PostgREST can be pointed at it as an
-- ON CONFLICT target (`on_conflict=tenant_id,import_key`), which is what lets
-- the import say "insert these, and quietly skip the ones already here" in a
-- single statement rather than by remembering.
create unique index if not exists gym_payments_import_key_uq
  on public.gym_payments (tenant_id, import_key);

create index if not exists idx_gym_payments_import_run
  on public.gym_payments (import_run_id)
  where import_run_id is not null;
