-- A coach who works online could not say so on their own public page.
--
-- ── what the page carried, and what it implied ────────────────────────────
--
-- `public_coach_page` returned a name, a tagline, a bio, specialties, offers,
-- a SESSION FEE, a join code and a review aggregate. Nothing in that list says
-- where coaching happens, and a stranger reading a per-session price with no
-- mention of distance reasonably concludes they have to turn up somewhere.
--
-- For a coach who works online that is the whole proposition inverted. Not
-- being limited to the people who can reach a particular gym is the thing they
-- put at the top of every post they write, and the one address in this product
-- they can put in a bio could not carry it.
--
-- ── null stays null, and is not rendered ──────────────────────────────────
--
-- `trainers.delivery_mode` is nullable and most rows are null: a coach who has
-- never been asked, one who skipped the question, one whose write did not land.
-- None of those is "in person". This returns the column exactly as it stands
-- and src/lib/publicProfile.ts prints nothing for null, because a page that
-- defaulted would be inventing a fact about somebody's business on a crawlable
-- URL that search engines keep.
--
-- It is the coach's OWN declaration and never the derived shape in
-- src/lib/coachDelivery.ts. That one widens when a roster read fails, which is
-- right for deciding what to put away inside the coach's app and wrong for a
-- claim published under their name: a page may only say what the coach said.
--
-- ── everything else about this function is unchanged ──────────────────────
--
-- Same arguments, same security definer, same pinned search_path, same row
-- filter (a coach who has BOTH opted into the directory and asked for a page),
-- and the same grants re-stated below. It is one more output column; the order
-- of the existing ones is untouched because web/coach.html reads them by name.

-- ── why a drop, and not just a replace ────────────────────────────────────
--
-- Adding an output column changes the row type a set-returning function
-- declares, and Postgres refuses that under `create or replace`: "cannot change
-- return type of existing function". So it is dropped first. The drop takes the
-- grants with it, which is exactly why the revoke-and-grant at the foot of this
-- file is not optional bookkeeping — without it the function would come back
-- executable by PUBLIC, and `anon` is in PUBLIC.
drop function if exists public.public_coach_page(text);

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
  credentials  jsonb,
  delivery_mode text
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
    coalesce(c.items, '[]'::jsonb),
    -- Only the three the app can set. Anything else is treated as not said,
    -- which is the same answer src/lib/publicProfile.ts gives for a value it
    -- does not recognise, so the two cannot drift into disagreeing.
    case when t.delivery_mode in ('online', 'inperson', 'hybrid') then t.delivery_mode end
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

-- Re-stated because `create or replace` grants EXECUTE to PUBLIC, which includes
-- anon. This function is one of exactly two deliberate anon entry points in this
-- database — scripts/check-grants.mjs names both — so the revoke-then-grant is
-- what keeps that list true rather than accidental.
revoke execute on function public.public_coach_page(text) from public;
grant execute on function public.public_coach_page(text) to anon, authenticated;
