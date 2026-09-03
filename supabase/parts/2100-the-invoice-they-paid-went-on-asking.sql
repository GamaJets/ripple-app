-- ═══════════════════════════════════════════════════════════════════════════
-- The invoice they paid, which went on asking — and the void that answered
-- with a constraint name.
--
-- Part 660 gave a coach somewhere to record that an invoice was paid. It moved
-- every SCREEN off the back of that column: `invoiceAge()` reports 'settled',
-- `ageingBook()` drops it from overdue, upcoming, the outstanding figure and
-- every chase list, `chaseBlocker` refuses to chase it, `homeMoney` stops
-- naming it on the first screen a coach opens, and the two partial indexes it
-- rebuilt exclude it by predicate.
--
-- It did not move the two things that are not screens.
--
-- ── 1. THE NIGHTLY PASS GOES ON TELLING THEM TO CHASE IT ──────────────────
--
-- `run_invoice_ageing_notices()` (part 613) selects on
--
--     kind = 'requested' and voided_at is null and due_on is not null
--     and due_on < current_date and due_on >= current_date - 90
--
-- and part 660 added no line to it. So an invoice the coach has recorded as
-- settled — off every list in the app, out of every figure — is still picked up
-- by the pass, and still writes a notification into their inbox saying it "was
-- due on 3 August, which is 41 days ago. You have chased it twice."
--
-- The buckets are 1-7, 8-30, 31-60 and 61+, one notification each, so a
-- settlement recorded in the first week is followed by up to three more
-- demands over the next three months. Part 660's own header names this exact
-- harm as the thing it was written to remove: "part 613's nightly pass, which
-- tells the coach four times over two months to chase money they have."
--
-- And the notification body, verbatim, is:
--
--     'Nothing tells this app when a client pays you, so if they already have,
--      void this one or record what you were paid — otherwise it goes on
--      ageing.'
--
-- A coach who does exactly what that sentence asks is told again next month.
-- That is worse than the original defect, because the instruction came from the
-- app: the coach concludes the record did not save, and goes looking for a
-- payment they already wrote down.
--
-- The predicate is also the reason the pass cannot use the index part 660 built
-- for it. `coach_invoices_due_idx` is partial on
-- `due_on is not null and voided_at is null and settled_on is null`, and a
-- query that does not state the third condition does not match the index.
-- Adding the line is a correctness fix that happens to restore the plan.
--
-- ── 2. VOIDING A SETTLED INVOICE RAISES A CHECK CONSTRAINT AT A COACH ─────
--
-- Part 138 wrote `void_coach_invoice()` with one guard — already voided —
-- because that was the only other state an invoice could be in. Part 660 then
-- added `coach_invoices_not_both_chk`:
--
--     check (voided_at is null or settled_on is null)
--
-- and gave the function no matching refusal. So a coach who voids an invoice
-- they have recorded as settled reaches the UPDATE, trips the CHECK, and is
-- shown an Alert headed "That invoice was not voided" carrying the raw Postgres
-- sentence about a relation and a constraint name.
--
-- This is not a rare state. It is the state a coach reaches by making a
-- mistake: "They paid it" sits beside "Send" on every row of the whole-book
-- list, a settlement is written once and there is no un-settle, so the coach
-- who taps the wrong row goes looking for the other way out — and the immutable
-- guard's own message tells them what it is: "void it and issue another".
--
-- The refusal below says what happened and what is left to do. The number
-- stands, and a correcting document is how a paper ledger has always handled
-- this. `voidBlocker` in src/lib/coachInvoice.ts is the screen's copy of the
-- same rule, so the control is absent rather than dead; this is the rule.
--
-- ── 3. AND A SETTLED INVOICE COULD STILL BE CHASED ────────────────────────
--
-- `remind_coach_invoice()` filters on `voided_at is null and kind = 'requested'`
-- and nothing else, so it will record a chase against a settled invoice and
-- push a notification to the client asking them to pay something they have
-- paid. `chaseBlocker` hides the control, which is why nobody has seen it — but
-- the screen's copy is a convenience and the function is the rule, and the
-- other two functions on this table (`settle_coach_invoice`,
-- `set_coach_invoice_chase_from`) both already refuse a settled invoice in
-- their own words. This is the third.
--
-- Nothing here changes a column, a constraint, an index or a policy. Three
-- function bodies, each gaining the condition part 660 established and did not
-- carry into it.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · the nightly pass ──────────────────────────────────────────────────
--
-- Replaced whole rather than patched, because a `create or replace function`
-- is the only way to change a body and the body has to be read against part 613
-- to see that ONE line moved. Everything else below — the buckets, the ninety
-- day window, the bookkeeping insert before the notification, the 400-day
-- sweep — is part 613's, verbatim.

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
       i.kind = 'requested'
       -- A voided invoice is on no list at all: the coach has already told
       -- somebody that number was cancelled.
       and i.voided_at is null
       -- ── THE LINE THIS PART EXISTS FOR ─────────────────────────────────
       -- An invoice the coach has recorded as settled is money they have. It
       -- is off every list and out of every figure in the app since part 660,
       -- and this pass was the one reader of the table that had not been told.
       -- Without it the body below asks a coach to chase a payment they wrote
       -- down themselves — and asks it again at 8 days, at 31 and at 61,
       -- immediately after they did the thing the message told them to do.
       and i.settled_on is null
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
        -- was paid in cash cannot make stop. It is now true: recording the
        -- payment sets `settled_on`, and the predicate above stops this pass
        -- speaking about it again. Before this part the sentence was an
        -- instruction that did not work, which is worse than no instruction.
        || ' Nothing tells this app when a client pays you, so if they already have,'
        || ' record what you were paid or void this one — otherwise it goes on ageing.'
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

-- ── 2 · voiding ───────────────────────────────────────────────────────────
--
-- Part 138's body plus one refusal, and the refusal is worded for the coach
-- because that is where it is read. Raised BEFORE the update rather than left
-- to the constraint: `coach_invoices_not_both_chk` is a correct rule and a
-- terrible sentence, and the difference between the two is the whole of this.

create or replace function public.void_coach_invoice(p_id uuid, p_reason text)
returns public.coach_invoices
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  uid uuid := auth.uid();
  inv public.coach_invoices;
  out_row public.coach_invoices;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'say why it is being voided — a cancelled number with no reason is a question nobody can answer later';
  end if;

  -- Read first, so the refusals below can name what is actually wrong. The old
  -- body went straight to the UPDATE and inferred everything from zero rows
  -- back, which cannot tell "not yours" from "already voided" and could not see
  -- a settlement at all.
  select * into inv from public.coach_invoices i
   where i.id = p_id and i.coach_id = uid
     for update;

  if inv.id is null then
    raise exception 'no invoice of yours to void with that id';
  end if;
  if inv.voided_at is not null then
    raise exception 'that invoice is already voided';
  end if;
  -- The refusal this part exists for. Says what is true and what is left to do,
  -- rather than letting the CHECK say 'new row for relation "coach_invoices"
  -- violates check constraint "coach_invoices_not_both_chk"' to a coach.
  if inv.settled_on is not null then
    raise exception 'that invoice is recorded as settled, and a document cannot say both that it was paid and that it was cancelled — issue a new one for the difference';
  end if;

  update public.coach_invoices i
     set voided_at = now(), void_reason = btrim(p_reason)
   where i.id = p_id and i.coach_id = uid and i.voided_at is null
  returning * into out_row;

  if out_row.id is null then
    raise exception 'that invoice was not voided — nothing was changed';
  end if;

  return out_row;
end $fn$;

-- ── 3 · chasing ───────────────────────────────────────────────────────────
--
-- The third function on this table to learn what part 660 established.
-- `settle_coach_invoice` and `set_coach_invoice_chase_from` both refuse a
-- settled invoice already; this one recorded a chase against it and pushed a
-- client a demand for money they had paid.
--
-- Read-then-update rather than a wider WHERE, for the same reason as above: the
-- old body raised one sentence listing every possible cause, and a coach who
-- reads "it may be voided, or you may have stated it was already received"
-- about an invoice that is neither learns nothing.

create or replace function public.remind_coach_invoice(p_id uuid)
returns public.coach_invoices
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  uid uuid := auth.uid();
  inv public.coach_invoices;
  out_row public.coach_invoices;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  select * into inv from public.coach_invoices i
   where i.id = p_id and i.coach_id = uid
     for update;

  if inv.id is null then
    raise exception 'that invoice is not one of yours';
  end if;
  if inv.voided_at is not null then
    raise exception 'that invoice is voided, so there is nothing to chase';
  end if;
  if inv.settled_on is not null then
    raise exception 'that invoice is recorded as settled, so there is nothing outstanding to chase';
  end if;
  if inv.kind <> 'requested' then
    raise exception 'that invoice states the money was received, so there is nothing to chase';
  end if;

  update public.coach_invoices i
     set reminded_at = now(), reminder_count = i.reminder_count + 1
   where i.id = p_id and i.coach_id = uid
  returning * into out_row;

  if out_row.id is null then
    raise exception 'that chase was not recorded — nothing was changed';
  end if;
  return out_row;
end $fn$;
