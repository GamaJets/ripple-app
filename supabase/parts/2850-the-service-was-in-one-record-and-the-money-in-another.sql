-- ═══════════════════════════════════════════════════════════════════════════
-- The service was in one record and the money was in another.
--
-- ── The defect ─────────────────────────────────────────────────────────────
--
-- Part 186 gave a machine a history: `gym_equipment_log` holds every service,
-- repair, inspection, clean and incident, with the engineer, the findings, the
-- day, and — in `cost_cents` / `currency` — WHAT IT COST.
--
-- Part 700 gave a gym a P&L: `gym_costs` holds what the gym paid for that is
-- not payroll, one of whose eight categories is literally 'maintenance' and
-- another 'equipment'.
--
-- The two have never been able to point at each other. So a gym that services a
-- rack either:
--
--   · records it in the log, where the figure is invisible to every money
--     screen in the product — /accounting's Money out, /close's month-end
--     statement, /tax's period figures and /costs' own budget comparison all
--     read `gym_costs` and none of them reads this table. The gym's own P&L is
--     short by the whole of its maintenance spend and nothing says so; or
--   · records it in /costs, where the money is in the books and there is
--     nothing on the row saying WHICH MACHINE, so the register cannot answer
--     for it; or
--   · records it in both, which is the only way to get both answers and is also
--     the only way to double-count the same invoice — see the double-counting
--     note below, which is the reason this part is a link and not a copy.
--
-- "What has this rack cost us" is the question that decides whether to repair a
-- machine again or replace it, and it is the question the product could not
-- answer while holding both halves of the answer.
--
-- ── The shape, borrowed from part 2640 ────────────────────────────────────
--
-- Part 2640 hung a document off a cost with one nullable `cost_id` on the
-- CHILD table, `on delete set null`, one partial index, one policy narrowed.
-- This is that, and the reasoning transfers almost line for line, because the
-- two cases are the same case: a thing the gym holds that is ABOUT a cost.
--
-- The direction is deliberate and it is the one part 2640 chose. `cost_id` goes
-- on `gym_equipment_log`, not `equipment_id` on `gym_costs`:
--
--   · one engineer's invoice can cover three machines serviced in one visit,
--     and one cost row cannot name three machines. Three log entries pointing
--     at one cost can. `equipment_id` on the cost would have forced a gym to
--     split one supplier invoice into three costs that never existed, which is
--     a worse record of the money than the one it replaced;
--   · `gym_costs` is the accounting record and takes no UPDATE at all (part
--     700: "correcting a cost is deleting the wrong line and writing the right
--     one"). A column there could never be filled in afterwards — the link
--     would have to be got right at the moment the cost was typed, which is
--     months before anybody asks what the rack has cost.
--
-- ── THE ONE FIGURE THIS MUST NOT PRODUCE ──────────────────────────────────
--
-- `gym_equipment_log.cost_cents` and the linked `gym_costs.amount_cents` are
-- TWO SEPARATE CLAIMS ABOUT THE SAME MONEY, and nothing anywhere may add them
-- together. That is the defect this part is most likely to cause and it is
-- named here, in the schema, because the arithmetic is invisible at the call
-- site: both columns are integers in minor units, both are about the same
-- repair, and summing a machine's log figures and its linked costs gives
-- exactly twice what the gym spent.
--
-- Nor are they reconciled. Nothing here checks that they agree, and they very
-- often will not, for reasons that are all ordinary: one invoice covering three
-- machines is one cost and three log entries; a call-out fee recorded as a cost
-- and the parts recorded on the log; a figure typed from the engineer's quote
-- and a cost entered from the final bill. `src/lib/equipmentSpend.ts` is
-- written to REPORT a disagreement rather than resolve one, and to answer "what
-- has this machine cost us" out of the BOOKS — the linked `gym_costs` rows,
-- deduplicated by cost id — with the log figures that reached no cost named
-- separately as money the register knows about and the accounts do not.
--
-- ── `on delete set null`, for part 2640's reason exactly ──────────────────
--
-- Part 700 grants the owner INSERT and DELETE on `gym_costs` and refuses UPDATE
-- on purpose, so a cost being deleted is the ORDINARY way a cost is corrected,
-- not an unusual event. `cascade` would then delete a machine's SERVICE HISTORY
-- — and an INCIDENT RECORD, which is a statutory document in most jurisdictions
-- this product is sold into — every time somebody fixed a typo in a cost
-- description. The log entry survives, detached, and the owner re-links it to
-- the replacement line.
--
-- Unlike part 2640 there is not even a question about audience widening here: a
-- detached log entry is read by exactly the people who could read it while it
-- was attached, because the policies below key on `tenant_id` and role and
-- never on the cost.
--
-- ── Applying this ─────────────────────────────────────────────────────────
--
-- Additive. One nullable column, one partial index, one policy narrowed. No
-- backfill: a log entry filed before today was never said by anybody to be the
-- same money as any particular cost row, and guessing — by date, by amount, by
-- category — would be this product asserting a match nobody made, on the two
-- records a gym reconciles its maintenance spend from.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. the column ───────────────────────────────────────────────────────────

alter table public.gym_equipment_log
  add column if not exists cost_id uuid references public.gym_costs(id) on delete set null;

comment on column public.gym_equipment_log.cost_id is
  'The gym_costs row this entry''s money is recorded in, or NULL because it cost nothing, because nobody put it in the books, or because nobody has linked it yet. NOT a second copy of the amount: cost_cents on this row and amount_cents on that one are two claims about the same money and MUST NEVER BE ADDED TOGETHER. Nothing checks that they agree — one invoice can cover three machines — and src/lib/equipmentSpend.ts reports a disagreement rather than resolving it.';

-- The read is always "the log entries attached to these costs", or its mirror,
-- "what does this machine's spend point at". Partial, because most rows in this
-- table are cleans, inspections and incidents that cost nothing and have no
-- business in an index of maintenance spend.
create index if not exists idx_gym_equipment_log_cost
  on public.gym_equipment_log (cost_id)
  where cost_id is not null;

-- ── 2. who may attach one ───────────────────────────────────────────────────
--
-- Part 186 lets a TRAINER insert into `gym_equipment_log`, deliberately: "they
-- are the ones standing next to it when it breaks, and a log only the owner can
-- write is a log written days later from memory or not at all." That stays
-- exactly as it is for every entry that names no cost.
--
-- Naming one is a different act, and part 2640 has already made this argument
-- about the identical column on `gym_documents`: `gym_costs` is the owner's
-- alone in all three directions (part 700 grants select, insert and delete to
-- `is_owner_of(tenant_id)` and nothing else, because a 'staff' cost line with a
-- description on it is a personnel disclosure the gym did not make). A foreign
-- key is checked by the SYSTEM rather than through row-level security, so
-- without this a trainer holding a cost id could attach a log entry to a cost
-- row they may not read — and then not be able to read the cost back.
--
-- Dropped by name as well as replaced: a policy left standing is OR'd with the
-- new one and the old width simply survives. Part 390 makes the same point
-- about `gym_documents_staff_r` and part 2640 about `gym_documents_staff_i`.
drop policy if exists gym_equipment_log_staff_i on public.gym_equipment_log;
create policy gym_equipment_log_staff_i on public.gym_equipment_log
  for insert with check (
    tenant_id = my_tenant()
    and my_role() in ('trainer', 'owner')
    -- The owner has `gym_equipment_log_owner` (for all, `is_owner_of(tenant_id)`)
    -- and reaches a linked entry through that policy, so this clause costs them
    -- nothing. What it removes is the trainer's route to a cost row.
    and cost_id is null
  );

comment on policy gym_equipment_log_staff_i on public.gym_equipment_log is
  'A trainer may record what happened to a machine and may not attach it to a cost: gym_costs is the owner''s alone in part 700, and a foreign key is checked outside row-level security. The owner links spend through gym_equipment_log_owner.';

-- The trainer's SELECT is untouched and stays wide. A log entry that names a
-- cost still shows a trainer everything it showed them before — the machine,
-- the day, the engineer, the findings, and the figure part 186 already put on
-- this row. This column carries no money of its own; it is an id, and the cost
-- behind it stays unreadable to them through `gym_costs`' own policies, which
-- is where that decision belongs.

-- ── 3. what this part deliberately does NOT do ──────────────────────────────
--
--   · No CHECK tying `cost_id` to a kind. A 'clean' can be a contract cleaner's
--     invoice and an 'incident' can cost a gym an excess on a claim; refusing
--     the link on those two kinds would leave real money out of the one place
--     that could account for it.
--   · No CHECK that `cost_cents` is set when `cost_id` is. A gym that puts the
--     money straight into the books and records only the work on the log is
--     doing the RIGHT thing — the books are the money record — and demanding a
--     second copy of the figure here would be demanding the double entry this
--     part's header refuses.
--   · No CHECK that the two figures agree, and no trigger that copies one into
--     the other. See the double-counting note: one invoice covering three
--     machines makes them legitimately different, and a database that insisted
--     otherwise would refuse the commonest real case.
--   · No unique constraint on `cost_id`. Three machines serviced on one visit
--     are three log entries pointing at one cost, which is the whole reason the
--     column is on this side; `equipmentSpend` deduplicates by cost id so that
--     one invoice counts once against one machine.
--   · Nothing is written to `gym_costs`. Linking an existing cost is a link;
--     creating the cost is `recordGymCost` in src/lib/gymCosts.ts, unchanged,
--     and a screen that offers both keeps them two separate acts so that
--     "attach this to the books" can never mint a cost nobody typed.
