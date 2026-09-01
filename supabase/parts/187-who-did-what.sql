-- ═══════════════════════════════════════════════════════════════════════════
-- Nothing records that a price changed, a payment was entered, or the whole
-- gym was exported.
--
-- `gym_events` (supabase/parts/105) is the right mechanism and it carries five
-- kinds — member-joined, trainer-joined, session-delivered, session-missed,
-- promo-redeemed. All five are things that HAPPENED TO the gym. Not one of them
-- is a thing somebody DID to the record.
--
-- So there is no answer to any of these:
--
--   · Who entered that payment, and when?
--   · Who changed the Gold plan from 60 to 90, and on what date? Nothing keeps
--     the old price. `membership_plans.price_cents` is updated in place, so a
--     member disputing a charge and an owner reading the price book are looking
--     at different months and cannot tell.
--   · Who cancelled that membership? The row says `cancelled`; nothing says by
--     whom, and the member is claiming they did not ask.
--   · Who took a full export of every member's record off the platform?
--     Nothing. That one is a data-protection question with a legal answer and
--     the product cannot even say it happened.
--   · Who reversed the payroll run?
--
-- And `studio-web` has no activity feed at all — the five existing kinds are
-- read on exactly one screen, app/(owner)/ops.tsx, capped at 100 rows with no
-- filter, date range or export.
--
-- ── Why this extends gym_events instead of adding an audit table ──────────
--
-- Part 105 makes the argument and it is the reason this part exists at all:
-- "events are derived from the rows that already record the facts, by triggers,
-- and NOTHING has insert rights. The log cannot drift from the data because it
-- is written by the data."
--
-- An audit table the console INSERTS into has the opposite properties. It
-- records what the client remembered to say it did, in the client's words,
-- through the anon key — so it misses every write made from the phone, every
-- write made in the SQL editor, and every write from a code path added next
-- month by somebody who did not know the table existed. Worse, it is forgeable:
-- a signed-in account with insert rights on an audit log can write whatever it
-- likes into the record of what it did. An audit log that the audited party can
-- write is not an audit log.
--
-- Triggers have none of those problems and they are already the pattern here.
--
-- ── The one column this needed ────────────────────────────────────────────
--
-- `actor_id`. `subject_id` is who an event is ABOUT — the member who joined —
-- and for the five original kinds that is the whole story. For an action it is
-- not: "the Gold plan was repriced" needs the plan and the person, and they are
-- different. `auth.uid()` inside a SECURITY DEFINER trigger still returns the
-- CALLING user, so the actor is recorded correctly without the caller being
-- able to state it.
--
-- NULL where nobody was signed in — a webhook, a scheduled job, the SQL editor
-- under the service role. Null means "not a signed-in person", which is a
-- different and more useful sentence than naming whoever happened to own the
-- gym.
--
-- ── What this still cannot do ─────────────────────────────────────────────
--
-- It records THAT the price changed and what it changed to. It is not a
-- temporal table and it does not reconstruct the price book as at a date — the
-- summary carries the before and after in words, which answers the dispute and
-- does not answer a query. And there is no MFA and no re-auth in front of the
-- money screens anywhere in this repo; a log says who was signed in, not who
-- was sitting at the keyboard.
--
-- Additive and idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.gym_events
  add column if not exists actor_id uuid references public.profiles(id) on delete set null;

comment on column public.gym_events.actor_id is
  'The signed-in account that DID this, as distinct from subject_id, which is who it is about. NULL where no person was signed in — a webhook, a job, the service role — which is a more useful statement than naming the owner by default.';

create index if not exists gym_events_actor_idx
  on public.gym_events (tenant_id, actor_id, created_at desc)
  where actor_id is not null;

-- The closed set, widened. Still closed, and still for the reason part 105
-- gives: "an owner scanning a feed needs to recognise the shapes, and an open
-- string becomes forty spellings of the same thing."
alter table public.gym_events drop constraint if exists gym_events_kind_check;
alter table public.gym_events add constraint gym_events_kind_check
  check (kind in (
    -- the five from part 105, unchanged
    'member-joined', 'trainer-joined', 'session-delivered',
    'session-missed', 'promo-redeemed',
    -- money
    'payment-recorded', 'payment-corrected', 'invoice-raised',
    'price-changed', 'plan-retired',
    -- the membership itself
    'membership-cancelled', 'membership-frozen',
    -- pay
    'payroll-settled', 'payroll-reversed',
    -- the building
    'equipment-retired', 'equipment-out-of-service',
    -- the record
    'month-closed', 'month-reopened', 'record-exported'
  ));

-- ── one writer, now carrying the actor ──────────────────────────────────────
--
-- The four-argument form from part 105 is kept and delegates here, so every
-- existing trigger keeps working unchanged and there is still exactly one place
-- a row is inserted.

create or replace function public.log_gym_event(
  p_tenant uuid, p_kind text, p_subject uuid, p_summary text, p_actor uuid
) returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  -- A tenant we cannot place is not an event. Same rule as part 105: the
  -- alternative is a row visible to nobody that still counts toward every
  -- figure computed over the table.
  if p_tenant is null then return; end if;
  insert into public.gym_events (tenant_id, kind, subject_id, summary, actor_id)
  values (p_tenant, p_kind, p_subject, p_summary, p_actor);
exception when others then
  -- A log that can fail a payment is worse than a gap in the log. Every caller
  -- below is a trigger on a table whose write matters more than this one, and
  -- that ordering is the whole reason this swallows.
  return;
end $fn$;

revoke all on function public.log_gym_event(uuid, text, uuid, text, uuid) from public, anon, authenticated;

create or replace function public.log_gym_event(
  p_tenant uuid, p_kind text, p_subject uuid, p_summary text
) returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  perform public.log_gym_event(p_tenant, p_kind, p_subject, p_summary, (select auth.uid()));
end $fn$;

revoke all on function public.log_gym_event(uuid, text, uuid, text) from public, anon, authenticated;

-- ── a name for a person, without a join in every trigger ────────────────────

create or replace function public.gym_event_name_of(p_id uuid)
returns text language sql stable security definer set search_path to 'public' as $fn$
  select coalesce(nullif(btrim(full_name), ''), 'someone') from public.profiles where id = p_id;
$fn$;

revoke all on function public.gym_event_name_of(uuid) from public, anon, authenticated;

-- ── money ───────────────────────────────────────────────────────────────────

create or replace function public.gym_event_payment()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
declare v_who text;
begin
  v_who := case when new.member_id is null then 'nobody named'
                else public.gym_event_name_of(new.member_id) end;
  if new.reverses_payment_id is not null then
    perform public.log_gym_event(
      new.tenant_id, 'payment-corrected', new.member_id,
      -- The amount is written into the sentence WITH its currency, because a
      -- log line reading "a correction of 5000" is read in whatever money the
      -- reader is thinking in. Same rule as every screen in this product.
      format('%s of %s %s against %s', initcap(new.kind), new.currency,
             to_char(abs(new.amount_cents) / 100.0, 'FM999G999G990D00'), v_who));
  else
    perform public.log_gym_event(
      new.tenant_id, 'payment-recorded', new.member_id,
      format('%s %s taken from %s by %s', new.currency,
             to_char(new.amount_cents / 100.0, 'FM999G999G990D00'), v_who,
             replace(new.method, '_', ' ')));
  end if;
  return new;
end $fn$;

drop trigger if exists trg_gym_event_payment on public.gym_payments;
create trigger trg_gym_event_payment
  after insert on public.gym_payments
  for each row execute function public.gym_event_payment();

create or replace function public.gym_event_invoice()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
begin
  perform public.log_gym_event(
    new.tenant_id, 'invoice-raised', new.member_id,
    format('Invoice %s for %s %s to %s',
           coalesce(new.number::text, '(unnumbered)'), new.currency,
           to_char(new.amount_cents / 100.0, 'FM999G999G990D00'),
           public.gym_event_name_of(new.member_id)));
  return new;
end $fn$;

drop trigger if exists trg_gym_event_invoice on public.gym_invoices;
create trigger trg_gym_event_invoice
  after insert on public.gym_invoices
  for each row execute function public.gym_event_invoice();

-- The price book. This is the one the product actively cannot answer today:
-- `price_cents` is updated in place and the old value is gone, so a member
-- disputing a charge and the owner reading the price book are looking at
-- different months with no way to tell.
create or replace function public.gym_event_plan_changed()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
begin
  if new.price_cents is distinct from old.price_cents then
    perform public.log_gym_event(
      new.tenant_id, 'price-changed', null,
      format('%s repriced from %s %s to %s %s', new.name,
             old.currency, to_char(old.price_cents / 100.0, 'FM999G999G990D00'),
             new.currency, to_char(new.price_cents / 100.0, 'FM999G999G990D00')));
  end if;
  if old.active and not new.active then
    perform public.log_gym_event(new.tenant_id, 'plan-retired', null,
      format('%s taken off the price book', new.name));
  end if;
  return new;
end $fn$;

drop trigger if exists trg_gym_event_plan_changed on public.membership_plans;
create trigger trg_gym_event_plan_changed
  after update on public.membership_plans
  for each row execute function public.gym_event_plan_changed();

-- ── the membership ──────────────────────────────────────────────────────────

create or replace function public.gym_event_membership_status()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status = 'cancelled' then
    perform public.log_gym_event(new.tenant_id, 'membership-cancelled', new.member_id,
      format('%s''s membership cancelled', public.gym_event_name_of(new.member_id)));
  elsif new.status = 'frozen' then
    perform public.log_gym_event(new.tenant_id, 'membership-frozen', new.member_id,
      format('%s''s membership frozen', public.gym_event_name_of(new.member_id)));
  end if;
  return new;
end $fn$;

drop trigger if exists trg_gym_event_membership_status on public.memberships;
create trigger trg_gym_event_membership_status
  after update on public.memberships
  for each row execute function public.gym_event_membership_status();

-- ── pay ─────────────────────────────────────────────────────────────────────

create or replace function public.gym_event_settlement()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
begin
  if tg_op = 'INSERT' then
    perform public.log_gym_event(new.tenant_id, 'payroll-settled', new.trainer_id,
      format('%s %s settled to %s for %s session(s)', new.currency,
             to_char(new.amount_cents / 100.0, 'FM999G999G990D00'),
             public.gym_event_name_of(new.trainer_id), new.sessions_count));
    return new;
  end if;
  if new.reversed_at is not null and old.reversed_at is null then
    perform public.log_gym_event(new.tenant_id, 'payroll-reversed', new.trainer_id,
      format('Settlement of %s %s to %s reversed — %s', new.currency,
             to_char(new.amount_cents / 100.0, 'FM999G999G990D00'),
             public.gym_event_name_of(new.trainer_id), new.reverse_reason));
  end if;
  return new;
end $fn$;

drop trigger if exists trg_gym_event_settlement on public.payroll_settlements;
create trigger trg_gym_event_settlement
  after insert or update on public.payroll_settlements
  for each row execute function public.gym_event_settlement();

-- ── the building ────────────────────────────────────────────────────────────

create or replace function public.gym_event_equipment_status()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status = 'retired' then
    perform public.log_gym_event(new.tenant_id, 'equipment-retired', null,
      format('%s retired from the register', new.name));
  elsif new.status = 'out_of_service' then
    perform public.log_gym_event(new.tenant_id, 'equipment-out-of-service', null,
      format('%s taken out of service%s', new.name,
             case when btrim(coalesce(new.out_of_service_reason, '')) = '' then ''
                  else ' — ' || new.out_of_service_reason end));
  end if;
  return new;
end $fn$;

drop trigger if exists trg_gym_event_equipment_status on public.gym_equipment;
create trigger trg_gym_event_equipment_status
  after update on public.gym_equipment
  for each row execute function public.gym_event_equipment_status();

-- ── the record ──────────────────────────────────────────────────────────────

create or replace function public.gym_event_month_close()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
begin
  if tg_op = 'INSERT' then
    perform public.log_gym_event(new.tenant_id, 'month-closed', null,
      format('%s closed', new.month_key));
    return new;
  end if;
  if new.reopened_at is not null and old.reopened_at is null then
    perform public.log_gym_event(new.tenant_id, 'month-reopened', null,
      format('%s reopened — %s', new.month_key, new.reopen_reason));
  end if;
  return new;
end $fn$;

drop trigger if exists trg_gym_event_month_close on public.gym_month_closes;
create trigger trg_gym_event_month_close
  after insert or update on public.gym_month_closes
  for each row execute function public.gym_event_month_close();

-- ── an export leaving the building ──────────────────────────────────────────
--
-- The one action in this list that writes no row anywhere, so there is nothing
-- for a trigger to hang off. `/export` produces a file in the browser and the
-- database never hears about it — which means the product cannot say that every
-- member's record was taken off it, by whom, or when. That is not an operational
-- gap; it is the question a data-protection officer asks first.
--
-- So the export screen records the run, and the trigger logs it. This is the
-- one place the client states what it did rather than being observed doing it,
-- and that is unavoidable: nothing else can see a download. The row is
-- deliberately narrow — what was exported, how many rows, and who — so there is
-- nothing in it worth forging.

create table if not exists public.gym_export_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- 'gym' for the whole-record bundle, 'member' for one person's file. Kept
  -- apart because they answer different questions: the first is a backup, the
  -- second is usually a subject-access request and has a deadline attached.
  scope text not null check (scope in ('gym', 'member')),
  -- Who the export was ABOUT, on a member export. NULL on a whole-gym one.
  member_id uuid references public.profiles(id) on delete set null,
  -- The entity names that went into the file, so a later reader knows what the
  -- bundle contained without having to still have the bundle.
  parts text[],
  rows_exported integer check (rows_exported is null or rows_exported >= 0),
  taken_at timestamptz not null default now(),
  taken_by uuid references public.profiles(id) on delete set null,
  note text
);

create index if not exists idx_gym_export_runs_tenant
  on public.gym_export_runs (tenant_id, taken_at desc);

comment on table public.gym_export_runs is
  'One row per export taken off the platform: the whole gym, or one member''s record. Written by the export screen because nothing else can observe a download, and deliberately narrow enough that there is nothing in it worth forging.';

alter table public.gym_export_runs enable row level security;

drop policy if exists gym_export_runs_owner on public.gym_export_runs;
create policy gym_export_runs_owner on public.gym_export_runs
  for all using (is_owner_of(tenant_id)) with check (is_owner_of(tenant_id));

revoke all on public.gym_export_runs from anon, authenticated, public;
grant select, insert on public.gym_export_runs to authenticated;
grant all on public.gym_export_runs to service_role;

-- No UPDATE and no DELETE for anybody. A record of an export that the exporter
-- can then remove is worth less than no record at all, because its absence
-- would be read as "no export was taken".

create or replace function public.gym_event_export()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
begin
  perform public.log_gym_event(new.tenant_id, 'record-exported', new.member_id,
    case when new.scope = 'member'
      then format('%s''s record exported', public.gym_event_name_of(new.member_id))
      else format('The gym''s record exported — %s row(s)', coalesce(new.rows_exported::text, 'an unstated number of')) end);
  return new;
end $fn$;

drop trigger if exists trg_gym_event_export on public.gym_export_runs;
create trigger trg_gym_event_export
  after insert on public.gym_export_runs
  for each row execute function public.gym_event_export();
