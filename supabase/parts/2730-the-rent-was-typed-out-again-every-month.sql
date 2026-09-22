-- ─────────────────────────────────────────────────────────────────────────
-- The rent was typed out again every month.
--
-- `gym_costs` (supabase/parts/700) gave a gym somewhere to put its rent, its
-- power, its cleaner, its music licence and its accountant. What it did not
-- give it was any memory. Every line is typed from nothing: the description,
-- the payee, the category, the currency and the amount, twelve times a year,
-- for the eight or ten suppliers that are the same eight or ten suppliers every
-- month. A gym with ten standing lines retypes a hundred and twenty rows a year
-- that differ from each other in one field.
--
-- The cost of that is not the typing. It is what the typing does to the book:
--
--   · A LINE GOES MISSING. The bill that was not entered before the month was
--     filed is the whole subject of src/lib/closeCosts.ts, which exists because
--     `gym_refuse_write_into_closed_month` LOCKS the month and the rent invoice
--     arrives in the first week of the next one. That module can now say "the
--     landlord is not in August" — and the owner's only remedy is still to
--     retype the landlord from memory.
--
--   · THE NAME DRIFTS. "EDF Energy", "EDF", "edf energy ltd" are three
--     suppliers to every `group by` in this product and one supplier to the
--     gym. `costLineKey` folds case and spacing and cannot fold a different
--     name, so a year of utilities comes out as three lines that look like
--     three arrangements.
--
--   · THE CATEGORY DRIFTS with it. The same insurer files under 'insurance' in
--     March and 'other' in April, because the category is a dropdown somebody
--     re-picks each time, and "Where it went" on /costs is then a split of two
--     habits rather than of the money.
--
-- ── WHAT THIS TABLE IS NOT, AND THE LINE IT MUST NOT CROSS ───────────────
--
-- NOTHING IN THIS DATABASE EVER CREATES A `gym_costs` ROW FROM ONE OF THESE.
--
-- No trigger, no scheduled job, no SECURITY DEFINER function, no `insert into
-- public.gym_costs` anywhere downstream of this table. There is none in this
-- part and there must never be one in a later one.
--
-- The reason is the single thing a costs ledger is for. `gym_costs` is a record
-- of money that LEFT THE GYM'S ACCOUNT — the table comment says so, and
-- /accounting hands it to an accountant on that basis. A template is a record
-- of an ARRANGEMENT. The two are different claims and only one of them is a
-- fact about a bank:
--
--   · the direct debit failed and the gym was in arrears for a month;
--   · the landlord took a rent holiday;
--   · the insurer was changed on the 3rd and the old policy was never charged;
--   · the gym closed for a refurbishment and the cleaner did not come;
--   · the amount changed and nobody updated the template.
--
-- In every one of those a template that posted on its own has written a cost
-- that was never incurred, into a ledger whose only remaining job is to be
-- true, under a month that will later be LOCKED — and the row carries no mark
-- saying a machine wrote it, because `gym_costs` has no such column and adding
-- one would be admitting the design was wrong rather than fixing it. An owner
-- reconciling against a bank statement in March would find a February rent in
-- Repple, no rent on the statement, and no way at all to tell which of the two
-- was lying.
--
-- A template that silently posts is worse than retyping. Retyping is slow and
-- true; a phantom row is fast and false, and it is false in a file somebody
-- files. So what this table does is exactly one thing: it PRE-FILLS THE FORM.
-- The owner still sees the amount, still sees the date, still presses Record,
-- and `gym_costs` still contains only rows a person looked at. The screen says
-- so out loud — see `TEMPLATES_NEVER_POST` in src/lib/recurringCosts.ts.
--
-- ── Why this is a typed table and not just `standingCosts` ────────────────
--
-- src/lib/closeCosts.ts already DERIVES standing lines from history: seen in
-- three of the last six months, and in the most recent month on record. That
-- is a good detector and it is not a substitute for this, in both directions:
--
--   · It cannot know anything in month one. A gym that signed a lease in
--     January has no standing rent until March under that rule, which is
--     exactly the period when it is least sure what its costs are.
--   · It cannot know an arrangement ENDED. A cancelled insurer keeps looking
--     like a standing line until it falls out of the six-month window.
--   · It cannot know a QUARTERLY bill is an arrangement at all — three
--     sightings in six months is the bar, and a quarterly line is seen twice.
--
-- Derivation answers "what does this gym's history look like". A row here is
-- the owner SAYING what the arrangement is. /costs offers the first as a way to
-- create the second, and neither is allowed to become a cost on its own.
--
-- ── Modelled on part 700 throughout ──────────────────────────────────────
--
-- Same categories, same minor units, same required-currency rule, same
-- owner-only reading. Three differences, each stated at its column: the amount
-- is OPTIONAL, the currency is optional with it, and UPDATE is granted.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.gym_cost_templates (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null references public.tenants(id) on delete cascade,
  -- Who wrote the arrangement down, on part 700's reasoning: an account may own
  -- more than one gym (part 290), so "who set this up" is a real question.
  -- `on delete set null`, because the arrangement outlives the person.
  created_by  uuid        references public.profiles(id) on delete set null,
  -- What it is for, in the gym's own words, and the text that will be carried
  -- onto every cost filled from it. Required and bounded exactly as
  -- `gym_costs.description` is, because that is the column it is copied into
  -- and a template that can hold 300 characters is a template whose Record
  -- button fails with a 23514 the owner cannot act on.
  description text        not null check (btrim(description) <> '' and length(description) <= 200),
  -- Who it is paid to. Bounded as `gym_costs.supplier` is, for the same reason.
  --
  -- OPTIONAL IN THE COLUMN AND REQUIRED BY THE SCREEN, and the split is
  -- deliberate. `costLineKey` in src/lib/closeCosts.ts returns null for a cost
  -- with no payee — it cannot be told apart from any other cost in its category
  -- — so a template with no supplier can never be matched against the month and
  -- can never be told whether it has been filled in yet. The screen therefore
  -- refuses to create one. The column stays nullable because a row written by a
  -- future importer with no payee is still a real arrangement, and a NOT NULL
  -- here would turn that into a failed write rather than a template the screen
  -- honestly reports it cannot check.
  supplier    text        check (supplier is null or (btrim(supplier) <> '' and length(supplier) <= 120)),
  -- The SAME closed set as `gym_costs.category`, repeated rather than shared.
  --
  -- A foreign key to a lookup table would keep the two in step automatically
  -- and this schema has no such table for it; an enum would make adding a
  -- category a migration on two objects. Repeating the list means the two can
  -- drift, and the drift is caught in one direction where it matters: a
  -- template whose category `gym_costs` refuses cannot be recorded, so the
  -- failure is a refused Record with the category named, not a silently
  -- mis-filed cost.
  category    text        not null check (category in (
                            'rent', 'utilities', 'staff', 'maintenance',
                            'equipment', 'insurance', 'licensing', 'marketing',
                            'software', 'stock', 'professional', 'finance',
                            'other')),
  -- What it USUALLY is, in minor units. NULLABLE, which is the first real
  -- difference from part 700.
  --
  -- A cost with no amount is money of unknown size and `gym_costs` refuses it.
  -- A template with no amount is an ordinary and very common arrangement: the
  -- electricity, the water, the card processor's fees and the accountant's
  -- hours are all "this supplier, this category, every month, a different
  -- number". Forcing a figure would make the owner type a fictional one, and
  -- that fiction would then be carried into the form as a suggestion and
  -- pressed through.
  --
  -- bigint with the ceiling in the CHECK, matching `gym_costs.amount_cents`
  -- exactly: `integer` stops at 2,147,483,647 minor units, which is less than a
  -- year's rent in a currency with a thousand minor units to the unit.
  amount_cents bigint     check (amount_cents is null
                                 or (amount_cents > 0 and amount_cents < 100000000000)),
  -- The currency that amount is in. NULL only where the amount is NULL.
  --
  -- Not defaulted from `tenants.currency`, which is itself nullable on purpose
  -- (part 99): a gym insured through a European broker holds a template in EUR
  -- while charging in GBP, and the two are never added. What the screen does
  -- with a template whose currency is not the gym's is REFUSE to carry the
  -- amount rather than convert it — this product holds no rate — and say which
  -- two currencies it is refusing between. See `carryForward` in
  -- src/lib/recurringCosts.ts.
  currency    text        check (currency is null
                                 or (currency = upper(btrim(currency))
                                     and length(currency) between 3 and 4)),
  -- Both or neither. An amount with no currency is not an amount of money —
  -- part 700 makes that argument for the cost and it is identical here — and a
  -- currency with no amount is three letters describing nothing.
  constraint gym_cost_templates_amount_has_currency
    check ((amount_cents is null) = (currency is null)),
  -- Which day of the month it usually goes out on, where the gym knows.
  --
  -- 1 to 31 and NOT clamped to 28 here. The 31st is a real direct-debit date
  -- and refusing it would make the owner state a day that is not their day. A
  -- month without that day is handled where it can be SEEN — `suggestedDay` in
  -- src/lib/recurringCosts.ts walks it back to the last day of the month and
  -- the form shows the result in a date box the owner reads before pressing
  -- Record. Clamping in the column would move the date invisibly instead.
  --
  -- NULL is the honest answer for "whenever the invoice turns up", and it is
  -- carried as a blank suggestion rather than as the 1st.
  due_day     smallint    check (due_day is null or (due_day between 1 and 31)),
  -- The month this arrangement started, as a DATE and not a timestamp, for the
  -- reason part 700 gives about `paid_on`: a DATE cast to timestamptz and
  -- formatted back in the same session timezone round-trips exactly, and an
  -- instant a few hours either side of midnight does not.
  --
  -- Required, because the alternative is reading `created_at` — which is when
  -- the ROW was written, not when the arrangement began, and which is a
  -- timestamptz whose month depends on who is reading it. A gym that adds its
  -- templates in September must not be told its rent is missing from every
  -- month back to January.
  starts_on   date        not null,
  -- The month it stopped, where it has. NULL means it is still running.
  --
  -- This is what a delete cannot say. Removing the row makes the arrangement
  -- never have existed; ending it records that the gym paid this supplier until
  -- June and then did not, which is the difference between "we changed insurer"
  -- and "somebody tidied up". The screen stops offering an ended template for
  -- months after `ends_on` and still shows it in the list, marked.
  ends_on     date        check (ends_on is null or ends_on >= starts_on),
  note        text        check (note is null or length(note) <= 500),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.gym_cost_templates is
  'A standing arrangement a gym says it has — the landlord, the insurer, the cleaner, the music licence — so the same line does not have to be retyped twelve times a year. NOT a cost and never counted as one: nothing in this database, and nothing in this repository, creates a gym_costs row from one of these. A template pre-fills the form and an owner still presses Record, because a cost is a claim that money LEFT THE ACCOUNT and a direct debit that failed, a rent holiday and a month the gym was shut are all arrangements that produced no payment.';
comment on column public.gym_cost_templates.amount_cents is
  'What it usually costs, in minor units. NULL is ordinary and not a gap: the electricity, the water and the accountant are all "this supplier, every month, a different number". Carried into the form as a suggestion the owner can overtype, never as a figure anything totals.';
comment on column public.gym_cost_templates.currency is
  'ISO 4217, uppercase. NULL exactly when the amount is NULL. Never defaulted from tenants.currency, and where it differs from it the amount is not carried at all — this product holds no rate and will not convert one.';
comment on column public.gym_cost_templates.due_day is
  'Day of the month the money usually goes out, 1 to 31, or NULL for "whenever the invoice arrives". A 31 in a thirty-day month is walked back to the last day by the app, in a date box the owner reads before recording.';
comment on column public.gym_cost_templates.ends_on is
  'The day this arrangement stopped, or NULL while it is running. Ending a template is not deleting it: a deleted row says the gym never had this supplier, and an ended one says it had them until June.';
comment on column public.gym_cost_templates.starts_on is
  'The day the arrangement began. Required and a DATE, so a gym that writes its templates up in September is not told its rent has been missing since January.';

-- The read is always "this gym's templates", and the screen orders them by
-- whether they are still running and then by name. `id` is in the index because
-- every paged read in this app orders on a total order: two templates started
-- on the same day would otherwise tie, and a page boundary could drop or repeat
-- one.
create index if not exists gym_cost_templates_tenant_idx
  on public.gym_cost_templates (tenant_id, starts_on desc, id desc);

-- ── Row-level security ───────────────────────────────────────────────────
--
-- The owner, and nobody else in the building — identical to `gym_costs` and for
-- the identical reason, which is sharper here rather than softer. A template
-- under category 'staff' is a standing arrangement with a named person and an
-- amount beside it; a trainer read on this table would put a colleague's
-- monthly pay in front of whoever is at the desk, permanently, with no event to
-- say it was seen. Part 700 refuses the costs themselves on this reasoning and
-- a template is the same disclosure held a month earlier.
--
-- A member reads nothing here at all, and there is no policy admitting one.
alter table public.gym_cost_templates enable row level security;

drop policy if exists gym_cost_templates_owner_read on public.gym_cost_templates;
create policy gym_cost_templates_owner_read on public.gym_cost_templates
  for select
  to authenticated
  using (is_owner_of(tenant_id));

drop policy if exists gym_cost_templates_owner_insert on public.gym_cost_templates;
create policy gym_cost_templates_owner_insert on public.gym_cost_templates
  for insert
  to authenticated
  with check (is_owner_of(tenant_id));

-- UPDATE **is** granted here, which `gym_costs` deliberately refuses, and the
-- difference is what the two tables hold.
--
-- A cost is a recorded fact about money that moved on a day. Editing one leaves
-- a row whose amount and whose date came from two different intentions with
-- nothing on it saying so, which is why part 700 grants no UPDATE and makes a
-- correction a delete plus a rewrite, logged.
--
-- A template is a standing instruction and it is not a fact about any money at
-- all. The rent goes up every year; the insurer re-quotes; the arrangement
-- ends. Every one of those is a change to what the instruction SAYS, not a
-- restatement of something that happened, and forcing a delete-and-recreate
-- would throw away `starts_on` — the one field that stops an edited template
-- claiming the gym has had this supplier only since today.
--
-- `with check` as well as `using`, so an owner cannot update a row INTO another
-- gym; the guard trigger below refuses that a second time, because a policy
-- that is later widened must not be the only thing holding it.
drop policy if exists gym_cost_templates_owner_update on public.gym_cost_templates;
create policy gym_cost_templates_owner_update on public.gym_cost_templates
  for update
  to authenticated
  using (is_owner_of(tenant_id))
  with check (is_owner_of(tenant_id));

drop policy if exists gym_cost_templates_owner_delete on public.gym_cost_templates;
create policy gym_cost_templates_owner_delete on public.gym_cost_templates
  for delete
  to authenticated
  using (is_owner_of(tenant_id));

-- Named and dropped rather than merely never written, so a policy added by
-- somebody who wanted the console to show templates to staff cannot survive a
-- rebuild of this file.
drop policy if exists gym_cost_templates_trainer_read on public.gym_cost_templates;
drop policy if exists gym_cost_templates_member_read on public.gym_cost_templates;

-- RLS narrows a GRANT; it does not create one.
grant select, insert, update, delete on public.gym_cost_templates to authenticated;
revoke all on public.gym_cost_templates from anon;

-- ── A template cannot be re-homed, and cannot backdate itself ────────────
--
-- Part 2700's `guard_gym_banked_month` makes this argument for a reconciliation
-- line and it holds here. `tenant_id` is what the row is ABOUT: an UPDATE that
-- moved it would carry one gym's supplier, amount and monthly commitment into
-- another gym's console with no trace that it had ever been anywhere else. The
-- RLS policy's `with check` refuses that already — this refuses it again, in
-- the database, where a later policy edit cannot reach.
--
-- `created_at` is held for the reason part 2700 holds `recorded_at`: it is when
-- somebody first wrote this arrangement down, and an edit is not a new writing.
-- `starts_on` is deliberately NOT held — it is an owner-stated fact about the
-- arrangement, and an owner who typed the wrong month must be able to correct
-- it without losing the row.
--
-- Deliberately NO INSERT into `public.gym_costs` here, and none anywhere below.
-- See the head of this part: a template that posts on its own writes money that
-- never left into a ledger whose only job is to be true.
create or replace function public.guard_gym_cost_template()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.tenant_id is distinct from old.tenant_id then
    raise exception
      'A cost template cannot be moved to another gym. Delete this template and create it on the gym it belongs to.'
      using errcode = '42501';
  end if;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists guard_gym_cost_template_t on public.gym_cost_templates;
create trigger guard_gym_cost_template_t
  before update on public.gym_cost_templates
  for each row execute function public.guard_gym_cost_template();

-- Trigger functions are reachable by nobody; see 51-advisor-tidy.sql. Revoked
-- from `anon` BY NAME, because Supabase's ALTER DEFAULT PRIVILEGES grants
-- EXECUTE to anon separately from PUBLIC and revoking PUBLIC does not touch it
-- (part 141).
revoke execute on function public.guard_gym_cost_template() from public, anon, authenticated;

-- ── the covering index the advisors ask for ───────────────────────────────
--
-- `created_by` is `on delete set null`, so deleting a profile obliges Postgres
-- to find this table's children first — by sequential scan without an index,
-- inside the transaction of somebody exercising a data right through
-- `action_account_deletion()`. Nothing filters on the column and nothing should;
-- this is purely so a delete does not have to read the table. Partial, because
-- a NULL cannot be the child of a delete.
create index if not exists idx_gym_cost_templates_created_by
  on public.gym_cost_templates (created_by) where created_by is not null;

-- ── Deliberately NOT written here ────────────────────────────────────────
--
-- NO new `gym_events` kind, and no trigger writing one.
--
-- Part 700 logs 'cost-recorded' and 'cost-deleted' because a cost is money and
-- a removed money row leaves no other trace that it existed. A template is not
-- money: creating one changes no figure on any screen, deleting one changes no
-- figure on any screen, and the cost rows a person recorded from it are logged
-- by part 700's own trigger exactly as if they had been typed — which is what
-- they were.
--
-- There is a second reason and it is mechanical. `gym_events_kind_check` is a
-- single CHECK constraint holding the whole list, and adding a kind means
-- re-issuing `alter table … add constraint` with every existing kind restated.
-- Two parts filed in the same wave that both do that, in either order, silently
-- drop whichever kinds the later one did not know about. A log entry nobody
-- needs is not worth that.
