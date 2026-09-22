-- ── An owner with two gyms could see the second one's name and nothing else ──
--
-- ROADMAP #4, and #5 with it. Both rows were partly wrong, which is worth
-- saying before the code, because the correction is most of the design.
--
-- #5 said per-site staff, timetables and pricing were "not modelled". They are
-- modelled, and have been since part 290 decided that A SITE IS A TENANT:
-- `trainers`, `gym_classes`, `sessions` and `profiles` all carry `tenant_id`,
-- and session fee, currency, pay policy and invoice numbering all live on
-- `tenants`. Per-site staff and pricing exist by construction. Nothing to build.
--
-- #4 said no cross-site aggregate exists anywhere. The ARITHMETIC exists:
-- src/lib/siteRollUp.ts is 629 tested lines about how a figure over several
-- gyms lies — currencies that cannot be added, zones whose "this month" are
-- different months, gyms that contributed nothing and the four distinct reasons
-- why. What it has never had is a caller, because nothing could supply it any
-- numbers.
--
-- So both rows reduce to ONE missing capability: an owner recorded against two
-- gyms can read exactly one of them. This part supplies the other one's
-- figures, and only its figures.
--
-- ── This is the invariant part 290 wrote down, being broken on purpose ──────
--
-- Part 290 §3 says, and means:
--
--     No policy anywhere reads `owner_sites` ... `grep -n owner_sites
--     supabase/setup.sql` should show this file and nothing else.
--
-- After this part that grep shows two files. That is a deliberate change and it
-- deserves the argument rather than a shrug:
--
--   · It is not a POLICY. No RLS anywhere gained a second arm, `is_owner_of`
--     is untouched, and every existing screen still reads exactly one tenant.
--     Widening `is_owner_of` to span sites was the obvious alternative and it
--     is the wrong one: it would silently make every existing query on every
--     screen cover both gyms — the payroll run, the month close, the till,
--     the class fill rate — and produce the figure that covers two places that
--     part 290 and `ownedSites.branchSpan` both exist to prevent. One function
--     that returns figures BY SITE cannot do that, because the site is on
--     every row it returns.
--
--   · It returns AGGREGATES ONLY. Counts and sums, per site. No member, no
--     session, no payment row crosses a tenant boundary; there is no id here
--     that names a person. This widens what an owner may COUNT about their own
--     second gym, not what they may SEE in it. Reading the other gym's members
--     still requires being scoped to it.
--
--   · The membership it trusts is the one no authenticated account can write.
--     `owner_sites` has a SELECT policy and no INSERT, UPDATE or DELETE policy
--     at all, so a row gets there through the service role and a human being.
--     That property is what makes it safe to read here, and it is why this
--     function reads that table rather than accepting a tenant id as an
--     argument and checking it.
--
-- ── The figures are the ones already on the screens ────────────────────────
--
-- Nothing here invents a measure. Each is the definition some screen in the
-- console already uses, so a roll-up line and the gym's own page cannot
-- disagree:
--
--   active members  `memberships` in status 'active'      (the members screen)
--   coaches         `trainers` rows for the tenant        (the roster)
--   taken           `gym_payments.amount_cents`, summed   (the till)
--
-- `taken` carries its currencies as an ARRAY rather than one code, which is
-- part 2540's rule arriving one level up: a month's `taken_cents` is labelled
-- only when the rows agreed on a currency, and NULL when they did not, because
-- a figure priced in a currency its rows never stated is a wrong number wearing
-- a right one. src/lib/siteRollUp.ts `denominate()` is the consumer and it
-- refuses a total across codes; handing it the codes is what lets it.
--
-- Corrections are negative `gym_payments` rows (console money screen), so a sum
-- is the right operator and no filter on sign belongs here.
--
-- ── Nullable, and never defaulted ──────────────────────────────────────────
--
-- `currency` and `timezone` come straight off `tenants` and are returned NULL
-- when the gym has not said. Part 150 removed the `'AED'` default from every
-- currency column in this schema for the reason this repository says most
-- often: a figure the reader believes is priced, that is priced by a guess, is
-- worse than one that admits it does not know. The same applies to the zone —
-- a NULL zone is not UTC and is not the reader's own, and siteRollUp's
-- `zoneSpan` is what decides whether a period may be presented as one period.
create or replace function public.owner_site_figures(
  since timestamptz default null,
  until timestamptz default null
)
returns table (
  site_id          uuid,
  name             text,
  currency         text,
  timezone         text,
  active_members   integer,
  coaches          integer,
  taken_cents      bigint,
  taken_currencies text[],
  taken_unstated   boolean
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with mine as (
    -- The gym this session is scoped to, when this account is an owner at all.
    -- Spelled out rather than calling `is_owner_of`, for the reason my_sites()
    -- gives: that function takes the tenant as an argument and the question
    -- here is which tenants there are.
    select p.tenant_id as tenant_id
      from public.profiles p
     where p.id = auth.uid() and p.role = 'owner' and p.tenant_id is not null
    union
    -- Every gym a human being has recorded this account against.
    select os.tenant_id
      from public.owner_sites os
     where os.user_id = auth.uid()
  )
  select
    m.tenant_id,
    t.name,
    t.currency,
    t.timezone,
    (select count(*)::integer from public.memberships ms
      where ms.tenant_id = m.tenant_id and ms.status = 'active'),
    (select count(*)::integer from public.trainers tr
      where tr.tenant_id = m.tenant_id),
    -- NULL rather than 0 when the window holds no rows: a till nobody rang up
    -- and a till that took nothing are the same number and different facts, and
    -- siteRollUp's `gapOf` tells them apart only if this is null.
    (select sum(gp.amount_cents)::bigint from public.gym_payments gp
      where gp.tenant_id = m.tenant_id
        and (since is null or gp.created_at >= since)
        and (until is null or gp.created_at <  until)),
    -- The codes the rows actually stated, de-duplicated, so the consumer can
    -- refuse a total across two of them rather than being handed one.
    (select coalesce(array_agg(distinct gp.currency) filter (where gp.currency is not null and btrim(gp.currency) <> ''), '{}')
       from public.gym_payments gp
      where gp.tenant_id = m.tenant_id
        and (since is null or gp.created_at >= since)
        and (until is null or gp.created_at <  until)),
    -- Whether any row in the window declined to say. The column is NOT NULL
    -- today (part 150 dropped its default, not its constraint), so this is
    -- false in practice — it is carried because a blank is not a currency and
    -- the consumer must not have to assume which of those two it is looking at.
    (select coalesce(bool_or(gp.currency is null or btrim(gp.currency) = ''), false)
       from public.gym_payments gp
      where gp.tenant_id = m.tenant_id
        and (since is null or gp.created_at >= since)
        and (until is null or gp.created_at <  until))
  from mine m
  left join public.tenants t on t.id = m.tenant_id;
$function$;

-- A SECURITY DEFINER function is granted to PUBLIC on creation, and PUBLIC
-- includes `anon`. Every definer function in this schema is revoked and then
-- granted narrowly for that reason; an unauthenticated caller here would get
-- an empty set because `auth.uid()` is null, but "it happens to return nothing"
-- is not an access rule.
revoke all on function public.owner_site_figures(timestamptz, timestamptz) from public, anon;
grant  execute on function public.owner_site_figures(timestamptz, timestamptz) to authenticated;

comment on function public.owner_site_figures(timestamptz, timestamptz) is
  'One row of figures per gym this account is recorded as owning — active members, coaches, and money taken in the window — for the multi-site roll-up. AGGREGATES ONLY and deliberately: it widens what an owner may count about their second gym, never what they may see in it, and no row it returns names a person. It is the one thing outside supabase/parts/290 that reads owner_sites, which that part''s section 3 asks to be checked; the argument for the exception is at the top of supabase/parts/2614. Currency and timezone are whatever the gym stated and NULL when it stated nothing — never defaulted. Consumed by src/lib/siteRollUp.ts, which decides what may and may not be added up.';
