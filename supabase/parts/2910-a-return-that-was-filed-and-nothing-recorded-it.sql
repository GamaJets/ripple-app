-- ═══════════════════════════════════════════════════════════════════════════
-- A return that was filed, and nothing in the product recording that it was.
--
-- ── The defect ─────────────────────────────────────────────────────────────
--
-- /tax builds a period out of this app's own months, cuts it on the gym's
-- clock, names the months of it that are still moving, and prints the figures
-- an owner hands to an accountant. Part 2641 gave the same screen the one fact
-- that is not a figure — what the gym says it was registered as, with dates on
-- it — so a quarter before the gym registered no longer reads as a denial.
--
-- What neither of them can say is whether anything was ever DONE about the
-- period. A gym files a return on sales, a payroll return, a set of accounts —
-- and the product holds no record of it. So an owner opening Q1 in September
-- sees exactly what they saw in April: the figures, and no way to tell whether
-- they filed on them. The answer lives in an email folder, an accountant's
-- portal, or a memory, and the two questions somebody actually asks —
--
--     "have we dealt with Q1?"   "when did we file it, and what was the
--                                 reference?"
--
-- — are both unanswerable from the one screen built for them.
--
-- ── ABSENCE IS UNSTATED. IT IS NEVER "NOT FILED". ─────────────────────────
--
-- This is part 2641's rule and it is, if anything, sharper here, because the
-- false sentence is worse. A period no row covers is a period NOBODY HAS
-- ANSWERED FOR. It is not a period this gym failed to file for, and no screen
-- over this table may say so.
--
-- The reason is the same one that made `tenants.tax_registered` nullable —
-- "Collapsing null into false would tell a registered gym's owner, in the
-- confident voice, that their business is not registered" — with a heavier
-- consequence on the other side of it. "Nothing has been filed for Q1" printed
-- over a quarter that WAS filed, by an accountant, in a portal this product
-- cannot see, is Repple telling a business it is in default when it is not.
-- Every gym running this today is in exactly that state for every period it has
-- ever traded, because this table did not exist, and an owner who reads that
-- sentence rings their accountant or files twice.
--
-- So there are three answers per period and not two, the same as part 2641:
-- covered, partly covered, and unanswered — plus 'unread' above all of them,
-- for a query that was refused. src/lib/taxFilings.ts holds the four and its
-- test asserts they cannot be collapsed.
--
-- ── Dates, not a period key ───────────────────────────────────────────────
--
-- The obvious column is `period_key text` — 'YYYY-Qn' or 'YYYY-MM', which is
-- exactly what `TaxPeriodKey` in src/lib/gymTax.ts is and what /tax's picker
-- already speaks. It is not what this table holds, and the reason is that a
-- filing period is not always one of ours.
--
-- A set of annual accounts is filed for a financial YEAR, and in a great many
-- jurisdictions that year does not start in January — 1 April to 31 March, 1
-- July to 30 June, whatever the business was incorporated with. A return on
-- sales can be annual for a small gym and monthly for a large one in the same
-- country. `taxPeriod()` can express none of those, so a `period_key` column
-- would have forced a gym filing April-to-March accounts to record them against
-- a quarter they do not correspond to, or not at all.
--
-- Two dates express every one of those, and the app's own periods are still
-- answerable from them: "was Q3 filed" is "does a filing's span contain Q3's
-- first and last day", which is a comparison of four bare `YYYY-MM-DD` strings
-- and is what `filingsFor` does. Inclusive at both ends, matching part 2641:
-- `period_to` is the LAST day the filing covers, not the day after, so 31 March
-- and 1 April are adjacent rather than overlapping.
--
-- ── Why there is NO exclusion constraint, unlike part 2641 ────────────────
--
-- That part refuses two statements about one day, because a period with two
-- answers about its registration has no answer a screen can print.
--
-- Here two rows about one period is the ORDINARY and CORRECT case, twice over:
--
--   · two KINDS. A gym files a return on its sales and a payroll return, both
--     for the same quarter. They are two filings and neither supersedes the
--     other.
--   · an AMENDMENT. A gym files Q3, finds an error, and files again. That is
--     two facts about one quarter and the house rule is explicit that a
--     correction is a second recorded fact and never an erasure — part 183's
--     `reversed_at` and part 2642's refusal to clear `dropped_at` on a reopened
--     invoice are the same argument. A constraint refusing the second row would
--     force the gym to DELETE the record of the first filing in order to record
--     the second, which destroys the date and reference of a submission that
--     really was made and that a tax authority really did receive.
--
-- So both rows stand, the screen reports "filed, and filed again on the 14th",
-- and src/lib/taxFilings.ts is what turns a list into that sentence rather than
-- into a contradiction.
--
-- ── Nothing here is checked, and no figure is produced from it ────────────
--
-- Part 701 and src/lib/gymTax.ts both say at length that this product computes
-- no tax figure, checks nothing against any register, and infers nothing from a
-- country or a currency. That does not soften because a filing has a date on
-- it. Nobody tells Repple when a gym files; a row here exists because somebody
-- typed it, the reference is held verbatim and matched against nothing, and no
-- deadline, penalty or liability is computed anywhere from any of it.
--
-- ── Applying this ─────────────────────────────────────────────────────────
--
-- Additive. One new table, its index, its policies, its grants. Nothing is
-- dropped and nothing existing is touched. No backfill: every period every gym
-- has ever traded is currently unanswered, which is the truth, and inventing a
-- filing would be this product asserting a submission to a tax authority that
-- nobody made.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. what was filed ───────────────────────────────────────────────────────

create table if not exists public.gym_tax_filings (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null references public.tenants(id) on delete cascade,

  -- WHAT was filed, in words that belong to no jurisdiction.
  --
  -- This product is white-label and sells into countries whose returns share no
  -- name: what one calls VAT another calls GST and a third a sales tax, and
  -- "Corporation Tax", "Companies House" and "Form 1120" are each right in
  -- exactly one place and wrong everywhere else. Naming any of them here would
  -- be the same assumption src/lib/wholeUnits.ts exists to stop being made
  -- about a currency's minor units.
  --
  -- So the five are described by WHAT THE RETURN IS ABOUT — sales, profits, the
  -- people it pays, the accounts it publishes — and 'other' is a real answer
  -- rather than a shrug. src/lib/taxFilings.ts holds the same five with the
  -- sentence each is shown under, and a value added here and not there renders
  -- as its own raw code on a screen somebody files from.
  kind        text        not null
              check (kind in ('sales_tax', 'income_tax', 'payroll', 'accounts', 'other')),

  -- The stretch it covers, inclusive at both ends. Dates and not a period key:
  -- see the header — a financial year starting on 1 April is not expressible as
  -- one of this app's quarters, and a gym filing one must not have to record it
  -- against a period it does not correspond to.
  period_from date        not null,
  period_to   date        not null,

  -- The day it was filed, as stated. Bare `YYYY-MM-DD` in the gym's own
  -- reckoning, for part 2641's reason: a submission at 09:00 on 1 April in
  -- Dubai must not read as 31 March to a bookkeeper in London, on the record of
  -- whether a deadline was met.
  --
  -- "Not in the future" is NOT enforced here. `current_date` is STABLE and
  -- Postgres rejects it in a CHECK outright; the rule lives in `filingBlockers`
  -- in src/lib/taxFilings.ts, beside the box, where the refusal arrives while
  -- somebody can still fix the date.
  filed_on    date        not null,

  -- The submission reference, receipt number or accountant's confirmation, as
  -- somebody typed it. Held verbatim, never validated, never matched against
  -- anything — part 701's sentence about a registration number, unchanged, and
  -- for the same reason: there is nothing this product could check it against.
  --
  -- Optional. A gym whose accountant filed on its behalf and has not sent the
  -- receipt through has still filed, and refusing to record that until a
  -- reference arrives would leave the period reading as unanswered — which is
  -- the worse of the two.
  reference   text        check (reference is null or (btrim(reference) <> '' and length(reference) <= 120)),

  -- Who filed it, in the gym's words: the owner, the accountant's firm, a
  -- bookkeeper. Free text rather than a profile reference, for part 186's
  -- reason about an engineer — the answer is usually a company, and a foreign
  -- key would require every external accountant to hold a Repple account.
  filed_by    text        check (filed_by is null or (btrim(filed_by) <> '' and length(filed_by) <= 120)),

  note        text        check (note is null or length(note) <= 1000),
  created_at  timestamptz not null default now(),
  -- The account that recorded it. NULL where that account has since been
  -- deleted — the record of the filing stays, because a period must not lose
  -- its answer when a bookkeeper leaves. Part 2642's wording about
  -- `dropped_by`, unchanged.
  created_by  uuid        references public.profiles(id) on delete set null
);

alter table public.gym_tax_filings drop constraint if exists gym_tax_filings_period;
alter table public.gym_tax_filings add constraint gym_tax_filings_period
  check (period_to >= period_from);

comment on table public.gym_tax_filings is
  'What this gym says it has filed, for which stretch of days, and when. A period NO ROW COVERS IS ONE NOBODY HAS ANSWERED FOR — never "not filed", which would be this product telling a business it is in default over a return its accountant submitted in a portal Repple cannot see. Nothing here is checked against any authority, no reference is validated, and no deadline, penalty or liability is computed from any of it anywhere.';
comment on column public.gym_tax_filings.kind is
  'sales_tax | income_tax | payroll | accounts | other. Described by what the return is ABOUT rather than by any jurisdiction''s name for it: what one country calls VAT another calls GST, and this product is sold into both.';
comment on column public.gym_tax_filings.period_to is
  'The LAST day this filing covers, inclusive — not the day after. Dates rather than one of this app''s period keys, because a financial year starting on 1 April is not expressible as a quarter and a gym filing one must still be able to record it.';
comment on column public.gym_tax_filings.filed_on is
  'The day it was filed, as stated by whoever recorded it. A bare day in the gym''s own reckoning, so a submission at 09:00 in Dubai does not read as the previous day in London. "Not in the future" is refused by filingBlockers in src/lib/taxFilings.ts, because current_date is not IMMUTABLE and cannot appear in a CHECK.';
comment on column public.gym_tax_filings.reference is
  'The submission reference as somebody typed it. Never validated, never matched, never inferred. Optional even on a filing that certainly happened: a gym whose accountant has not yet sent the receipt has still filed, and refusing the record until it arrives would leave the period reading as unanswered.';

-- The read is "this gym's filings, newest first", which is the whole history in
-- a handful of rows per year and is scanned in order to answer a period. `id`
-- closes the total order — several filings can share a `filed_on` (a quarter's
-- sales return and its payroll return go in together), and pages of a tied
-- ordering drop and repeat rows silently.
create index if not exists gym_tax_filings_tenant_idx
  on public.gym_tax_filings (tenant_id, filed_on desc, id desc);

-- And the period lookup behind "has anything been filed covering September",
-- which walks the spans rather than the filing dates.
create index if not exists gym_tax_filings_period_idx
  on public.gym_tax_filings (tenant_id, period_from, period_to);

-- ── 2. who may read and write it ────────────────────────────────────────────
--
-- The owner, and nobody else in the building — part 2641's line around
-- `gym_tax_registrations` and part 700's around `gym_costs`, for the same
-- reason and one more. Whether a business has filed its returns is a fact about
-- the company rather than about the gym floor; no trainer needs it, no
-- receptionist needs it, and a member reads nothing here. A reference number is
-- additionally the string somebody would need to impersonate the business to
-- its own tax authority.
alter table public.gym_tax_filings enable row level security;

drop policy if exists gym_tax_filings_owner_read on public.gym_tax_filings;
create policy gym_tax_filings_owner_read on public.gym_tax_filings
  for select
  to authenticated
  using (is_owner_of(tenant_id));

drop policy if exists gym_tax_filings_owner_insert on public.gym_tax_filings;
create policy gym_tax_filings_owner_insert on public.gym_tax_filings
  for insert
  to authenticated
  with check (is_owner_of(tenant_id));

drop policy if exists gym_tax_filings_owner_delete on public.gym_tax_filings;
create policy gym_tax_filings_owner_delete on public.gym_tax_filings
  for delete
  to authenticated
  using (is_owner_of(tenant_id));

-- No UPDATE, and this is where this part differs from its sibling. Part 2641
-- grants it because a registration period is an assertion with an OPEN END, and
-- closing it the day a gym deregisters is an ordinary edit to a row that never
-- stopped being the same statement.
--
-- A filing is not that shape. It is an act performed on one day, for one
-- stretch, under one reference — part 700's `gym_costs` exactly — so correcting
-- the record of it is deleting the row describing a submission nobody made and
-- writing the one describing the submission they did. An UPDATE would leave a
-- row whose date came from one filing and whose reference came from another,
-- with nothing on it saying so, on the record a business would produce to show
-- it had complied.
--
-- Named and dropped rather than merely never written: a policy left standing is
-- OR'd with the new ones and the old width survives a rebuild.
drop policy if exists gym_tax_filings_owner_update on public.gym_tax_filings;
drop policy if exists gym_tax_filings_staff_r on public.gym_tax_filings;
drop policy if exists gym_tax_filings_member_r on public.gym_tax_filings;

-- RLS narrows a GRANT; it does not create one.
grant select, insert, delete on public.gym_tax_filings to authenticated;
revoke update on public.gym_tax_filings from authenticated;
revoke all on public.gym_tax_filings from anon;
grant all on public.gym_tax_filings to service_role;

-- ── 3. what this part deliberately does NOT do ──────────────────────────────
--
--   · It computes no deadline. A filing deadline is a function of a
--     jurisdiction, a registration type, a turnover band and a calendar of
--     public holidays, none of which this product holds — and a due date shown
--     to an owner and quietly wrong by a week is worse than none at all. That
--     is `TAX_NO_RETURN_FIGURE`'s argument in src/lib/gymTax.ts applied to a
--     date instead of an amount.
--   · It writes no notification and schedules no pass. Nothing tells Repple
--     when a gym files, so a reminder would be fired at owners who filed weeks
--     ago — which is the harm part 2100 records the coach-side ageing pass
--     causing, and the reason part 2820 refused a scheduled chase.
--   · It does not touch `tenants.tax_registered`, `gym_tax_registrations` or
--     `gym_month_closes`. Filing a return is not closing a month and does not
--     imply a registration: a gym can file a nil return for a period it was
--     registered in and file nothing at all for one it was not, and neither
--     fact may be inferred from the other.
--   · It stores no document. The return itself, where there is a PDF of one, is
--     `gym_documents` — which since part 2640 can say a file is about a cost,
--     and which a later part may teach to say a file is about a filing. That is
--     a column on the other table and is not invented here on the strength of
--     nobody having asked for it yet.
