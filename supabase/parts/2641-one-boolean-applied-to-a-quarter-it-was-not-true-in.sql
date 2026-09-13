-- ═══════════════════════════════════════════════════════════════════════════
-- One boolean, applied to a quarter it was not true in.
--
-- ── The defect ─────────────────────────────────────────────────────────────
--
-- `tenants.tax_registered` (boolean) and `tenants.tax_registration` (text) came
-- in with part 701 and are CURRENT-STATE SINGLETONS. /tax reads them through
-- `readGymTaxProfile`, renders `taxProfileLine`, and prints the answer above
-- the figures for whichever period the picker is on — including periods that
-- ended before the gym ever registered.
--
-- So a gym that registered in April shows, over its Q1 figures:
--
--     "This gym says it is registered, under the number below."
--
-- and the number is one that did not exist in January. Go the other way — a gym
-- that deregistered in June — and every quarter it WAS registered in now reads
-- "This gym says it is not registered for a tax on its sales", on the screen
-- somebody is working from at a filing deadline. Neither sentence is a figure,
-- which is the only reason this is not worse; both are statements about a
-- business's legal standing, made about a period the stored fact says nothing
-- about, on a document an accountant is being handed.
--
-- The rest of /tax already understands that a period is a period. `taxPeriod`
-- builds a quarter out of three of this app's own months, `cutAtGym` puts its
-- bounds on the gym's clock, `openMonthsIn` names the months of it that are
-- still moving. Every figure on that page is scoped. The one fact that is not a
-- figure was the one fact with no time on it at all.
--
-- ── What a row here is ─────────────────────────────────────────────────────
--
-- A STATEMENT somebody at this gym made about a stretch of time: from this day,
-- until this day or still now, this business was registered under this number —
-- or was not registered at all. Nothing is checked against any register; there
-- is none this product could check, which is what part 701 and src/lib/gymTax.ts
-- both say at length and neither this table nor the screens over it soften.
--
-- ── Absence is UNKNOWN, and stays unknown ──────────────────────────────────
--
-- A gym with no rows here has said nothing, and a period no row covers is a
-- period nobody has answered for. That is deliberately NOT "not registered":
-- `tenants.tax_registered` is nullable for exactly this reason ("Collapsing
-- null into false would tell a registered gym's owner, in the confident voice,
-- that their business is not registered"), and a table of dated statements has
-- the same three answers per period rather than two.
--
-- It is also why there is NO BACKFILL. Every existing `tax_registered = true`
-- is a fact with no date on it, and a backfilled row would have to invent one:
-- `created_at` on the tenant is when the gym joined Repple, which is not when
-- it registered for tax, and using it would manufacture exactly the false
-- statement about Q1 this part exists to remove. The two columns stay where
-- they are and stay readable — see §3.
--
-- ── Why the periods cannot overlap ─────────────────────────────────────────
--
-- Because a period covered by two statements has two answers, and a screen
-- holding two answers either picks one (silently wrong half the time) or
-- refuses (correct, and useless). The database refuses instead, at write time,
-- when somebody can still fix it. btree_gist is already in this schema —
-- part 86 brought it in for `sessions_no_double_booking` — so this costs
-- nothing new.
--
-- ── Applying this ──────────────────────────────────────────────────────────
--
-- Additive. One new table, its policies, its grants. Nothing is dropped and
-- nothing on `tenants` is touched, so /tax keeps working exactly as it does
-- today until a screen starts reading this.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists btree_gist;

-- ── 1. the statements ───────────────────────────────────────────────────────

create table if not exists public.gym_tax_registrations (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null references public.tenants(id) on delete cascade,

  -- Two values and not a boolean, for the reason `tenants.tax_registered` is
  -- nullable: the third state is "nobody has said", and it is represented by
  -- there being no row covering that day rather than by a null in a column.
  -- A null here would be a statement that says nothing, which is not a
  -- statement.
  status      text        not null check (status in ('registered', 'not_registered')),

  -- The number as somebody typed it. Held verbatim, never validated, never
  -- matched against anything — part 701's own comment, and it is not softened
  -- by being dated. 60 characters is the same ceiling `taxProfileBlockers`
  -- already refuses past.
  --
  -- Optional even when registered: a gym that has registered and not yet been
  -- given its number has said something true, and refusing to record it until
  -- the certificate arrives would leave the period unstated — which is the
  -- worse of the two.
  registration text       check (registration is null or (btrim(registration) <> '' and length(registration) <= 60)),

  -- The first day this was true, and the last. Both DATEs, both bare
  -- `YYYY-MM-DD`, for part 700's reason and one more: a tax period boundary is
  -- a calendar day in a jurisdiction, not an instant, and storing an instant
  -- would put a registration that started on 1 April into 31 March for every
  -- gym east of Greenwich.
  --
  -- `to_on` NULL means "and still", which is the ordinary case for the current
  -- registration. It is not "unknown" — a caller that needs to say the end is
  -- unknown records the period that IS known and leaves the rest uncovered,
  -- which is the shape this table gives to every unanswered stretch.
  from_on     date        not null,
  to_on       date,

  note        text        check (note is null or length(note) <= 500),
  created_at  timestamptz not null default now(),
  created_by  uuid        references public.profiles(id) on delete set null
);

alter table public.gym_tax_registrations drop constraint if exists gym_tax_registrations_dates;
alter table public.gym_tax_registrations add constraint gym_tax_registrations_dates
  check (to_on is null or to_on >= from_on);

-- A period that says the gym was NOT registered cannot carry a number. Part
-- 701 has the identical CHECK on the tenant columns and the reasoning carries
-- over unchanged: "A record that says both 'not registered' and 'registered as
-- GB123456789' is one nobody can act on, and it is the state a half-finished
-- edit produces."
alter table public.gym_tax_registrations drop constraint if exists gym_tax_registrations_number_shape;
alter table public.gym_tax_registrations add constraint gym_tax_registrations_number_shape
  check (status = 'registered' or registration is null);

-- Two statements about one day are two answers, and a screen holding two
-- answers about a tax period either picks one or refuses. Refused here instead,
-- while whoever typed it is still looking at it.
--
-- `'[]'` — both ends inclusive. `to_on` is the LAST day the statement was true,
-- not the day after, so a registration ending 2026-03-31 and one starting
-- 2026-04-01 do not touch. An exclusive upper bound would have let a gym record
-- two overlapping statements about 31 March and called them adjacent.
alter table public.gym_tax_registrations drop constraint if exists gym_tax_registrations_no_overlap;
alter table public.gym_tax_registrations add constraint gym_tax_registrations_no_overlap
  exclude using gist (
    tenant_id with =,
    daterange(from_on, to_on, '[]') with &&
  );

-- The read is always "this gym's statements, oldest first" — the whole history
-- is a handful of rows and is scanned in order to answer a period, so the index
-- is the order rather than a filter.
create index if not exists gym_tax_registrations_tenant_idx
  on public.gym_tax_registrations (tenant_id, from_on, id);

comment on table public.gym_tax_registrations is
  'What this gym says about its own tax registration, as dated statements rather than one current flag. A period no row covers is one NOBODY HAS ANSWERED FOR — never "not registered". Nothing here is checked against any register, nothing is inferred from a country or a currency, and no tax figure is computed from any of it anywhere in this product.';
comment on column public.gym_tax_registrations.status is
  'registered | not_registered. There is no third value: "nobody has said" is the ABSENCE of a row covering that day, which is what lets a quarter before the gym registered read as unstated instead of as a denial.';
comment on column public.gym_tax_registrations.to_on is
  'The LAST day this statement was true, inclusive, or NULL for "and still". Not the day after — the no-overlap constraint is built on an inclusive range, so 31 March and 1 April are adjacent rather than overlapping.';
comment on column public.gym_tax_registrations.registration is
  'The number as somebody typed it. Never validated, never matched, never inferred. NULL on a not_registered period by CHECK, and allowed to be NULL on a registered one: a gym that has registered and not yet been given a number has still said something true.';

-- ── 2. who may read and write it ────────────────────────────────────────────
--
-- The owner, and nobody else in the building — the same line part 700 draws
-- around `gym_costs` and for a closely related reason: a registration number is
-- what a business prints on its own invoices, and whether it is registered at
-- all is a fact about the company rather than about the gym floor. No trainer
-- needs it, no receptionist needs it, and a member reads nothing here.
--
-- UPDATE is granted, unlike `gym_costs`, and the difference is real rather than
-- an oversight. A cost is an event that happened once; a registration period is
-- an assertion with an open end, and CLOSING it — setting `to_on` the day a gym
-- deregisters — is an ordinary edit to a row that stays true of the days before
-- it. Forcing a delete-and-rewrite there would destroy `created_at` and
-- `created_by` on a statement that never stopped being the same statement.
alter table public.gym_tax_registrations enable row level security;

drop policy if exists gym_tax_registrations_owner on public.gym_tax_registrations;
create policy gym_tax_registrations_owner on public.gym_tax_registrations
  for all
  to authenticated
  using (is_owner_of(tenant_id))
  with check (is_owner_of(tenant_id));

-- Named and dropped rather than merely never written, so a policy added by
-- somebody who wanted the desk to see this cannot survive a rebuild.
drop policy if exists gym_tax_registrations_staff_r on public.gym_tax_registrations;
drop policy if exists gym_tax_registrations_member_r on public.gym_tax_registrations;

-- RLS narrows a GRANT; it does not create one.
grant select, insert, update, delete on public.gym_tax_registrations to authenticated;
revoke all on public.gym_tax_registrations from anon;
grant all on public.gym_tax_registrations to service_role;

-- ── 3. the two columns on `tenants`, left exactly where they are ────────────
--
-- `tax_registered` and `tax_registration` are NOT dropped, NOT deprecated in
-- the schema, and NOT backfilled from or into this table.
--
-- Dropping them would break /tax the moment this is applied, for every gym,
-- and replace a sentence that is wrong about old quarters with no sentence at
-- all. Backfilling them FROM here would mean choosing which statement is "the
-- current one" in a column that cannot say as at when — the same singleton
-- problem in a new place. Writing them INTO here would mean inventing a start
-- date, which is the fabrication this part exists to prevent.
--
-- So they remain what they have always been: what this gym says about itself
-- TODAY. A screen that has read this table answers a period from it; a screen
-- that finds no statement covering the period says nobody has answered for it,
-- and may still show the current flag as what the gym says NOW, labelled as
-- that. src/lib/gymTaxHistory.ts holds both sentences and the test asserts they
-- cannot be swapped.
comment on column public.tenants.tax_registered is
  'What this gym says about its registration TODAY. Current state, with no date on it — it says nothing about any past period, and a screen showing it above a quarter''s figures is making a claim the column cannot support. Dated statements live in gym_tax_registrations (part 2641).';
