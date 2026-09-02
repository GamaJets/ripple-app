-- ═══════════════════════════════════════════════════════════════════════════
-- The invoice that went overdue and told nobody.
--
-- Part 188 collected the due date and built the chase. `invoiceAge()` and
-- `ageingBook()` in src/lib/coachInvoice.ts sort a coach's book into overdue,
-- upcoming and undated, band it by how late it is, and tell them what to chase
-- first. All of it runs when somebody opens the Invoices screen, and nowhere
-- else: part 188 contains no `cron.schedule`, and grep `coach_invoices` across
-- supabase/parts finds no trigger and no scheduled pass.
--
-- So "who owes me money" is answered accurately and only when asked, and the
-- moment it matters is the moment nobody is asking. A self-employed coach does
-- not open an invoicing screen on the day an invoice falls due; they open it at
-- the end of a quarter, and find four things they could have chased eight weeks
-- earlier when the client still remembered the sessions.
--
-- ── Why a scheduled pass ─────────────────────────────────────────────────
--
-- The event is the ABSENCE of a write. Nothing happens to a `coach_invoices`
-- row on the day it becomes late — the last thing that happened to it was the
-- coach issuing it, six weeks ago — so there is no INSERT or UPDATE to hang a
-- trigger on. That is part 202's argument for the overdue-client and credential
-- passes, and part 471's for a block ending, unchanged.
--
-- ── The bands, borrowed rather than invented ─────────────────────────────
--
-- `ageBucket()` in src/lib/coachInvoice.ts is four bands — 1-7, 8-30, 31-60,
-- 61+ — and it is what the Invoices screen already groups by. This pass files
-- one notice per invoice per BAND, so a coach hears on the day it goes late and
-- again as it ages into a band they have not been told about: at 1 day, at 8, at
-- 31 and at 61. Four messages in the life of an invoice, spread over two months.
--
-- The bands are re-stated in SQL below rather than shared, which is a copy and
-- copies drift. It is the smallest possible one — three integer comparisons and
-- no notion of what an invoice is — and it is named here so the two can be read
-- against each other. The alternative is a nightly message, which is the
-- nagging every notification in this product refuses.
--
-- ── The honest cost of this feature, stated up front ─────────────────────
--
-- Nothing tells this app when a client pays. An invoice leaves the ageing list
-- in exactly two ways: the coach VOIDS it, or they issue a 'received' one
-- instead — `invoiceAge()` has no third door, `kind` is immutable after issue
-- (part 188), and `AGEING_IS_YOUR_OWN_RECORD` says so on the screen.
--
-- Which means a coach who was paid in cash on Friday and did not write it down
-- WILL be told their invoice is late. That is not a bug to be engineered away;
-- it is the same thing the screen already says, arriving without being asked
-- for. What this pass owes them is that the message says so and names the way
-- out, and the body below does: void it, or record what you were paid.
--
-- It is bounded by construction, which is the other half of making that
-- acceptable. Four messages, ever, per invoice.
--
-- ── And nothing about money in the message ───────────────────────────────
--
-- No amount and no currency, which is part 163's rule and part 202's.
-- `minorMoney` in src/lib/coachMoney.ts is the one money formatter in this
-- codebase — it is what knows a currency's decimal places — and it is not
-- reachable from plpgsql. A second one is the copy that drifts, and a drifted
-- copy quotes a coach a figure that is not the figure. The invoice number and
-- the day are certain, they are what identifies the document, and the Invoices
-- screen prices it.
--
-- Idempotent; safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── The dedupe record ─────────────────────────────────────────────────────
--
-- The same shape as `coach_credential_notices` in part 202: one row per subject
-- per stage, so a nightly pass speaks once at each crossing rather than every
-- night in between. The band is the stage.
create table if not exists public.coach_invoice_ageing_notices (
  invoice_id uuid not null references public.coach_invoices(id) on delete cascade,
  -- Which of `ageBucket()`'s four bands this row records. An invoice gets one
  -- of each and never two of any.
  bucket     text not null check (bucket in ('1-7', '8-30', '31-60', '61+')),
  notified_at timestamptz not null default now(),
  primary key (invoice_id, bucket)
);

comment on table public.coach_invoice_ageing_notices is
  'One row per invoice per ageing band (ageBucket() in src/lib/coachInvoice.ts), so a coach is told once as an invoice crosses into each band rather than every night it sits there. Bookkeeping for run_invoice_ageing_notices(); read by nothing.';

alter table public.coach_invoice_ageing_notices enable row level security;

-- No policy at all, and that is the intent rather than an omission — the same
-- call parts 202's two bookkeeping tables make. RLS with no policy denies every
-- row to every non-superuser role, which is exactly right: this is bookkeeping
-- for a job that runs as the table owner, and nothing in any of the three apps
-- reads or writes it. A coach-readable policy would be a second, differently
-- shaped answer to "what is late" sitting beside the one `ageingBook()`
-- computes.

create or replace function public.run_invoice_ageing_notices()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_sent integer := 0;
  r      record;
begin
  for r in
    select i.id, i.coach_id, i.seq, i.bill_to, i.due_on, i.reminder_count,
           (current_date - i.due_on) as days_late,
           -- `ageBucket()` in src/lib/coachInvoice.ts, written out. Named here
           -- so the two can be read against each other, and so that changing
           -- one is visibly not changing the other.
           case
             when (current_date - i.due_on) <= 7  then '1-7'
             when (current_date - i.due_on) <= 30 then '8-30'
             when (current_date - i.due_on) <= 60 then '31-60'
             else '61+'
           end as bucket
      from public.coach_invoices i
       -- No recipient guard, and it is checked rather than assumed: part 138
       -- declares `coach_id uuid not null references trainers(id)`, and part 01
       -- declares `trainers.id references profiles(id)`, which is exactly what
       -- `notifications.user_id` requires. Every row here has a coach who has a
       -- profile — unlike part 471's assigned_programs, whose coach_id is
       -- nullable and therefore guarded.
     where
       -- Only what the coach is ASKING for. A 'received' invoice is their own
       -- statement that the money came in, and `invoiceAge()` calls it settled.
       and i.kind = 'requested'
       -- A voided invoice is on no list at all: the coach has already told
       -- somebody that number was cancelled.
       and i.voided_at is null
       -- No due date is not "not due" — it is the coach never having stated
       -- one, and part 188 is emphatic that those must never be read as being
       -- comfortably within terms nobody wrote down. An invoice with no date
       -- cannot be late and is not this pass's business.
       and i.due_on is not null
       -- Past the day itself. `invoiceAge()` calls the due date 'due-today' and
       -- not overdue, so the first day this can speak is the day after.
       and i.due_on < current_date
       -- Nothing about an invoice that fell due before this feature existed.
       -- A coach opening the app to nine notifications about documents from
       -- last year learns to clear the inbox without reading it — part 202
       -- makes this exact trade for credentials, with the same thirty-day
       -- shape. Ninety days here rather than thirty, because the last band
       -- opens at sixty-one and a shorter window would mean an invoice could
       -- never reach it.
       and i.due_on >= current_date - 90
  loop
    if exists (
      select 1 from public.coach_invoice_ageing_notices n
       where n.invoice_id = r.id and n.bucket = r.bucket
    ) then
      continue;
    end if;

    -- Written BEFORE the notification, and the ordering is part 202's. If the
    -- insert into `notifications` fails the whole iteration rolls back and the
    -- coach is told tomorrow; if it succeeded and the bookkeeping then failed,
    -- the coach would be told again every night forever.
    insert into public.coach_invoice_ageing_notices (invoice_id, bucket, notified_at)
    values (r.id, r.bucket, now())
    on conflict (invoice_id, bucket) do nothing;

    insert into public.notifications (user_id, title, body, icon, route)
    values (
      r.coach_id,
      case when r.bucket = '1-7' then 'An invoice has gone past its date'
           else 'An invoice is still unpaid' end,
      left(
        -- `invoiceNumber()` in src/lib/coachInvoice.ts formats the sequence for
        -- the document; here it is the bare number, because the notification is
        -- identifying which one rather than reproducing the document.
        'Invoice ' || r.seq || ' to ' || coalesce(nullif(btrim(coalesce(r.bill_to, '')), ''), 'a client')
        || ' was due on ' || to_char(r.due_on, 'DD Mon YYYY') || ', which is '
        || r.days_late || ' day' || case when r.days_late = 1 then '' else 's' end || ' ago.'
        || case
             when coalesce(r.reminder_count, 0) = 0 then ' You have not chased it yet.'
             when r.reminder_count = 1 then ' You have chased it once.'
             else ' You have chased it ' || r.reminder_count || ' times.'
           end
        -- The way out, named, because otherwise this is a message a coach who
        -- was paid in cash cannot make stop.
        || ' Nothing tells this app when a client pays you, so if they already have,'
        || ' void this one or record what you were paid — otherwise it goes on ageing.'
        || ' Invoices has the amount and the chase.',
        500),
      'grid',
      '/(trainer)/invoices'
    );
    v_sent := v_sent + 1;
  end loop;

  -- Bookkeeping. A cascade already clears the rows of a deleted invoice; this
  -- is for the rest, and it keeps the table from growing one row per band per
  -- invoice forever. Well past the ninety-day window above, so nothing can be
  -- swept and then re-notified.
  delete from public.coach_invoice_ageing_notices n
   where n.notified_at < now() - interval '400 days';

  return jsonb_build_object('sent', v_sent);
end $fn$;

revoke all on function public.run_invoice_ageing_notices() from public, anon, authenticated;

comment on function public.run_invoice_ageing_notices() is
  'Nightly. Tells a coach when one of their own requested invoices crosses into a new ageing band — ageBucket() in src/lib/coachInvoice.ts: 1-7, 8-30, 31-60, 61+ — so at most four messages in the life of an invoice. Ignores anything that fell due more than ninety days ago, so switching it on does not produce an inbox of history. Carries no amount and no currency.';

-- ── The schedule ─────────────────────────────────────────────────────────

create extension if not exists pg_cron;

-- Unschedule first so re-running this file does not accumulate duplicate jobs
-- each firing the same pass, exactly as parts 48, 135, 202, 471 and 612 do.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'invoice-ageing-notices') then
    perform cron.unschedule('invoice-ageing-notices');
  end if;
end $$;

-- 07:40 UTC, seven minutes after part 612's pass and on the same morning
-- reasoning parts 202 and 471 set out: this wakes a phone, and a coach whose
-- notification arrives at 03:17 is a coach who turns notifications off. Off the
-- top of the hour, and clear of every pass already scheduled.
select cron.schedule(
  'invoice-ageing-notices',
  '40 7 * * *',
  $cron$ select public.run_invoice_ageing_notices(); $cron$
);
