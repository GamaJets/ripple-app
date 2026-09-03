-- ═══════════════════════════════════════════════════════════════════════════
-- Every money sentence in the gym's permanent log was divided by a hundred.
--
-- ── The defect ────────────────────────────────────────────────────────────
--
-- `gym_events` is composed AT WRITE TIME and never recomputed — that is the
-- whole design of the table, and it is why it is the record a gym would hand to
-- somebody asking who took what. Part 187 wrote seven money sentences into it,
-- and every one of them formats the amount as
--
--     to_char(new.amount_cents / 100.0, 'FM999G999G990D00')
--
-- An unconditional division by a hundred, and a mandatory two decimal places
-- after it. In a gym that prices in yen that sentence states a hundred times
-- the money that changed hands; in one that prices in dinar, a tenth of it. It
-- is the same division `money()` was fixed for in src/lib/gymRecord.ts and that
-- `readMinorAmount` / `majorFromMinor` in src/lib/coachMoney.ts exist to end,
-- still standing in the log — and part 700 named it, at :279, while declining
-- to add a fourteenth site of it:
--
--     "Every existing money event in part 187 writes `to_char(amount_cents /
--      100.0, …)` into its sentence, which is a hundred times the real figure
--      in a gym that prices in yen and ten times it in one that prices in
--      dinar… Adding a fourteenth site of it is not a trade worth making."
--
-- Correct, and the conclusion it reached — leave the amount off the
-- cost-deletion sentence entirely — does not hold, for a reason the same
-- paragraph half-states. The row an owner is told to "open to read the amount
-- of" is the row that was just deleted. `gym_costs` has no UPDATE path at all,
-- so removing a line is the only way to correct one, and after the delete the
-- sum that month used to show is unrecoverable from anywhere in this product.
--
-- ── What this part does ───────────────────────────────────────────────────
--
--   1. `public.money_text(amount_cents, currency)` — one formatter, which asks
--      the currency how many places its money has, exactly as
--      `currencyDecimals` does in TypeScript.
--   2. Part 187's seven sites are rewritten through it. Same sentences, same
--      triggers, correct figures.
--   3. The cost-deletion event carries its amount, because the formatter it was
--      waiting for now exists.
--
-- ── What it does NOT do, and cannot ───────────────────────────────────────
--
-- It does not touch a single `gym_events` row already written. The summary is
-- composed at write time and stored; there is nothing in a stored sentence that
-- says which currency it was composed from, or what the raw figure was, so a
-- hundredfold sentence cannot be told from a correct one after the fact. That
-- is not a limitation of this part, it is what "composed at write time" means,
-- and it is the reason this was worth fixing before more of them accumulated.
--
-- A gym reading its own history will therefore see sentences from before this
-- part that are wrong by a factor of a hundred (sixteen currencies) or ten
-- (five currencies), and sentences from after it that are right. Two-decimal
-- gyms — which is most of them — are unaffected in both directions, because
-- for those the old expression happened to be correct.

-- ── the formatter ─────────────────────────────────────────────────────────
--
-- The three sets are Stripe's and are the same lists `ZERO_DECIMAL` and
-- `THREE_DECIMAL` hold in src/lib/coachMoney.ts. Duplicated here rather than
-- read from a table on purpose: this runs inside an AFTER trigger on the money
-- tables, and a formatter that could fail on a missing lookup row would take
-- the payment write down with it. The two lists are small, closed and set by
-- ISO 4217 rather than by this product.
--
-- IMMUTABLE and STRICT: no I/O, and a null in gives a null out, which callers
-- handle with `coalesce` where an amount may genuinely be absent.
create or replace function public.money_text(p_amount_cents bigint, p_currency text)
returns text language plpgsql immutable strict as $fn$
declare
  v_cur text := upper(btrim(p_currency));
  v_places int;
begin
  if v_cur = '' then
    -- No currency is not a formatting problem to be worked around. The caller
    -- gets the integer and the fact that its unit is unknown, which is what is
    -- actually true; inventing two decimal places here is the defect.
    return p_amount_cents::text || ' (minor units, currency not recorded)';
  end if;

  v_places := case
    when v_cur in ('BIF','CLP','DJF','GNF','JPY','KMF','KRW','MGA',
                   'PYG','RWF','UGX','VND','VUV','XAF','XOF','XPF') then 0
    when v_cur in ('BHD','JOD','KWD','OMR','TND') then 3
    else 2
  end;

  -- Grouped, with exactly the number of decimal places this money has. The old
  -- expression hard-coded 'D00' as well as the hundred, so even a correctly
  -- divided yen figure would have been printed with two places it does not
  -- have.
  return case v_places
    when 0 then to_char(p_amount_cents, 'FM999G999G999G990')
    when 3 then to_char(p_amount_cents / 1000.0, 'FM999G999G990D000')
    else to_char(p_amount_cents / 100.0, 'FM999G999G990D00')
  end;
end $fn$;

comment on function public.money_text(bigint, text) is
  'A minor-unit amount as words, in the places the currency actually has — 0 for the sixteen zero-decimal currencies, 3 for the five thousandth ones, 2 otherwise. The one formatter for money composed into a gym_events summary. Never divide by 100 in a trigger: see supabase/parts/1011.';

-- ── part 187''s seven sites, through it ────────────────────────────────────
--
-- The sentences are unchanged word for word. Only the figure inside them moves,
-- and only for the twenty-one currencies where the old one was wrong.

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
             public.money_text(abs(new.amount_cents), new.currency), v_who));
  else
    perform public.log_gym_event(
      new.tenant_id, 'payment-recorded', new.member_id,
      format('%s %s taken from %s by %s', new.currency,
             public.money_text(new.amount_cents, new.currency), v_who,
             replace(new.method, '_', ' ')));
  end if;
  return new;
end $fn$;

create or replace function public.gym_event_invoice()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
begin
  perform public.log_gym_event(
    new.tenant_id, 'invoice-raised', new.member_id,
    format('Invoice %s for %s %s to %s',
           coalesce(new.number::text, '(unnumbered)'), new.currency,
           public.money_text(new.amount_cents, new.currency),
           public.gym_event_name_of(new.member_id)));
  return new;
end $fn$;

create or replace function public.gym_event_plan_changed()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
begin
  if new.price_cents is distinct from old.price_cents then
    -- Each side formatted in ITS OWN currency. A gym that repriced and
    -- redenominated in the same edit is two amounts in two monies, and the old
    -- line divided both by a hundred whatever they were.
    perform public.log_gym_event(
      new.tenant_id, 'price-changed', null,
      format('%s repriced from %s %s to %s %s', new.name,
             old.currency, public.money_text(old.price_cents, old.currency),
             new.currency, public.money_text(new.price_cents, new.currency)));
  end if;
  if old.active and not new.active then
    perform public.log_gym_event(new.tenant_id, 'plan-retired', null,
      format('%s taken off the price book', new.name));
  end if;
  return new;
end $fn$;

create or replace function public.gym_event_settlement()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
begin
  if tg_op = 'INSERT' then
    perform public.log_gym_event(new.tenant_id, 'payroll-settled', new.trainer_id,
      format('%s %s settled to %s for %s session(s)', new.currency,
             public.money_text(new.amount_cents, new.currency),
             public.gym_event_name_of(new.trainer_id), new.sessions_count));
    return new;
  end if;
  if new.reversed_at is not null and old.reversed_at is null then
    perform public.log_gym_event(new.tenant_id, 'payroll-reversed', new.trainer_id,
      format('Settlement of %s %s to %s reversed — %s', new.currency,
             public.money_text(new.amount_cents, new.currency),
             public.gym_event_name_of(new.trainer_id), new.reverse_reason));
  end if;
  return new;
end $fn$;

-- ── the cost that was removed, and how much it was ────────────────────────
--
-- Part 700 left the amount off this sentence to avoid a fourteenth division by
-- a hundred, and directed the reader to "open the row" instead. The row is the
-- one that has just been hard-deleted by `deleteGymCost` — `gym_costs` has no
-- UPDATE path, so removing a line is the only correction available, and
-- studio-web/app/costs/page.tsx says so in the confirmation. After the delete
-- the amount exists nowhere: not on the row, not in the log, and not in any
-- total, because the total moved.
--
-- Which is the one event kind whose subject no longer exists, and therefore the
-- one where the reasoning does not hold. With a formatter that asks the
-- currency, it can now say what it was.
--
-- `gym_costs.currency` is nullable, so `coalesce` rather than a bare call: a
-- cost filed with no currency says so in words instead of silently losing the
-- amount to STRICT.
create or replace function public.gym_event_cost()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
begin
  -- `subject_id` is who the event is ABOUT, and a cost is about nobody — no
  -- member, no trainer. NULL rather than the actor, which part 187 already
  -- carries separately and which is a different question.
  if tg_op = 'DELETE' then
    perform public.log_gym_event(
      old.tenant_id, 'cost-deleted', null,
      format('Cost removed: %s — %s, %s, paid %s',
             old.category, old.description,
             coalesce(
               nullif(btrim(coalesce(old.currency, '')), '') || ' ' ||
                 public.money_text(old.amount_cents, old.currency),
               old.amount_cents::text || ' (minor units, currency not recorded)'),
             old.paid_on));
    return old;
  end if;
  perform public.log_gym_event(
    new.tenant_id, 'cost-recorded', null,
    format('Cost recorded: %s — %s, %s, paid %s',
           new.category, new.description,
           coalesce(
             nullif(btrim(coalesce(new.currency, '')), '') || ' ' ||
               public.money_text(new.amount_cents, new.currency),
             new.amount_cents::text || ' (minor units, currency not recorded)'),
           new.paid_on));
  return new;
end $fn$;

revoke all on function public.gym_event_cost() from public, anon, authenticated;
revoke all on function public.money_text(bigint, text) from public, anon, authenticated;
