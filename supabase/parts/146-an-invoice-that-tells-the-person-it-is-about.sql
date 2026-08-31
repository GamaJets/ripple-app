-- ─────────────────────────────────────────────────────────────────────────
-- A gym invoice that tells the member it is about.
--
-- ── What was missing ─────────────────────────────────────────────────────
--
-- `gym_invoices` (part 29) is what a gym says a member owes it. It has had a
-- member read policy since the day it was written — `gym_invoices_own_r`, so
-- the member may see their own — and no producer of any kind: no push, no
-- inbox row, no email, nothing. A charge appeared against somebody's name and
-- the only way they learned of it was being told at the desk.
--
-- The same was true of the coach invoices that shipped in part 138. Those are
-- notified from the app (src/ui/coachInvoices.ts) and these are notified from
-- a trigger, and the difference is not a preference:
--
--   coach_invoices  has exactly ONE writer, `issue_coach_invoice()`, called
--                   from one screen. App code sees every row as it is created
--                   and can also tell the COACH whether their client was
--                   notified, which a trigger cannot report back.
--   gym_invoices    has NO writer in this repository at all. Rows arrive from
--                   the owner's web console and from hand-written SQL, neither
--                   of which the phone app can observe. A notification written
--                   next to each of those call sites would be a notification
--                   with a hole wherever somebody forgot one — which is the
--                   argument part 105 makes for writing `gym_events` from
--                   triggers, in the same words.
--
-- ── WHY NO AMOUNT IS STATED ──────────────────────────────────────────────
--
-- This is the decision most likely to look like an omission, so: the figure is
-- withheld ON PURPOSE, and the notification says where to find it.
--
-- `gym_invoices.currency` is `not null default 'AED'`. A default is not a
-- choice — scripts/check-currency.mjs exists in this repo because that exact
-- default silently denominated every non-UAE gym's settlements in dirhams —
-- so a row's currency may well be a value nobody in that gym has ever seen,
-- and Repple is white-labelled with gyms in several. On top of that,
-- `amount_cents` is in minor units, and how many minor units make a unit
-- depends on the currency (JPY, KWD and AED do not agree). The app knows both
-- of those things and does them in one tested place (src/lib/coachMoney.ts);
-- restating them in plpgsql would be a second copy that drifts, and the
-- failure mode of a drifted copy here is a member told they owe a number that
-- is not the number.
--
-- A figure whose currency is unknown is not printed bare and not guessed —
-- that rule is the whole of check-currency.mjs. So this states the DATES,
-- which are unambiguous, and sends the member to the document. When a member
-- screen for `gym_invoices` exists, this copy gains a route and the amount can
-- be rendered there by the code that already knows how.
--
-- ── When it fires ────────────────────────────────────────────────────────
--
-- On INSERT of a row that is already issued, and on the one transition from
-- 'draft' to an issued status. Not on 'paid', 'void' or 'written_off': those
-- are the gym's own bookkeeping and none of them is news that a charge has
-- been made. Not on every status change either — an invoice going
-- open → overdue → open would otherwise notify twice for one debt, and a
-- notification somebody has already read arriving again reads as a second
-- charge.
--
-- ── Why the insert is direct and not through notify_users() ──────────────
--
-- `notify_users()` (part 122) authorises on `auth.uid()`, and these rows are
-- written by an owner through PostgREST TODAY and may be written by a job or
-- by the service role tomorrow — where `auth.uid()` is null and the function
-- correctly returns 0, notifying nobody. The recipient here is not a choice
-- made by a caller at all: it is `new.member_id`, the person the row is
-- already about, so there is no fan-out to authorise. The trigger writes that
-- one row and nothing else.
--
-- SECURITY DEFINER because `notif_self` is `using (user_id = auth.uid())`,
-- which is exactly backwards for a notification addressed to somebody else —
-- the same reason part 122 gives — with `search_path` pinned so the tables it
-- resolves cannot be chosen by whoever happens to be inserting. Revoked from
-- public, anon AND authenticated, as part 51 and part 141 require of every
-- trigger function: Postgres checks EXECUTE when a trigger is created, not
-- when it fires, so a trigger function needs no grant to anybody.
--
-- Idempotent; safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.gym_invoice_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_body text;
begin
  -- 'draft' is not issued to anybody, and paid/void/written_off are the gym's
  -- own bookkeeping rather than a charge being made.
  if new.status not in ('open', 'overdue') then
    return new;
  end if;
  -- On an update, only the first move out of 'draft'. Every other transition
  -- is a status the member has already been told about once.
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status <> 'draft' then
    return new;
  end if;

  -- Dates, not money. See the header: the amount is withheld because the
  -- currency on the row may be a default nobody chose, and a wrong figure is
  -- worse than none.
  v_body := 'Your gym has issued you an invoice dated '
         || to_char(new.issued_on, 'FMDD Mon YYYY')
         || coalesce(', due ' || to_char(new.due_on, 'FMDD Mon YYYY'), '')
         || '. The amount and how to pay it are on the invoice itself — ask at reception for a copy.';

  insert into public.notifications (user_id, title, body, icon)
  values (new.member_id, 'An invoice from your gym', left(v_body, 500), 'bell');

  return new;
end;
$function$;

comment on function public.gym_invoice_notify() is
  'Writes the member one inbox row when a gym invoice is issued to them. States dates only — never an amount; see part 146 for why.';

drop trigger if exists gym_invoices_notify_member on public.gym_invoices;
create trigger gym_invoices_notify_member
  after insert or update of status on public.gym_invoices
  for each row execute function public.gym_invoice_notify();

-- A trigger function is callable by nobody. Postgres checks EXECUTE when the
-- trigger is CREATED, not each time it fires, so these revokes cost nothing and
-- close the hole part 141 found across a whole night of new functions: Supabase
-- grants to `anon` and `authenticated` separately, and `revoke ... from public`
-- leaves both standing.
revoke all on function public.gym_invoice_notify() from public;
revoke all on function public.gym_invoice_notify() from anon;
revoke all on function public.gym_invoice_notify() from authenticated;
