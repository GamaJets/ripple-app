-- ═══════════════════════════════════════════════════════════════════════════
-- The invoice currency follows the same order as everything else.
--
-- The other half of part 940, and the reason it is a separate file: 940 adds a
-- column and one write, and this changes a function somebody's documents are
-- issued by. They are applied together and they are read apart.
--
-- ── The disagreement that exists today ────────────────────────────────────
--
-- `issue_coach_invoice()` (part 138, last re-emitted by part 188) resolves a
-- currency the caller did not state in two steps: the coach's own packages
-- when they unanimously agree, then the gym. The gym link is
--
--     from public.trainers tr join public.tenants t on t.id = tr.tenant_id
--
-- and that is the wrong column. `revoke_staff_role()` (part 711) takes a coach
-- off a gym's staff by clearing `profiles.tenant_id`, and it KEEPS the
-- `trainers` row on purpose — deleting it would set `clients.trainer_id` null
-- underneath the history and strand every per-coach figure that joins on it.
-- `trainers.tenant_id` is NOT NULL, so it goes on naming the gym the coach has
-- left, for ever.
--
-- The consequence is one coach with two answers. Every screen in the coach app
-- reads `profiles.tenant_id` — `myTenantCurrency()`, the tenant provider — and
-- shows an independent coach a dash. This function reads `trainers.tenant_id`
-- and denominates their invoices in their old gym's currency. The document is
-- the one that gets sent to a client, and it was the one that was wrong.
--
-- ── What this changes, and what it deliberately does not ──────────────────
--
-- Three lines of a hundred-and-five. The body below is `pg_get_functiondef` of
-- the live function, taken verbatim on 3 Sep 2026, with the currency chain
-- replaced and comments added at the chain. Every refusal, the advisory lock,
-- the gapless per-coach sequence and the insert are untouched, and the
-- signature is character-for-character the live one — an overload here is not
-- a cosmetic problem, it is PostgREST resolving `issue_coach_invoice` against
-- two candidates and refusing (part 188 had to drop the eight-argument version
-- for exactly that).
--
-- The chain becomes:
--
--   1 · what the caller stated. The app always states it.
--   2 · the coach's own packages, unanimous. Unchanged.
--   3 · the gym on `profiles.tenant_id`.            ← was trainers.tenant_id
--   4 · `trainers.currency` (part 940), and ONLY when there is no gym.  ← new
--
-- Link 4 is guarded on "no gym" rather than on "nothing has answered yet".
-- That is part 940's precedence rule and it is what stops a coach inside a gym
-- whose owner has not chosen from quietly pricing themselves — which would put
-- a different currency on their invoice from the one their packages charge in,
-- and from the one the coach at the next desk uses.
--
-- Nothing here invents a currency. The last line of the chain is still
-- `raise exception 'no currency has been set…'`, and that refusal is correct:
-- an invoice with the wrong three letters on it is worse than no invoice.
--
-- Idempotent; safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.issue_coach_invoice(p_bill_to text, p_description text, p_amount_cents bigint, p_issued_on date, p_kind text, p_client_id uuid DEFAULT NULL::uuid, p_currency text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_due_on date DEFAULT NULL::date, p_tax_rate_pct numeric DEFAULT NULL::numeric, p_tax_registration text DEFAULT NULL::text)
 RETURNS coach_invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  uid uuid := auth.uid();
  ccy text;
  n   integer;
  reg text;
  out_row public.coach_invoices;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  if not exists (select 1 from public.trainers t where t.id = uid) then
    raise exception 'no trainer profile for this account';
  end if;

  if p_bill_to is null or btrim(p_bill_to) = '' then
    raise exception 'an invoice has to say who it is for';
  end if;
  if p_description is null or btrim(p_description) = '' then
    raise exception 'an invoice has to say what it is for';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'an invoice for nothing is not an invoice';
  end if;
  if p_amount_cents >= 100000000000 then
    raise exception 'that amount is too large';
  end if;
  if p_kind is null or p_kind not in ('received', 'requested') then
    raise exception 'say whether this records money received or money requested';
  end if;
  if p_issued_on is null then
    raise exception 'an invoice has to carry the date it was issued';
  end if;
  if p_issued_on > current_date + 1 then
    raise exception 'an invoice cannot be dated in the future';
  end if;

  -- Refused, not corrected. A document that says it fell due before it was
  -- written is not one anybody can act on, and silently swapping the two dates
  -- would print terms the coach did not type. There is deliberately no upper
  -- bound: a coach settling annually with a corporate client is ordinary.
  if p_due_on is not null and p_due_on < p_issued_on then
    raise exception 'an invoice cannot fall due before it is issued';
  end if;

  -- Refused rather than clamped, for the reason every money refusal in this
  -- product is refused rather than corrected: clamping 120 to 100 prints a rate
  -- the coach did not type onto a document about their tax affairs.
  if p_tax_rate_pct is not null and (p_tax_rate_pct < 0 or p_tax_rate_pct > 100) then
    raise exception 'a tax rate is a percentage between 0 and 100';
  end if;
  reg := nullif(btrim(coalesce(p_tax_registration, '')), '');
  if reg is not null and length(reg) > 60 then
    raise exception 'that tax registration number is longer than any this can print';
  end if;

  if p_client_id is not null and not exists (
    select 1 from public.clients c where c.id = p_client_id and c.trainer_id = uid
  ) then
    raise exception 'that client is not one of yours';
  end if;

  -- ── the currency, in one order, and the same order the app shows ──────
  --
  -- 1 · what the caller stated. The app always states it — see
  --     `fetchInvoiceCurrency` in src/ui/coachInvoices.ts, which resolves the
  --     same three links below and disables the Issue button when none of
  --     them answers — so the chain here is the fallback for a caller that
  --     did not, and it must not be able to reach a different answer.
  ccy := nullif(btrim(upper(coalesce(p_currency, ''))), '');

  -- 2 · the coach's own packages, unanimous or nothing. Unchanged from part
  --     138: a coach selling in sterling inside a dirham gym is selling in
  --     sterling, and a coach with packages in two currencies has not said
  --     which this invoice is in.
  if ccy is null then
    select case when count(distinct upper(k.currency)) = 1 then max(upper(k.currency)) end
      into ccy
    from public.trainer_packages k
    where k.trainer_id = uid and k.currency is not null and btrim(k.currency) <> '';
  end if;
  -- 3 · the gym, read from `profiles.tenant_id`.
  --
  --     Was `from public.trainers tr join public.tenants t on t.id =
  --     tr.tenant_id`. That is the wrong column and part 711 is why:
  --     `revoke_staff_role()` clears `profiles.tenant_id` and deliberately
  --     KEEPS the `trainers` row, still pointing at the gym the coach has
  --     left. So the old join denominated an independent coach's invoices in
  --     the currency of a gym they no longer belong to — while every other
  --     screen in the app showed them a dash, because those read
  --     `profiles.tenant_id`. One coach, two answers, and the one on the
  --     document was the wrong one.
  --
  --     `profiles.tenant_id` is the column that says which gym somebody is
  --     in, and it is the column `myTenantCurrency()` and the tenant provider
  --     already read. Part 940 states the precedence rule against it; this is
  --     that rule, in the one place that writes a currency onto a document.
  if ccy is null then
    select upper(btrim(t.currency)) into ccy
    from public.profiles pr
    join public.tenants t on t.id = pr.tenant_id
    where pr.id = uid and t.currency is not null and btrim(t.currency) <> '';
  end if;

  -- 4 · the coach's own currency (part 940), AND ONLY WHEN THERE IS NO GYM.
  --
  --     Guarded on `tenant_id is null` rather than on `ccy is still null`. A
  --     coach who IS in a gym whose owner has not set a currency must not be
  --     answered from their own dormant column: that would price their
  --     invoices differently from the coach standing next to them, and
  --     differently again from the packages their clients are charged in.
  --     They are waiting on their owner, and the exception below says so.
  if ccy is null and exists (
    select 1 from public.profiles pr where pr.id = uid and pr.tenant_id is null
  ) then
    select upper(btrim(tr.currency)) into ccy
    from public.trainers tr
    where tr.id = uid and tr.currency is not null and btrim(tr.currency) <> '';
  end if;
  if ccy is null then
    raise exception 'no currency has been set, so there is nothing to price this in';
  end if;
  if ccy !~ '^[A-Z]{3,4}$' then
    raise exception 'currency must be a three-letter code';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(uid::text, 138));

  select coalesce(max(i.seq), 0) + 1 into n
  from public.coach_invoices i
  where i.coach_id = uid;

  insert into public.coach_invoices
    (coach_id, seq, client_id, bill_to, description, amount_cents, currency, kind, issued_on, due_on, note,
     tax_rate_pct, tax_registration)
  values
    (uid, n, p_client_id, btrim(p_bill_to), btrim(p_description), p_amount_cents, ccy, p_kind,
     p_issued_on, p_due_on, nullif(btrim(coalesce(p_note, '')), ''),
     p_tax_rate_pct, reg)
  returning * into out_row;

  return out_row;
end $function$;

-- `create or replace` keeps the function's existing ACL, so these are here for
-- a run from an empty database rather than to change anything on a live one.
-- Both `public` and `anon` are named: Postgres grants EXECUTE to PUBLIC on
-- every new function and `anon` resolves through that grant, so naming one
-- leaves the other standing.
revoke all on function public.issue_coach_invoice(text, text, bigint, date, text, uuid, text, text, date, numeric, text) from public;
revoke all on function public.issue_coach_invoice(text, text, bigint, date, text, uuid, text, text, date, numeric, text) from anon;
grant execute on function public.issue_coach_invoice(text, text, bigint, date, text, uuid, text, text, date, numeric, text) to authenticated;
