-- ═══════════════════════════════════════════════════════════════════════════
-- The spend recorded against a gym the coach had left.
--
-- Part 941 fixed this chain in `issue_coach_invoice()`. Parts 1060–1062 swept
-- the policies, the helper and the two writable `tenant_id` columns. Neither
-- swept a SECURITY DEFINER FUNCTION BODY, and the join-code returns feature has
-- the same wrong column in two of them — the one that WRITES the figure and the
-- one that READS it back.
--
-- ── WHAT IS WRONG ────────────────────────────────────────────────────────
--
-- `revoke_staff_role()` (part 711) takes a coach off a gym's staff by clearing
-- `profiles.tenant_id`, and KEEPS the `trainers` row deliberately — deleting it
-- would set `clients.trainer_id` null underneath the history and strand every
-- per-coach figure that joins on it. `trainers.tenant_id` is NOT NULL, so it
-- goes on naming the gym the coach has left, for ever. One coach, two answers
-- to "which gym are you at".
--
-- `set_code_spend()` resolves the currency of a recorded ad spend in two steps:
-- the coach's own packages when they unanimously agree, then the gym. The gym
-- link is
--
--     from public.tenants t
--     join public.trainers tr on tr.tenant_id = t.id
--    where tr.id = uid
--
-- and that is the column part 941 established is the wrong one. `my_code_returns()`
-- carries a byte-for-byte copy of the same join in its `house` CTE, which is
-- what supplies `revenue_currency` when a code's purchases cannot be totalled
-- from the packages themselves.
--
-- ── WHAT IT COSTS ────────────────────────────────────────────────────────
--
-- This is not a capability — there is no id to supply and nothing here that
-- another account can reach. Both functions are scoped to `auth.uid()` at every
-- statement, and that scoping is correct. It is the third question this sweep
-- asks: which gym does the body believe the caller is at.
--
-- A coach who has left a gym and has no packages with a unanimous currency gets
-- their advertising spend stamped with their old gym's currency, and the
-- returns screen prices their revenue in it too. The two figures then agree
-- with each other and are both wrong, which is the worst available outcome:
-- src/lib/coachChannels.ts and codeReturn.ts go to real trouble to render
-- "unknown" rather than assert a unit nobody chose — a code whose purchases
-- disagree about currency deliberately reports null — and this chain hands them
-- a confident wrong answer instead of the null they are built to display.
--
-- What the screen is FOR is cost per acquisition: money spent against money
-- taken. Denominating either side in a currency the coach does not trade in
-- makes that ratio meaningless while looking entirely normal.
--
-- MEMORY on this project is explicit that white-label means per-tenant currency
-- and that no default may be assumed anywhere. A currency inherited from a gym
-- the coach has left is exactly the assumed default that rule exists to stop.
--
-- ── HONESTLY: THIS IS LATENT TODAY ───────────────────────────────────────
--
-- Established by probing the live project read-only before writing this file:
--
--     coaches with profiles.tenant_id null but trainers.tenant_id set  → none
--     listed coaches whose two tenant columns disagree                 → none
--
-- Nobody has been through `revoke_staff_role()` yet, so no coach currently has
-- the two answers, and this part changes no figure that anybody can see today.
-- It is written anyway for the reason part 1060 gives: the divergence is
-- created by a function that exists and is reachable, the fix is three lines
-- against a chain already agreed in part 941, and a latent wrong currency is
-- cheaper to close now than to find later in somebody's cost-per-acquisition.
--
-- ── WHY THE FIX IS SHAPED THIS WAY ───────────────────────────────────────
--
-- The chain becomes part 941's, exactly, so that all three places that resolve
-- a coach's currency agree:
--
--   1 · what the caller stated.                    (set_code_spend only)
--   2 · the coach's own packages, unanimous. Unchanged.
--   3 · the gym on `profiles.tenant_id`.         ← was trainers.tenant_id
--   4 · `trainers.currency` (part 940), and ONLY when there is no gym.  ← new
--
-- Link 4 is guarded on "no gym" rather than on "nothing has answered yet", and
-- that guard is part 940's precedence rule rather than a convenience. A coach
-- who IS inside a gym whose owner has not yet chosen a currency must keep
-- getting nothing: answering them from their own dormant column would price
-- their advertising in one currency while their packages charge in another,
-- and they are legitimately waiting on their owner.
--
-- In `my_code_returns()` link 4 is written as a scalar subquery that joins
-- `profiles` and requires `pr.tenant_id is null`, so it is self-guarding inside
-- the `coalesce` and needs no procedural branch — the same rule as link 4 in
-- `set_code_spend`, expressed in the form the surrounding CTE is written in.
--
-- Both bodies are `pg_get_functiondef` taken verbatim from the live project on
-- 3 Sep 2026 with only the currency chain replaced and comments added at it.
-- In `set_code_spend` every refusal, the code-ownership test, the delete branch
-- and the two-statement upsert are untouched; in `my_code_returns` every other
-- CTE, both arms of the union and the whole ordering are untouched. The
-- signatures and RETURNS TABLE column lists are character-for-character the
-- live ones — an overload is PostgREST refusing the call outright, which is
-- what part 188 had to undo.
--
-- ── WHAT THIS CHANGES FOR SCREENS THAT EXIST ─────────────────────────────
--
-- Established by reading the callers: src/ui/joinCode.ts:109 calls
-- `set_code_spend` and :84 calls `my_code_returns`, and those are the only two
-- call sites in the repository. For every coach whose `profiles.tenant_id` and
-- `trainers.tenant_id` agree — which the probe above says is all of them — the
-- chain returns exactly what it returns now, because link 3 reads the same gym
-- through a different column and link 4 cannot fire while a gym is present.
--
-- Idempotent and safe to re-run: `create or replace function` replaces a body
-- in place. This file reads no rows and writes no data; it does not rewrite any
-- currency already recorded on `coach_code_spend`, because a figure the coach
-- entered under a stated unit is a fact about what they did, not a cache.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.set_code_spend(p_code_id uuid, p_amount_cents bigint, p_currency text default null::text)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uid  uuid := auth.uid();
  ccy  text;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  if p_code_id is not null and not exists (
    select 1 from public.coach_join_codes c where c.id = p_code_id and c.trainer_id = uid
  ) then
    raise exception 'that is not your code';
  end if;

  if p_amount_cents is null then
    delete from public.coach_code_spend s
     where s.trainer_id = uid and s.code_id is not distinct from p_code_id;
    return null;
  end if;

  -- 1 · what the caller stated.
  ccy := nullif(btrim(upper(coalesce(p_currency, ''))), '');

  -- 2 · the coach's own packages, unanimous or nothing. Unchanged.
  if ccy is null then
    select case when count(distinct upper(k.currency)) = 1 then max(upper(k.currency)) end
      into ccy
    from public.trainer_packages k
    where k.trainer_id = uid;
  end if;

  -- 3 · the gym, read from `profiles.tenant_id`. Was `trainers.tenant_id`,
  --     which part 711 deliberately leaves pointing at a gym the coach has
  --     LEFT — so a departed coach's advertising spend was denominated in that
  --     gym's currency while every other screen showed them a dash. Part 941
  --     made this same correction in `issue_coach_invoice()`.
  if ccy is null then
    select upper(btrim(t.currency)) into ccy
      from public.profiles pr
      join public.tenants t on t.id = pr.tenant_id
     where pr.id = uid and t.currency is not null and btrim(t.currency) <> '';
  end if;

  -- 4 · the coach's own currency (part 940), AND ONLY WHEN THERE IS NO GYM.
  --     Guarded on `tenant_id is null` rather than on `ccy is still null`: a
  --     coach who IS in a gym whose owner has not chosen must not be answered
  --     from their own dormant column, or their advertising would be priced in
  --     one currency while their packages charge in another.
  if ccy is null and exists (
    select 1 from public.profiles pr where pr.id = uid and pr.tenant_id is null
  ) then
    select upper(btrim(tr.currency)) into ccy
      from public.trainers tr
     where tr.id = uid and tr.currency is not null and btrim(tr.currency) <> '';
  end if;

  if ccy is null then
    raise exception 'no currency set - record the currency for this spend, or set your gym currency first'
      using errcode = '22023';
  end if;
  if length(ccy) not between 3 and 4 then
    raise exception 'that is not a currency code';
  end if;

  -- Two statements rather than one ON CONFLICT: the conflict target differs
  -- between the named and default case, and a single statement naming one of
  -- them would silently insert duplicates in the other.
  update public.coach_code_spend s
     set amount_cents = p_amount_cents, currency = ccy, updated_at = now()
   where s.trainer_id = uid and s.code_id is not distinct from p_code_id;
  if not found then
    insert into public.coach_code_spend (trainer_id, code_id, amount_cents, currency)
    values (uid, p_code_id, p_amount_cents, ccy);
  end if;
  return p_amount_cents;
end; $function$;

create or replace function public.my_code_returns()
returns table(id uuid, code text, label text, created_at timestamp with time zone, revoked_at timestamp with time zone, is_default boolean, joined bigint, active_now bigint, revenue_cents bigint, revenue_currency text, spend_cents bigint, spend_currency text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with me as (select auth.uid() as uid),
  named as (
    select c.id, upper(c.code) as code, c.label, c.created_at, c.revoked_at
    from public.coach_join_codes c, me
    where c.trainer_id = me.uid
  ),
  -- Their packages if those agree, else their gym's currency, else their own
  -- currency when they have no gym, else NULL — never a literal. A null means
  -- the revenue figure is a number with no unit, and the caller renders it
  -- unknown rather than against a currency nobody chose.
  --
  -- The gym link reads `profiles.tenant_id`. It was `trainers.tenant_id`, which
  -- part 711 leaves naming a gym the coach has LEFT — see this part's header,
  -- and part 941, which made the same correction in `issue_coach_invoice()`.
  -- The third arm is part 940's `trainers.currency`, and it carries its own
  -- `pr.tenant_id is null` test so that it can only answer a coach who has no
  -- gym at all: a coach inside a gym whose owner has not chosen keeps getting
  -- null, because they are waiting on their owner rather than on themselves.
  house as (
    select coalesce(
             (select case when count(distinct upper(k.currency)) = 1 then max(upper(k.currency)) end
                from public.trainer_packages k, me where k.trainer_id = me.uid),
             (select upper(btrim(t.currency))
                from public.profiles pr
                join public.tenants t on t.id = pr.tenant_id, me
               where pr.id = me.uid and t.currency is not null and btrim(t.currency) <> ''),
             (select upper(btrim(tr.currency))
                from public.trainers tr
                join public.profiles pr on pr.id = tr.id, me
               where tr.id = me.uid and pr.tenant_id is null
                 and tr.currency is not null and btrim(tr.currency) <> '')
           ) as ccy
  ),
  -- One row per CLIENT: the code on their most recent accepted request.
  -- Counting requests instead would double-count anybody who left and came
  -- back, and double-count their money with them.
  touch as (
    select distinct on (q.client_id)
           q.client_id, upper(btrim(q.via_code)) as via
    from public.coach_requests q, me
    where q.trainer_id = me.uid and q.source = 'code' and q.status = 'accepted'
    order by q.client_id, coalesce(q.responded_at, q.created_at) desc, q.created_at desc
  ),
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
           -- amount_cents is nullable and carries no currency of its own, and
           -- package_id is nullable too. sum() skips nulls, so a code whose
           -- purchases are all unreadable would total to zero and read as
           -- clients who paid nothing. These counts are what let the row say
           -- "unknown" instead. `buys` — not code_id, which is legitimately
           -- null for the default bucket — distinguishes "no purchases" from
           -- "did not join".
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
  -- Every column reference qualified: the RETURNS TABLE columns are OUT
  -- parameters in scope here, so a bare `code` or `joined` is ambiguous and the
  -- function fails to run at all.
  select * from (
    select n.id, n.code, n.label, n.created_at, n.revoked_at, false as is_default,
           coalesce(mine.clients, 0) as clients, coalesce(live.still, 0) as still,
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
    -- in nobody.
    left join mine  dmine  on dmine.code_id  is null
    left join live  dlive  on dlive.code_id  is null
    left join took  dtook  on dtook.code_id  is null
    left join spent dspent on dspent.code_id is null
    where t.id = me.uid and t.join_code is not null
  ) all_codes
  order by all_codes.is_default desc, (all_codes.revoked_at is not null), all_codes.created_at desc nulls first;
$function$;
