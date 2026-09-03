-- ═══════════════════════════════════════════════════════════════════════════
-- A VAT-registered gym could not tell this product that it was registered.
--
-- ── The word "tax" appears nowhere in this schema ─────────────────────────
--
-- Not on `tenants`, not on `gym_invoices`, not on `gym_payments`, not on
-- `payroll_settlements`, not on the month close. A gym with a filing obligation
-- ran Repple for its members, its timetable and its money, and then produced
-- its return from somewhere else entirely — which means the register an
-- accountant is handed by /accounting has no way of even saying which of its
-- figures are inside a tax regime and which are not.
--
-- ── What part 451 decided, and why this follows it ────────────────────────
--
-- Part 451 asked the same question on the coach's side and answered it
-- narrowly. It added a tax RATE and a tax REGISTRATION to `coach_invoices` —
-- both typed by the coach, both printed verbatim — and it added nothing else:
--
--     No tax AMOUNT. No net figure. No gross/net split. No "subtotal". Not as
--     columns, not as defaults, not as zeros.
--
-- because "this app may print what a person stated and may not work anything
-- out from it". A coach who states "20%" beside "GBP 480.00" has said two true
-- things; an app that prints "VAT: GBP 80.00" underneath has made a claim about
-- their tax affairs, and it is wrong for a margin scheme, a flat-rate scheme, a
-- reverse charge or a mixed-rate invoice.
--
-- That reasoning holds for a gym and holds harder. A gym has more transactions
-- and a real filing deadline, so a wrong figure here is filed faster and by
-- somebody with less time to check it. Everything part 451 refused is refused
-- here: this part adds no amount, no rate applied to anything, no net or gross
-- split, no deductibility flag, and nothing anywhere in this repository
-- multiplies a rate by a figure and calls the result tax.
--
-- ── Where this goes NARROWER than part 451, and why ───────────────────────
--
-- No rate is stored. Part 451 keeps `coach_invoices.tax_rate_pct` because a
-- coach's invoice is one supply to one client and the rate on it is a statement
-- about that document. A gym is not one supply. Its memberships, its personal
-- training, its bottles of drink and its room hire can sit at different rates,
-- some of them exempt, in the same week — so a single rate stored against the
-- gym would be a claim about all of them, and a rate stored against a
-- `gym_invoices` row would still say nothing about the card payments at the
-- desk, which are most of the money.
--
-- A rate that describes some of the sales and is filed as though it described
-- all of them is exactly the "subtotal printed as a total" failure that
-- src/lib/coachLedger.ts names first among the three it exists to prevent. So
-- there is no rate column, and src/lib/gymTax.ts states the absence on the
-- screen rather than leaving it to be read as an oversight.
--
-- ── What IS recorded, and it is two facts ─────────────────────────────────
--
-- Whether the gym says it is registered, and the number it says it is
-- registered under. Both are stated by a person, printed verbatim, never
-- checked against any register — there is no register this app could check, and
-- a format check would refuse valid numbers from countries nobody thought of —
-- and never inferred from a country, a currency or a price.
--
-- They live on `tenants` rather than on a document, which is the one place this
-- differs in SHAPE from part 451. Part 451's argument for snapshotting onto the
-- invoice is that "a coach who deregisters next year has not changed what a
-- document they issued this year said". Nothing in this product renders a gym
-- invoice as a document: `gym_invoices` is a register read by /accounting and
-- /close and by the member's own history, and there is no page, no PDF and no
-- print path that hands one to anybody. There is therefore no issued document
-- for a joined column to rewrite. What this records is what the gym states
-- TODAY, the tax screen says as much beside it, and if a gym invoice ever does
-- become a document the columns it needs are its own and belong on that row.
--
-- ── Everyone in the gym can read these, on purpose ────────────────────────
--
-- `tenants_read` (part 38) admits every signed-in account whose `tenant_id`
-- matches — members and trainers included — and RLS selects rows rather than
-- columns, so anything added to this table is added to what all of them can
-- read. Part 242 makes that point while refusing to widen this very policy.
--
-- Both columns here are fine on that basis and it is worth saying why rather
-- than assuming it: a tax registration number is, in every regime that has one,
-- a thing the business is required to print on the invoices it hands out. It is
-- published by the gym by law. That is emphatically NOT true of a note about
-- which scheme the gym is on, what its accountant advised, or what it expects
-- to owe — so there is no free-text tax field here, and there must not be one
-- while this table is readable by the members.
--
-- Additive and idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

-- THREE states, which is the whole reason this is a nullable boolean rather
-- than a `not null default false`.
--
--   true   the gym says it is registered for a tax on its sales.
--   false  the gym says it is not. A real answer, deliberately given.
--   null   nobody has said, which is where every gym on the platform starts.
--
-- A default of false would make the second and the third the same value on the
-- first day, and the screen would then tell a registered gym's owner, in the
-- confident voice, that their business is not registered. It is the same
-- distinction `tenants.currency` is nullable for (part 99) and the same one
-- `denominate` in src/lib/coachLedger.ts keeps between a setting nobody chose
-- and a read that failed.
alter table public.tenants add column if not exists tax_registered boolean;

-- The number as somebody typed it. Printed verbatim; never validated, never
-- normalised beyond trimming, never looked up. 60 characters is part 451's
-- limit on the same field and there is no reason for a gym's to differ.
alter table public.tenants add column if not exists tax_registration text;

alter table public.tenants drop constraint if exists tenants_tax_reg_len;
alter table public.tenants add constraint tenants_tax_reg_len
  check (tax_registration is null or (btrim(tax_registration) <> '' and length(tax_registration) <= 60));

-- A record that says both "not registered" and "registered as GB123456789" is
-- one nobody can act on, and it is the state a half-finished edit produces:
-- somebody unticks the box and leaves the number behind. Refused rather than
-- silently cleared, because clearing it would throw away a number the gym may
-- simply have unticked the wrong box about. The screen clears both in one
-- write, so this fires against a hand-edit rather than against an owner.
alter table public.tenants drop constraint if exists tenants_tax_reg_needs_registration;
alter table public.tenants add constraint tenants_tax_reg_needs_registration
  check (tax_registered is not false or tax_registration is null);

comment on column public.tenants.tax_registered is
  'Whether this gym SAYS it is registered for a tax on its sales. NULL means nobody has said, which is not the same as no — a default of false would tell a registered gym it is not one. Nothing is computed from this: Repple applies no rate, produces no tax figure and files nothing.';
comment on column public.tenants.tax_registration is
  'A tax registration number somebody at the gym typed, held verbatim. Never checked against any register, never inferred from a country or a currency, and never used in a calculation. Readable by everyone in the gym, which is correct for the one tax fact a business is required to print on its own invoices — and is why there is no free-text tax note on this table.';
