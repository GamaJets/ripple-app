-- ═══════════════════════════════════════════════════════════════════════════
-- Two parts fixed the same function and neither knew about the other
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `run_invoice_ageing_notices` was rewritten twice on the same night, in two
-- files, for two unrelated defects. Both rewrites are right. Neither file
-- contains the other's change, and `create or replace function` does not
-- merge — it replaces. So applying either one in isolation silently deletes
-- the other's fix, and applying them in number order deletes the earlier one
-- every time.
--
--   part 1890 · WHEN it speaks.  The pass runs at 07:40 UTC, which is 18:40 in
--     Sydney and 00:40 in Los Angeles. 1890 gates every pass on the coach's own
--     local 7-9 via `notice_hour_due`, and claims the day per coach per pass
--     via `claim_notice_pass` so an hourly job cannot notify anybody twice.
--
--   part 2100 · WHETHER it should speak at all.  `and i.settled_on is null`.
--     An invoice the coach recorded as paid is money they have; it is off every
--     list in the app since part 660, and this pass was the one reader of the
--     table nobody had told. Without that line it asks a coach to chase a
--     payment they wrote down themselves — and asks again at 8 days, at 31 and
--     at 61, immediately after they did the thing the message told them to do.
--
-- Part 2100 is what is live, verified against `md5(prosrc)`. Part 1890's copy
-- is the older text plus the gate.
--
-- ── why this could not be applied as a sequence ───────────────────────────
--
-- The plan was "apply 1890, then re-apply 2100". That produces the paid-invoice
-- bug back in production: 2100 runs last and has no gate. Reversing it produces
-- notifications at half past midnight. There is no order of those two files
-- that yields both fixes, which is why this part exists rather than a runbook.
--
-- ── and why it cannot simply be left ──────────────────────────────────────
--
-- Part 1890 section 6 moves all six passes to an HOURLY schedule, because a
-- pass that gates on local 7-9 has to be offered every hour to catch every
-- zone. An ungated `run_invoice_ageing_notices` on an hourly schedule sends
-- invoice notifications twenty-four times a day to every coach. So the moment
-- 1890's schedule is applied, this function must already be gated. The two go
-- together or neither goes.
--
-- ── what this part is ────────────────────────────────────────────────────
--
-- Part 2100's function, unchanged, with part 1890's three additions spliced in:
-- the `v_due` array, the `claim_notice_pass` call, and `coach_id = any(v_due)`
-- in the predicate. It was built by inserting into 2100's own text rather than
-- by retyping it, so `settled_on` cannot have been lost on the way.
--
-- One judgement that is this part's and neither of theirs: the candidate set
-- handed to `claim_notice_pass` also carries `settled_on is null`, so it
-- mirrors the loop it gates. 1890's copy predates 2100 and could not have.
--
-- APPLY AFTER 1890. This part supersedes 1890's copy of this one function; the
-- other five passes, the seed and the schedule are 1890's and are unchanged.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.run_invoice_ageing_notices()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_sent integer := 0;
  r      record;
  -- The coaches whose local morning this tick is. Part 1890's mechanism.
  v_due  uuid[];
begin
  -- ── PART 1890'S GATE, WHICH THIS FUNCTION LOST ────────────────────────
  --
  -- Claim today for every coach whose local hour is now inside 7-9, and get
  -- back only those this tick may speak to. Two things at once: the coach is
  -- notified in their own morning rather than at 07:40 UTC, which is 18:40 in
  -- Sydney and half past midnight in Los Angeles; and the claim is per coach
  -- per pass per UTC day, so running hourly cannot notify anybody twice.
  --
  -- The candidate set mirrors the loop's own predicate below, `settled_on`
  -- included. A coach whose every invoice is settled has nothing this pass can
  -- say, and claiming their day for a run that will send nothing would put a
  -- row in notice_pass_runs that reads as "this coach was told something".
  select public.claim_notice_pass(
    'invoice-ageing-notices',
    (select coalesce(array_agg(distinct i.coach_id), '{}'::uuid[])
       from public.coach_invoices i
      where i.coach_id is not null
        and i.kind = 'requested'
        and i.voided_at is null
        and i.settled_on is null
        and i.due_on is not null),
    7) into v_due;

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
       -- Part 1890 again: only the coaches this tick claimed.
       and i.coach_id = any(v_due)
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

-- Part 1890 and part 2100 both revoke this; stated again because a `create or
-- replace` of a function that did not previously exist would otherwise be left
-- executable by PUBLIC, which includes anon.
revoke all on function public.run_invoice_ageing_notices() from public, anon, authenticated;

comment on function public.run_invoice_ageing_notices() is
  'Tells a coach an invoice they ASKED for has gone past its date, once per ageing band. Says nothing about an invoice they recorded as settled (part 2100) and speaks only inside the coach''s own 7-9, once per UTC day, claimed through notice_pass_runs (part 1890). This part exists because those two fixes were written into the same function in two different files and neither could be applied without deleting the other.';
