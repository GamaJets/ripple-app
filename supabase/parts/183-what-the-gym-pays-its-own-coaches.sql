-- ═══════════════════════════════════════════════════════════════════════════
-- Four things about a coach's pay that this product could not hold.
--
-- ── 1. Every coach is paid the same ───────────────────────────────────────
--
-- `payroll30For` in src/lib/gymTrainers.ts multiplies delivered sessions by a
-- single `tenants.session_fee`. There is one fee for the gym, so a coach of
-- fifteen years and a trainee in their first month are worth an identical
-- amount to the payroll screen, and /payroll offers no override anywhere.
--
-- `trainers.session_fee` is NOT the missing column. It was added in
-- supabase/parts/23 as part of the public directory — tagline, offers,
-- specialties, session_fee, listed — and it is what a coach CHARGES a client
-- for private work booked through the app. Reading it as what the gym pays them
-- would take a coach's own price list and hand it to their employer's payroll
-- run, which is a different number, usually a bigger one, and belongs to the
-- coach rather than to the gym.
--
-- ── 2. Teaching a class is unpaid by the system ───────────────────────────
--
-- `payroll_settlements` links to `sessions` and to nothing else, so a trainer
-- who taught twelve classes and covered twenty floor hours is owed nothing this
-- product can compute. app/(owner)/class-analytics.tsx holds the per-attendee
-- rate in `useState` and says at line 263 that "nothing is paid from this
-- screen" — which is honest and is the whole problem.
--
-- ── 3. A payroll run cannot be undone or adjusted ─────────────────────────
--
-- `recordSettlement` is insert-only, all-or-nothing per trainer, with no
-- reverse, no partial settlement and no adjustment line. Pressing "Mark as
-- paid" before the money actually moves stamps every session in the run
-- permanently and drops them out of "Owed now" — and the only way back is
-- editing rows in the Supabase dashboard.
--
-- ── Why a separate table instead of a column on `trainers` ────────────────
--
-- Because the owner cannot write to `trainers` and must not be given the
-- ability. Part 23 is a dump of the live database and its five policies are
-- `trainers_self_rw` (the coach's own row, for everything) plus four SELECTs —
-- one of which, `trainers_owner_r`, is the owner's read. There is no owner
-- UPDATE, deliberately: `trainers` holds the coach's public profile, their
-- tagline, their specialties and their own price list, and none of that is the
-- gym's to edit. Adding an owner UPDATE policy to reach one pay column would
-- hand the employer edit rights over the employee's public listing.
--
-- So what the gym pays lives in the gym's own table, owned by the gym, readable
-- by the coach it is about. Which is also the correct relationship: this is a
-- fact about the employment, not about the trainer.
--
-- Additive and idempotent. Nothing here alters an existing table's rows.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── what this gym pays this coach ───────────────────────────────────────────

create table if not exists public.gym_trainer_pay (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  trainer_id uuid not null references public.profiles(id) on delete cascade,

  -- What the gym pays for one payable one-to-one, in MINOR units.
  --
  -- Minor units, unlike `tenants.session_fee`, which is a numeric in whole
  -- currency and has caused exactly one incident about it already — the payroll
  -- screen printing AED 63.00 where the gym owed AED 6,300, because a whole-unit
  -- figure went through a formatter that divides by 100. Everything downstream
  -- of this column is minor units: `sessions.rate_cents`,
  -- `payroll_settlements.amount_cents`, every figure `money()` renders. A new
  -- column had no reason to inherit the older one's boundary.
  --
  -- NULL means this gym has not set a rate for this coach, which is a real and
  -- common state and is NOT the same as zero. A null falls back to the gym's
  -- own session fee, exactly as it does today; a zero says the gym pays this
  -- coach nothing per session, which is a claim somebody has to make on purpose.
  session_rate_cents integer check (session_rate_cents is null or session_rate_cents >= 0),

  -- What the gym pays this coach to TEACH, and how it is counted.
  --
  -- Two columns rather than one, because "80 per class" and "8 per head" are
  -- the same number of digits and completely different money, and a single
  -- amount column with the interpretation living in a screen is how a gym pays
  -- a coach twelve times what it meant to. Both are NULL together or set
  -- together; the constraint below is what makes that true rather than hoped.
  class_pay_kind text check (class_pay_kind is null or class_pay_kind in ('per_class', 'per_attendee')),
  class_rate_cents integer check (class_rate_cents is null or class_rate_cents >= 0),

  -- What both rates are denominated in. NOT inherited silently from
  -- `tenants.currency` at read time: a gym that changes its currency must not
  -- retroactively re-denominate what it agreed to pay somebody. NULL means
  -- nobody has said, which withholds the figure — the same rule as every other
  -- money column since supabase/parts/150.
  currency text,

  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

alter table public.gym_trainer_pay drop constraint if exists gym_trainer_pay_class_pair;
alter table public.gym_trainer_pay add constraint gym_trainer_pay_class_pair
  check ((class_pay_kind is null) = (class_rate_cents is null));

alter table public.gym_trainer_pay drop constraint if exists gym_trainer_pay_currency_is_iso;
alter table public.gym_trainer_pay add constraint gym_trainer_pay_currency_is_iso
  check (currency is null or currency ~ '^[A-Z]{3}$');

-- A rate that names no currency is not a rate. Either of the two amounts being
-- set requires one, and the whole row being empty is allowed — that is simply a
-- coach the gym has not priced yet.
alter table public.gym_trainer_pay drop constraint if exists gym_trainer_pay_amount_has_currency;
alter table public.gym_trainer_pay add constraint gym_trainer_pay_amount_has_currency
  check (currency is not null or (session_rate_cents is null and class_rate_cents is null));

create unique index if not exists gym_trainer_pay_uq
  on public.gym_trainer_pay (tenant_id, trainer_id);

comment on table public.gym_trainer_pay is
  'What one gym pays one coach — per payable one-to-one, and per class taught. Distinct from trainers.session_fee, which is what the coach charges their own clients and is theirs, not the gym''s. Amounts are minor units. NULL is "not set" and falls back to tenants.session_fee; zero is a decision.';

alter table public.gym_trainer_pay enable row level security;

drop policy if exists gym_trainer_pay_owner on public.gym_trainer_pay;
create policy gym_trainer_pay_owner on public.gym_trainer_pay
  for all using (is_owner_of(tenant_id)) with check (is_owner_of(tenant_id));

-- The coach reads what they are paid, and only reads it. A coach must never
-- record their own pay — /coach/earnings is deliberately read-only and this is
-- the database saying the same thing independently, so the two do not have to
-- trust each other.
drop policy if exists gym_trainer_pay_self_r on public.gym_trainer_pay;
create policy gym_trainer_pay_self_r on public.gym_trainer_pay
  for select using (trainer_id = (select auth.uid()));

revoke all on public.gym_trainer_pay from anon, authenticated, public;
grant select, insert, update, delete on public.gym_trainer_pay to authenticated;
grant all on public.gym_trainer_pay to service_role;

-- ── a class somebody taught, and was paid for ───────────────────────────────

create table if not exists public.gym_class_pay (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- The class this line pays for. Cascade rather than set null: a pay line with
  -- no class is a payment for nothing, and part 34's argument about a service
  -- record with no machine applies unchanged. A class that has been settled is
  -- protected from deletion by the screen, not by the schema — B5 on the
  -- roadmap is the item that makes cancelling a class stop deleting it.
  class_id uuid not null references public.gym_classes(id) on delete cascade,
  trainer_id uuid not null references public.profiles(id) on delete cascade,

  -- Snapshotted, all three, and never recomputed. A rate changed in March must
  -- not rewrite what a coach was paid in January — the same reasoning as
  -- `sessions.rate_cents` and `payroll_settlements.amount_cents`.
  pay_kind text not null check (pay_kind in ('per_class', 'per_attendee')),
  rate_cents integer not null check (rate_cents >= 0),
  -- How many people the register said were there, for a per-attendee line. NULL
  -- on a per-class line because it did not enter into the amount, and a zero
  -- there would read as an empty class.
  attendees integer check (attendees is null or attendees >= 0),
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),

  -- The run that paid it, if one has. Exactly the mechanism part 36 chose for
  -- sessions and for the same reason: settlement is per LINE, not per period,
  -- so a class registered late simply joins the next run and is paid once.
  settlement_id uuid references public.payroll_settlements(id) on delete set null,

  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);

alter table public.gym_class_pay drop constraint if exists gym_class_pay_attendees_shape;
alter table public.gym_class_pay add constraint gym_class_pay_attendees_shape
  check ((pay_kind = 'per_attendee') = (attendees is not null));

-- One pay line per class per coach. A class taught by two coaches is two rows;
-- a class accidentally submitted twice is refused by the database rather than
-- paid twice by the payroll run that reads this table.
create unique index if not exists gym_class_pay_uq
  on public.gym_class_pay (class_id, trainer_id);

create index if not exists idx_gym_class_pay_unsettled
  on public.gym_class_pay (tenant_id, trainer_id)
  where settlement_id is null;

comment on table public.gym_class_pay is
  'One line of class-teaching pay: the class, the coach, the rate as it stood, and the run that paid it. Settlement is per line so a class registered after its period was settled joins the next run instead of being lost or paid twice.';

alter table public.gym_class_pay enable row level security;

drop policy if exists gym_class_pay_owner on public.gym_class_pay;
create policy gym_class_pay_owner on public.gym_class_pay
  for all using (is_owner_of(tenant_id)) with check (is_owner_of(tenant_id));

drop policy if exists gym_class_pay_self_r on public.gym_class_pay;
create policy gym_class_pay_self_r on public.gym_class_pay
  for select using (trainer_id = (select auth.uid()));

revoke all on public.gym_class_pay from anon, authenticated, public;
grant select, insert, update, delete on public.gym_class_pay to authenticated;
grant all on public.gym_class_pay to service_role;

-- ── undoing and adjusting a run ─────────────────────────────────────────────

alter table public.payroll_settlements
  add column if not exists reversed_at timestamptz;
alter table public.payroll_settlements
  add column if not exists reversed_by uuid references public.profiles(id) on delete set null;
alter table public.payroll_settlements
  add column if not exists reverse_reason text;

alter table public.payroll_settlements drop constraint if exists payroll_settlements_reverse_has_why;
alter table public.payroll_settlements add constraint payroll_settlements_reverse_has_why
  check (reversed_at is null or (reverse_reason is not null and btrim(reverse_reason) <> ''));

comment on column public.payroll_settlements.reversed_at is
  'When this run was taken back. The row is NEVER deleted — a settlement that was recorded and then withdrawn is two facts, and deleting it leaves neither. Reversing also clears settlement_id from the sessions and class lines it covered, which is what puts them back into "Owed now".';

-- A reversed run must not be counted as money that went out. Every reader of
-- this table filters on it, and the comment above is the instruction; the index
-- is what keeps that filter cheap on the query /accounting runs monthly.
create index if not exists idx_settlements_live
  on public.payroll_settlements (tenant_id, settled_at desc)
  where reversed_at is null;

create table if not exists public.payroll_adjustments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  trainer_id uuid not null references public.profiles(id) on delete cascade,

  -- Four kinds, and they are not interchangeable even where the arithmetic
  -- agrees. A reimbursement is the gym paying back money the coach spent; a
  -- bonus is pay. Both add, and a payslip that called one the other would be
  -- wrong in a way that matters to whoever files it.
  kind text not null check (kind in ('bonus', 'deduction', 'reimbursement', 'advance')),

  -- SIGNED, and the sign is decided by the kind rather than typed. A deduction
  -- and an advance are negative; a bonus and a reimbursement are positive. The
  -- constraint below is what makes a screen unable to record a negative bonus,
  -- which would read on a payslip as the gym awarding somebody minus fifty.
  amount_cents integer not null check (amount_cents <> 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),

  -- Required. An adjustment with no reason on it is the line a coach queries
  -- and nobody can answer.
  note text not null check (btrim(note) <> ''),

  -- The date it belongs to, for the run that picks it up. Not `created_at`: an
  -- adjustment for last month entered this month belongs to last month.
  applies_on date not null default current_date,

  settlement_id uuid references public.payroll_settlements(id) on delete set null,

  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);

alter table public.payroll_adjustments drop constraint if exists payroll_adjustments_sign_matches_kind;
alter table public.payroll_adjustments add constraint payroll_adjustments_sign_matches_kind
  check (
    (kind in ('bonus', 'reimbursement') and amount_cents > 0)
    or
    (kind in ('deduction', 'advance') and amount_cents < 0)
  );

create index if not exists idx_payroll_adjustments_unsettled
  on public.payroll_adjustments (tenant_id, trainer_id)
  where settlement_id is null;

comment on table public.payroll_adjustments is
  'A line on a payroll run that is not a session and not a class: a bonus, a deduction, a reimbursement or an advance. Signed by kind rather than by the person typing it, so a bonus cannot be recorded as a negative. Picked up by the next run for that coach and stamped with its settlement_id, exactly like a session.';

alter table public.payroll_adjustments enable row level security;

drop policy if exists payroll_adjustments_owner on public.payroll_adjustments;
create policy payroll_adjustments_owner on public.payroll_adjustments
  for all using (is_owner_of(tenant_id)) with check (is_owner_of(tenant_id));

-- The coach reads what was added to and taken off their pay, and writes none of
-- it. Same rule as gym_trainer_pay above: nobody records their own pay.
drop policy if exists payroll_adjustments_self_r on public.payroll_adjustments;
create policy payroll_adjustments_self_r on public.payroll_adjustments
  for select using (trainer_id = (select auth.uid()));

revoke all on public.payroll_adjustments from anon, authenticated, public;
grant select, insert, update, delete on public.payroll_adjustments to authenticated;
grant all on public.payroll_adjustments to service_role;
