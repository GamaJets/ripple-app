-- ═══════════════════════════════════════════════════════════════════════════
-- The clients who bring a coach clients, and the coach who could not see them.
--
-- Part 128 gave referrals a referrer. It gave the REFERRER two functions to read
-- their own side — `my_referrals()` and `my_referral_summary()`, both keyed on
-- `r.referrer_id = auth.uid()` — and it gave nobody else anything. The base
-- table carries one select policy, from 02-domain-schema.sql:
--
--     referrals_self   select   referred_user_id = auth.uid()
--
-- So a coach reading `referrals` directly gets ZERO ROWS AND NO ERROR, which is
-- the failure mode part 165 spends a page on: RLS filters, it does not refuse.
-- A member who has personally brought four people into a coach's book is, to
-- that coach's app, indistinguishable from one who has brought nobody.
--
-- That is the one fact a coach would act on. Referral is how a small coaching
-- business actually grows, the people doing it are on the coach's own roster,
-- and thanking them is free — but only if the coach knows who they are.
--
-- ── What this returns, and what it deliberately does not ──────────────────
--
-- COUNTS, and the coach's own client's name. Nothing else.
--
--   · No name, no first name, no id and no date for the people who were
--     REFERRED. They are somebody else's referral, they may be nobody's client,
--     and they never agreed to be listed to a coach they have not met.
--     `my_referrals()` shows a first name to the person whose code was used —
--     that is a relationship those two have — and this is not that person.
--   · No money. Not a credit, not a discount, not a projected value, not
--     "worth". REWARD_NOTE in src/lib/referralCredit.ts is the rule and it is
--     unchanged by this file: what a referral is worth is a commercial decision
--     belonging to each gym and each coach, in their own currency, and nothing
--     in this product has been told it. A schema that returned an amount would
--     be committing somebody else's business to a cost they never agreed.
--
-- ── Joined is not converted, and both are returned ────────────────────────
--
-- The same distinction part 128 draws and for the same reason: a signup, a
-- first session and a first payment are three different promises, and the one
-- this database can keep is the middle one. `converted` is derived from
-- `workouts` at read time rather than stored, exactly as `my_referral_summary`
-- derives it — a stored copy of a fact `workouts` already holds can only
-- disagree with it, and the trigger that would maintain it would sit on the
-- hottest write path in the product.
--
-- Both counts are returned on every row so that no caller can infer one from
-- the other. A coach shown "4 brought in" learns nothing about whether any of
-- them stayed, and a coach shown only conversions cannot see who is trying.
--
-- ── Scope: the caller's own clients, through the existing helper ──────────
--
-- `is_my_client(uuid)` (02-domain-schema.sql) is `clients.trainer_id =
-- auth.uid()`, which is the same test every `*_coach_read` policy in this
-- schema uses. Not a new definition of "my client": a second one is how two
-- surfaces come to disagree about who a coach coaches.
--
-- SECURITY DEFINER because the base table's only policy is the referred user's,
-- and the alternative — a `referrals_coach_r` policy on the table — would grant
-- a coach the ROW, which carries `referred_user_id` and `code`. RLS chooses
-- rows and never columns (115-the-face-that-goes-with-the-name says this at
-- length), so "the coach may see the counts and not the people" is not a
-- sentence a policy can say. Only a select list can say it, and this is that
-- select list.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.coach_referrals()
returns table (referrer_id uuid, referrer_name text, joined int, converted int)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
  select r.referrer_id,
         -- A first name, like `my_referrals()`. The coach already holds this
         -- person's full name on their own roster and the app prefers that;
         -- this is the fallback, and it is the smaller of the two on purpose.
         coalesce(nullif(btrim(split_part(btrim(p.full_name), ' ', 1)), ''), 'A client') as referrer_name,
         count(*)::int as joined,
         count(*) filter (
           where exists (select 1 from workouts w where w.user_id = r.referred_user_id)
         )::int as converted
    from referrals r
    left join profiles p on p.id = r.referrer_id
   where r.referrer_id is not null
     and is_my_client(r.referrer_id)
   group by r.referrer_id, p.full_name
   -- Most brought in first, then by name so two clients on the same count hold
   -- a stable order between reads. Without the tie-break the list reshuffles
   -- people who have done nothing, which reads on a screen as movement.
   order by count(*) desc, 2 asc
   -- The same ceiling `my_referrals()` takes. A coach with more than 200 clients
   -- who have each referred somebody is not a case this product has, and the
   -- app treats a read that came back at its cap as a prefix rather than a
   -- total — see src/lib/rowCap.ts.
   limit 200;
$fn$;

revoke execute on function public.coach_referrals() from public;
revoke execute on function public.coach_referrals() from anon;
grant execute on function public.coach_referrals() to authenticated;

comment on function public.coach_referrals() is
  'Which of the caller''s own clients have brought people in, as counts only. Returns no identifying detail about the people who were referred, and no monetary value of any kind: what a referral is worth is the gym''s or the coach''s decision and this database has never been told it.';
