-- ─────────────────────────────────────────────────────────────────────────
-- What each code COST, and what it BROUGHT BACK.
--
-- ── What was missing ─────────────────────────────────────────────────────
--
-- Part 81 gave a coach named codes and `my_join_codes()` gave each one a join
-- count, which answers "which of the things I did brought people in?". It does
-- not answer the question an online coach actually spends money on: "which of
-- the things I did returned money?". Twenty joins off a code that cost £400 in
-- ads and four joins off a code that cost nothing are not comparable numbers,
-- and a coach reading only the joins will pour more money into the loser.
--
-- Two of the three figures needed for that are already in this database —
-- who joined by which code (`coach_requests.via_code`) and what they then paid
-- (`client_purchases`). The third, what the coach spent to get them, exists
-- nowhere: nothing in Repple sees an Instagram invoice. So this part adds one
-- table for the coach to write it down, and one function that puts the three
-- together per code.
--
-- ── LAST TOUCH, and why the client count here can be LOWER than
--    my_join_codes().joined ────────────────────────────────────────────────
--
-- `coach_requests` has one PENDING row per (client, trainer) pair, and no
-- constraint at all on accepted ones — part 23's partial unique index covers
-- 'pending' only, deliberately, so somebody who was declined can ask again.
-- A client who joined off the Instagram code, ended coaching, and came back a
-- year later off the TikTok code therefore has TWO accepted rows.
--
-- `my_join_codes()` counts requests, so that person is one join on Instagram
-- and one join on TikTok. For a headcount that is arguably fine. For MONEY it
-- is not: their purchases would be added to Instagram's revenue AND to
-- TikTok's, and a coach summing the columns would see more revenue than they
-- have ever been paid.
--
-- So this function attributes each CLIENT once, to the code on their most
-- recent accepted request — last touch. Every purchase lands in exactly one
-- bucket and the revenue column sums to what the coach actually took. The
-- consequence is that `joined` here can be lower than `joined` in
-- my_join_codes() for the same code, and that is the correct disagreement:
-- one counts events, this counts people. The app labels this column "clients"
-- for that reason, and says on screen that attribution is last touch.
--
-- ── Default-code handling, unchanged from my_join_codes() ────────────────
--
-- The default row from `trainers.join_code` carries every client whose code
-- matches no NAMED code — including codes rotated away and pre-56 rows with a
-- null via_code. Dropping those would shrink a coach's history every time they
-- pressed "New Code". The same rule, in the same shape, so the two functions
-- cannot drift into disagreeing about who belongs where.
--
-- ── Currency, which cannot be assumed ─────────────────────────────────────
--
-- `client_purchases` has no currency column; the currency lives on the
-- `trainer_packages` row the purchase points at, and `package_id` is nullable.
-- Adding minor units across two currencies produces a number that is not an
-- amount of anything, so where the purchases behind a code do not agree on one
-- currency, `revenue_cents` is NULL — unknown — rather than a total nobody
-- could spend. NULL there is not zero and the app does not render it as zero.
-- A code with genuinely no purchases returns 0, which is a real figure.
--
-- ── Spend: absent is not zero ─────────────────────────────────────────────
--
-- `coach_code_spend` holds a row only for codes whose cost the coach has
-- written down. No row means UNKNOWN. A row with amount_cents = 0 means the
-- coach has stated this cost nothing — an organic post, a code read out in a
-- class — and that is a different sentence from "we have no idea". Cost per
-- client is computable for the second and not the first, so clearing the field
-- DELETES the row rather than storing a zero.
--
-- auth.uid() throughout, never current_user: under PostgREST every signed-in
-- request runs as the shared `authenticated` role.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.coach_code_spend (
  id           uuid        primary key default gen_random_uuid(),
  trainer_id   uuid        not null references public.trainers(id) on delete cascade,
  -- Null means the coach's DEFAULT code, which has no row in coach_join_codes
  -- — it lives on `trainers.join_code`. Spend recorded against it covers the
  -- same set of clients the default row of my_code_returns() counts, rotated
  -- away codes included, for the same reason: the money was spent on the code
  -- PATH, and rotating does not refund it.
  code_id      uuid        references public.coach_join_codes(id) on delete cascade,
  -- Minor units, matching client_purchases.amount_cents and trainer_packages
  -- .price_cents, so the two sides of the comparison never need converting.
  -- bigint, not integer: an agency-run campaign in a minor-unit currency with
  -- no subdivision worth naming passes 2^31 sooner than anyone expects, and an
  -- overflow here would report a fortune spent as a negative.
  amount_cents bigint      not null check (amount_cents >= 0 and amount_cents < 100000000000),
  currency     text        not null check (currency = upper(btrim(currency)) and length(currency) between 3 and 4),
  updated_at   timestamptz not null default now()
);

comment on table public.coach_code_spend is
  'What a coach says a join code cost them in advertising. The absence of a row means unknown, never zero.';
comment on column public.coach_code_spend.code_id is
  'The named code this spend is against; null means the trainer''s default code.';
comment on column public.coach_code_spend.amount_cents is
  'Minor units, same as client_purchases.amount_cents. Zero is a real answer — "this cost me nothing".';

-- One spend row per named code. The code belongs to exactly one trainer, so
-- the code alone is the key; including trainer_id would let two rows exist for
-- the same code if a future part ever mis-set it, and the coach would be shown
-- whichever one the planner reached first.
create unique index if not exists coach_code_spend_named_uniq
  on public.coach_code_spend (code_id) where code_id is not null;

-- And one for the default code, per trainer. A plain unique (trainer_id,
-- code_id) would NOT do this: in Postgres two nulls are distinct, so a coach
-- could accumulate a dozen "main code" spend rows and the total shown would
-- depend on the read order.
create unique index if not exists coach_code_spend_default_uniq
  on public.coach_code_spend (trainer_id) where code_id is null;

alter table public.coach_code_spend enable row level security;

-- Read your own. Writes go through set_code_spend() below — see part 81's
-- header for why write access to anything join-code shaped is stated as a
-- revoked privilege rather than as a policy nobody wrote.
drop policy if exists coach_code_spend_owner_read on public.coach_code_spend;
create policy coach_code_spend_owner_read on public.coach_code_spend
  for select
  to authenticated
  using (trainer_id = (select auth.uid()));

grant select on public.coach_code_spend to authenticated;
revoke insert, update, delete on public.coach_code_spend from authenticated;
revoke all on public.coach_code_spend from anon;

/**
 * Record — or clear — what a code cost.
 *
 * p_amount_cents null CLEARS the record, deleting the row, because "I do not
 * know what this cost" has to remain expressible after the coach has once
 * typed a number. Storing a zero for it would make an unmeasured campaign look
 * free and give it an infinitely good return.
 *
 * p_currency is optional. Left null it is taken from the coach's own packages,
 * so a coach who has only ever sold in one currency never has to state it and
 * cannot state it wrongly; where they have no packages at all it falls back to
 * their gym's own currency (tenants.currency). It is stored upper case so
 * 'usd' and 'USD' cannot look like two currencies to the comparison below.
 *
 * It does NOT fall back to a literal. Repple is being white-labelled, and a
 * coach in Dubai whose ad spend was quietly recorded in dollars would be shown
 * a return computed by dividing dirhams by dollars — a number that looks like
 * an answer and is not one. Where no currency can be established the write is
 * refused and the coach is asked, which is the same rule the rest of the app
 * follows for a figure nobody has stated.
 *
 * Scoped by trainer_id = auth.uid() inside the function because SECURITY
 * DEFINER bypasses the read policy above: without it any signed-in account
 * could write spend against any coach's code by guessing a uuid.
 *
 * Returns the amount now recorded, or null when the record was cleared.
 */
create or replace function public.set_code_spend(
  p_code_id uuid,
  p_amount_cents bigint,
  p_currency text default null
)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  uid  uuid := auth.uid();
  ccy  text;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  if not exists (select 1 from public.trainers t where t.id = uid) then
    raise exception 'no trainer profile for this account';
  end if;
  -- A named code must be one of theirs. Null is the default code and needs no
  -- check beyond the trainer row above.
  if p_code_id is not null and not exists (
    select 1 from public.coach_join_codes c where c.id = p_code_id and c.trainer_id = uid
  ) then
    raise exception 'that code is not one of yours';
  end if;

  if p_amount_cents is null then
    delete from public.coach_code_spend s
    where s.trainer_id = uid and s.code_id is not distinct from p_code_id;
    return null;
  end if;

  if p_amount_cents < 0 then
    raise exception 'spend cannot be negative';
  end if;
  -- A fat-fingered extra run of zeros is not an amount anybody spent, and it
  -- would drown every other code's cost per client in the comparison.
  if p_amount_cents >= 100000000000 then
    raise exception 'that amount is too large';
  end if;

  ccy := nullif(btrim(upper(coalesce(p_currency, ''))), '');
  if ccy is null then
    select case when count(distinct upper(k.currency)) = 1 then max(upper(k.currency)) end
      into ccy
    from public.trainer_packages k
    where k.trainer_id = uid;
  end if;
  if ccy is null then
    select upper(t.currency) into ccy
      from public.tenants t
      join public.trainers tr on tr.tenant_id = t.id
     where tr.id = uid and t.currency is not null;
  end if;
  if ccy is null then
    raise exception 'no currency set — record the currency for this spend, or set your gym''s currency first'
      using errcode = '22023';
  end if;
  if length(ccy) not between 3 and 4 then
    raise exception 'that is not a currency code';
  end if;

  -- Upsert onto whichever partial index applies. Written as two statements
  -- rather than one ON CONFLICT because the conflict target differs between
  -- the named and the default case, and a single statement naming one of them
  -- would silently insert duplicates in the other.
  --
  -- Two devices saving the same code at once can both find nothing to update
  -- and both insert; the partial index refuses the second, the app is told the
  -- amount was not saved, and the coach sees the figure that WAS. That is the
  -- right way round — the alternative is one of them silently winning.
  update public.coach_code_spend s
     set amount_cents = p_amount_cents, currency = ccy, updated_at = now()
   where s.trainer_id = uid and s.code_id is not distinct from p_code_id;
  if not found then
    insert into public.coach_code_spend (trainer_id, code_id, amount_cents, currency)
    values (uid, p_code_id, p_amount_cents, ccy);
  end if;
  return p_amount_cents;
end; $$;

/**
 * Per code: how many clients it brought, how many are still here, what they
 * have paid, and what the coach says it cost.
 *
 * Same shape as my_join_codes() — the same `me`/`named` CTEs, the same default
 * row from `trainers.join_code`, the same ordering — so the two lists cannot
 * fall out of step about which codes exist or which order they read in. What
 * differs is documented in the header: this one counts PEOPLE, last touch,
 * because it carries money.
 *
 * `active_now` is the count still on the coach's roster — coaching_
 * relationships.status = 'active'. It is the honest denominator for "is this
 * channel bringing people who STAY": a code that brings ten clients who all
 * leave in a month is not the same channel as one that brings four who stay a
 * year, and the joined count alone cannot tell them apart.
 *
 * Purchases are restricted to status = 'paid'. A pending or failed charge is
 * not revenue, and counting it would credit a channel with money that never
 * arrived.
 */
create or replace function public.my_code_returns()
returns table (
  id uuid, code text, label text,
  created_at timestamptz, revoked_at timestamptz, is_default boolean,
  joined bigint, active_now bigint,
  revenue_cents bigint, revenue_currency text,
  spend_cents bigint, spend_currency text
)
language sql security definer stable set search_path = public as $$
  with me as (select auth.uid() as uid),
  named as (
    select c.id, upper(c.code) as code, c.label, c.created_at, c.revoked_at
    from public.coach_join_codes c, me
    where c.trainer_id = me.uid
  ),
  -- The currency this coach sells in, when there is exactly one. Used for a
  -- code with no purchases behind it, where there is no purchase to read a
  -- currency off but zero is still a true revenue figure.
  -- Their packages if they all agree, else their gym's own currency, else
  -- NULL — never a literal. A null here means the revenue figure is a number
  -- with no unit, and the caller renders it as unknown rather than printing it
  -- against a currency nobody chose. Under white-label an invented 'USD' is not
  -- a harmless placeholder: it is the denominator of a return the coach would
  -- act on.
  house as (
    select coalesce(
             (select case when count(distinct upper(k.currency)) = 1 then max(upper(k.currency)) end
                from public.trainer_packages k, me where k.trainer_id = me.uid),
             (select upper(t.currency)
                from public.tenants t
                join public.trainers tr on tr.tenant_id = t.id, me
               where tr.id = me.uid)
           ) as ccy
  ),
  -- One row per client: the code on their MOST RECENT accepted request. See
  -- the header — counting requests instead would double-count anybody who left
  -- and came back, and double-count their money with them.
  touch as (
    select distinct on (q.client_id)
           q.client_id, upper(btrim(q.via_code)) as via
    from public.coach_requests q, me
    where q.trainer_id = me.uid and q.source = 'code' and q.status = 'accepted'
    order by q.client_id, coalesce(q.responded_at, q.created_at) desc, q.created_at desc
  ),
  -- Client → bucket. A left join onto `named` puts a client whose code matches
  -- no named code into the null bucket, which is exactly the default row's
  -- membership rule in my_join_codes(): rotated-away codes and null via_codes
  -- included.
  attributed as (
    select t.client_id, n.id as code_id
    from touch t left join named n on n.code = t.via
  ),
  mine as (
    select a.code_id, count(*)::bigint as clients
    from attributed a group by a.code_id
  ),
  live as (
    select a.code_id, count(*)::bigint as still
    from attributed a
    join public.coaching_relationships r
      on r.client_id = a.client_id and r.status = 'active'
    join me on r.coach_id = me.uid
    group by a.code_id
  ),
  took as (
    select a.code_id,
           sum(p.amount_cents)::bigint as cents,
           -- Why this cannot just be the sum. `client_purchases.amount_cents`
           -- is nullable and carries no currency of its own — the currency is
           -- on the package it points at, and `package_id` is nullable too.
           -- sum() skips nulls, so a code whose purchases are all unreadable
           -- would total to zero and read as clients who paid nothing. The
           -- counts below are what let the row say "unknown" instead.
           --
           -- `buys` is never null for a group that exists, so it — and NOT
           -- code_id, which is legitimately null for the default bucket — is
           -- what tells "this code has no purchases" from "this row did not
           -- join". Using code_id here reported every coach's main code as
           -- having earned nothing.
           count(*) as buys,
           count(*) filter (where p.amount_cents is null) as no_amount,
           count(*) filter (where k.currency is null) as no_ccy,
           min(upper(k.currency)) as lo,
           max(upper(k.currency)) as hi
    from attributed a
    join public.client_purchases p on p.client_id = a.client_id and p.status = 'paid'
    join me on p.trainer_id = me.uid
    left join public.trainer_packages k on k.id = p.package_id
    group by a.code_id
  ),
  spent as (
    select s.code_id, s.amount_cents, upper(s.currency) as currency
    from public.coach_code_spend s, me
    where s.trainer_id = me.uid
  )
  -- Every column reference below is qualified, deliberately. The RETURNS TABLE
  -- columns are OUT parameters and are in scope inside this body, so a bare
  -- `code`, `label` or `joined` here is ambiguous and the function fails to run
  -- at all — see my_join_codes() in part 81, which learned this first.
  select * from (
    select n.id, n.code, n.label, n.created_at, n.revoked_at, false as is_default,
           coalesce(mine.clients, 0) as clients, coalesce(live.still, 0) as still,
           -- No purchases at all is a real zero. Purchases that cannot be
           -- summed honestly — a missing amount, a missing currency, or two
           -- currencies in one bucket — are NULL, because a sum across
           -- currencies is not an amount of money and a sum that silently
           -- skipped its unreadable rows is not a total.
           case when took.buys is null then 0
                when took.no_amount > 0 or took.no_ccy > 0 or took.lo is distinct from took.hi then null
                else took.cents end as took_cents,
           case when took.buys is null then house.ccy
                when took.no_amount > 0 or took.no_ccy > 0 or took.lo is distinct from took.hi then null
                else took.lo end as took_ccy,
           spent.amount_cents as spent_cents, spent.currency as spent_ccy
    from named n
    cross join house
    left join mine on mine.code_id = n.id
    left join live on live.code_id = n.id
    left join took on took.code_id = n.id
    left join spent on spent.code_id = n.id
    union all
    select null::uuid, t.join_code, 'Your main code', null::timestamptz, null::timestamptz, true,
           coalesce(dmine.clients, 0), coalesce(dlive.still, 0),
           case when dtook.buys is null then 0
                when dtook.no_amount > 0 or dtook.no_ccy > 0 or dtook.lo is distinct from dtook.hi then null
                else dtook.cents end,
           case when dtook.buys is null then house.ccy
                when dtook.no_amount > 0 or dtook.no_ccy > 0 or dtook.lo is distinct from dtook.hi then null
                else dtook.lo end,
           dspent.amount_cents, dspent.currency
    from public.trainers t, me, house
    -- `is null` rather than `= null`: the default bucket's key IS null, and an
    -- equality test against null is null rather than true, so an equality join
    -- would match nothing and report every coach's main code as having brought
    -- in nobody. Each of these matches at most one row — mine, live and took
    -- are grouped by code_id, and the partial index above allows one default
    -- spend row per coach.
    left join mine  dmine  on dmine.code_id  is null
    left join live  dlive  on dlive.code_id  is null
    left join took  dtook  on dtook.code_id  is null
    left join spent dspent on dspent.code_id is null
    where t.id = me.uid and t.join_code is not null
  ) all_codes
  order by all_codes.is_default desc, (all_codes.revoked_at is not null), all_codes.created_at desc nulls first;
$$;

revoke all on function public.my_code_returns() from public, anon;
revoke all on function public.set_code_spend(uuid, bigint, text) from public, anon;
grant execute on function public.my_code_returns() to authenticated;
grant execute on function public.set_code_spend(uuid, bigint, text) to authenticated;

comment on function public.my_code_returns is
  'Per join code for the signed-in coach: clients (last touch, one per person), how many are still active, revenue in minor units, and recorded ad spend. Null revenue means the currencies did not agree; null spend means none was recorded.';
comment on function public.set_code_spend is
  'Records what a join code cost in advertising. A null amount clears the record — unknown, which is not zero.';
