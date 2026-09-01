-- ═════════════════════════════════════════════════════════════════════════
-- Repple's own numbers had nobody allowed to read them.
--
-- ── What was measured, and what turned out to be already fixed ──────────
--
-- docs/OWNER-PORTAL.md describes the platform's SaaS side — what trainers and
-- gyms pay Repple — living in `subscriptions`, `invoices` and
-- `billing_customers`, and says the screens for it were removed from the owner
-- app. Correctly: `role = 'owner'` means a GYM owner, and a gym owner has no
-- business seeing Repple's MRR.
--
-- The obvious worry on reading part 20 is that its policies grant SELECT to
-- ANY account with `role = 'owner'`, with no tenant test — one gym's owner
-- reading every other gym's trainers' plans and invoices. That is NOT open.
-- Part 39 replaced `cust_read` and `sub_read` with tenant-scoped versions, and
-- part 106 narrowed `inv_read` to the trainer alone. Both were checked before
-- this part was written and neither is touched here. Part 20's text is the
-- superseded version and is left exactly as it is: rewriting history in a part
-- file is how a re-run stops being a re-run.
--
-- What IS missing is the other end. After those two parts, the reader set for
-- the platform's own book is: the trainer themselves, and the owner of that
-- trainer's own gym. Nobody at Repple is on that list. So "Repple's own
-- numbers have no screen" is not a missing screen — it is a missing READER,
-- and a screen built without this part would have shown its author an empty
-- table and called it zero revenue.
--
-- ── Why an allowlist TABLE and not a role value ─────────────────────────
--
-- `profiles.role` is the obvious place and it is the wrong one, for a reason
-- this codebase has already paid for once: the platform LETS PEOPLE SIGN UP AS
-- AN OWNER. That is what made the pre-part-39 `owner-metrics` leak reachable
-- by anybody who registered — the header of supabase/functions/owner-metrics
-- spells it out. A fourth role would be one CHECK constraint and one signup
-- form away from the same shape, and the failure would be silent.
--
-- An explicit table cannot be reached by signing up. It has no INSERT policy
-- at all, for anybody: a row can only be written by the service role or by
-- somebody with a SQL console, which is to say by the person who owns the
-- project. It ships EMPTY, and an empty allowlist means every screen built on
-- it says "not your console" to everybody, including its author, until a row
-- is deliberately added.
--
-- ── What this does NOT widen ────────────────────────────────────────────
--
-- Nothing for gym owners. The three policies below are ADDITIVE and are
-- separate policies rather than an extra `or` bolted onto the existing ones,
-- which matters twice over:
--
--   · a re-run of part 39 or part 106 replaces their own policies and leaves
--     these standing, so applying the parts in any order converges;
--   · the reader set granted here is visible as its own line in
--     `pg_policies`, named for what it is, instead of being an extra clause
--     inside a policy about gym owners that somebody later "simplifies".
--
-- Postgres OR's permissive policies for the same command, so these add exactly
-- one reader and take none away.
--
-- SELECT only. There is deliberately no write anywhere in this part: the
-- platform's billing rows are written by Stripe's webhook with the service
-- role and by nothing else, and an admin who could edit an invoice is an admin
-- who can edit an invoice.
--
-- Idempotent; safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════

create table if not exists public.platform_admins (
  -- The account. `profiles` rather than `auth.users`, matching the rest of
  -- this schema, so a deleted account takes its admin row with it rather than
  -- leaving a dangling grant nothing renders.
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  -- Why this person is on the list, in words, for whoever reads the table in
  -- two years. Not an audit trail and not pretending to be one.
  note       text,
  added_at   timestamptz not null default now()
);

alter table public.platform_admins enable row level security;

-- ── the ONLY policy on this table ───────────────────────────────────────
--
-- An admin may read their own row, and that is the whole of it. There is:
--
--   · no INSERT policy, so no authenticated account can add itself or anybody
--     else. This is the property that makes the table safe;
--   · no UPDATE and no DELETE policy, so nobody can remove somebody else from
--     the list — or themselves, which would be an admin able to hide;
--   · no read of OTHER admins' rows. A list of who at Repple has access is not
--     something one of them needs from a browser, and a table that returned it
--     would be a list of high-value accounts behind one leaked session.
--
-- The service role bypasses all of this, which is how a row gets in.
drop policy if exists pa_self on public.platform_admins;
create policy pa_self on public.platform_admins for select
  using (user_id = auth.uid());

-- ── the test the policies below use ─────────────────────────────────────
--
-- SECURITY DEFINER and `search_path` pinned, exactly as `is_owner_of` is
-- (part 28), and for the same two reasons: the policies on the billing tables
-- must not depend on the caller being able to read `platform_admins` through
-- RLS, and a function used inside a policy with a mutable search_path is a
-- function somebody can shadow.
--
-- STABLE, not VOLATILE: it is called once per row of a scan and the answer
-- cannot change within a statement.
create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path to 'public', 'pg_temp'
as $function$
  select exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid());
$function$;

revoke all on function public.is_platform_admin() from public, anon;
grant  execute on function public.is_platform_admin() to authenticated;

-- ── the three reads ─────────────────────────────────────────────────────
--
-- Named for the reader rather than for the table, so `pg_policies` says who
-- these are for. Each is additive: the trainer's own policy and the gym
-- owner's tenant-scoped one (parts 39 and 106) are untouched and still apply.
drop policy if exists sub_platform_admin on public.subscriptions;
create policy sub_platform_admin on public.subscriptions for select
  using (public.is_platform_admin());

drop policy if exists inv_platform_admin on public.invoices;
create policy inv_platform_admin on public.invoices for select
  using (public.is_platform_admin());

drop policy if exists cust_platform_admin on public.billing_customers;
create policy cust_platform_admin on public.billing_customers for select
  using (public.is_platform_admin());

-- The names behind the ids. Without this the platform screen can count
-- subscriptions and cannot say whose — and `profiles` is the one table where
-- widening a read is worth stating out loud rather than doing quietly.
--
-- Deliberately NOT added. `profiles` already carries several policies and the
-- platform screen does not need a name to answer "what is Repple's MRR" — it
-- needs a count, a plan and a status, all of which are on `subscriptions`
-- itself. A screen that wanted to name a trainer would be a different screen
-- with a different argument to make, and it would be making it about every
-- person on the platform at once.

comment on table public.platform_admins is
  'Who at Repple may read the platform''s own billing. An explicit allowlist and NOT a profiles.role value, because the platform lets people sign up as an owner — which is exactly how the pre-part-39 owner-metrics leak was reachable. It has no INSERT, UPDATE or DELETE policy for anybody: a row can only be written by the service role. It ships empty, and an empty allowlist means the platform screen refuses everybody until somebody is deliberately added.';
comment on column public.platform_admins.note is
  'Why this person is on the list, for whoever reads this table in two years. Not an audit trail.';
comment on function public.is_platform_admin() is
  'True when the caller is on the platform_admins allowlist. SECURITY DEFINER with a pinned search_path, like is_owner_of, so the billing policies do not depend on the caller being able to read platform_admins through RLS.';
