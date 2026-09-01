-- ═══════════════════════════════════════════════════════════════════════════
-- The equipment register is a register. It is not a maintenance system.
--
-- `recordService` in src/lib/gymEquipment.ts overwrites the single
-- `last_serviced_on` and CLEARS the note — "since whatever it said is presumably
-- done". That one line is the whole of a gym's maintenance record, and what it
-- means is:
--
--   · There is no service history. Six services in three years leave one date,
--     and the five before it are gone. "When was this last looked at, and how
--     often has it needed looking at" is unanswerable, which is precisely the
--     question that tells a broken machine from a machine that keeps breaking.
--   · There is no engineer, no cost and no findings. An insurer or an HSE
--     inspector asking who serviced the leg press and what they found gets
--     nothing — from a product that had the date and threw the rest away.
--   · The one note the machine did carry — usually the description of the
--     fault — is DELETED by the act of fixing it. So the register cannot say
--     what was wrong with anything, ever, retrospectively.
--
-- And nothing anywhere records an incident, an accident, a cleaning round or an
-- inspection. Those are not equipment-adjacent nice-to-haves in a gym: an
-- accident book is a statutory requirement in most jurisdictions this product
-- is sold into, and the place a gym would look for one is the machine.
--
-- ── One table, five kinds, and why not five tables ────────────────────────
--
-- A service, a repair, an inspection, a clean and an incident are the same
-- shape — a machine, a date, a person, what they found, what it cost — and they
-- are always read together, because the answer to "what has happened to this
-- rower" is all five interleaved. Five tables would be five queries and one
-- UNION on every screen that asks, and the first screen to forget one of them
-- would show a maintenance history with the incidents missing.
--
-- `equipment_id` is NULLABLE, and that is what makes an incident recordable at
-- all: somebody slipping on a wet floor is an incident with no machine in it.
-- A gym with no accident book is not helped by one that only accepts accidents
-- involving equipment.
--
-- ── The date on the machine stays ─────────────────────────────────────────
--
-- `gym_equipment.last_serviced_on` is not dropped and not deprecated. It is
-- what `serviceState` computes the due date from and it is read on two screens;
-- turning it into a derived value would mean every one of those reads becoming
-- a join against the newest row of this table, on a screen that lists two
-- hundred machines. It stays as the cached answer, and the log below is the
-- evidence behind it — the same relationship `payroll_settlements` has with the
-- sessions it stamped.
--
-- Additive and idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.gym_equipment_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- Nullable so an incident that involved no machine can still be recorded, and
  -- `set null` rather than cascade so retiring a machine does not delete the
  -- record of the accident that happened on it — which is the record most
  -- likely to be wanted after it has been taken away.
  equipment_id uuid references public.gym_equipment(id) on delete set null,
  -- What the machine was called at the time. Kept because of the set null
  -- above: a maintenance history that says "somebody serviced something" is not
  -- a maintenance history.
  equipment_label text,

  kind text not null check (kind in ('service', 'repair', 'inspection', 'clean', 'incident')),

  -- The day it happened, not the day it was typed. A service recorded on
  -- Monday for work done on Friday belongs to Friday.
  happened_on date not null default current_date,

  -- Who did it. Free text rather than a profile reference, because the answer
  -- is usually a company — "Precor UK", "Dave at Southside Fitness" — and a
  -- foreign key would force every external engineer to have a Repple account.
  performed_by text,

  -- What they found and what they did. This is the column `recordService`
  -- deleted, given somewhere permanent to live.
  findings text,

  -- What it cost, in minor units, with the currency it was billed in. Both
  -- nullable together: a service under warranty costs nothing to record and an
  -- amount with no currency is not an amount. The constraint below is what
  -- stops one arriving without the other.
  cost_cents integer check (cost_cents is null or cost_cents >= 0),
  currency text,

  -- Where the paperwork is, if there is any. References the index in front of
  -- the gym-docs bucket added in supabase/parts/185.
  document_id uuid references public.gym_documents(id) on delete set null,

  -- For an incident: whether it was reported onward, and to whom. Nullable
  -- because most entries are not incidents; the screen asks only on that kind.
  reported_to text,

  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.gym_equipment_log drop constraint if exists gym_equipment_log_cost_has_currency;
alter table public.gym_equipment_log add constraint gym_equipment_log_cost_has_currency
  check ((cost_cents is null) = (currency is null));

alter table public.gym_equipment_log drop constraint if exists gym_equipment_log_currency_is_iso;
alter table public.gym_equipment_log add constraint gym_equipment_log_currency_is_iso
  check (currency is null or currency ~ '^[A-Z]{3}$');

-- An entry has to be about SOMETHING. A row with no machine and no words is a
-- form submitted empty, and it would sit in the accident book looking like a
-- recorded incident.
alter table public.gym_equipment_log drop constraint if exists gym_equipment_log_says_something;
alter table public.gym_equipment_log add constraint gym_equipment_log_says_something
  check (equipment_id is not null or (findings is not null and btrim(findings) <> ''));

create index if not exists idx_gym_equipment_log_machine
  on public.gym_equipment_log (equipment_id, happened_on desc);
create index if not exists idx_gym_equipment_log_tenant
  on public.gym_equipment_log (tenant_id, happened_on desc);

comment on table public.gym_equipment_log is
  'Everything that has happened to a machine, and the gym''s accident book. One table for five kinds because the answer to "what has happened to this rower" is all of them interleaved, and five tables would be one UNION that a screen eventually forgets a branch of.';

alter table public.gym_equipment_log enable row level security;

drop policy if exists gym_equipment_log_owner on public.gym_equipment_log;
create policy gym_equipment_log_owner on public.gym_equipment_log
  for all using (is_owner_of(tenant_id)) with check (is_owner_of(tenant_id));

-- Staff read the history and may add to it, for the same reason part 34 lets a
-- trainer take a machine out of service: they are the ones standing next to it
-- when it breaks, and a log only the owner can write is a log written days
-- later from memory or not at all.
--
-- No update and no delete for a trainer. An incident record somebody can edit
-- afterwards is not an incident record.
drop policy if exists gym_equipment_log_staff_r on public.gym_equipment_log;
create policy gym_equipment_log_staff_r on public.gym_equipment_log
  for select using (tenant_id = my_tenant() and my_role() in ('trainer', 'owner'));

drop policy if exists gym_equipment_log_staff_i on public.gym_equipment_log;
create policy gym_equipment_log_staff_i on public.gym_equipment_log
  for insert with check (tenant_id = my_tenant() and my_role() in ('trainer', 'owner'));

revoke all on public.gym_equipment_log from anon, authenticated, public;
grant select, insert, update, delete on public.gym_equipment_log to authenticated;
grant all on public.gym_equipment_log to service_role;

-- ── the reason a machine is out of action ───────────────────────────────────
--
-- `gym_equipment.note` already exists and `setStatus(..., note)` already accepts
-- one; neither surface passes it, and both then render "no reason recorded".
-- That is a screen fix rather than a schema one and it is made in this wave.
--
-- What the schema owed it is this: the note has been doubling as both the
-- standing description of the machine AND the reason it is out of action, and
-- `recordService` clears it on the way past. So a machine whose note says
-- "bought second hand, serial plate missing" loses that permanently the first
-- time anybody services it.
alter table public.gym_equipment
  add column if not exists out_of_service_reason text;
alter table public.gym_equipment
  add column if not exists out_of_service_since date;

comment on column public.gym_equipment.out_of_service_reason is
  'Why this machine is not in use, in the words of whoever took it out. Separate from `note`, which is the standing description of the machine and which recordService() clears — a reason stored there disappears the first time anybody records a service.';
comment on column public.gym_equipment.out_of_service_since is
  'When it went out of action. NULL on a machine in service. "How long has that rower been broken" is the question an owner actually asks, and a status column alone cannot answer it.';
