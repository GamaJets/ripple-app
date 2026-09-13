-- ═══════════════════════════════════════════════════════════════════════════
-- An overdue invoice, and nothing anywhere saying anybody had chased it.
--
-- ── The defect ─────────────────────────────────────────────────────────────
--
-- `gym_invoices` has recorded what is owed and when it was due since part 29.
-- `isOverdue` in src/lib/monthEnd.ts computes lateness from the DUE DATE, the
-- Ageing section of studio-web/app/accounting/page.tsx bands it 1-30 / 31-60 /
-- 61+, and the register beneath it names every invoice behind every band.
--
-- So the console answers "who is late" exactly, and answers nothing else. An
-- owner who works down that list on a Monday morning — three emails, a phone
-- call, a word at the desk — opens it again on Thursday and it is the same
-- list, in the same order, saying the same thing. Nothing on it distinguishes
-- the member who was rung yesterday from the member nobody has spoken to since
-- April. The only place the difference lives is in whoever did the ringing.
--
-- That costs three separate things, and the third is the expensive one:
--
--   · the same member is chased twice in a week by two people, or not at all
--     because each assumed the other had;
--   · `WRITE_OFF_PROMPT` in src/lib/invoiceWriteOff.ts asks "Why is this money
--     not going to be collected?", and the honest answer is usually "we chased
--     it four times and gave up" — which the gym cannot evidence, on the one
--     figure in the accounts an accountant asks about first;
--   · a gym pursuing a debt is asked, by anybody who might help it, when it
--     asked and how. The product held the debt and not one word of the asking.
--
-- ── A CHASE IS A RECORD. IT IS NOT A SEND. ────────────────────────────────
--
-- This is the whole shape of the table and it is stated first because getting
-- it wrong is the one failure here that reaches a member.
--
-- Nothing in this part, and nothing in src/lib/invoiceChases.ts, sends
-- anything to anybody. No email, no push, no SMS, no inbox row. A row here says
-- SOMEBODY AT THIS GYM SAYS THEY CHASED THIS INVOICE, on this day, by this
-- means, in their own words — the same size of claim `gym_tax_registrations`
-- (part 2641) makes about a registration and `gym_documents.cost_id`
-- (part 2640) makes about a receipt. Repple did not witness the phone call and
-- does not claim to.
--
-- The risk is real and specific rather than theoretical, because this table
-- hangs off the one table in this schema that DOES send. `gym_invoice_notify()`
-- (part 146) is an AFTER INSERT OR UPDATE OF status trigger on `gym_invoices`
-- that writes the member a notification saying their gym has issued them an
-- invoice. A chase modelled as a column on that row — `last_chased_on`, say —
-- would sit one careless `update of` list away from mailing every late member
-- in the building the moment somebody widened the trigger. A separate table
-- carries no trigger, is named in no `update of` clause, and cannot acquire one
-- by accident.
--
-- Which leaves `via` as the only thing on the row that could mislead, and it is
-- deliberately the gym's own account of what the gym did:
--
--     'email' does not mean Repple emailed anybody. It means whoever recorded
--     this says they sent an email, from wherever they send email.
--
-- The column comment says that, src/lib/invoiceChases.ts says it again in
-- `CHASE_IS_A_RECORD_NOT_A_SEND`, and the console prints that sentence above
-- the form. A screen that let "Chased by email" be read as "Repple emailed
-- them" would be claiming delivery of something that may never have been sent.
--
-- ── Why a row per chase, and not a count and a date ───────────────────────
--
-- The obvious cheap answer is part 188's, on the coach side: `reminded_at` and
-- `reminder_count` on the invoice itself, moved by a SECURITY DEFINER function
-- that only ever increments. Two columns, no new table.
--
-- It is the right answer there and the wrong one here. That pair can say "three
-- times, most recently on Tuesday" and can never say when the first two were,
-- what was said, who said it, or by what means — and a self-employed coach
-- chasing their own client does not need it to. A gym's receivables are read by
-- somebody else: an accountant at the year end, a partner at a write-off, a
-- solicitor if it ever gets that far. "Emailed 3 September, telephoned
-- 14 September, spoke to her at the desk 28 September" is the evidence behind a
-- bad debt. A count of three is not evidence of anything.
--
-- A count is also lossy in the direction that matters. Delete the wrong chase
-- out of a counter and the history is gone; delete the wrong ROW and the other
-- three are still there, which is the same argument part 700 makes for
-- correcting a cost by deletion rather than by update.
--
-- ── `chased_on` is a DATE the gym states, not an instant Repple stamps ────
--
-- Two different facts, and both are on the row:
--
--   · `chased_on` — the day the chase HAPPENED, as a bare `YYYY-MM-DD`, typed
--     by whoever is recording it. It defaults to nothing and is NOT NULL: an
--     owner writing up Friday's phone calls on Monday states Friday, and a
--     column that could only hold "now" would file all four of them on Monday
--     and then age them against a due date from the wrong end.
--   · `created_at` — when the RECORD was made, stamped by the database, which
--     is a fact about the filing and not about the chase.
--
-- A `date` and not a `timestamptz`, for part 2641's reason and part 700's: the
-- day an act fell on is a calendar day in the gym's own reckoning, and an
-- instant would put a call made at 09:00 on 1 September in Dubai into 31 August
-- for a bookkeeper reading it in London. Every comparison against it in the
-- product is a string compare against another bare day — `due_on`, `issued_on`,
-- the gym's own today out of `gymDay` — and none of them parses.
--
-- ── The two rules the database cannot hold, and where they live instead ───
--
-- A chase dated in the future has not happened, and a chase dated before the
-- invoice was issued is about a bill that did not exist. Both are refused, and
-- neither can be refused HERE:
--
--   · `current_date` is STABLE, not IMMUTABLE, and Postgres rejects it in a
--     CHECK constraint outright. There is no version of "not in the future"
--     this table can enforce.
--   · `issued_on` is on the other table, and a CHECK may not reach across a
--     row. A trigger could, and is not written: it would fire on a table whose
--     whole point is that it carries no trigger (see the send note above), to
--     re-state a rule the one writer already enforces before the round trip.
--
-- So both live in `chaseBlocker` in src/lib/invoiceChases.ts, beside the box,
-- where the refusal arrives while somebody can still fix the date rather than
-- as a constraint name after the form has closed. The database holds what the
-- database can hold, and the header says which half is which rather than
-- leaving a reader to assume the CHECK list is the whole rule.
--
-- ── Who may read it ───────────────────────────────────────────────────────
--
-- The owner, and nobody else — including the member it is about, who can
-- already read the invoice itself through `gym_invoices_own_r`. A working note
-- saying "rang her twice, no answer, try the mother's number" is the gym's
-- record of its own conduct and not a document it published to anybody. Part
-- 188 drew the same line around `reminded_at` in one sentence — "it is their
-- own record of an act they performed" — and this is that sentence with a
-- second party in the room.
--
-- ── Applying this ─────────────────────────────────────────────────────────
--
-- Additive. One new table, its indexes, its policies, its grants. Nothing
-- existing is altered, no trigger is touched, and no backfill: a gym that has
-- been chasing invoices by hand for a year has said nothing to this table, and
-- an invented row would be Repple asserting a phone call nobody made.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. the record of an act ─────────────────────────────────────────────────

create table if not exists public.gym_invoice_chases (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null references public.tenants(id) on delete cascade,

  -- `cascade`, unlike `gym_documents.cost_id` in part 2640, and the difference
  -- is what the child row means on its own. A receipt is a document that goes
  -- on existing when the cost line it was attached to is retyped. A chase is
  -- "we asked for the money on this invoice", and an invoice that is gone takes
  -- the sentence with it — a chase pointing at nothing is not a smaller fact,
  -- it is an unreadable one.
  invoice_id  uuid        not null references public.gym_invoices(id) on delete cascade,

  -- The day it HAPPENED, as stated. See the header: not the day it was typed,
  -- which is `created_at`, and not an instant, which would move the act across
  -- a date boundary for a reader in another zone.
  chased_on   date        not null,

  -- How the gym says it asked. NOT a delivery record: nothing in this product
  -- sends on the strength of this value, and 'email' means somebody says they
  -- sent one. A closed set rather than free text so the register can be read at
  -- a glance, and src/lib/invoiceChases.ts holds the same six with the label
  -- each one is shown under; a value added here and not there renders as its
  -- own raw code, which is the drift part 2640 refused a seventh document kind
  -- to avoid.
  via         text        not null
              check (via in ('email', 'phone', 'message', 'in_person', 'post', 'other')),

  -- What was actually said, or what came back. Optional, because "rang, no
  -- answer" is a complete chase and a form that demands a paragraph for it gets
  -- "n/a" typed into the box — which is the failure `writeOffBlocker` was
  -- written against and the reason the minimum there is twelve characters
  -- rather than one. 1000 is the form's ceiling too, so the refusal arrives
  -- beside the box rather than as a 23514.
  note        text        check (note is null or (btrim(note) <> '' and length(note) <= 1000)),

  -- When the RECORD was made, which is not when the chase happened.
  created_at  timestamptz not null default now(),
  -- Who recorded it. NULL where that account has since been deleted: the chase
  -- stays, because a write-off must not lose its history when a receptionist
  -- leaves. Same reasoning, same wording, as gym_invoices.dropped_by in
  -- part 2642.
  created_by  uuid        references public.profiles(id) on delete set null
);

comment on table public.gym_invoice_chases is
  'What this gym says it did to collect on an invoice: one row per act, dated by the day it happened. NOTHING HERE SENDS ANYTHING. Repple does not email, message or telephone anybody on the strength of a row in this table, and via = ''email'' means somebody at the gym says they sent one. A row is a claim by the gym about the gym, the same size of claim gym_tax_registrations makes about a registration.';
comment on column public.gym_invoice_chases.chased_on is
  'The day the chase happened, as stated by whoever recorded it — a bare YYYY-MM-DD in the gym''s own reckoning, so writing up Friday''s calls on Monday dates them Friday. Not an instant: a call at 09:00 in Dubai must not read as the previous day in London. "Not in the future" and "not before the invoice was issued" are refused by chaseBlocker in src/lib/invoiceChases.ts, because current_date is not IMMUTABLE and issued_on is on another table.';
comment on column public.gym_invoice_chases.via is
  'How the gym says it asked: email | phone | message | in_person | post | other. NOT a delivery record and never evidence that anything arrived — no code path in this repository sends on the strength of it.';
comment on column public.gym_invoice_chases.note is
  'What was said, or what came back, in the gym''s own words. Optional on purpose: "rang, no answer" is a complete chase, and a box that must be filled gets "n/a" typed into it.';
comment on column public.gym_invoice_chases.created_at is
  'When the record was made. A fact about the filing, not about the chase — chased_on is the chase.';

-- The read is always "the chases against these invoices, most recent first",
-- which is how a screen puts a history beside an ageing row and how it decides
-- which invoices have been chased at all.
create index if not exists gym_invoice_chases_invoice_idx
  on public.gym_invoice_chases (invoice_id, chased_on desc, id desc);

-- And the tenant-wide sweep behind it: "what has this gym chased lately", which
-- is the read the console makes once and indexes by invoice rather than asking
-- per row. `id` gives the ordering a total order — pages of a tied `chased_on`
-- drop and repeat rows without it, and here that is a chase missing from the
-- history behind a write-off.
create index if not exists gym_invoice_chases_tenant_idx
  on public.gym_invoice_chases (tenant_id, chased_on desc, id desc);

-- ── 2. who may read and write it ────────────────────────────────────────────
--
-- The owner alone, in all three directions, which is the line part 700 draws
-- around `gym_costs` and part 2641 around `gym_tax_registrations`.
--
-- The member is the one to be careful about, because they are ALREADY allowed
-- to read the invoice this row points at: `gym_invoices_own_r` (part 29) is
-- `member_id = auth.uid()`, deliberately, so somebody can see what their gym
-- says they owe. That policy is on the other table and does not reach this one,
-- and no policy here admits them. A note reading "rang twice, no answer, try
-- the mother's number" is the gym's record of its own conduct; publishing it to
-- the person it is about is a different product and not one anybody asked for.
alter table public.gym_invoice_chases enable row level security;

drop policy if exists gym_invoice_chases_owner_read on public.gym_invoice_chases;
create policy gym_invoice_chases_owner_read on public.gym_invoice_chases
  for select
  to authenticated
  using (is_owner_of(tenant_id));

drop policy if exists gym_invoice_chases_owner_insert on public.gym_invoice_chases;
create policy gym_invoice_chases_owner_insert on public.gym_invoice_chases
  for insert
  to authenticated
  with check (is_owner_of(tenant_id));

drop policy if exists gym_invoice_chases_owner_delete on public.gym_invoice_chases;
create policy gym_invoice_chases_owner_delete on public.gym_invoice_chases
  for delete
  to authenticated
  using (is_owner_of(tenant_id));

-- No UPDATE, and it is named and dropped rather than merely never written, so a
-- policy added by somebody who wanted an edit button cannot survive a rebuild
-- of this file. Part 2641 DOES grant update, on the argument that closing an
-- open-ended registration is an ordinary edit to a row that never stopped being
-- the same statement. A chase is the opposite shape: an event that happened
-- once, on one day, by one means — part 700's `gym_costs` exactly. Correcting
-- it is deleting the row that describes an act nobody performed and writing the
-- one that describes the act they did, and an UPDATE would leave a row whose
-- date came from one chase and whose note came from another with nothing on it
-- saying so.
drop policy if exists gym_invoice_chases_owner_update on public.gym_invoice_chases;
-- The member reads the invoice and not the chasing of it. The trainer reads
-- neither — `gym_invoices` admits no staff policy at all.
drop policy if exists gym_invoice_chases_member_read on public.gym_invoice_chases;
drop policy if exists gym_invoice_chases_staff_read on public.gym_invoice_chases;

-- RLS narrows a GRANT; it does not create one.
grant select, insert, delete on public.gym_invoice_chases to authenticated;
revoke update on public.gym_invoice_chases from authenticated;
revoke all on public.gym_invoice_chases from anon;
grant all on public.gym_invoice_chases to service_role;

-- ── 3. what this part deliberately does NOT do ──────────────────────────────
--
--   · It adds no trigger, and nothing on `gym_invoices` is widened to notice
--     it. See the send note in the header: the one trigger on that table writes
--     a member a notification, and this table is kept out of its reach by being
--     a different table.
--   · It writes no notification, queues no message and touches `notifications`
--     nowhere. Part 613's nightly ageing pass exists on the COACH side and is
--     not mirrored here, and part 2100 is the record of what that pass cost
--     when it went on asking about an invoice somebody had already settled.
--     A gym chasing its own members through its own channels is not something
--     Repple should be doing on a schedule on their behalf.
--   · It does not touch `gym_invoices.status`. Recording a chase changes
--     nothing about what is owed, when it was due, or whether it is overdue —
--     `isOverdue` computes that from the due date and is not consulted here,
--     and a chase must never become a way of moving an invoice out of a band it
--     genuinely sits in.
--   · It does not constrain the invoice to be overdue. A gym that rings a
--     member the day before a large bill falls due has chased it, and a CHECK
--     that could only be satisfied by lateness would refuse the one chase that
--     works.
