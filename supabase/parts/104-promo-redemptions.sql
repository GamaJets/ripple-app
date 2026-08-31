-- ── A promo code you can actually tell the result of ───────────────────────
--
-- `promos` has existed since part 02 and nothing has ever read or written it.
-- The Growth screen's codes lived in `useState` in src/ui/promos.tsx: create
-- one, close the app, it is gone. The header comment said "Swap for a Supabase
-- promo_codes table in the migration" and the migration never came.
--
-- The table also carries `redemptions int default 0`, which is the wrong shape
-- twice over. A counter cannot say WHO used a code or WHEN, which is the only
-- reason an owner runs one — and a counter maintained by
-- `update … set redemptions = redemptions + 1` loses writes under concurrency,
-- which this codebase has a standing rule against. It is left in place and
-- unused rather than dropped, because dropping a column is not reversible and
-- nothing reads it; the count below is derived from rows.
create table if not exists public.promo_redemptions (
  id uuid primary key default gen_random_uuid(),
  promo_id uuid not null references public.promos(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  redeemed_at timestamptz not null default now()
);

-- One person, one code, once. The redeem function checks this too and returns a
-- civil answer; the index is what makes the check true when somebody taps twice
-- or runs two devices.
create unique index if not exists promo_redeemed_once
  on public.promo_redemptions (promo_id, member_id);

create index if not exists promo_redemptions_promo_idx
  on public.promo_redemptions (promo_id, redeemed_at desc);

alter table public.promo_redemptions enable row level security;

-- The owner of the gym that runs the code sees every redemption of it. That is
-- the whole point of the feature, and it is scoped through the promo's tenant
-- rather than through the member, so an owner cannot read redemptions of
-- somebody else's codes.
drop policy if exists promo_red_owner_read on public.promo_redemptions;
create policy promo_red_owner_read on public.promo_redemptions
  for select using (
    exists (
      select 1 from public.promos p
       where p.id = promo_redemptions.promo_id
         and public.is_owner_of(p.tenant_id)
    )
  );

-- A member sees their own. They are entitled to know what they have used, and
-- it is what stops the app telling them a code is new when they have had it.
drop policy if exists promo_red_member_read on public.promo_redemptions;
create policy promo_red_member_read on public.promo_redemptions
  for select using (member_id = (select auth.uid()));

-- No INSERT policy, deliberately. Redemption goes through `redeem_promo`
-- below, which is SECURITY DEFINER: a member who could insert directly could
-- redeem a code they were never given, or one belonging to another gym, simply
-- by knowing its id. The function is the only door and it checks the tenant.
grant select on public.promo_redemptions to authenticated;


-- ── Redeeming one ──────────────────────────────────────────────────────────
--
-- SECURITY DEFINER because the member must NOT be able to read `promos`. A
-- select grant there would hand every member the gym's whole list of codes and
-- discounts, including the ones aimed at people who have not joined yet.
--
-- So the member sends a code and gets back only the answer about that code.
-- A wrong code and an inactive code are told apart for the member's sake, but
-- neither reveals anything about codes they did not name.
create or replace function public.redeem_promo(p_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_promo public.promos%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'signed-out');
  end if;

  select tenant_id into v_tenant from public.profiles where id = v_uid;
  if v_tenant is null then
    return jsonb_build_object('ok', false, 'reason', 'no-gym');
  end if;

  -- Case and surrounding space are the member's typing, not their mistake.
  select * into v_promo
    from public.promos
   where tenant_id = v_tenant
     and upper(btrim(code)) = upper(btrim(p_code))
   limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no-such-code');
  end if;
  if not coalesce(v_promo.active, false) then
    return jsonb_build_object('ok', false, 'reason', 'inactive');
  end if;

  begin
    insert into public.promo_redemptions (promo_id, member_id)
    values (v_promo.id, v_uid);
  exception when unique_violation then
    -- Not an error to the person holding the phone: they already have it.
    return jsonb_build_object('ok', false, 'reason', 'already',
                              'code', v_promo.code, 'discount', v_promo.discount);
  end;

  return jsonb_build_object('ok', true, 'code', v_promo.code, 'discount', v_promo.discount);
end $fn$;

revoke all on function public.redeem_promo(text) from public;
grant execute on function public.redeem_promo(text) to authenticated;


-- ── What THIS member has redeemed ──────────────────────────────────────────
--
-- SECURITY DEFINER for the same reason `redeem_promo` is: a member must not
-- hold a select grant on `promos`, or they can read the gym's whole list of
-- codes — including the ones aimed at people who have not joined yet. This
-- joins on their behalf and returns only rows they redeemed themselves.
create or replace function public.my_promo_redemptions()
returns table (code text, discount int, redeemed_at timestamptz)
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select p.code, p.discount, r.redeemed_at
    from public.promo_redemptions r
    join public.promos p on p.id = r.promo_id
   where r.member_id = auth.uid()
   order by r.redeemed_at desc
   limit 200;
$fn$;

revoke all on function public.my_promo_redemptions() from public;
grant execute on function public.my_promo_redemptions() to authenticated;
