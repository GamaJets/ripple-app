-- ═══════════════════════════════════════════════════════════════════════════
-- A cost with nothing behind it.
--
-- ── What was missing ───────────────────────────────────────────────────────
--
-- `gym_documents` (part 185) is the index in front of the `gym-docs` bucket and
-- it can say what a file is ABOUT in exactly two ways: `member_id` and
-- `equipment_id`. So a gym could file the engineer's report on a rower and the
-- member's signed contract, and could not file the invoice the engineer sent —
-- the one piece of paper the money record is actually made of.
--
-- Part 700's own header says so, twice, and says it as a limitation rather than
-- a decision:
--
--     "nothing here has been checked against a bank, a card, a receipt or a
--      supplier's invoice, and Repple holds no document behind any of it"
--
-- and src/lib/gymTax.ts prints it to the owner, at a filing deadline, as one of
-- the six things this product does not know:
--
--     "Nothing here is evidenced. Repple holds no supplier invoice, no receipt
--      and no till roll. Every cost on the record is somebody's typed word
--      about a document that lives somewhere else, and that document is what a
--      tax authority asks for."
--
-- The bucket existed. The cost table existed. The one column joining them did
-- not, so the two halves of every expense sat in one database unable to point
-- at each other, and a gym answering a query about September's rent had the
-- amount here and the PDF in an inbox.
--
-- ── This does not make a cost "evidenced" ──────────────────────────────────
--
-- It makes it EVIDENCEABLE, which is a smaller claim and the only one the
-- schema can support. Nothing checks that the attached file is a receipt,
-- nothing reads the amount off it, nothing compares it to `amount_cents`, and
-- nothing anywhere is allowed to say a cost is verified because a file hangs
-- off it. Somebody attached a document and said it was about this cost; that is
-- the whole fact, and src/lib/costReceipts.ts is written to say only that.
--
-- The sentence in TAX_UNKNOWNS above therefore STAYS true of any cost with no
-- document on it, which is most of them, and the console reports the two states
-- apart rather than reporting a proportion as reassurance.
--
-- ── Why no new `kind`, and why that is the safe answer here ────────────────
--
-- `gym_documents.kind` is a closed set of seven, and `gym_doc_readable()` in
-- part 390 admits a TRAINER to four of them — `service_report`, `photo`,
-- `certificate`, `insurance` — whenever the document is not about a person.
-- Adding a 'receipt' kind would mean adding it in three places that must not
-- drift: the CHECK here, `DOCUMENT_KINDS` in src/lib/gymDocs.ts (whose reader
-- maps an unrecognised kind to 'other', so a database-only addition would show
-- a gym's supplier invoices on the compliance screen labelled "Other"), and the
-- test that reads part 390 back.
--
-- It is not needed. A receipt is filed under one of the three kinds a trainer
-- may NOT read — 'other' for a till receipt or a supplier invoice, 'contract'
-- for a supply agreement — so the existing predicate already gives the right
-- answer without being touched: what the gym pays in rent, and to whom, is not
-- the floor's business, which is the same line part 700 drew when it refused
-- `gym_costs` to every role but the owner. src/lib/costReceipts.ts holds that
-- list and a test asserts every kind on it is owner-only.
--
-- ── Applying this ──────────────────────────────────────────────────────────
--
-- Additive. One nullable column, one partial index, one policy narrowed. No
-- backfill: a document filed before today is about a member, a machine or the
-- building, and inventing a cost for it would be a claim nobody made.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. the column ───────────────────────────────────────────────────────────

alter table public.gym_documents
  add column if not exists cost_id uuid references public.gym_costs(id) on delete set null;

comment on column public.gym_documents.cost_id is
  'The gym_costs row this document is evidence for, or NULL because it is about a member, a machine, the building, or nothing in particular. Attaching one does not verify the cost: nothing reads the file, nothing compares it to amount_cents, and no screen may say a cost is checked because a document hangs off it.';

-- `on delete set null`, matching `member_id` and `equipment_id`, and it is the
-- only correct answer here rather than a copied one. Part 700 grants the owner
-- INSERT and DELETE on `gym_costs` and refuses UPDATE on purpose — "correcting
-- a cost is deleting the wrong line and writing the right one" — so a cost
-- being deleted is the ORDINARY way a cost is corrected, not an unusual event.
-- `cascade` would then take the supplier's invoice out of the filing cabinet
-- every time somebody fixed a typo in a description, and the file is the part
-- the gym cannot reproduce. The document survives, detached, and the owner
-- re-attaches it to the replacement line.
--
-- Unlike `member_id` this needs NO `..._attached` latch. Part 390 added one for
-- members because detaching WIDENED the audience: an incident report whose
-- member was erased would have become gym-wide paperwork the moment the id went
-- null. Here the audience is decided by `kind` alone and a detached receipt is
-- still 'other' or 'contract', so nothing widens and there is nothing to latch.

-- The read is always "the documents attached to these costs", so the index is
-- on the column and only where it is set. Partial, because the overwhelming
-- majority of rows in this table are about a member or a machine and have no
-- business in an index of receipts.
create index if not exists idx_gym_documents_cost
  on public.gym_documents (cost_id)
  where cost_id is not null;

-- ── 2. who may file one ─────────────────────────────────────────────────────
--
-- Part 185 lets a TRAINER insert into `gym_documents`, deliberately and
-- correctly: photographing a broken rower is the case that policy was written
-- for, and part 390 kept the asymmetry ("a trainer who can file an incident
-- report but not read one back is the correct asymmetry, not a bug").
--
-- A receipt against a cost is a different act. `gym_costs` is the owner's alone
-- in all three directions — part 700 grants select, insert and delete to
-- `is_owner_of(tenant_id)` and nothing else, on the stated reasoning that a
-- 'staff' cost line with a description on it is a personnel disclosure the gym
-- did not make. A foreign key is checked by the system rather than through row
-- level security, so without this a trainer holding a cost id could attach a
-- document to a line they may not read, and then not be able to read back the
-- row they had just written. Narrowing the insert is what keeps the two tables
-- saying the same thing about who the gym's spending belongs to.
--
-- Dropped by name as well as replaced: a policy left standing is OR'd with the
-- new one and the old width simply survives. Part 390's header makes the same
-- point about `gym_documents_staff_r`.
drop policy if exists gym_documents_staff_i on public.gym_documents;
create policy gym_documents_staff_i on public.gym_documents
  for insert with check (
    tenant_id = my_tenant()
    and my_role() in ('trainer', 'owner')
    -- The owner has `gym_documents_owner` (for all, `is_owner_of(tenant_id)`)
    -- and reaches a receipt through that policy, so this clause costs them
    -- nothing. What it removes is the trainer's route to a cost row.
    and cost_id is null
  );

comment on policy gym_documents_staff_i on public.gym_documents is
  'A trainer may file the building''s paperwork and may not attach anything to a cost: gym_costs is the owner''s alone in part 700, and a foreign key is checked outside row-level security. The owner writes receipts through gym_documents_owner.';
