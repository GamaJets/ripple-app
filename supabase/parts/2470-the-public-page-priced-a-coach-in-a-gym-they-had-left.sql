-- ═══════════════════════════════════════════════════════════════════════════
-- The public page priced a coach in the currency of a gym they had left
-- ═══════════════════════════════════════════════════════════════════════════
-- APPLIED. Verified after: `listed_trainer_currencies` over the two listed
-- coaches returns AED for both — identical to the answer before, so this is a
-- no-op for every row that exists today and bites only in the two cases it
-- fixes. The anon-executable SECURITY DEFINER set is still exactly
-- leave_my_details and public_coach_page.
--
--
-- NOT APPLIED. Written to be applied by hand. Every fact below was read out of
-- the live database on 5 Sep 2026 with pg_proc, pg_policies, pg_namespace and
-- information_schema — not out of the parts.
--
-- ── What a person suffers ─────────────────────────────────────────────────
--
-- Two outward-facing reads still denominate a coach's session fee by joining
-- `trainers.tenant_id` to `tenants.currency`. Part 941 has already written down,
-- at length, why that is the wrong column:
--
--     `revoke_staff_role()` (part 711) clears `profiles.tenant_id` and
--     DELIBERATELY KEEPS the `trainers` row, still pointing at the gym the
--     coach has left.
--
-- So for a coach who has gone independent, both reads answer with the currency
-- of a gym they no longer belong to. And for a coach who has set a currency of
-- their own through `set_my_coach_currency()` — which is the entire reason part
-- 940 added `trainers.currency` — both reads answer NULL, because they never
-- look at that column at all.
--
-- The two reads, and what each one does with the wrong answer:
--
--   1 · `public_coach_page(text)` — the anon-callable read behind
--       /coach?h=<handle>. web/coach.html:657-666 prints the fee only when the
--       currency is a three-letter code, so:
--         · departed coach  → "£60 a session" published to the open web when
--           the coach charges 60 AED. Wrong money, on a page whose whole job is
--           to tell a stranger what this coach costs.
--         · independent coach → the fee vanishes from the page entirely. The
--           one number they set in order to publish it is silently withheld,
--           and nothing on the page says why.
--
--   2 · `listed_trainer_currencies(uuid[])` — the in-app Find a Trainer
--       directory, app/(client)/trainers.tsx:624. `feeMoney()` there is
--       `wholeMoney(fee, ccy)`, which returns null without a currency, and
--       `feeGap()` then prints "this coach has not said what they charge in" —
--       about a coach who has said exactly that, in Settings, and can see it
--       there.
--
-- Both are the same defect part 941 fixed in `issue_coach_invoice()` and part
-- 940's own follow-up fixed in `set_code_spend()`. Those two now resolve a
-- coach's currency correctly; these two were never revisited.
--
-- ── Measured, so nobody reads more into this than is there ────────────────
--
-- Counted live on 5 Sep 2026:
--
--     listed trainers                                    2
--     trainers with public_page = true                   0
--     trainers.currency set on any row                   0
--     profiles.tenant_id null while trainers.tenant_id set   0
--
-- NOBODY IS AFFECTED TODAY. This is a hole rather than a queue: it opens the
-- first time a gym uses the staff screen the product already ships, or the
-- first time an independent coach uses the currency picker part 940 built for
-- them. Both routes are in the shipped app.
--
-- ── The order, and why it is this one rather than part 941's ─────────────
--
-- Part 941's chain has four steps because it writes a currency onto a DOCUMENT
-- and may be called without one being stated. These two reads are neither: they
-- publish what the coach's own app already shows them under "Priced in …". So
-- the order here is `resolveMyCurrency()` in src/lib/currencySource.ts, which is
-- that screen, and it has two steps:
--
--   1 · the gym, read from `profiles.tenant_id` — the column that says which
--       gym somebody is in, and the column `myTenantCurrency()` reads.
--   2 · `trainers.currency` (part 940), AND ONLY WHEN THERE IS NO GYM.
--       Guarded on `tenant_id is null` rather than on "still null", for part
--       941's reason: a coach who IS in a gym whose owner has not set a
--       currency must not be answered from their own dormant column. They are
--       waiting on their owner, and a dash is the honest answer.
--
-- Deliberately NOT included: part 941's step 2, the coach's own packages. A
-- session fee is a `trainers` column and not a package, and adding a third
-- ordering here would put the public page at odds with the coach's own Settings
-- screen — which is the "one coach, two answers" failure this is fixing.
--
-- ── The anon surface does not widen ───────────────────────────────────────
--
-- `public_coach_page` is one of exactly two anon-executable SECURITY DEFINER
-- functions and it stays that way. Verified live before writing this: the set
-- is {leave_my_details, public_coach_page} and nothing else in `public` carries
-- EXECUTE for anon or for PUBLIC.
--
-- Its RETURNS TABLE is unchanged, column for column. The new read of
-- `public.profiles` happens INSIDE the definer body and only a three-letter
-- code comes back out of it — no tenant id, no profile row, no new column
-- travels to an unauthenticated caller. `listed_trainer_currencies` likewise
-- still returns exactly (trainer_id, currency), which is the whole reason it
-- exists rather than a policy on `tenants` (see app/(client)/trainers.tsx:619
-- and part 131).
--
-- Both functions already exist, so `create or replace` preserves their ACLs
-- rather than handing EXECUTE to PUBLIC. The grants are restated below anyway,
-- with the revoke first, because a grant that is only implied is a grant nobody
-- can check. Run `get_advisors` after applying.
--
-- Idempotent; safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════
-- 1 · The public page  [anon entry point]
-- ═════════════════════════════════════════════════════════════════════════
--
-- Supersedes the definition in part 340. Everything except the currency
-- expression is carried over unchanged and verbatim: the `listed = true` AND
-- `public_page = true` gate, the self-declared-and-unexpired credential filter,
-- the withdrawn-review exclusion, and a review aggregate that is a count and a
-- sum and never a name or a body.

create or replace function public.public_coach_page(p_handle text)
returns table (
  display_name text,
  brand_color  text,
  tagline      text,
  bio          text,
  specialties  text[],
  offers       text[],
  session_fee  numeric,
  currency     text,
  join_code    text,
  rating_count integer,
  rating_sum   integer,
  credentials  jsonb
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select
    coalesce(nullif(btrim(coalesce(t.brand_name, '')), ''),
             nullif(btrim(coalesce(p.full_name,  '')), '')),
    t.brand_color,
    nullif(btrim(coalesce(t.tagline, '')), ''),
    nullif(btrim(coalesce(t.bio, '')), ''),
    t.specialties,
    t.offers,
    case when t.session_fee is not null and t.session_fee > 0 then t.session_fee end,
    cc.currency,
    nullif(btrim(coalesce(t.join_code, '')), ''),
    coalesce(r.n, 0),
    coalesce(r.s, 0),
    coalesce(c.items, '[]'::jsonb)
  from public.trainers t
  left join public.profiles p  on p.id  = t.id
  -- The coach's currency, in the order src/lib/currencySource.ts shows them.
  -- `profiles.tenant_id`, NOT `trainers.tenant_id` — part 711 leaves the latter
  -- pointing at a gym the coach has left, and part 941 is the same correction
  -- made in `issue_coach_invoice()`.
  left join lateral (
    select nullif(upper(btrim(coalesce(
             case when pr.tenant_id is not null
                  then (select tn.currency from public.tenants tn where tn.id = pr.tenant_id)
                  else t.currency
             end, ''))), '') as currency
      from public.profiles pr
     where pr.id = t.id
  ) cc on true
  left join lateral (
    select count(*)::int as n, sum(v.rating)::int as s
      from public.coach_reviews v
     where v.coach_id = t.id
       and v.withdrawn_at is null
  ) r on true
  left join lateral (
    select jsonb_agg(
             jsonb_build_object(
               'kind',       k.kind,
               'title',      k.title,
               'issuer',     nullif(btrim(coalesce(k.issuer, '')), ''),
               'reference',  nullif(btrim(coalesce(k.reference, '')), ''),
               'expires_on', k.expires_on)
             order by k.kind, k.title) as items
      from public.coach_credentials k
     where k.coach_id = t.id
       and k.verification = 'self_declared'
       and (k.expires_on is null or k.expires_on >= current_date)
  ) c on true
 where t.listed = true
   and t.public_page = true
   and t.public_handle is not null
   and t.public_handle = lower(btrim(coalesce(p_handle, '')));
$function$;

revoke execute on function public.public_coach_page(text) from public;
grant execute on function public.public_coach_page(text) to anon, authenticated;


-- ═════════════════════════════════════════════════════════════════════════
-- 2 · The directory's currencies
-- ═════════════════════════════════════════════════════════════════════════
--
-- Same correction, same order. Still exactly two columns out, and still only
-- for coaches who opted into the directory.

create or replace function public.listed_trainer_currencies(p_ids uuid[])
returns table (trainer_id uuid, currency text)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select t.id,
         nullif(upper(btrim(coalesce(
           case when pr.tenant_id is not null
                then (select tn.currency from public.tenants tn where tn.id = pr.tenant_id)
                else t.currency
           end, ''))), '')
    from public.trainers t
    left join public.profiles pr on pr.id = t.id
   where t.listed = true
     and t.id = any(coalesce(p_ids, array[]::uuid[]));
$function$;

revoke execute on function public.listed_trainer_currencies(uuid[]) from public, anon;
grant execute on function public.listed_trainer_currencies(uuid[]) to authenticated;


-- ═════════════════════════════════════════════════════════════════════════
-- 3 · What to check after applying
-- ═════════════════════════════════════════════════════════════════════════
--
--   · the anon-executable SECURITY DEFINER set is still exactly two:
--
--       select p.oid::regprocedure::text
--         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--        where n.nspname = 'public' and p.prosecdef
--          and has_function_privilege('anon', p.oid, 'EXECUTE');
--
--     expected: leave_my_details(text,text,text,text), public_coach_page(text)
--
--   · `select * from public.get_advisors('security')` is clean.
